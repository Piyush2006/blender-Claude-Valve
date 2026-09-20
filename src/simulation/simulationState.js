/**
 * Central simulation state. Every 3D animation and UI element reads from here;
 * nothing else hardcodes process values.
 *
 * Positions are 0..100 (% open). Flow fraction is 0..1.
 */
/** Default anomaly-simulation parameters per component (RESET restores these). */
export const DEFAULT_SIMS = {
  esdValve: () => ({ anomaly: 'normal', shutdownTime: 6, acceptableTime: 3, partialOpen: 30, airPressure: 5.5, minAirPressure: 4.0, tripElapsed: 0, tripping: false, lastTripDuration: 0, velocity: 0 }),
  ballValve: () => ({ anomaly: 'normal', operationTime: 12, acceptableTime: 5, leakage: 230, moveElapsed: 0, moving: false, lastMoveDuration: 0, lastCloseDuration: 0, lastOpenDuration: 0 }),
  safetyValve: () => ({ anomaly: 'normal', linePressure: 8.5, valveOpen: false, openCount: 0, openings: [], reliefCapacity: 1300 }),
  steamTrap: () => ({ anomaly: 'normal', inletTemp: 172, outletTemp: 98, pressure: 7.0 }),
  checkValve: () => ({ anomaly: 'normal', upstreamPressure: 1.5, downstreamPressure: 1.0, direction: 1 }),
};

export const simulationState = {
  anomalySim: {
    component: 'vPortValve', // which component the Anomaly Simulation panel is driving
    anomaly: 'normal',       // its selected anomaly id (see anomalyCatalog.js)
  },
  ballValve: {
    command: 100,        // 0 = CLOSED, 100 = OPEN
    position: 100,       // actual (animated toward command)
    status: 'NORMAL',
    sim: DEFAULT_SIMS.ballValve(),
  },
  esdValve: {
    command: 100,
    position: 100,
    tripped: false,
    status: 'NORMAL',
    sim: DEFAULT_SIMS.esdValve(),
  },
  vPortValve: {
    mode: 'normal',        // normal | positionMismatch | sticking | slowResponse | hunting | trimWear
    commandPosition: 70,   // requested by the control system (user-set in the simulation)
    actualPosition: 70,    // physical position feedback (mode decides how it evolves)
    physicalPosition: 70,  // animated valve position, slews toward actualPosition
    positionError: 0,      // |command - actual| in %
    actualVelocity: 0,     // %/s, smoothed — used by the sticking detector
    expectedFlow: 8750,    // kg/h for the actual position with healthy trim
    status: 'NORMAL',      // NORMAL | DETECTING | ANOMALY
    anomaly: null,         // { type, message } while an anomaly is active
    sim: {
      sticking: { stuck: false },
      slowResponse: { responseTime: 8, acceptableTime: 4, moveElapsed: 0, moving: false, lastMoveDuration: 0 },
      hunting: { amplitude: 6, frequency: 0.5 },
      trimWear: { health: 100, multiplier: 1 },
    },
  },
  safetyValve: {
    setPressure: 10.0,   // bar(g)
    lift: 0,             // 0..1 disc lift (drives the 3D stem)
    reliefFlow: 0,       // kg/h vented through the discharge — drives BOTH the readout and the vent steam
    status: 'NORMAL',
    sim: DEFAULT_SIMS.safetyValve(),
  },
  steamTrap: {
    dischargeTemp: 98,   // °C outlet (simulated)
    cycling: true,
    status: 'NORMAL',
    sim: DEFAULT_SIMS.steamTrap(),
  },
  checkValve: {
    lift: 0,             // 0..1, follows condensate flow (or the anomaly)
    status: 'NORMAL',
    sim: DEFAULT_SIMS.checkValve(),
  },
  rotaryJoint: {
    sealTemp: 172,       // °C (simulated)
    status: 'NORMAL',
  },
  separator: {
    level: 42,           // % (simulated)
    pressure: 6.0,       // bar(g) (simulated)
    blowThrough: 700,    // kg/h (simulated)
    status: 'NORMAL',
  },
  yankee: {
    running: true,
    speedRpm: 4,         // slow demo speed
    angle: 0,            // rad, integrated by the engine
    surfaceTemp: 118,    // °C (simulated)
    status: 'NORMAL',
  },
  paper: {
    moisture: 4.2,       // % after the Yankee (simulated; computed by the engine from steam flow)
    available: false,    // set by the animator once the Paper_Web mesh is confirmed
    speedMpm: 0,         // m/min, derived from Yankee speed
    travel: 0,           // metres travelled (for texture scrolling)
  },
  steam: {
    supplyPressure: 8.5, // bar(g)
    pressure: 8.5,       // bar(g) downstream of control valve (simulated)
    temperature: 175,    // °C
    flow: 8750,          // kg/h
    maxFlow: 12500,      // kg/h at 100 % V-Port opening
  },
  flow: {
    fraction: 0.7,       // 0..1 overall steam flow (drives the in-pipe steam visual)
    segments: { P1: 1, P2: 1, P3: 1, P4: 1, P5: 1 }, // steam presence per pipe segment (0..1)
  },
  condensate: {
    flow: 0,             // kg/h (simulated; negative = reverse flow)
    temperature: 165,
    direction: 1,        // +1 forward to return, −1 reverse
  },
  anomalies: [],           // every component whose detector is DETECTING / WARNING / ANOMALY (see anomalyEngine.js)
  demo: { phase: 'idle', t: 0 },   // boot demo scenario (ball valve stroke test), see demoScenario.js
  anomaly: {
    active: false,
    status: 'NORMAL',          // NORMAL | DETECTING | ANOMALY
    type: null,                // 'VPORT_POSITION_MISMATCH'
    persistenceTime: 0,        // s the condition has been true
    threshold: 10,             // % allowed position error
    persistenceRequired: 2,    // s the error must persist before it is declared
    detail: '',                // short human-readable evidence for the current detector
    component: null,           // component id the active detector belongs to
    severity: 'anomaly',       // 'anomaly' | 'warning' (from the catalog)
  },
  view: {
    xrayValves: true,    // see-through valve bodies so the mechanisms are visible
    debug: false,        // show the detection debug block
  },
  selection: {
    componentId: null,
  },
  time: 0,
};

