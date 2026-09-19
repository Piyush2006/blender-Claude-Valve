import { simulationState as S } from './simulationState.js';
import { anomalyDef } from './anomalyCatalog.js';

/**
 * Anomaly engine.
 *
 * One detector runs for the component + anomaly selected in the Anomaly
 * Simulation panel (simulationState.anomalySim). Every detector answers the
 * same question — "is the abnormal condition present right now?" — and shares
 * the persistence timer: condition true for ≥ persistenceRequired (2 s) →
 * ANOMALY (or WARNING for warning-severity anomalies), true but not yet
 * persisted → DETECTING, false → NORMAL (timer reset).
 *
 * V-Port (unchanged from the original implementation):
 *   normal / positionMismatch : |commanded − actual| > 10 %
 *   sticking                  : error > 10 % AND actual is not moving
 *   slowResponse              : a move took longer than the acceptable time (latched per move)
 *   hunting                   : actual keeps crossing the command with a swing > 4 %
 *   trimWear                  : actual flow exceeds expected flow by > 10 %
 * ESD, Ball, Safety valve, Steam trap and Check valve detectors are listed below.
 */
export const VPORT_MISMATCH = 'VPORT_POSITION_MISMATCH';
export const VPORT_STICKING = 'VPORT_STICKING';
export const VPORT_SLOW_RESPONSE = 'VPORT_SLOW_RESPONSE';
export const VPORT_HUNTING = 'VPORT_HUNTING';
export const VPORT_TRIM_WEAR = 'VPORT_TRIM_WEAR';

export const ANOMALY_LABELS = {
  VPORT_POSITION_MISMATCH: 'V-Port Position Mismatch',
  VPORT_STICKING: 'V-Port Sticking',
  VPORT_SLOW_RESPONSE: 'V-Port Slow Response',
  VPORT_HUNTING: 'V-Port Hunting / Oscillation',
  VPORT_TRIM_WEAR: 'V-Port Trim Wear',
  ESD_FAIL_TO_CLOSE: 'ESD Fail to Close',
  ESD_SLOW_SHUTDOWN: 'ESD Slow Shutdown',
  ESD_PARTIAL_CLOSURE: 'ESD Partial Closure',
  ESD_LOW_AIR: 'ESD Low Pneumatic Air Pressure',
  BALL_FAIL_TO_OPEN: 'Ball Valve Fail to Open',
  BALL_FAIL_TO_CLOSE: 'Ball Valve Fail to Close',
  BALL_SLOW_OPERATION: 'Ball Valve Slow Operation',
  BALL_PASSING: 'Ball Valve Passing / Leakage',
  PSV_UNEXPECTED_OPENING: 'Safety Valve Unexpected Opening',
  PSV_FAILURE_TO_OPEN: 'Safety Valve Failure to Open',
  PSV_CHATTERING: 'Safety Valve Chattering',
  TRAP_FAILED_OPEN: 'Steam Trap Possible Failed Open',
  TRAP_BLOCKED: 'Steam Trap Blocked',
  TRAP_POOR_REMOVAL: 'Steam Trap Poor Condensate Removal',
  CHECK_REVERSE_FLOW: 'Check Valve Reverse Flow',
  CHECK_FAILURE_TO_OPEN: 'Check Valve Failure to Open',
  CHECK_FAILURE_TO_CLOSE: 'Check Valve Failure to Close',
};

export const LIMITS = {
  stickVelocity: 1.0,     // %/s below which the valve counts as "not moving"
  huntingSwing: 4,        // % peak-to-peak movement around the command
  huntingCrossings: 3,    // sign changes of (actual − command) inside the window
  huntingWindow: 3,       // s
  trimWearDeviation: 10,  // % flow above expected
  trapFailedOpenDeltaT: 15,   // °C — outlet within this of inlet = live steam passing
  trapBlockedOutlet: 60,      // °C — outlet colder than this with no discharge = blocked
  trapPoorOutlet: 85,         // °C — outlet colder than this = sluggish removal
  chatterOpenings: 3,         // openings inside 3 s
};

const STATUS_KEYS = ['ballValve', 'esdValve', 'vPortValve', 'safetyValve', 'steamTrap', 'checkValve', 'yankee', 'rotaryJoint', 'separator'];

// Sliding window of (t, actual − command) samples for the hunting detector.
const huntingSamples = [];

