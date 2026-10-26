const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Block = require('../models/Block');
const Lot = require('../models/Lot');
const Requisition = require('../models/Requisition');
const InspectionAlert = require('../models/InspectionAlert');
const AnomalyFlag = require('../models/AnomalyFlag');
const SensorReading = require('../models/SensorReading');
const DeviceState = require('../models/DeviceState');
const ConsumptionHistory = require('../models/ConsumptionHistory');

const smartContracts = require('../blockchain/smartContracts');
const merkleService = require('../services/merkleService');

const AMMO_TYPES = [
  { ammoType: '5.56x45mm', caliber: '5.56mm NATO' },
  { ammoType: '7.62x51mm', caliber: '7.62mm NATO' },
  { ammoType: '9x19mm', caliber: '9mm Parabellum' }
];

const DEMO_PASSWORD = 'Password123!';

const DEMO_USERS = [
  { username: 'commander', org: 'Commander', displayName: 'Cdr. A. Rao', depotId: null },
  { username: 'factory_officer', org: 'OrdnanceFactory', displayName: 'OFB Officer S. Iyer', depotId: null },
  { username: 'depot1_officer', org: 'Depot', displayName: 'Depot Officer R. Singh', depotId: 'DEPOT-01' },
  { username: 'depot2_officer', org: 'Depot', displayName: 'Depot Officer K. Nair', depotId: 'DEPOT-02' },
  { username: 'unit_alpha', org: 'FieldUnit', displayName: 'Unit Alpha QM', depotId: 'UNIT-ALPHA' },
  { username: 'unit_bravo', org: 'FieldUnit', displayName: 'Unit Bravo QM', depotId: 'UNIT-BRAVO' }
];

async function cleanDatabase() {
  console.log('[seed] clearing old records & noisy simulator blocks...');
  await Promise.all([
    Block.deleteMany({}),
    Lot.deleteMany({}),
    Requisition.deleteMany({}),
    InspectionAlert.deleteMany({}),
    AnomalyFlag.deleteMany({}),
    SensorReading.deleteMany({}),
    DeviceState.deleteMany({}),
    ConsumptionHistory.deleteMany({}),
    User.deleteMany({})
  ]);
  console.log('[seed] database cleanly purged.');
}

async function seedUsers() {
  const created = [];
  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const user = await User.create({ ...u, passwordHash });
    created.push(user);
  }
  return created;
}

function actorFor(user) {
  return { org: user.org, username: user.username, depotId: user.depotId };
}