const listeners = new Set();

/** Subscribe to state changes (called after each engine tick and after any set*). */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(simulationState);
}

/* ---- Command helpers (the only sanctioned way UI mutates the state) ---- */

export function setBallValveCommand(open) {
  simulationState.ballValve.command = open ? 100 : 0;
  if (simulationState.demo) simulationState.demo.phase = 'done';   // operator took over from the boot demo stroke test
  notify();
}

export function setEsdValveCommand(open) {
  simulationState.esdValve.command = open ? 100 : 0;
  simulationState.esdValve.tripped = !open;
  notify();
}

export function setVPortCommand(percent) {
  simulationState.vPortValve.commandPosition = clampPercent(percent);
  notify();
}

/** Physical feedback is set independently so the operator can create a mismatch. */
export function setVPortActual(percent) {
  simulationState.vPortValve.actualPosition = clampPercent(percent);
  notify();
}

export const VPORT_MODES = [
  { id: 'normal', label: 'Normal' },
  { id: 'positionMismatch', label: 'Position Mismatch' },
  { id: 'sticking', label: 'Sticking' },
  { id: 'slowResponse', label: 'Slow Response' },
  { id: 'hunting', label: 'Hunting / Oscillation' },
  { id: 'trimWear', label: 'Trim Wear' },
];

/** Select the V-Port anomaly scenario; values are reset so each scenario starts clean. */
export function setVPortMode(mode) {
  if (!VPORT_MODES.some((m) => m.id === mode)) return;
  resetVPortSimulation(mode);
}

/* ---- Generic anomaly simulation (all components) ------------------------------------ */

/** Restore every component's simulation parameters and commands to normal operation. */
function resetAllComponentSims() {
  const st = simulationState;
  st.ballValve.sim = DEFAULT_SIMS.ballValve();
  st.ballValve.command = 100;
  st.esdValve.sim = DEFAULT_SIMS.esdValve();
  st.esdValve.command = 100;
  st.esdValve.tripped = false;
  st.safetyValve.sim = DEFAULT_SIMS.safetyValve();
  st.safetyValve.lift = 0;
  st.safetyValve.reliefFlow = 0;
  st.steamTrap.sim = DEFAULT_SIMS.steamTrap();
  st.checkValve.sim = DEFAULT_SIMS.checkValve();
  st.condensate.direction = 1;
}

/**
 * Select the component + anomaly driven by the Anomaly Simulation panel.
 * Only one anomaly is active at a time; everything else returns to normal.
 */
