import { simulationState as S, subscribe } from '../simulation/simulationState.js';

/**
 * Live sample buffers read straight from simulationState (no second copy of any
 * value — just samples over time, for the analytics charts):
 *
 *   positionHistory — V-Port commanded / actual position + steam flow, every 1 s, last 60 min
 *   ballHistory     — ball valve command / position every 0.2 s of SIMULATION time, last 45 min
 *                     (deterministic; fine enough to show a stroke that takes a few seconds).
 *                     Samples carry `st` (sim seconds); ballSamplesWallClock() maps them to wall time.
 *   processHistory  — ESD command/position, safety-valve line/set pressure + lift, trap inlet/outlet,
 *                     condensate flow + ΔP, rotary-joint seal temp, Yankee surface temp / speed,
 *                     paper moisture — every 0.5 s of simulation time, last 10 min
 */
export const positionHistory = [];
export const ballHistory = [];
export const processHistory = [];
export const esdHistory = [];                    // { st, cmd, pos } every 0.2 s of sim time, last 45 min
export const vportHistory = [];                  // { st, cmd, act } every 0.2 s of sim time, last 45 min (cyclic test chart)
let lastEsdSim = -1, lastVportSim = -1;
const PROC_EVERY_S = 0.5, PROC_WINDOW_S = 10 * 60;
let lastProcSim = -1;
/**
 * Backfill variation (SIMULATED historian): gentle, deterministic drift / cycling around the
 * current operating point that is exactly 0 at the newest sample, so live samples continue
 * the line without a step. `i` = samples before now.
 */
function drift(i, amp, period, phase = 0) { return i > 0 ? amp * Math.sin(i / period + phase) : 0; }
/** Deterministic pseudo-random jitter in ±amp (0 at the newest sample). */
function jitter(i, amp, seed = 1) { if (i <= 0) return 0; const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; return amp * ((x - Math.floor(x)) * 2 - 1); }
function processSample(st, i = 0) {
  const trapCycle = i > 0 ? Math.max(0, Math.sin(i / 7)) : 0;          // trap discharge cycles
  return {
    st,
    esdCmd: S.esdValve.command, esdPos: S.esdValve.position,
    psvLine: S.safetyValve.sim.linePressure + drift(i, 0.12, 40) + drift(i, 0.05, 9, 1) + jitter(i, 0.03, 1), psvSet: S.safetyValve.setPressure, psvLift: S.safetyValve.lift, reliefFlow: S.safetyValve.reliefFlow,
    trapIn: S.steamTrap.sim.inletTemp + drift(i, 1.2, 25) + jitter(i, 0.4, 2), trapOut: S.steamTrap.sim.outletTemp + drift(i, 2.5, 33, 2) - 4 * trapCycle + jitter(i, 0.8, 3),
    condFlow: S.condensate.flow * (1 + 0.035 * (i > 0 ? Math.sin(i / 9) : 0)) + drift(i, 60, 21) + jitter(i, 40, 4), dP: S.checkValve.sim.upstreamPressure - S.checkValve.sim.downstreamPressure + drift(i, 0.06, 30) + jitter(i, 0.02, 5),
    sealTemp: S.rotaryJoint.sealTemp + drift(i, 1.5, 45) + drift(i, 0.5, 11, 2) + jitter(i, 0.3, 6), steamTemp: S.steam.temperature + drift(i, 0.8, 50) + jitter(i, 0.2, 7),
    yankeeTemp: S.yankee.surfaceTemp + drift(i, 1.5, 60, 1) + drift(i, 0.4, 13) + jitter(i, 0.3, 8), speed: S.yankee.speedRpm, moisture: S.paper.moisture + drift(i, 0.15, 55) + drift(i, 0.04, 12, 3) + jitter(i, 0.03, 9),
  };
}
const POS_EVERY = 1000, POS_WINDOW = 60 * 60 * 1000;
const BALL_EVERY_S = 0.2, BALL_WINDOW_S = 45 * 60;
let lastPos = 0, lastBallSim = -1;

