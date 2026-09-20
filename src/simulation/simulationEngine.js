import { simulationState as S, notify } from './simulationState.js';
import { tickAnomalies } from './anomalyEngine.js';
import { tickDemoScenario } from './demoScenario.js';

/**
 * Advances the simulation. All derived values (flow, pressures, segment
 * presence, condensate) are computed here from the valve states, so the
 * animation and UI layers stay purely presentational.
 */

const RATES = {
  ballValve: 45,        // %/s  (manual quarter-turn, ~2.2 s full stroke)
  esdOpen: 40,          // %/s
  esdClose: 160,        // %/s  (spring-return trip, ~0.6 s)
  vPortPhysical: 60,    // %/s  visual slew of the valve toward the actual feedback value
  vPortTracking: 40,    // %/s  healthy positioner: actual follows command
};

function slew(current, target, rate, dt) {
  const maxStep = rate * dt;
  const delta = target - current;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

/** Ball valves pass very little flow until they are a few % open; keep it simple but not linear. */
function quarterTurnCv(percent) {
  const x = Math.max(0, Math.min(1, percent / 100));
  return Math.min(1, Math.pow(x, 0.6) * 1.05);
}

export function tickSimulation(dt) {
  S.time += dt;

  // --- Valve actual positions follow commands (each with its own anomaly model) -----
  updateBallValve(dt);
  updateEsdValve(dt);
  updateVPortActual(dt);
  updateSafetyValve(dt);

  // --- Steam flow ---------------------------------------------------------------
  let ballOpen = quarterTurnCv(S.ballValve.position);
  // Ball valve passing: a closed ball still leaks a small flow past the seats.
  if (S.ballValve.sim.anomaly === 'passing') ballOpen = Math.max(ballOpen, S.ballValve.sim.leakage / S.steam.maxFlow);
  const esdOpen = quarterTurnCv(S.esdValve.position);
  const vport = S.vPortValve.actualPosition / 100;

  // Steam flow follows the ACTUAL valve position (never the command), gated by the
  // isolation valves upstream: 12,500 kg/h × actual/100 with everything else open.
  const healthyFraction = Math.max(0, Math.min(1, ballOpen * esdOpen * vport));
  // Trim wear: internal leakage lets more steam through than the position implies.
  const wear = S.vPortValve.mode === 'trimWear' ? S.vPortValve.sim.trimWear.multiplier : 1;
  // One flow variable drives BOTH the displayed kg/h and the in-pipe steam visual; a short
  // ramp (≈0.4 s) keeps changes smooth without ever letting the two drift apart.
  // A relieving safety valve vents some steam that would otherwise reach the Yankee.
  const reliefLoss = 0.5 * S.safetyValve.reliefFlow / S.steam.maxFlow;
  const targetFraction = Math.max(0, Math.min(1.5, healthyFraction * wear) - reliefLoss);
  S.flow.fraction = smooth(S.flow.fraction, targetFraction, dt, 8);
  if (Math.abs(S.flow.fraction - targetFraction) < 0.0005) S.flow.fraction = targetFraction;
  const fraction = S.flow.fraction;
  S.vPortValve.expectedFlow = Math.round(S.steam.maxFlow * healthyFraction);

  // Steam presence per segment (used by the in-pipe steam visual).
  const seg = S.flow.segments;
  seg.P1 = 1;                                   // always pressurised from supply
  seg.P2 = smooth(seg.P2, ballOpen > 0.005 ? 1 : 0, dt);
  seg.P3 = smooth(seg.P3, ballOpen > 0.005 && esdOpen > 0.02 ? 1 : 0, dt);
  const down = fraction > 0.01 ? 1 : 0;
  seg.P4 = smooth(seg.P4, down, dt);
  seg.P5 = smooth(seg.P5, down, dt);

  // Simulated process values (not physically rigorous — demo only).
  S.steam.flow = Math.round(S.steam.maxFlow * fraction);
  const baselinePressure = S.steam.supplyPressure - 2.2 * fraction * fraction;
  const psvEffect = safetyValvePressureEffect(baselinePressure);   // relief lowers, failure-to-open raises line pressure
  S.steam.pressure = round1(baselinePressure + psvEffect);
  S.steam.temperature = Math.round(150 + 25 * Math.min(1, S.steam.pressure / 8.5));

  // --- Steam trap → condensate → check valve --------------------------------------
  updateSteamTrap(dt, fraction);
  updateCheckValve(dt, fraction);
  S.condensate.temperature = Math.round(S.steamTrap.sim.outletTemp);

  // --- Rotary joint & separator (simple simulated values) -------------------------
  S.rotaryJoint.sealTemp = Math.round(120 + 55 * fraction);
  S.separator.blowThrough = Math.round(S.steam.flow * 0.08);
  S.separator.pressure = round1(Math.max(0.5, S.steam.pressure - 1.4));
  S.separator.level = Math.round(smooth(S.separator.level, 30 + 25 * fraction, dt, 0.5));

  // --- Yankee dryer & paper web -----------------------------------------------------
  const yankeeRadius = 0.63; // m — from the GLB geometry (Yankee_Cylinder)
  const targetRpm = S.yankee.running ? 4 : 0;
  S.yankee.speedRpm = smooth(S.yankee.speedRpm, targetRpm, dt, 0.8);
  const omega = (S.yankee.speedRpm / 60) * Math.PI * 2; // rad/s
  S.yankee.angle = (S.yankee.angle + omega * dt) % (Math.PI * 2);
  const surfaceSpeed = omega * yankeeRadius;            // m/s
  S.paper.speedMpm = round1(surfaceSpeed * 60);
  S.paper.travel += surfaceSpeed * dt;
  S.yankee.surfaceTemp = Math.round(60 + 60 * Math.min(1, fraction * 1.2));
  // Paper moisture after the Yankee (demo model): rises when steam flow falls below nominal.
  S.paper.moisture = Math.round((4.2 + 2.2 * Math.max(0, 0.70 - fraction) + 0.05 * Math.sin(S.time * 0.7)) * 100) / 100;

  // --- Anomaly engine (phase 2 — currently a no-op that keeps every status NORMAL) ---
  tickAnomalies(dt);
  tickDemoScenario(dt);

  notify();
}

/* ------------------------------------------------------------------------------- */
/* Ball valve (isolation, quarter-turn)                                             */
/* ------------------------------------------------------------------------------- */
function updateBallValve(dt) {
  const b = S.ballValve, sim = b.sim;
  switch (sim.anomaly) {
    case 'failToOpen':
      if (b.command === 100 && b.position < 1) break;                 // stays shut on OPEN command
      b.position = slew(b.position, b.command, RATES.ballValve, dt);
      break;
    case 'failToClose':
      if (b.command === 0 && b.position > 99) break;                  // stays open on CLOSE command
      b.position = slew(b.position, b.command, RATES.ballValve, dt);
      break;
    case 'slowOperation':
      b.position = slew(b.position, b.command, 100 / Math.max(1, sim.operationTime), dt);
      break;
    default:                                                          // normal + passing: closes normally
      b.position = slew(b.position, b.command, RATES.ballValve, dt);
  }
  // Per-move timing (slow-operation detector): verdict latches per completed move.
  const away = Math.abs(b.command - b.position) > 0.5;
  if (away && !sim.moving) { sim.moving = true; sim.moveElapsed = 0; sim.lastMoveDuration = 0; }
  if (sim.moving) sim.moveElapsed += dt;
  if (sim.moving && !away) {
    sim.moving = false; sim.lastMoveDuration = sim.moveElapsed;
    if (b.command === 0) sim.lastCloseDuration = sim.moveElapsed; else sim.lastOpenDuration = sim.moveElapsed;
  }
}

/* ------------------------------------------------------------------------------- */
/* ESD valve (spring-return isolation; command 100 = open, 0 = trip/close)           */
/* ------------------------------------------------------------------------------- */

/** Response dead time for cycle k of the cyclic test (demo schedule, s). */
export function esdCycleDelay(k, sim) {
  const d0 = sim.delayInitial ?? 0.5, dF = sim.delayFinal ?? 5.0;
  if (k <= 3) return d0;                                   // normal
  if (k <= 7) return 1.0 + ((k - 4) / 3) * 1.0;            // slight delay 1 → 2 s
  if (k <= 11) return 2.0 + ((k - 8) / 3) * 1.0;           // degrading 2 → 3 s
  return 4.0 + ((k - 12) / 3) * (dF - 4.0);                // slow response 4 → 5 s
}

/** Command of the duty cycle at sim time t: CLOSE for the first half of each cycle, then OPEN. */
function esdCycleCommandAt(ct, t) {
  const el = t - ct.startSt;
  if (el < 0) return 100;
  const k = Math.floor(el / (2 * ct.period));
  if (k >= ct.total) return 100;
  return (el - k * 2 * ct.period) < ct.period ? 0 : 100;
}

export function startEsdCycleTest(e, sim, startSt = S.time) {
  e.cycleTest = { active: true, startSt, period: sim.cyclePeriod, total: sim.cycleCount, current: 0, cycles: [], lastDelay: 0, endSt: startSt + 2 * sim.cyclePeriod * sim.cycleCount };
  return e.cycleTest;
}

function runEsdCycleTest(e, sim) {
  let ct = e.cycleTest;
  if (!ct) ct = startEsdCycleTest(e, sim);                 // scenario selection clears the previous test
  const t = S.time;
  if (ct.active) {
    const el = t - ct.startSt;
    const k = Math.min(ct.total, Math.floor(el / (2 * ct.period)) + 1);
    if (k > ct.current) {                                   // a new cycle starts (CLOSE command issued)
      for (let i = ct.current + 1; i <= k; i++) ct.cycles.push({ index: i, cmdAt: ct.startSt + (i - 1) * 2 * ct.period, delay: esdCycleDelay(i, sim) });
      ct.current = k;
    }
    ct.lastDelay = esdCycleDelay(ct.current, sim);
    e.command = esdCycleCommandAt(ct, t);
    if (el >= 2 * ct.period * ct.total) { ct.active = false; ct.finishedBy = 'cyclicDegradation'; e.command = 100; }
  } else {
    e.command = 100;                                         // test finished: valve released to OPEN
  }
  // Delayed command: what the actuator is acting on right now.
  const delay = ct.current ? esdCycleDelay(ct.current, sim) : 0;
  ct.delayedCommand = ct.active ? esdCycleCommandAt(ct, t - delay) : (t - ct.endSt < delay ? esdCycleCommandAt(ct, t - delay) : 100);
  return ct;
}
function updateEsdValve(dt) {
  const e = S.esdValve, sim = e.sim;
  const closing = e.command < e.position;
  let rate = closing ? RATES.esdClose : RATES.esdOpen;
  let target = e.command;
  switch (sim.anomaly) {
    case 'failToClose':
      if (e.command === 0) rate = 0;                                  // trip has no effect
      break;
    case 'slowShutdown':
      if (closing) rate = 100 / Math.max(1, sim.shutdownTime);
      break;
    case 'partialClosure':
      if (e.command === 0) target = sim.partialOpen;                  // stops part-way
      break;
    case 'cyclicDegradation': {
      // Repeated ON/OFF duty cycle (command flips every `cyclePeriod` s). The actuator answers
      // with a dead time that grows cycle by cycle: ~0.5 s (1–3) → 1–2 s (4–7) → 2–3 s (8–11)
      // → 4–5 s (12–15). Steam is isolated while CLOSED; nothing else changes automatically.
      const ct = runEsdCycleTest(e, sim);
      target = ct.delayedCommand;
      rate = 250;                                                     // healthy stroke once it responds (~0.4 s)
      break;
    }
    case 'lowAirPressure': {
      // Double-acting actuator: below the minimum the stroke authority collapses —
      // the valve moves sluggishly and stalls part-way (cannot complete the closure).
      if (sim.airPressure < sim.minAirPressure) {
        const authority = Math.max(0, Math.min(1, (sim.airPressure - 2.0) / Math.max(0.1, sim.minAirPressure - 2.0)));
        rate *= 0.15 + 0.25 * authority;
        if (closing) target = Math.max(target, Math.round((1 - authority) * 100));   // e.g. 3.0 bar → stalls ~50 % open
      }
      break;
    }
    default:
      break;
  }
  const before = e.position;
  e.position = slew(e.position, target, rate, dt);
  sim.velocity = smooth(sim.velocity ?? 0, dt > 0 ? (e.position - before) / dt : 0, dt, 6);
  // Trip timing for the slow-shutdown detector (latched per trip).
  const tripActive = e.command === 0 && e.position > 0.5;
  if (tripActive && !sim.tripping) { sim.tripping = true; sim.tripElapsed = 0; sim.lastTripDuration = 0; }
  if (sim.tripping) sim.tripElapsed += dt;
  if (sim.tripping && !tripActive) { sim.tripping = false; sim.lastTripDuration = sim.tripElapsed; }
  if (e.command === 100) sim.lastTripDuration = 0;
}

/* ------------------------------------------------------------------------------- */
/* Safety / relief valve (self-acting on line pressure)                              */
/* ------------------------------------------------------------------------------- */
function updateSafetyValve(dt) {
  const p = S.safetyValve, sim = p.sim;
  const set = p.setPressure;
  const linePressureNow = S.steam.pressure;              // line pressure at the valve (last tick)
  let targetLift = 0;
  switch (sim.anomaly) {
    case 'pressureRelief': {
      // Simulated overpressure event (demo model, not a sizing calculation): pressure climbs
      // until it reaches the set point → disc lifts → relief brings pressure down → the valve
      // reseats at blowdown (set − 0.25 bar) → pressure climbs again, so the loop is observable.
      if (!sim.valveOpen) {
        sim.linePressure += 0.12 * dt;
        if (sim.linePressure >= set) { sim.valveOpen = true; sim.openCount += 1; sim.openings.push(S.time); }
      } else {
        sim.linePressure -= (0.03 + 0.14 * (p.reliefFlow / sim.reliefCapacity)) * dt;
        if (sim.linePressure <= set - 0.35) sim.valveOpen = false;             // reseats at blowdown
      }
      targetLift = sim.valveOpen ? 1 : 0;
      break;
    }
    case 'unexpectedOpening':
      sim.linePressure = linePressureNow;                // pressure well below set point
      targetLift = 1;                                    // …yet the disc lifts
      break;
    case 'failureToOpen':
      sim.linePressure = Math.min(set + 2.0, sim.linePressure + 0.04 * dt);   // keeps rising (capped at set + 2 bar), nothing relieves it
      targetLift = 0;
      break;
    case 'chattering': {
      // Pressure hovering at the set point: rapid open/close cycling (~1.5 Hz).
      const phase = Math.sin(S.time * 2 * Math.PI * 1.5);
      sim.linePressure = set + 0.6 * phase + 0.05;
      const open = phase > 0;
      if (open && !sim.valveOpen) { sim.openCount += 1; sim.openings.push(S.time); }
      sim.valveOpen = open;
      p.lift = open ? 1 : 0;
      break;
    }
    default:
      sim.linePressure = linePressureNow;
      sim.openings.length = 0;
  }
  sim.openings = sim.openings.filter((t) => t > S.time - 3);
  if (sim.anomaly !== 'chattering') {
    p.lift = smooth(p.lift, targetLift, dt, 6);
    if (sim.anomaly !== 'pressureRelief') sim.valveOpen = p.lift > 0.5;
  }
  // Relief flow: opens with the disc, grows with pressure above the set point (demo model).
  const over = Math.max(0, sim.linePressure - set);
  // ≈ capacity at the set point, less at lower pressure, more with overpressure (demo model).
  const pr = Math.max(0, sim.linePressure / set);
  const targetRelief = p.lift > 0.02 ? Math.min(sim.reliefCapacity * 1.5, p.lift * (1050 * pr * pr + 3200 * over)) : 0;
  p.reliefFlow = Math.round(smooth(p.reliefFlow, targetRelief, dt, targetRelief === 0 ? 14 : 6));
  if (targetRelief === 0 && p.reliefFlow < 40) p.reliefFlow = 0;
}

/** Line-pressure correction applied by the safety-valve scenario (so KPI pressure == PSV pressure). */
function safetyValvePressureEffect(baseline) {
  const sim = S.safetyValve.sim;
  if (sim.anomaly === 'pressureRelief' || sim.anomaly === 'failureToOpen' || sim.anomaly === 'chattering') return sim.linePressure - baseline;
  if (sim.anomaly === 'unexpectedOpening') return -1.0 * S.safetyValve.lift;              // relieving drops line pressure
  return 0;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

/* ------------------------------------------------------------------------------- */
/* Steam trap (condensate management — temperatures, not positions)                  */
/* ------------------------------------------------------------------------------- */
function updateSteamTrap(dt, fraction) {
  const t = S.steamTrap, sim = t.sim;
  sim.inletTemp = S.steam.temperature;
  let outletTarget, flowFactor, pressure;
  switch (sim.anomaly) {
    case 'failedOpen':      // live steam blowing through: outlet ≈ inlet, discharge high
      outletTarget = sim.inletTemp - 3; flowFactor = 1.4; pressure = S.steam.pressure - 0.3; break;
    case 'blocked':         // condensate backing up: outlet goes cold, no discharge, inlet pressure rises
      outletTarget = 45; flowFactor = 0; pressure = S.steam.pressure + 0.6; break;
    case 'poorRemoval':     // intermittent, sluggish discharge
      outletTarget = 75 + 6 * Math.sin(S.time * 0.8); flowFactor = 0.5; pressure = S.steam.pressure + 0.2; break;
    default:
      outletTarget = 98; flowFactor = 1; pressure = S.steam.pressure - 0.4;
  }
  sim.outletTemp = smooth(sim.outletTemp, outletTarget, dt, 1.5);
  sim.pressure = round1(Math.max(0.5, pressure));
  t.dischargeTemp = Math.round(sim.outletTemp);
  t.cycling = sim.anomaly === 'normal' || sim.anomaly === 'poorRemoval';
  t.condensateFactor = flowFactor;
}

/* ------------------------------------------------------------------------------- */
/* Check valve (passive: opens on forward ΔP, seats on reverse ΔP)                   */
/* ------------------------------------------------------------------------------- */
function updateCheckValve(dt, fraction) {
  const c = S.checkValve, sim = c.sim;
  const nominal = S.steam.flow * 0.92 * (S.steamTrap.condensateFactor ?? 1);   // kg/h reaching the valve
  let liftTarget, flow, direction;
  switch (sim.anomaly) {
    case 'reverseFlow':       // return header above trap outlet; disc seats but passes reverse flow
      sim.downstreamPressure = 2.2; sim.upstreamPressure = 1.5;
      liftTarget = 0.15; flow = -0.3 * Math.max(nominal, 0.3 * S.steam.maxFlow); direction = -1; break;
    case 'failureToOpen':     // forward ΔP present, disc stuck on its seat, condensate backs up
      sim.downstreamPressure = 1.0; sim.upstreamPressure = 2.5;
      liftTarget = 0; flow = 0; direction = 1; break;
    case 'failureToClose':    // reverse ΔP, disc stuck open → full reverse flow
      sim.downstreamPressure = 2.2; sim.upstreamPressure = 1.5;
      liftTarget = 0.8; flow = -0.8 * Math.max(nominal, 0.3 * S.steam.maxFlow); direction = -1; break;
    default:
      sim.downstreamPressure = 1.0; sim.upstreamPressure = nominal > 0 ? 1.5 : 1.0;
      liftTarget = nominal > 100 ? 0.35 + 0.65 * Math.min(1, nominal / (S.steam.maxFlow * 0.92)) : 0;
      flow = nominal; direction = 1;
  }
  c.lift = smooth(c.lift, liftTarget, dt, 2.5);
  sim.direction = direction;
  S.condensate.direction = direction;
  S.condensate.flow = Math.round(flow);
}

/**
 * How the ACTUAL V-Port position evolves depends on the selected scenario.
 * Position-mismatch keeps the original behaviour: actual is set directly by the
 * operator and nothing moves it. The animated valve always slews toward actual.
 */
function updateVPortActual(dt) {
  const v = S.vPortValve;
  const before = v.actualPosition;
  switch (v.mode) {
    case 'positionMismatch':
      break;                                   // operator-set, independent of command
    case 'sticking':
      if (!v.sim.sticking.stuck) v.actualPosition = slew(v.actualPosition, v.commandPosition, RATES.vPortTracking, dt);
      break;                                   // stuck: the valve simply does not move
    case 'slowResponse': {
      const sr = v.sim.slowResponse;
      const rate = 100 / Math.max(1, sr.responseTime);           // full stroke in responseTime s
      const wasAway = Math.abs(v.commandPosition - v.actualPosition) > 0.5;
      v.actualPosition = slew(v.actualPosition, v.commandPosition, rate, dt);
      const stillAway = Math.abs(v.commandPosition - v.actualPosition) > 0.5;
      if (wasAway && !sr.moving) { sr.moving = true; sr.moveElapsed = 0; sr.lastMoveDuration = 0; }
      if (sr.moving) sr.moveElapsed += dt;
      if (sr.moving && !stillAway) { sr.moving = false; sr.lastMoveDuration = sr.moveElapsed; } // verdict latches per move
      break;
    }
    case 'hunting': {
      const h = v.sim.hunting;
      const osc = h.amplitude * Math.sin(2 * Math.PI * h.frequency * S.time);
      v.actualPosition = Math.max(0, Math.min(100, v.commandPosition + osc));
      break;
    }
    case 'trimWear': {
      v.actualPosition = slew(v.actualPosition, v.commandPosition, RATES.vPortTracking, dt);
      const wearFrac = 1 - Math.max(0, Math.min(100, v.sim.trimWear.health)) / 100;
      v.sim.trimWear.multiplier = 1 + 0.5 * wearFrac;          // 60 % health → ×1.2
      break;
    }
    default:                                   // normal: healthy positioner tracks the command
      v.actualPosition = slew(v.actualPosition, v.commandPosition, RATES.vPortTracking, dt);
  }
  const vel = dt > 0 ? (v.actualPosition - before) / dt : 0;
  v.actualVelocity = smooth(v.actualVelocity, vel, dt, 6);
  const physRate = v.mode === 'hunting' ? 400 : RATES.vPortPhysical;
  v.physicalPosition = slew(v.physicalPosition, v.actualPosition, physRate, dt);
}

function smooth(current, target, dt, rate = 3) {
  const k = 1 - Math.exp(-rate * dt);
  return current + (target - current) * k;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