async function seedCuratedLots(users) {
  const factory = users.find((u) => u.org === 'OrdnanceFactory');
  const depot1 = users.find((u) => u.username === 'depot1_officer');
  const depot2 = users.find((u) => u.username === 'depot2_officer');
  const unitAlpha = users.find((u) => u.username === 'unit_alpha');
  const unitBravo = users.find((u) => u.username === 'unit_bravo');

  const now = Date.now();
  const dayMs = 86400000;

  // 1. LOT-FAC-556-01: At Factory (Status: REGISTERED)
  console.log('[seed] creating LOT-FAC-556-01 (OrdnanceFactory)...');
  await smartContracts.registerLot(actorFor(factory), {
    lotID: 'LOT-FAC-556-01',
    ammoType: '5.56x45mm',
    caliber: '5.56mm NATO',
    quantity: 5000,
    manufactureDate: new Date(now - 10 * dayMs)
  });
  await merkleService.createCheckpoint(actorFor(factory), 'LOT-FAC-556-01');

  // 2. LOT-DEP1-762-01: At Depot 1 (Status: IN_STORAGE)
  console.log('[seed] creating LOT-DEP1-762-01 (Depot 1)...');
  await smartContracts.registerLot(actorFor(factory), {
    lotID: 'LOT-DEP1-762-01',
    ammoType: '7.62x51mm',
    caliber: '7.62mm NATO',
    quantity: 3500,
    manufactureDate: new Date(now - 45 * dayMs)
  });
  await smartContracts.issueLot(actorFor(factory), {
    lotID: 'LOT-DEP1-762-01',
    toOrg: 'Depot',
    toId: 'DEPOT-01'
  });
  await merkleService.createCheckpoint(actorFor(depot1), 'LOT-DEP1-762-01');

  // 3. LOT-DEP1-9MM-01: At Depot 1 (Status: IN_STORAGE)
  console.log('[seed] creating LOT-DEP1-9MM-01 (Depot 1)...');
  await smartContracts.registerLot(actorFor(factory), {
    lotID: 'LOT-DEP1-9MM-01',
    ammoType: '9x19mm',
    caliber: '9mm Parabellum',
    quantity: 2000,
    manufactureDate: new Date(now - 60 * dayMs)
  });
  await smartContracts.issueLot(actorFor(factory), {
    lotID: 'LOT-DEP1-9MM-01',
    toOrg: 'Depot',
    toId: 'DEPOT-01'
  });
  await merkleService.createCheckpoint(actorFor(depot1), 'LOT-DEP1-9MM-01');

  // 4. LOT-DEP2-556-01: At Depot 2 (Status: IN_STORAGE)
  console.log('[seed] creating LOT-DEP2-556-01 (Depot 2)...');
  await smartContracts.registerLot(actorFor(factory), {
    lotID: 'LOT-DEP2-556-01',
    ammoType: '5.56x45mm',
    caliber: '5.56mm NATO',
    quantity: 4000,
    manufactureDate: new Date(now - 30 * dayMs)
  });
  await smartContracts.issueLot(actorFor(factory), {
    lotID: 'LOT-DEP2-556-01',
    toOrg: 'Depot',
    toId: 'DEPOT-02'
  });
  await merkleService.createCheckpoint(actorFor(depot2), 'LOT-DEP2-556-01');

  // 5. LOT-ALPHA-556-01: At Field Unit Alpha (Status: ISSUED, Partially Consumed)
  console.log('[seed] creating LOT-ALPHA-556-01 (Field Unit Alpha)...');
  await smartContracts.registerLot(actorFor(factory), {
    lotID: 'LOT-ALPHA-556-01',
    ammoType: '5.56x45mm',
    caliber: '5.56mm NATO',
    quantity: 2500,
    manufactureDate: new Date(now - 90 * dayMs)
  });
  await smartContracts.issueLot(actorFor(factory), {
    lotID: 'LOT-ALPHA-556-01',
    toOrg: 'Depot',
    toId: 'DEPOT-01'
  });
  await smartContracts.issueLot(actorFor(depot1), {
    lotID: 'LOT-ALPHA-556-01',
    toOrg: 'FieldUnit',
    toId: 'UNIT-ALPHA'
  });
  await smartContracts.recordConsumption(actorFor(unitAlpha), {
    lotID: 'LOT-ALPHA-556-01',
    quantity: 1000
  });
  await merkleService.createCheckpoint(actorFor(unitAlpha), 'LOT-ALPHA-556-01');

  // 6. LOT-ALPHA-9MM-01: At Field Unit Alpha (Status: ISSUED)
  console.log('[seed] creating LOT-ALPHA-9MM-01 (Field Unit Alpha)...');
  await smartContracts.registerLot(actorFor(factory), {
    lotID: 'LOT-ALPHA-9MM-01',
    ammoType: '9x19mm',
    caliber: '9mm Parabellum',
    quantity: 1200,
    manufactureDate: new Date(now - 70 * dayMs)
  });
  await smartContracts.issueLot(actorFor(factory), {
    lotID: 'LOT-ALPHA-9MM-01',
    toOrg: 'Depot',
    toId: 'DEPOT-01'
  });
  await smartContracts.issueLot(actorFor(depot1), {
    lotID: 'LOT-ALPHA-9MM-01',
    toOrg: 'FieldUnit',
    toId: 'UNIT-ALPHA'
  });
  await merkleService.createCheckpoint(actorFor(unitAlpha), 'LOT-ALPHA-9MM-01');

  // 7. LOT-BRAVO-762-01: At Field Unit Bravo (Status: ISSUED)
  console.log('[seed] creating LOT-BRAVO-762-01 (Field Unit Bravo)...');
  await smartContracts.registerLot(actorFor(factory), {
    lotID: 'LOT-BRAVO-762-01',
    ammoType: '7.62x51mm',
    caliber: '7.62mm NATO',
    quantity: 2200,
    manufactureDate: new Date(now - 40 * dayMs)
  });
  await smartContracts.issueLot(actorFor(factory), {
    lotID: 'LOT-BRAVO-762-01',
    toOrg: 'Depot',
    toId: 'DEPOT-02'
  });
  await smartContracts.issueLot(actorFor(depot2), {
    lotID: 'LOT-BRAVO-762-01',
    toOrg: 'FieldUnit',
    toId: 'UNIT-BRAVO'
  });
  await merkleService.createCheckpoint(actorFor(unitBravo), 'LOT-BRAVO-762-01');

  // 8. LOT-INSPECT-01: Adverse storage condition, FLAGGED_FOR_INSPECTION
  console.log('[seed] creating LOT-INSPECT-01 with adverse storage condition alert...');
  await smartContracts.registerLot(actorFor(factory), {
    lotID: 'LOT-INSPECT-01',
    ammoType: '5.56x45mm',
    caliber: '5.56mm NATO',
    quantity: 1500,
    manufactureDate: new Date(now - 120 * dayMs)
  });
  await smartContracts.issueLot(actorFor(factory), {
    lotID: 'LOT-INSPECT-01',
    toOrg: 'Depot',
    toId: 'DEPOT-01'
  });
  await smartContracts.updateStorageCondition(actorFor(depot1), {
    lotID: 'LOT-INSPECT-01',
    temperatureC: 45.5,
    humidityPct: 84.0
  });
  await merkleService.createCheckpoint(actorFor(depot1), 'LOT-INSPECT-01');

  // Seed sample AnomalyFlag for Commander Anomaly Console
  console.log('[seed] creating demonstration anomaly flag...');
  await AnomalyFlag.create({
    rule: 'TRANSFER_QUANTITY_SPIKE',
    lotID: 'LOT-DEP1-762-01',
    unitId: 'DEPOT-01',
    details: {
      ammoType: '7.62x51mm',
      quantity: 12000,
      recentAverage: 2500,
      factor: 3
    },
    severity: 'HIGH',
    source: 'both',
    mlScore: 0.88,
    topFeatures: [
      { feature: 'quantity_ratio_typical', value: 4.8, zScore: 5.2 },
      { feature: 'events_last_hour_lot', value: 4, zScore: 3.8 }
    ],
    reason: 'Quantity spike confirmed by Isolation Forest (z=5.2)'
  });
}

async function seedConsumptionHistory() {
  const now = new Date();
  const configs = [
    { ammoType: '5.56x45mm', base: 9000 },
    { ammoType: '7.62x51mm', base: 5500 },
    { ammoType: '9x19mm', base: 4000 }
  ];

  for (const { ammoType, base } of configs) {
    for (let m = 11; m >= 0; m--) {
      const period = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const periodStr = `${period.getFullYear()}-${String(period.getMonth() + 1).padStart(2, '0')}`;
      const trend = (11 - m) * 45;
      const noise = Math.round((Math.sin(m) * 0.15) * base);
      const quantityConsumed = Math.max(0, base + trend + noise);
      const quantityIssued = quantityConsumed + Math.round(base * 0.08);

      await ConsumptionHistory.create({
        ammoType,
        period: periodStr,
        quantityIssued,
        quantityConsumed
      });
    }
  }
}

async function seedAll() {
  await cleanDatabase();
  const users = await seedUsers();
  await seedCuratedLots(users);
  await seedConsumptionHistory();
  return { users: users.map((u) => u.username), demoPassword: DEMO_PASSWORD };
}

module.exports = { seedAll, AMMO_TYPES, DEMO_USERS, DEMO_PASSWORD };