{ // same-spacing backfill at the current operating point so the charts open with context
  const now = Date.now();
  for (let i = POS_WINDOW / POS_EVERY; i > 0; i--) positionHistory.push({ t: now - i * POS_EVERY, cmd: S.vPortValve.commandPosition, act: S.vPortValve.actualPosition, flow: S.steam.flow, expected: S.vPortValve.expectedFlow });
  for (let i = 60 / BALL_EVERY_S; i > 0; i--) ballHistory.push({ st: S.time - i * BALL_EVERY_S, cmd: S.ballValve.command, pos: S.ballValve.position });
  for (let i = PROC_WINDOW_S / PROC_EVERY_S; i > 0; i--) processHistory.push(processSample(S.time - i * PROC_EVERY_S, i));
  for (let i = 60 / BALL_EVERY_S; i > 0; i--) esdHistory.push({ st: S.time - i * BALL_EVERY_S, cmd: S.esdValve.command, pos: S.esdValve.position });
  for (let i = 60 / BALL_EVERY_S; i > 0; i--) vportHistory.push({ st: S.time - i * BALL_EVERY_S, cmd: S.vPortValve.commandPosition, act: S.vPortValve.actualPosition });
}

subscribe(() => {
  const now = Date.now();
  if (now - lastPos >= POS_EVERY) {
    lastPos = now;
    positionHistory.push({ t: now, cmd: S.vPortValve.commandPosition, act: S.vPortValve.actualPosition, flow: S.steam.flow, expected: S.vPortValve.expectedFlow });
    while (positionHistory.length && positionHistory[0].t < now - POS_WINDOW) positionHistory.shift();
  }
  if (S.time - lastProcSim >= PROC_EVERY_S) {
    lastProcSim = S.time;
    processHistory.push(processSample(S.time));
    while (processHistory.length && processHistory[0].st < S.time - PROC_WINDOW_S) processHistory.shift();
  }
  if (S.time - lastVportSim >= BALL_EVERY_S) {
    lastVportSim = S.time;
    vportHistory.push({ st: S.time, cmd: S.vPortValve.commandPosition, act: S.vPortValve.actualPosition });
    while (vportHistory.length && vportHistory[0].st < S.time - BALL_WINDOW_S) vportHistory.shift();
  }
  if (S.time - lastEsdSim >= BALL_EVERY_S) {
    lastEsdSim = S.time;
    esdHistory.push({ st: S.time, cmd: S.esdValve.command, pos: S.esdValve.position });
    while (esdHistory.length && esdHistory[0].st < S.time - BALL_WINDOW_S) esdHistory.shift();
  }
  if (S.time - lastBallSim >= BALL_EVERY_S) {
    lastBallSim = S.time;
    ballHistory.push({ st: S.time, cmd: S.ballValve.command, pos: S.ballValve.position });
    while (ballHistory.length && ballHistory[0].st < S.time - BALL_WINDOW_S) ballHistory.shift();
  }
});

/** Sim-time samples with wall-clock `t` (ms), aligned so the newest sample is "now". */
function toWallClock(list, now) {
  const simNow = S.time;
  return list.map((p) => ({ ...p, t: now - (simNow - p.st) * 1000 }));
}
export function ballSamplesWallClock(now = Date.now()) { return toWallClock(ballHistory, now); }
export function processSamplesWallClock(now = Date.now()) { return toWallClock(processHistory, now); }
/** Stamp of the newest sample in each buffer — cheap "has new data arrived?" check for chart redraws. */
export function sampleStamp() {
  return `${positionHistory[positionHistory.length - 1]?.t || 0}|${ballHistory[ballHistory.length - 1]?.st || 0}|${esdHistory[esdHistory.length - 1]?.st || 0}|${processHistory[processHistory.length - 1]?.st || 0}|${vportHistory[vportHistory.length - 1]?.st || 0}`;
}
/** ESD samples { t, cmd, pos } (0.2 s) for the trip-response and cyclic-test charts. */
export function esdSamplesWallClock(now = Date.now()) { return toWallClock(esdHistory, now); }
/** V-Port samples in the { t, cmd, pos } shape used by the cycle chart. */
export function vportSamplesWallClock(now = Date.now()) { return toWallClock(vportHistory, now).map((p) => ({ t: p.t, cmd: p.cmd, pos: p.act })); }

/**
 * Demo seeding: write a completed V-Port cyclic command test into the V-Port buffer — command
 * steps lo → hi every `period` s for `total` cycles starting `agoS` s ago; the actual position
 * follows with the per-cycle dead time `delayFor(k)`, limited to `ceilingFor(k)`, at `rate` %/s.
 */
