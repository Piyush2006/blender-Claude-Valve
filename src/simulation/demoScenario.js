import { simulationState as S, setAnomalyScenario, setVPortActual, setComponentAnomaly, notify } from './simulationState.js';
import { presetDetection, tickAnomalies } from './anomalyEngine.js';
import { tickSimulation, esdCycleDelay } from './simulationEngine.js';
import { seedPositionHistory, seedProcessHistory, seedEsdCycleTest } from '../dashboard/liveHistory.js';

/**
 * Boot demo scenario — two technically different anomalies, ALREADY PRESENT when the
 * app opens (nothing plays out after the refresh):
 *
 *   V-Port Control Valve · Position Mismatch  — commanded 70 %, actual 32 %, detected
 *     37 min ago; steam flow already at the reduced level (CRITICAL)
 *   ESD Valve · Slow Response                — a 15-cycle ON/OFF duty-cycle test (5 s per
 *     state) ~22 min ago: the actual state followed the command with a delay growing from
 *     0.5 s (cycles 1–3) to ~5 s (cycles 12–15); the verdict is latched (WARNING) and the
 *     valve is OPEN again. The ball valve is NORMAL / OPEN.
 *
 * Everything is written into the shared simulationState (the Twin, the panels and the
 * Dashboard all read the same values); the trend buffers are seeded with the same story.
 * The Anomaly Simulation tab keeps working as before (selecting a scenario there resets
 * to a single anomaly).
 */
export const DEMO = {
  vPortCommand: 70, vPortActual: 32, vPortDetectedAgoMin: 37,
  esdTestAgoMin: 22,      // start of the 15-cycle ESD response test
};

export function loadDemoScenario() {
  const now = Date.now();

  // V-Port: position mismatch already established (37 min ago); flow settled at the actual position.
  const vDetectedAt = now - DEMO.vPortDetectedAgoMin * 60000;
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
  presetDetection('vPortValve', vDetectedAt);
  {
    const healthy = Math.round(S.steam.maxFlow * DEMO.vPortCommand / 100);
    seedPositionHistory(now - vDetectedAt, { cmd: DEMO.vPortCommand, act: DEMO.vPortCommand, flow: healthy, expected: healthy }, { cmd: DEMO.vPortCommand, act: DEMO.vPortActual, flow: S.steam.flow, expected: S.steam.flow });
  }

  // ESD: slow-response verdict latched from a completed cyclic ON/OFF test; valve OPEN again.
  setComponentAnomaly('esdValve', 'cyclicDegradation');
  const esim = S.esdValve.sim;
  const agoS = DEMO.esdTestAgoMin * 60;
  const { startSt, endSt } = seedEsdCycleTest({ agoS, period: esim.cyclePeriod, total: esim.cycleCount, delayFor: (k) => esdCycleDelay(k, esim) });
  const cycles = Array.from({ length: esim.cycleCount }, (_, i) => ({ index: i + 1, cmdAt: startSt + i * 2 * esim.cyclePeriod, delay: esdCycleDelay(i + 1, esim) }));
  S.esdValve.cycleTest = { active: false, finishedBy: 'cyclicDegradation', startSt, endSt, period: esim.cyclePeriod, total: esim.cycleCount, current: esim.cycleCount, cycles, lastDelay: esdCycleDelay(esim.cycleCount, esim) };
  S.esdValve.command = 100; S.esdValve.position = 100; S.esdValve.tripped = false;
  // Detected when the delay first exceeded the acceptable value (+ persistence), during the test.
  const firstBad = cycles.find((c) => c.delay > esim.acceptableDelay) || cycles[cycles.length - 1];
  const eDetectedAt = now - (S.time - (firstBad.cmdAt + firstBad.delay + S.anomaly.persistenceRequired)) * 1000;
  S.demo = { phase: 'done', t: 0, commandedAt: now - agoS * 1000 };

  // Detection records + trend buffers tell the same back-dated story.
  presetDetection('esdValve', eDetectedAt);
  // Let the derived process values settle on the demo operating point before the history is backfilled.
  for (let i = 0; i < 80; i++) tickSimulation(0.1);
  seedProcessHistory();
  tickAnomalies(0);
  notify();
}

/** Live stroke-test sequencer for the ball valve (not used by the pre-populated boot demo). */
export function tickDemoScenario(dt) {
  const d = S.demo, b = S.ballValve;
  if (!d || d.phase === 'idle' || d.phase === 'done') return;
  if (b.sim.anomaly !== 'slowOperation') { d.phase = 'done'; return; }
  switch (d.phase) {
    case 'closing': if (b.position <= 0.5) { d.phase = 'hold'; d.t = 0; } break;
    case 'hold': d.t += dt; if (d.t >= 4) { b.command = 100; d.phase = 'opening'; } break;
    case 'opening': if (b.position >= 99.5) d.phase = 'done'; break;
    default: break;
  }
}