export function setAnomalyScenario(component, anomaly = 'normal') {
  const st = simulationState;
  const operatorCommand = st.vPortValve.commandPosition;   // operating set point from the Controls tab is kept
  resetAllComponentSims();
  if (st.demo) st.demo.phase = 'done';                     // the Anomaly Simulation panel takes over from the boot demo
  st.anomalySim.component = component;
  st.anomalySim.anomaly = anomaly;
  if (component === 'vPortValve') {
    resetVPortSimulation(anomaly);            // reuses the existing V-Port scenario logic
  } else {
    resetVPortSimulation('normal');
    if (st[component]?.sim) st[component].sim.anomaly = anomaly;
    // Scenario presets (relative to the operator's set pressure) so the effect is visible immediately.
    const set = st.safetyValve.setPressure;
    if (component === 'safetyValve' && anomaly === 'failureToOpen') st.safetyValve.sim.linePressure = set + 0.4;   // already above set, keeps rising
    if (component === 'safetyValve' && anomaly === 'pressureRelief') st.safetyValve.sim.linePressure = set - 0.6;  // overpressure event starts here
    if (component === 'esdValve' && anomaly === 'lowAirPressure') st.esdValve.sim.airPressure = 3.0;
  }
  st.vPortValve.commandPosition = operatorCommand;
  st.vPortValve.actualPosition = operatorCommand;
  st.vPortValve.physicalPosition = operatorCommand;
  Object.assign(st.anomaly, { active: false, status: 'NORMAL', type: null, persistenceTime: 0, detail: '', component: null, severity: 'anomaly' });
  notify();
}

/**
 * Set ONE component's simulated anomaly without touching the others (used by the
 * boot demo scenario, which needs two anomalies at once). The Anomaly Simulation
 * panel keeps using setAnomalyScenario (one scenario at a time).
 */
export function setComponentAnomaly(component, anomaly = 'normal') {
  const st = simulationState;
  if (component === 'vPortValve') { st.vPortValve.mode = anomaly; }
  else if (st[component]?.sim) { st[component].sim = DEFAULT_SIMS[component](); st[component].sim.anomaly = anomaly; }
  notify();
}

/** RESET SIMULATION: selected component back to normal (keeps the component selection). */
export function resetAnomalySimulation() {
  setAnomalyScenario(simulationState.anomalySim.component, 'normal');
}

/** Set a numeric parameter of a component's anomaly simulation (e.g. esdValve.shutdownTime). */
export function setComponentSimParam(component, key, value) {
  const sim = simulationState[component]?.sim;
  if (!sim || !(key in sim)) return;
  sim[key] = Number(value) || 0;
  notify();
}

export function setVPortStuck(stuck) {
  simulationState.vPortValve.sim.sticking.stuck = !!stuck;
  notify();
}

export function setVPortSimParam(mode, key, value) {
  const sim = simulationState.vPortValve.sim[mode];
  if (!sim || !(key in sim)) return;
  sim[key] = Number(value) || 0;
  notify();
}

export function resetVPortSimulation(mode = 'normal') {
  const v = simulationState.vPortValve;
  v.mode = mode;
  v.commandPosition = 70;
  v.actualPosition = 70;
  v.physicalPosition = 70;
  v.positionError = 0;
  v.actualVelocity = 0;
  v.status = 'NORMAL';
  v.anomaly = null;
  v.sim.sticking.stuck = false;
  Object.assign(v.sim.slowResponse, { responseTime: 8, acceptableTime: 4, moveElapsed: 0, moving: false, lastMoveDuration: 0 });
  Object.assign(v.sim.hunting, { amplitude: 6, frequency: 0.5 });
  Object.assign(v.sim.trimWear, { health: 100, multiplier: 1 });
  Object.assign(simulationState.anomaly, { active: false, status: 'NORMAL', type: null, persistenceTime: 0, detail: '' });
  notify();
}

export function setDebugVisible(enabled) {
  simulationState.view.debug = !!enabled;
  notify();
}

function clampPercent(v) {
  return Math.max(0, Math.min(100, Number(v) || 0));
}

/** Operating setting: safety / relief valve set pressure (bar). Used by the PSV anomaly models. */
export function setSafetyValveSetPressure(bar) {
  const v = Number(bar);
  if (!Number.isFinite(v)) return;
  simulationState.safetyValve.setPressure = Math.max(5, Math.min(20, Math.round(v * 10) / 10));
  notify();
}

export function setYankeeRunning(running) {
  simulationState.yankee.running = !!running;
  notify();
}

export function setXrayValves(enabled) {
  simulationState.view.xrayValves = !!enabled;
  notify();
}

export function setSelection(componentId) {
  simulationState.selection.componentId = componentId;
  notify();
}