export function seedVportCycleTest({ agoS, period, total, hi, lo, delayFor, ceilingFor, rate = 40 }) {
  const simNow = S.time, t0 = simNow - agoS, tEnd = t0 + 2 * period * total;
  const cmdAt = (t) => { const el = t - t0; if (el < 0 || el >= 2 * period * total) return hi; return (el % (2 * period)) < period ? lo : hi; };
  const cycleAt = (t) => Math.min(total, Math.max(1, Math.floor((t - t0) / (2 * period)) + 1));
  vportHistory.length = 0;
  let act = hi;
  for (let i = BALL_WINDOW_S / BALL_EVERY_S; i >= 0; i--) {
    const st = simNow - i * BALL_EVERY_S;
    const k = cycleAt(Math.min(st, tEnd - 0.001));
    const delay = st >= t0 ? delayFor(k) : 0;
    const ceiling = st >= t0 ? ceilingFor(k) : 100;
    const target = Math.min(cmdAt(st - delay), ceiling);
    act += Math.max(-rate * BALL_EVERY_S, Math.min(rate * BALL_EVERY_S, target - act));
    vportHistory.push({ st, cmd: cmdAt(st), act });
  }
  lastVportSim = simNow;
  return { startSt: t0, endSt: tEnd };
}

/**
 * Demo seeding: write a completed ESD cyclic ON/OFF test into the ESD buffer — command
 * flips every `period` s for `total` cycles starting `agoS` s ago; the actual state follows
 * with the per-cycle dead time `delayFor(k)` and a ~0.4 s stroke.
 */
export function seedEsdCycleTest({ agoS, period, total, delayFor }) {
  const simNow = S.time, t0 = simNow - agoS, tEnd = t0 + 2 * period * total;
  const cmdAt = (t) => { const el = t - t0; if (el < 0 || el >= 2 * period * total) return 100; return (el % (2 * period)) < period ? 0 : 100; };
  const cycleAt = (t) => Math.min(total, Math.max(1, Math.floor((t - t0) / (2 * period)) + 1));
  esdHistory.length = 0;
  let pos = 100;
  for (let i = BALL_WINDOW_S / BALL_EVERY_S; i >= 0; i--) {
    const st = simNow - i * BALL_EVERY_S;
    const delay = st >= t0 && st < tEnd + 6 ? delayFor(cycleAt(Math.min(st, tEnd - 0.001))) : 0;
    const target = cmdAt(st - delay);
    pos += Math.max(-250 * BALL_EVERY_S, Math.min(250 * BALL_EVERY_S, target - pos));
    esdHistory.push({ st, cmd: cmdAt(st), pos });
  }
  lastEsdSim = simNow;
  return { startSt: t0, endSt: tEnd };
}

/**
 * Demo seeding: rebuild the V-Port history so the anomaly onset sits `onsetAgoMs` in the
 * past (healthy `before` values, then `after`), and write a completed ball-valve stroke
 * (CLOSE → slow close → hold → OPEN) that started `agoS` seconds ago into the ball buffer.
 */
export function seedPositionHistory(onsetAgoMs, before, after) {
  const now = Date.now();
  positionHistory.length = 0;
  for (let i = POS_WINDOW / POS_EVERY; i >= 0; i--) {
    const t = now - i * POS_EVERY;
    const base = t < now - onsetAgoMs ? before : after;
    positionHistory.push({ t, cmd: base.cmd, act: base.act + drift(i, 0.5, 17) + drift(i, 0.2, 5, 1) + jitter(i, 0.15, 10), flow: base.flow + drift(i, 45, 23) + drift(i, 15, 6, 2) + jitter(i, 20, 11), expected: base.expected });
  }
  lastPos = now;
}
export function seedProcessHistory() {
  processHistory.length = 0;
  for (let i = PROC_WINDOW_S / PROC_EVERY_S; i >= 0; i--) processHistory.push(processSample(S.time - i * PROC_EVERY_S, i));
  lastProcSim = S.time;
}
export function seedBallStroke({ agoS, closeS, holdS, openS }) {
  const simNow = S.time, t0 = simNow - agoS;
  ballHistory.length = 0;
  for (let i = BALL_WINDOW_S / BALL_EVERY_S; i >= 0; i--) {
    const st = simNow - i * BALL_EVERY_S, dt = st - t0;
    let cmd = 100, pos = 100;
    if (dt >= 0 && dt < closeS) { cmd = 0; pos = 100 * (1 - dt / closeS); }
    else if (dt >= closeS && dt < closeS + holdS) { cmd = 0; pos = 0; }
    else if (dt >= closeS + holdS && dt < closeS + holdS + openS) { cmd = 100; pos = 100 * ((dt - closeS - holdS) / openS); }
    ballHistory.push({ st, cmd, pos });
  }
  lastBallSim = simNow;
}
