/**
 * degradationService.js
 * ----------------------
 * Deliberately NOT a machine-learning model. The brief calls for a plain,
 * explainable formula a viva panel can follow on a whiteboard:
 *
 *   1. Temperature term (Arrhenius-style rule of thumb): reaction/degradation
 *      rate roughly DOUBLES for every +10C above a baseline storage
 *      temperature. We turn that into a multiplier:
 *          tempFactor = 2 ^ ((avgTemp - baselineTemp) / 10)
 *      Below the baseline the factor drops below 1 (cooler storage is safer);
 *      above it, the factor grows exponentially, matching real propellant/
 *      primer chemistry behaviour at a hand-wavy but directionally correct
 *      level - exactly what's defensible for a capstone, not a certified
 *      ballistics model.
 *
 *   2. Humidity term: linear penalty above a "dry" reference humidity,
 *      because moisture ingress (corrosion, propellant hydrolysis) scales
 *      roughly linearly with excess humidity over the range that matters for
 *      storage (this is a simplification, stated as such).
 *
 *   3. Time-in-storage term: linear creep with days in storage, capped, so a
 *      lot sitting for years under otherwise fine conditions still trends
 *      upward slowly.
 *
 * The three terms combine into a 0-100 risk score:
 *   riskScore = clamp( baseRisk * tempFactor + humidityPenalty + timePenalty, 0, 100 )
 */

const BASE_RISK = 5; // starting risk for a freshly manufactured lot at baseline conditions
const BASELINE_TEMP_C = Number(process.env.DEGRADATION_BASELINE_TEMP_C || 25);
const DRY_HUMIDITY_PCT = 40; // reference "safe" relative humidity
const HUMIDITY_PENALTY_PER_PCT = 0.8; // risk points per % RH above the dry reference
const TIME_PENALTY_PER_YEAR = 6; // risk points per year in storage
const MAX_RISK = 100;

function computeTempFactor(temperatureC) {
  return Math.pow(2, (temperatureC - BASELINE_TEMP_C) / 10);
}

function computeHumidityPenalty(humidityPct) {
  return Math.max(0, humidityPct - DRY_HUMIDITY_PCT) * HUMIDITY_PENALTY_PER_PCT;
}

function computeTimePenalty(daysInStorage) {
  const years = daysInStorage / 365;
  return years * TIME_PENALTY_PER_YEAR;
}

/**
 * @param {{lotID: string, temperatureC: number, humidityPct: number, daysInStorage: number}} params
 * @returns {{riskScore: number, breakdown: object}}
 */
async function computeRiskScore({ lotID, temperatureC, humidityPct, daysInStorage }) {
  const tempFactor = computeTempFactor(temperatureC);
  const humidityPenalty = computeHumidityPenalty(humidityPct);
  const timePenalty = computeTimePenalty(daysInStorage);

  const raw = BASE_RISK * tempFactor + humidityPenalty + timePenalty;
  const riskScore = Math.round(Math.min(MAX_RISK, Math.max(0, raw)) * 10) / 10;

  return {
    riskScore,
    breakdown: {
      baseRisk: BASE_RISK,
      tempFactor: Math.round(tempFactor * 1000) / 1000,
      humidityPenalty: Math.round(humidityPenalty * 100) / 100,
      timePenalty: Math.round(timePenalty * 100) / 100,
      baselineTempC: BASELINE_TEMP_C,
      dryHumidityPct: DRY_HUMIDITY_PCT
    }
  };
}

module.exports = { computeRiskScore, BASELINE_TEMP_C, DRY_HUMIDITY_PCT };