export function tickAnomalies(dt) {
  const a = S.anomaly;
  const { component, anomaly } = S.anomalySim;
  const def = anomalyDef(component, anomaly);
  const v = S.vPortValve;
  v.positionError = Math.abs(v.commandPosition - v.actualPosition);

  let r;
  switch (component) {
    case 'esdValve': r = detectEsd(anomaly); break;
    case 'ballValve': r = detectBall(anomaly); break;
    case 'safetyValve': r = detectSafetyValve(anomaly); break;
    case 'steamTrap': r = detectSteamTrap(anomaly); break;
    case 'checkValve': r = detectCheckValve(anomaly); break;
    default: r = detectVPort(v.mode); break;
  }
  if (v.mode !== 'hunting') huntingSamples.length = 0;

  const severity = def?.severity || 'anomaly';
  if (r.condition) {
    a.persistenceTime = Math.min(a.persistenceTime + dt, a.persistenceRequired);
    a.type = r.type;
    a.component = component;
    a.severity = severity;
    if (a.persistenceTime >= a.persistenceRequired) {
      a.status = severity === 'warning' ? 'WARNING' : 'ANOMALY';
      a.active = true;
    } else {
      a.status = 'DETECTING';
      a.active = false;
    }
  } else {
    a.persistenceTime = 0;
    a.status = 'NORMAL';
    a.active = false;
    a.type = null;
    a.component = null;
    a.severity = 'anomaly';
  }
  a.detail = r.detail;

  // Component statuses: only the flagged component carries the detector's status.
  for (const key of STATUS_KEYS) {
    if (!S[key]) continue;
    const st = key === component ? a.status : 'NORMAL';
    if (S[key].status !== st) S[key].status = st;
  }
  v.anomaly = a.active && component === 'vPortValve' ? { type: a.type, message: ANOMALY_LABELS[a.type] } : null;
}

/* ------------------------------------------------------------------------------- */
/* V-Port (original detectors)                                                       */
/* ------------------------------------------------------------------------------- */
function detectVPort(mode) {
  const v = S.vPortValve, a = S.anomaly;
  switch (mode) {
    case 'sticking': {
      const notMoving = Math.abs(v.actualVelocity) < LIMITS.stickVelocity;
      return { condition: v.positionError > a.threshold && notMoving, type: VPORT_STICKING,
        detail: `error ${Math.round(v.positionError)}% · movement ${Math.abs(v.actualVelocity).toFixed(1)} %/s` };
    }
    case 'slowResponse': {
      const sr = v.sim.slowResponse;
      const tooSlowNow = sr.moving && sr.moveElapsed > sr.acceptableTime;
      const lastTooSlow = !sr.moving && sr.lastMoveDuration > sr.acceptableTime;
      return { condition: tooSlowNow || lastTooSlow, type: VPORT_SLOW_RESPONSE,
        detail: sr.moving ? `moving ${sr.moveElapsed.toFixed(1)} s · acceptable ${sr.acceptableTime.toFixed(1)} s`
          : sr.lastMoveDuration ? `last move ${sr.lastMoveDuration.toFixed(1)} s · acceptable ${sr.acceptableTime.toFixed(1)} s` : 'at command' };
    }
    case 'hunting': {
      huntingSamples.push({ t: S.time, e: v.actualPosition - v.commandPosition });
      while (huntingSamples.length && huntingSamples[0].t < S.time - LIMITS.huntingWindow) huntingSamples.shift();
      let min = Infinity, max = -Infinity, crossings = 0;
      for (let i = 0; i < huntingSamples.length; i++) {
        const e = huntingSamples[i].e;
        min = Math.min(min, e); max = Math.max(max, e);
        if (i > 0 && Math.sign(e) !== Math.sign(huntingSamples[i - 1].e) && e !== 0) crossings++;
      }
      const swing = huntingSamples.length ? max - min : 0;
      return { condition: swing > LIMITS.huntingSwing && crossings >= LIMITS.huntingCrossings, type: VPORT_HUNTING,
        detail: `swing ${swing.toFixed(1)}% · ${crossings} crossings / ${LIMITS.huntingWindow} s` };
    }
    case 'trimWear': {
      const expected = Math.max(1, v.expectedFlow);
      const deviation = ((S.steam.flow - expected) / expected) * 100;
      return { condition: deviation > LIMITS.trimWearDeviation, type: VPORT_TRIM_WEAR, detail: `flow +${Math.max(0, deviation).toFixed(0)}% vs expected` };
    }
    default:
      return { condition: v.positionError > a.threshold, type: VPORT_MISMATCH,
        detail: `|${Math.round(v.commandPosition)} − ${Math.round(v.actualPosition)}| = ${Math.round(v.positionError)}%` };
  }
}

