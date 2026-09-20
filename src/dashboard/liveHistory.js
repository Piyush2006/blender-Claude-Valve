import { simulationState as S, subscribe } from '../simulation/simulationState.js';

/**
 * Live sample buffers read straight from simulationState (no second copy of any
 * value — just samples over time, for the analytics charts):
 *
 *   positionHistory — V-Port commanded / actual position + steam flow, every 1 s, last 60 min
 *   ballHistory     — ball valve command / position every 0.2 s of SIMULATION time, last 25 min
 *                     (deterministic; fine enough to show a stroke that takes a few seconds).
 *                     Samples carry `st` (sim seconds); ballSamplesWallClock() maps them to wall time.
 */
export const positionHistory = [];
export const ballHistory = [];
const POS_EVERY = 1000, POS_WINDOW = 60 * 60 * 1000;
const BALL_EVERY_S = 0.2, BALL_WINDOW_S = 25 * 60;
let lastPos = 0, lastBallSim = -1;

{ // same-spacing backfill at the current operating point so the charts open with context
  const now = Date.now();
  for (let i = POS_WINDOW / POS_EVERY; i > 0; i--) positionHistory.push({ t: now - i * POS_EVERY, cmd: S.vPortValve.commandPosition, act: S.vPortValve.actualPosition, flow: S.steam.flow, expected: S.vPortValve.expectedFlow });
  for (let i = 60 / BALL_EVERY_S; i > 0; i--) ballHistory.push({ st: S.time - i * BALL_EVERY_S, cmd: S.ballValve.command, pos: S.ballValve.position });
}

subscribe(() => {
  const now = Date.now();
  if (now - lastPos >= POS_EVERY) {
    lastPos = now;
    positionHistory.push({ t: now, cmd: S.vPortValve.commandPosition, act: S.vPortValve.actualPosition, flow: S.steam.flow, expected: S.vPortValve.expectedFlow });
    while (positionHistory.length && positionHistory[0].t < now - POS_WINDOW) positionHistory.shift();
  }
  if (S.time - lastBallSim >= BALL_EVERY_S) {
    lastBallSim = S.time;
    ballHistory.push({ st: S.time, cmd: S.ballValve.command, pos: S.ballValve.position });
    while (ballHistory.length && ballHistory[0].st < S.time - BALL_WINDOW_S) ballHistory.shift();
  }
});

/** Ball samples with wall-clock `t` (ms), aligned so the newest sample is "now". */
export function ballSamplesWallClock(now = Date.now()) {
  const simNow = S.time;
  return ballHistory.map((p) => ({ t: now - (simNow - p.st) * 1000, cmd: p.cmd, pos: p.pos }));
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
    positionHistory.push({ t, ...(t < now - onsetAgoMs ? before : after) });
  }
  lastPos = now;
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
