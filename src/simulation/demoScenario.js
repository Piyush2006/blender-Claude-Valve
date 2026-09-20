import { simulationState as S, setAnomalyScenario, setVPortActual, setComponentAnomaly, notify } from './simulationState.js';
import { presetDetection, tickAnomalies } from './anomalyEngine.js';
import { seedPositionHistory, seedBallStroke } from '../dashboard/liveHistory.js';

/**
 * Boot demo scenario — two technically different anomalies, ALREADY PRESENT when the
 * app opens (nothing plays out after the refresh):
 *
 *   V-Port Control Valve · Position Mismatch  — commanded 70 %, actual 32 %, detected
 *     37 min ago; steam flow already at the reduced level (CRITICAL)
 *   Ball Valve · Slow Response               — a CLOSE command during a stroke test 18 min
 *     ago took 8.5 s instead of < 2 s; the valve reached CLOSED, was re-opened, and the
 *     slow-response verdict is latched (WARNING)
 *
 * Everything is written into the shared simulationState (the Twin, the panels and the
 * Dashboard all read the same values); the trend buffers are seeded with the same story.
 * The Anomaly Simulation tab keeps working as before (selecting a scenario there resets
 * to a single anomaly).
 */
export const DEMO = {
  vPortCommand: 70, vPortActual: 32, vPortDetectedAgoMin: 37,
  ballOperationTime: 8.5, ballAcceptableTime: 2, ballDetectedAgoMin: 18, holdClosedSeconds: 4,
};

export function loadDemoScenario() {
  const now = Date.now();
  const vDetectedAt = now - DEMO.vPortDetectedAgoMin * 60000;
  const bDetectedAt = now - DEMO.ballDetectedAgoMin * 60000;

  // V-Port: mismatch already established; flow settled at the actual position.
  setAnomalyScenario('vPortValve', 'positionMismatch');
  const v = S.vPortValve;
  v.commandPosition = DEMO.vPortCommand;
  setVPortActual(DEMO.vPortActual);
  v.physicalPosition = DEMO.vPortActual;
  const fraction = DEMO.vPortActual / 100;
  S.flow.fraction = fraction;
  S.steam.flow = Math.round(S.steam.maxFlow * fraction);
  v.expectedFlow = S.steam.flow;
  S.steam.pressure = Math.round((S.steam.supplyPressure - 2.2 * fraction * fraction) * 10) / 10;

  // Ball valve: slow-response verdict latched from a completed stroke test; valve is OPEN again.
  setComponentAnomaly('ballValve', 'slowOperation');
  Object.assign(S.ballValve.sim, { operationTime: DEMO.ballOperationTime, acceptableTime: DEMO.ballAcceptableTime, lastCloseDuration: DEMO.ballOperationTime, lastOpenDuration: DEMO.ballOperationTime, lastMoveDuration: DEMO.ballOperationTime, moving: false, moveElapsed: 0 });
  S.ballValve.command = 100;
  S.ballValve.position = 100;
  S.demo = { phase: 'done', t: 0, commandedAt: bDetectedAt - (DEMO.ballAcceptableTime + S.anomaly.persistenceRequired) * 1000 };

  // Detection records + trend buffers tell the same back-dated story.
  presetDetection('vPortValve', vDetectedAt);
  presetDetection('ballValve', bDetectedAt);
  const healthy = Math.round(S.steam.maxFlow * DEMO.vPortCommand / 100);
  seedPositionHistory(now - vDetectedAt, { cmd: DEMO.vPortCommand, act: DEMO.vPortCommand, flow: healthy, expected: healthy }, { cmd: DEMO.vPortCommand, act: DEMO.vPortActual, flow: S.steam.flow, expected: S.steam.flow });
  seedBallStroke({ agoS: (now - S.demo.commandedAt) / 1000, closeS: DEMO.ballOperationTime, holdS: DEMO.holdClosedSeconds, openS: DEMO.ballOperationTime });
  tickAnomalies(0);
  notify();
}

/** Kept for a live stroke test (not used by the pre-populated boot demo). */
export function tickDemoScenario(dt) {
  const d = S.demo, b = S.ballValve;
  if (!d || d.phase === 'idle' || d.phase === 'done') return;
  if (b.sim.anomaly !== 'slowOperation') { d.phase = 'done'; return; }
  switch (d.phase) {
    case 'closing': if (b.position <= 0.5) { d.phase = 'hold'; d.t = 0; } break;
    case 'hold': d.t += dt; if (d.t >= DEMO.holdClosedSeconds) { b.command = 100; d.phase = 'opening'; } break;
    case 'opening': if (b.position >= 99.5) d.phase = 'done'; break;
    default: break;
  }
}