/* ------------------------------------------------------------------------------- */
/* ESD valve                                                                          */
/* ------------------------------------------------------------------------------- */
function detectEsd(anomaly) {
  const e = S.esdValve, sim = e.sim;
  const tripped = e.command === 0;
  const state = esdStateText();
  switch (anomaly) {
    case 'failToClose':
      return { condition: tripped && e.position > 90, type: 'ESD_FAIL_TO_CLOSE', detail: `trip CLOSE · actual ${state}` };
    case 'slowShutdown': {
      const tooSlowNow = sim.tripping && sim.tripElapsed > sim.acceptableTime;
      const lastTooSlow = !sim.tripping && sim.lastTripDuration > sim.acceptableTime;
      return { condition: tripped && (tooSlowNow || lastTooSlow), type: 'ESD_SLOW_SHUTDOWN',
        detail: sim.tripping ? `closing ${sim.tripElapsed.toFixed(1)} s · acceptable ${sim.acceptableTime.toFixed(1)} s`
          : sim.lastTripDuration ? `shutdown took ${sim.lastTripDuration.toFixed(1)} s · acceptable ${sim.acceptableTime.toFixed(1)} s` : 'no trip in progress' };
    }
    case 'partialClosure':
      return { condition: tripped && e.position > 5 && e.position < 95 && Math.abs(sim.velocity) < 1, type: 'ESD_PARTIAL_CLOSURE', detail: `trip CLOSE · stopped at ${Math.round(e.position)}% open` };
    case 'lowAirPressure': {
      const low = sim.airPressure < sim.minAirPressure;
      const stalled = tripped && e.position > 5 && Math.abs(sim.velocity) < 1;
      return { condition: low && (stalled || !tripped), type: 'ESD_LOW_AIR',
        detail: `air ${sim.airPressure.toFixed(1)} bar < min ${sim.minAirPressure.toFixed(1)} bar${stalled ? ` · valve stalled at ${Math.round(e.position)}%` : ''}` };
    }
    default:
      return { condition: false, type: null, detail: `actual ${state}` };
  }
}

export function esdStateText() {
  const e = S.esdValve;
  if (e.position >= 99.5) return 'OPEN';
  if (e.position <= 0.5) return 'CLOSED';
  const stalled = Math.abs(e.sim.velocity ?? 0) < 1;
  if (e.command === 0) return stalled ? `PARTIALLY OPEN · ${Math.round(e.position)}%` : `CLOSING · ${Math.round(e.position)}% open`;
  return stalled ? `PARTIALLY OPEN · ${Math.round(e.position)}%` : `OPENING · ${Math.round(e.position)}% open`;
}

/* ------------------------------------------------------------------------------- */
/* Ball valve                                                                         */
/* ------------------------------------------------------------------------------- */
function detectBall(anomaly) {
  const b = S.ballValve, sim = b.sim;
  switch (anomaly) {
    case 'failToOpen':
      return { condition: b.command === 100 && b.position < 10, type: 'BALL_FAIL_TO_OPEN', detail: `command OPEN · actual ${ballStateText()}` };
    case 'failToClose':
      return { condition: b.command === 0 && b.position > 90, type: 'BALL_FAIL_TO_CLOSE', detail: `command CLOSE · actual ${ballStateText()}` };
    case 'slowOperation': {
      const tooSlowNow = sim.moving && sim.moveElapsed > sim.acceptableTime;
      const lastTooSlow = !sim.moving && sim.lastMoveDuration > sim.acceptableTime;
      return { condition: tooSlowNow || lastTooSlow, type: 'BALL_SLOW_OPERATION',
        detail: sim.moving ? `operating ${sim.moveElapsed.toFixed(1)} s · acceptable ${sim.acceptableTime.toFixed(1)} s`
          : sim.lastMoveDuration ? `last operation ${sim.lastMoveDuration.toFixed(1)} s · acceptable ${sim.acceptableTime.toFixed(1)} s` : 'idle' };
    }
    case 'passing':
      return { condition: b.command === 0 && b.position < 0.5 && S.steam.flow > 0, type: 'BALL_PASSING',
        detail: `closed · leakage ${S.steam.flow.toLocaleString()} kg/h (expected 0)` };
    default:
      return { condition: false, type: null, detail: `actual ${ballStateText()}` };
  }
}

