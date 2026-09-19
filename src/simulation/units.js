/**
 * Centralized measurement configuration — the single place that says which units
 * the digital twin uses. The Twin is the source of truth: the simulation state
 * stores values in these units and every view (Twin panels, Dashboard) formats
 * them through this module, so a value can never appear in two different units.
 */
export const UNITS = {
  pressure: 'bar',       // gauge
  flow: 'kg/h',
  temperature: '°C',
  moisture: '%',
  position: '%',
  speed: 'rpm',
  paperSpeed: 'm/min',
  time: 's',
};

/**
 * Demo / simulation thresholds (configurable — NOT universal engineering limits).
 * Used by detectors' presentation and the Dashboard's severity logic.
 */
export const THRESHOLDS = {
  positionErrorWarning: 10,     // % commanded-vs-actual error (V-Port detector threshold)
  flowDeviationWarning: 10,     // % actual vs expected/target flow → ATTENTION
  flowDeviationCritical: 25,    // % → CRITICAL
  trimHealthWarning: 75,        // % trim health below this → early warning
  trimHealthCritical: 50,       // %
  moistureTarget: 5.0,          // % paper moisture after the Yankee (demo target)
};

const int = (v) => Math.round(v).toLocaleString('en-US');
const dec = (v, d) => Number(v).toFixed(d);

/** Formatters return "value unit" strings; use *Num for the bare number. */
export const fmt = {
  flow: (v) => `${int(v)} ${UNITS.flow}`,
  flowNum: (v) => int(v),
  pressure: (v, d = 1) => `${dec(v, d)} ${UNITS.pressure}`,
  pressureNum: (v, d = 1) => dec(v, d),
  temperature: (v) => `${Math.round(v)} ${UNITS.temperature}`,
  temperatureNum: (v) => String(Math.round(v)),
  moisture: (v) => `${dec(v, 1)} ${UNITS.moisture}`,
  moistureNum: (v) => dec(v, 1),
  position: (v) => `${Math.round(v)}${UNITS.position}`,
  percent: (v, d = 0) => `${dec(v, d)}%`,
  signedPercent: (v, d = 0) => `${v >= 0 ? '+' : '−'}${dec(Math.abs(v), d)}%`,
  speed: (v) => `${dec(v, 1)} ${UNITS.speed}`,
  seconds: (v, d = 1) => `${dec(v, d)} ${UNITS.time}`,
};

/** Flow deviation in % of expected: ((actual − expected) / expected) × 100. */
export function flowDeviationPercent(actual, expected) {
  if (!expected || expected <= 0) return 0;
  return ((actual - expected) / expected) * 100;
}

/**
 * Centralized severity logic. Component statuses come from the anomaly engine:
 * NORMAL | DETECTING | WARNING | ANOMALY.
 *   level: 'normal' | 'attention' | 'critical'
 */
export function levelOfStatus(status) {
  if (status === 'ANOMALY') return 'critical';
  if (status === 'WARNING' || status === 'DETECTING') return 'attention';
  return 'normal';
}

export function levelOfDeviation(deviationPercent) {
  const d = Math.abs(deviationPercent);
  if (d > THRESHOLDS.flowDeviationCritical) return 'critical';
  if (d > THRESHOLDS.flowDeviationWarning) return 'attention';
  return 'normal';
}

/** Highest of several levels. */
export function maxLevel(...levels) {
  if (levels.includes('critical')) return 'critical';
  if (levels.includes('attention')) return 'attention';
  return 'normal';
}

export const LEVEL_LABEL = { normal: 'Normal', attention: 'Attention', critical: 'Critical' };
export const SYSTEM_LABEL = { normal: 'System Healthy', attention: 'Attention Required', critical: 'Critical' };
