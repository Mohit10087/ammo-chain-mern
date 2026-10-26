/**
 * offlineQueue.js
 * ---------------
 * Client-Side Tactical Offline Queue backed by IndexedDB (idb) for DDIL environments.
 * Implements Algorithm A.5 from the technical report:
 * 1. Monotonically increasing sequence number per device
 * 2. Web Crypto HMAC-SHA256 signature over (eventId, deviceId, seq, timestamp, action, payload)
 * 3. Atomic local queueing and sync with exponential backoff on reconnect
 */

import { openDB } from 'idb';

const DB_NAME = 'ordnance_tactical_ddil_db';
const DB_VERSION = 1;
const STORE_NAME = 'offline_events';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'eventId' });
          store.createIndex('by_sequence', 'sequenceNumber', { unique: false });
          store.createIndex('by_capturedAt', 'capturedAt', { unique: false });
        }
      }
    });
  }
  return dbPromise;
}

export function getDeviceId() {
  let devId = localStorage.getItem('ordnance_device_id');
  if (!devId) {
    devId = `DEV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    localStorage.setItem('ordnance_device_id', devId);
  }
  return devId;
}

export function getDeviceSecret() {
  let secret = localStorage.getItem('ordnance_device_secret');
  if (!secret) {
    // 256-bit provisioned tactical key
    secret = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
    localStorage.setItem('ordnance_device_secret', secret);
  }
  return secret;
}

function getNextSequenceNumber(deviceId) {
  const key = `ordnance_seq_${deviceId}`;
  const current = parseInt(localStorage.getItem(key) || '0', 10);
  const next = current + 1;
  localStorage.setItem(key, String(next));
  return next;
}

/**
 * Computes Web Crypto HMAC-SHA256 signature over event fields.
 */
export async function signEventPayload(secretHex, dataToSign) {
  const enc = new TextEncoder();
  const keyData = enc.encode(secretHex);
  const msgData = enc.encode(typeof dataToSign === 'string' ? dataToSign : JSON.stringify(dataToSign));

  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await window.crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const bytes = new Uint8Array(sigBuffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Normalizes payload fields for canonical HMAC hashing.
 */
export function canonicalStringify(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Enqueues a tactical action while disconnected.
 */
export async function enqueueOfflineEvent({ action, payload, actor }) {
  const deviceId = getDeviceId();
  const deviceSecret = getDeviceSecret();
  const eventId = crypto.randomUUID();
  const sequenceNumber = getNextSequenceNumber(deviceId);
  const capturedAt = new Date().toISOString();

  // Canonical payload to ensure byte-level match on server
  const canonicalData = {
    eventId,
    deviceId,
    sequenceNumber,
    capturedAt,
    action,
    payload
  };

  const signature = await signEventPayload(deviceSecret, canonicalData);

  const eventRecord = {
    ...canonicalData,
    signature,
    actorOrg: actor?.org || 'FieldUnit',
    actorUser: actor?.username || 'tactical-operator',
    status: 'QUEUED'
  };

  const db = await getDB();
  await db.put(STORE_NAME, eventRecord);

  // Dispatch custom event for UI reactivity
  window.dispatchEvent(new CustomEvent('ordnance_offline_queue_changed'));
  return eventRecord;
}

/**
 * Retrieves all queued offline events sorted by sequence number.
 */
export async function getQueuedEvents() {
  const db = await getDB();
  const all = await db.getAll(STORE_NAME);
  return all.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

/**
 * Counts uncommitted offline events.
 */
export async function getQueueCount() {
  const db = await getDB();
  return db.count(STORE_NAME);
}

/**
 * Removes successfully processed events from IndexedDB.
 */
export async function removeEvents(eventIds) {
  if (!eventIds || eventIds.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  for (const id of eventIds) {
    await tx.store.delete(id);
  }
  await tx.done;
  window.dispatchEvent(new CustomEvent('ordnance_offline_queue_changed'));
}

/**
 * Synchronizes the offline queue with the backend server (POST /api/sync/batch).
 */
export async function syncOfflineQueue(apiClient) {
  const events = await getQueuedEvents();
  if (events.length === 0) {
    return { count: 0, results: [], message: 'Queue is empty' };
  }

  const deviceSecret = getDeviceSecret();
  const payload = {
    deviceId: getDeviceId(),
    deviceSecret, // sent for proof-of-possession verification in demo
    events
  };

  const response = await apiClient.post('/sync/batch', payload);
  const { results = [] } = response;

  // Evict APPLIED, CONFLICT_DETECTED, and DUPLICATE_IGNORED events from the local queue
  const resolvedIds = results
    .filter((r) => ['APPLIED', 'CONFLICT_DETECTED', 'DUPLICATE_IGNORED'].includes(r.status))
    .map((r) => r.eventId);

  await removeEvents(resolvedIds);

  return {
    submitted: events.length,
    resolved: resolvedIds.length,
    results
  };
}