export function ballStateText() {
  const b = S.ballValve;
  if (b.position >= 99.5) return 'OPEN';
  if (b.position <= 0.5) return 'CLOSED';
  return `${Math.round(b.position)}% open`;
}

/* ------------------------------------------------------------------------------- */
/* Safety / relief valve                                                              */
/* ------------------------------------------------------------------------------- */
function detectSafetyValve(anomaly) {
  const p = S.safetyValve, sim = p.sim;
  const set = p.setPressure;
  switch (anomaly) {
    case 'pressureRelief':
      return { condition: false, type: null, detail: sim.valveOpen ? `relieving ${p.reliefFlow.toLocaleString()} kg/h at ${sim.linePressure.toFixed(2)} bar` : `${sim.linePressure.toFixed(2)} bar rising toward set ${set.toFixed(1)} bar` };
    case 'unexpectedOpening':
      return { condition: p.lift > 0.5 && sim.linePressure < set * 0.95, type: 'PSV_UNEXPECTED_OPENING',
        detail: `OPEN at ${sim.linePressure.toFixed(1)} bar · set ${set.toFixed(1)} bar · venting ${p.reliefFlow.toLocaleString()} kg/h` };
    case 'failureToOpen':
      return { condition: sim.linePressure > set && p.lift < 0.1, type: 'PSV_FAILURE_TO_OPEN',
        detail: `CLOSED at ${sim.linePressure.toFixed(1)} bar · set ${set.toFixed(1)} bar` };
    case 'chattering':
      return { condition: sim.openings.length >= LIMITS.chatterOpenings, type: 'PSV_CHATTERING',
        detail: `${sim.openings.length} openings / 3 s · ${sim.openCount} total` };
    default:
      return { condition: false, type: null, detail: `CLOSED · ${sim.linePressure.toFixed(1)} bar` };
  }
}

/* ------------------------------------------------------------------------------- */
/* Steam trap                                                                         */
/* ------------------------------------------------------------------------------- */
function detectSteamTrap(anomaly) {
  const sim = S.steamTrap.sim;
  const dT = sim.inletTemp - sim.outletTemp;
  switch (anomaly) {
    case 'failedOpen':
      return { condition: dT < LIMITS.trapFailedOpenDeltaT, type: 'TRAP_FAILED_OPEN', detail: `ΔT ${dT.toFixed(0)} °C (< ${LIMITS.trapFailedOpenDeltaT} °C) · live steam passing` };
    case 'blocked':
      return { condition: sim.outletTemp < LIMITS.trapBlockedOutlet && S.condensate.flow < 50, type: 'TRAP_BLOCKED', detail: `outlet ${sim.outletTemp.toFixed(0)} °C · no discharge · ${sim.pressure.toFixed(1)} bar` };
    case 'poorRemoval':
      return { condition: sim.outletTemp < LIMITS.trapPoorOutlet && sim.outletTemp >= LIMITS.trapBlockedOutlet, type: 'TRAP_POOR_REMOVAL', detail: `outlet ${sim.outletTemp.toFixed(0)} °C · discharge ${Math.round((S.steamTrap.condensateFactor ?? 1) * 100)}%` };
    default:
      return { condition: false, type: null, detail: `ΔT ${dT.toFixed(0)} °C` };
  }
}

/* ------------------------------------------------------------------------------- */
/* Check valve                                                                        */
/* ------------------------------------------------------------------------------- */
function detectCheckValve(anomaly) {
  const c = S.checkValve, sim = c.sim;
  const dP = sim.upstreamPressure - sim.downstreamPressure;
  const flow = S.condensate.flow;
  switch (anomaly) {
    case 'reverseFlow':
      return { condition: flow < -50, type: 'CHECK_REVERSE_FLOW', detail: `ΔP ${dP.toFixed(1)} bar · flow ${flow.toLocaleString()} kg/h (reverse)` };
    case 'failureToOpen':
      return { condition: dP > 0.2 && c.lift < 0.05 && S.steam.flow > 100, type: 'CHECK_FAILURE_TO_OPEN', detail: `ΔP +${dP.toFixed(1)} bar · disc seated · no flow` };
    case 'failureToClose':
      return { condition: dP < 0 && c.lift > 0.05, type: 'CHECK_FAILURE_TO_CLOSE', detail: `ΔP ${dP.toFixed(1)} bar · disc open · reverse ${Math.abs(flow).toLocaleString()} kg/h` };
    default:
      return { condition: false, type: null, detail: `ΔP +${dP.toFixed(1)} bar · forward` };
  }
}
