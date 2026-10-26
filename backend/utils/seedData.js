const bcrypt = require('bcryptjs');
const User = require('../models/User');
const ConsumptionHistory = require('../models/ConsumptionHistory');
const smartContracts = require('../blockchain/smartContracts');

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

async function seedUsers() {
  const created = [];
  for (const u of DEMO_USERS) {
    const existing = await User.findOne({ username: u.username });
    if (existing) {
      created.push(existing);
      continue;
    }
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const user = await User.create({ ...u, passwordHash });
    created.push(user);
  }
  return created;
}

function actorFor(user) {
  return { org: user.org, username: user.username, depotId: user.depotId };
}

async function seedLotsAndLedger(users) {
  const factory = users.find((u) => u.org === 'OrdnanceFactory');
  const depot1 = users.find((u) => u.username === 'depot1_officer');
  const depot2 = users.find((u) => u.username === 'depot2_officer');
  const unitAlpha = users.find((u) => u.username === 'unit_alpha');
  const unitBravo = users.find((u) => u.username === 'unit_bravo');

  let lotCounter = 1;
  const manufactureBase = Date.now() - 400 * 86400000; // up to ~13 months old

  for (const { ammoType, caliber } of AMMO_TYPES) {
    for (let i = 0; i < 4; i++) {
      const lotID = `LOT-${ammoType.replace(/[^0-9A-Za-z]/g, '')}-${String(lotCounter).padStart(3, '0')}`;
      lotCounter += 1;

      const manufactureDate = new Date(manufactureBase + i * 20 * 86400000);
      const quantity = 800 + Math.round(Math.random() * 600);

      await smartContracts.registerLot(actorFor(factory), { lotID, ammoType, caliber, quantity, manufactureDate });

      // Send every other lot to Depot-01, the rest to Depot-02
      const targetDepot = i % 2 === 0 ? depot1 : depot2;
      await smartContracts.issueLot(actorFor(factory), { lotID, toOrg: 'Depot', toId: targetDepot.depotId });

      // A couple of lots per ammo type go further out to a field unit and get partially consumed
      if (i === 0) {
        const targetUnit = targetDepot.depotId === 'DEPOT-01' ? unitAlpha : unitBravo;
        await smartContracts.issueLot(actorFor(targetDepot), { lotID, toOrg: 'FieldUnit', toId: targetUnit.depotId });
        await smartContracts.recordConsumption(actorFor(targetUnit), { lotID, quantity: Math.round(quantity * 0.4) });

        // Push one deliberately hot/humid reading so the degradation dashboard has data on first run.
        if (i === 0 && ammoType === AMMO_TYPES[0].ammoType) {
          await smartContracts.updateStorageCondition(actorFor(targetUnit), {
            lotID,
            temperatureC: 41,
            humidityPct: 78
          });
        }
      } else {
        // Leave remaining lots in depot storage with a normal condition reading.
        await smartContracts.updateStorageCondition(actorFor(targetDepot), {
          lotID,
          temperatureC: 24 + Math.round(Math.random() * 4),
          humidityPct: 38 + Math.round(Math.random() * 8)
        });
      }
    }
  }
}

async function seedConsumptionHistory() {
  const now = new Date();
  for (const { ammoType } of AMMO_TYPES) {
    // Base monthly demand differs per ammo type, with a mild upward trend and noise,
    // so the linear-regression and moving-average forecasts diverge slightly (useful for the viva).
    const base = ammoType.startsWith('5.56') ? 900 : ammoType.startsWith('7.62') ? 500 : 700;
    for (let m = 11; m >= 0; m--) {
      const period = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const periodStr = `${period.getFullYear()}-${String(period.getMonth() + 1).padStart(2, '0')}`;
      const trend = (11 - m) * 8; // slow upward drift over the year
      const noise = Math.round((Math.random() - 0.5) * 60);
      const quantityIssued = Math.max(0, base + trend + noise + 50);
      const quantityConsumed = Math.max(0, base + trend + noise);

      await ConsumptionHistory.updateOne(
        { ammoType, period: periodStr },
        { $set: { quantityIssued, quantityConsumed } },
        { upsert: true }
      );
    }
  }
}

async function seedAll() {
  const users = await seedUsers();
  await seedLotsAndLedger(users);
  await seedConsumptionHistory();
  return { users: users.map((u) => u.username), demoPassword: DEMO_PASSWORD };
}

module.exports = { seedAll, AMMO_TYPES, DEMO_USERS, DEMO_PASSWORD };
