import { simulationState as S } from '../simulation/simulationState.js';
import { ANOMALY_LABELS, esdStateText, ballStateText, ballResponseTime, ballStrokeInfo, esdCycleStage } from '../simulation/anomalyEngine.js';
import { anomalyByType, ANOMALY_CATALOG } from '../simulation/anomalyCatalog.js';
import { UNITS, THRESHOLDS, fmt, flowDeviationPercent, levelOfStatus, levelOfDeviation, maxLevel, SYSTEM_LABEL } from '../simulation/units.js';

/**
 * Dashboard data layer.
 *
 * Everything shown on the Dashboard is DERIVED from the same simulationState the
 * Twin uses — no second copy of any valve, anomaly, flow, pressure or temperature
 * value — and formatted through the shared unit configuration (units.js), so the
 * Dashboard always shows the Twin's units (bar, kg/h, °C).
 *
 * The only Dashboard-side additions are clearly marked SIMULATED helpers (paper
 * moisture, trend history, event log). They can be replaced by PLC / historian
 * data without touching the UI.
 */
export { fmt, UNITS, THRESHOLDS };

/* ------------------------------ simulated layer ------------------------------ */
const SIM = {
  historyWindowMs: 10 * 60 * 1000,   // trends show the last 10 minutes of real time
  sampleEvery: 2000,                 // ms between live samples (and backfill spacing)
};

function maintenanceWindow(health) {
  // Rough demo mapping (~1 month per 12 % of remaining health) shown as a range — an estimate, not a prediction.
  if (health >= THRESHOLDS.trimHealthWarning) return 'not yet indicated';
  const months = Math.max(0, health / 12);
  if (health < 25) return '< 1 month';
  return `~${Math.max(0, Math.floor(months - 0.5))}–${Math.ceil(months + 0.5)} months`;
}

/* --------------------------------- snapshot --------------------------------- */

export function snapshot(t = S.time) {
  const v = S.vPortValve, a = S.anomaly;
  const fraction = S.flow.fraction;
  const moisture = S.paper.moisture;              // computed by the engine — same value as the Twin panel

  // Flow references (all in Twin units):
  //   targetFlow   — healthy flow at the COMMANDED position (what the control system asked for)
  //   expectedFlow — healthy flow at the ACTUAL position (what the valve should pass where it is)
  const gate = upstreamGate();
  const targetFlow = Math.round(S.steam.maxFlow * (v.commandPosition / 100) * gate);
  const expectedFlow = v.expectedFlow;                      // engine value (actual position, healthy trim)
  const actualFlow = S.steam.flow;
  const flowDeviation = flowDeviationPercent(actualFlow, expectedFlow);   // trim indicator
  const targetDeviation = flowDeviationPercent(actualFlow, targetFlow);   // control indicator
  const trimHealth = Math.round(v.sim.trimWear.health);

  const components = statusRows();
  const anomalies = activeAnomalies({ expectedFlow, actualFlow, flowDeviation, trimHealth });

  // Centralized severity: worst component level, plus the configured flow-deviation rule.
  const flowLevel = gate > 0 ? levelOfDeviation(targetDeviation) : 'normal';
  const systemLevel = maxLevel(...components.map((c) => c.level), flowLevel);
  const counts = { critical: components.filter((c) => c.level === 'critical').length, attention: components.filter((c) => c.level === 'attention').length };
  counts.normal = components.length - counts.critical - counts.attention;

  return {
    kpis: {
      pressure: { value: S.steam.pressure, unit: UNITS.pressure },
      temperature: { value: S.steam.temperature, unit: UNITS.temperature },
      flow: { value: actualFlow, unit: UNITS.flow, target: targetFlow, deviation: targetDeviation, level: flowLevel },
      moisture: { value: moisture, unit: UNITS.moisture, target: THRESHOLDS.moistureTarget, level: moisture > THRESHOLDS.moistureTarget ? 'attention' : 'normal' },
      anomalies: { count: anomalies.length, level: anomalies.length ? maxLevel(...anomalies.map((x) => x.level)) : 'normal' },
      system: { level: systemLevel, label: SYSTEM_LABEL[systemLevel], ...counts },
    },
    vport: {
      mode: v.mode,
      status: v.status,
      level: levelOfStatus(v.status),
      command: v.commandPosition,
      actual: v.actualPosition,
      error: v.positionError,
      targetFlow, expectedFlow, actualFlow, flowDeviation,
      flowLevel: levelOfDeviation(flowDeviation),
      trimHealth,
      maintenance: maintenanceWindow(trimHealth),
      earlyWarning: trimHealth < THRESHOLDS.trimHealthWarning,
      anomalyType: a.component === 'vPortValve' ? a.type : null,
    },
    components,
    anomalies,
    insights: insights({ v, a, flowDeviation, trimHealth, moisture, components }),
    flowFraction: fraction,
  };
}

function upstreamGate() {
  return S.ballValve.position > 2 && S.esdValve.position > 2 ? 1 : 0;
}

/* ------------------------------ component rows ------------------------------ */

function statusRows() {
  const ball = S.ballValve, esd = S.esdValve, v = S.vPortValve, psv = S.safetyValve, rj = S.rotaryJoint, cv = S.checkValve, trap = S.steamTrap;
  const own = (id) => (S.anomalies || []).find((x) => x.component === id && x.active) || null;
  const flagged = (id) => { const x = own(id); return x ? anomalyByType(x.type)?.short : null; };

  // Ball valve — isolation: OPEN / CLOSED, never a modulating %.
  const ballState = ballStateText();
  const ballRow = { id: 'ballValve', name: 'Ball Valve', level: levelOfStatus(ball.status), param: 'State', value: ballState, notes: `Command ${ball.command === 100 ? 'OPEN' : 'CLOSE'}` };
  if (ball.sim.anomaly === 'passing' && ball.position <= 0.5 && S.steam.flow > 0) { ballRow.param = 'Leakage Flow'; ballRow.value = fmt.flow(S.steam.flow); ballRow.notes = 'Command CLOSE · state CLOSED · passing'; }
  if (flagged('ballValve')) ballRow.notes += ` · ${flagged('ballValve')}`;
  // Short state for the status table (discrete isolation-valve states only).
  ballRow.state = title(ballState);
  if (ball.sim.anomaly === 'slowOperation' && flagged('ballValve')) { ballRow.state = ball.sim.moving ? (ball.command === 0 ? 'Closing Slowly' : 'Opening Slowly') : `${title(ballState)} · slow response ${fmt.seconds(ballResponseTime())}`; ballRow.short = ball.sim.moving ? ballRow.state : 'Slow Response'; }
  if (ball.sim.anomaly === 'passing' && flagged('ballValve')) ballRow.state = `Closed · passing ${fmt.flow(S.steam.flow)}`;

  // ESD — isolation: OPEN / CLOSED / CLOSING / PARTIALLY OPEN.
  const esdRow = { id: 'esdValve', name: 'ESD Valve', level: levelOfStatus(esd.status), param: 'State', value: esdStateText(), notes: esd.command === 0 ? 'Trip command CLOSE' : 'No trip' };
  if (esd.sim.anomaly === 'slowShutdown' && (esd.sim.tripping || esd.sim.lastTripDuration)) esdRow.notes += ` · shutdown ${fmt.seconds(esd.sim.tripping ? esd.sim.tripElapsed : esd.sim.lastTripDuration)}`;
  if (esd.sim.anomaly === 'lowAirPressure') { esdRow.param = 'Air Pressure'; esdRow.value = `${fmt.pressure(esd.sim.airPressure)} (min ${fmt.pressure(esd.sim.minAirPressure)})`; esdRow.notes = `State ${esdStateText()}`; }
  if (flagged('esdValve')) esdRow.notes += ` · ${flagged('esdValve')}`;
  esdRow.state = title(esdStateText());
  if (esd.sim.anomaly === 'cyclicDegradation' && esd.cycleTest && flagged('esdValve')) { const ct = esd.cycleTest; esdRow.state = ct.active ? `${title(esdStateText())} · cycle ${ct.current}/${ct.total} · response ${fmt.seconds(ct.lastDelay)}` : `${title(esdStateText())} · response ${fmt.seconds(ct.lastDelay)}`; esdRow.short = 'Slow Response'; }
  if (esd.sim.anomaly === 'lowAirPressure' && flagged('esdValve')) esdRow.state = `${title(esdStateText())} · air ${fmt.pressure(esd.sim.airPressure)}`;

  // V-Port — control valve: position error, or flow deviation for trim wear.
  const vRow = v.mode === 'trimWear'
    ? { id: 'vPortValve', name: 'V-Port Control Valve', level: levelOfStatus(v.status), param: 'Flow Deviation', value: fmt.signedPercent(flowDeviationPercent(S.steam.flow, v.expectedFlow)), notes: `Cmd ${fmt.position(v.commandPosition)} / Act ${fmt.position(v.actualPosition)} · trim ${v.sim.trimWear.health}%` }
    : { id: 'vPortValve', name: 'V-Port Control Valve', level: levelOfStatus(v.status), param: 'Position Error', value: fmt.percent(v.positionError), notes: `Cmd ${fmt.position(v.commandPosition)} / Act ${fmt.position(v.actualPosition)}` };
  if (flagged('vPortValve')) vRow.notes += ` · ${flagged('vPortValve')}`;
  vRow.state = v.mode === 'trimWear' && flagged('vPortValve') ? `flow ${fmt.signedPercent(flowDeviationPercent(S.steam.flow, v.expectedFlow))} vs expected` : `${fmt.position(v.commandPosition)} cmd / ${fmt.position(v.actualPosition)} act`;

  // Safety valve — pressure driven.
  const psvOpen = psv.lift > 0.5;
  const psvRow = { id: 'safetyValve', name: 'Safety / Relief Valve', level: levelOfStatus(psv.status), param: 'Set / Current Pressure', value: `${fmt.pressure(psv.setPressure)} / ${fmt.pressure(psv.sim.linePressure, 2)}`, notes: psvOpen ? `OPEN · relief ${fmt.flow(psv.reliefFlow)}` : `CLOSED · relief ${fmt.flow(0)}` };
  if (psv.sim.anomaly === 'chattering') psvRow.notes = `${psvOpen ? 'OPEN' : 'CLOSED'} · ${psv.sim.openCount} openings`;
  if (flagged('safetyValve')) psvRow.notes += ` · ${flagged('safetyValve')}`;
  psvRow.state = psv.sim.anomaly === 'chattering' && flagged('safetyValve') ? `Chattering · ${psv.sim.openCount} openings` : psvOpen ? `Open · relief ${fmt.flow(psv.reliefFlow)}` : 'Closed';

  const rjRow = { id: 'rotaryJoint', name: 'Rotary Joint', level: 'normal', param: 'Seal Temperature', value: fmt.temperature(rj.sealTemp), notes: S.yankee.running ? `Running · ${fmt.speed(S.yankee.speedRpm)}` : 'Yankee stopped', state: 'Normal' };
  const yankeeRow = { id: 'yankee', name: 'Yankee Dryer', level: 'normal', param: 'Speed · Surface Temp', value: `${fmt.speed(S.yankee.speedRpm)} · ${fmt.temperature(S.yankee.surfaceTemp)}`, notes: S.yankee.running ? 'Running' : 'Stopped', state: S.yankee.running ? `${fmt.speed(S.yankee.speedRpm)} · ${fmt.temperature(S.yankee.surfaceTemp)}` : 'Stopped' };

  // Steam trap — condition driven (temperatures), never a position.
  const dT = trap.sim.inletTemp - trap.sim.outletTemp;
  const trapCond = trap.sim.anomaly === 'failedOpen' ? 'FAILED OPEN' : trap.sim.anomaly === 'blocked' ? 'BLOCKED' : trap.sim.anomaly === 'poorRemoval' ? 'POOR CONDENSATE REMOVAL' : 'HEALTHY';
  const trapRow = { id: 'steamTrap', name: 'Steam Trap', level: levelOfStatus(trap.status), param: 'Inlet / Outlet Temp', value: `${fmt.temperatureNum(trap.sim.inletTemp)} / ${fmt.temperature(trap.sim.outletTemp)}`, notes: `ΔT ${fmt.temperature(dT)} · ${trapCond}`, state: flagged('steamTrap') ? title(trapCond) : 'Normal' };

  // Check valve — passive: direction / state.
  const reverse = S.condensate.direction < 0;
  const cvOpen = cv.lift > 0.05;
  const cvRow = { id: 'checkValve', name: 'Check Valve', level: levelOfStatus(cv.status), param: 'Flow Direction', value: reverse ? '← REVERSE' : S.condensate.flow > 0 ? 'CONDENSATE →' : 'NO FLOW', notes: reverse ? `disc ${cvOpen ? 'open' : 'near seat'} · ${fmt.flow(Math.abs(S.condensate.flow))} reverse` : cvOpen ? `disc open · ${fmt.flow(S.condensate.flow)}` : (cv.sim.anomaly === 'failureToOpen' ? 'disc stuck closed · condensate backing up' : 'disc seated') };
  if (flagged('checkValve')) cvRow.notes += ` · ${flagged('checkValve')}`;
  cvRow.state = reverse ? 'Reverse' : S.condensate.flow > 0 ? 'Forward' : cv.sim.anomaly === 'failureToOpen' && flagged('checkValve') ? 'Stuck Closed' : 'No Flow';

  return [ballRow, esdRow, vRow, psvRow, trapRow, cvRow, rjRow, yankeeRow];
}

function title(text) { return String(text).toLowerCase().replace(/(^|[\s·(])([a-z])/g, (m, pre, c) => pre + c.toUpperCase()); }

/* ------------------------------ active anomalies ------------------------------ */

function activeAnomalies({ expectedFlow, actualFlow, flowDeviation, trimHealth }) {
  return (S.anomalies || []).filter((r) => r.active && r.type).map((r) => anomalyEntry(r, { expectedFlow, actualFlow, flowDeviation, trimHealth }));
}

/** Dashboard entry for one detection record (component, type, status, detail, detectedAt). */
export function anomalyEntry(a, ctx = null) {
  const v = S.vPortValve;
  const expectedFlow = ctx?.expectedFlow ?? v.expectedFlow, actualFlow = ctx?.actualFlow ?? S.steam.flow;
  const flowDeviation = ctx?.flowDeviation ?? flowDeviationPercent(actualFlow, expectedFlow);
  const trimHealth = ctx?.trimHealth ?? Math.round(v.sim.trimWear.health);
  const def = anomalyByType(a.type);
  const level = levelOfStatus(a.status);
  const lines = [];
  switch (a.type) {
    case 'VPORT_POSITION_MISMATCH': case 'VPORT_STICKING': case 'VPORT_SLOW_RESPONSE': case 'VPORT_HUNTING':
      lines.push(['Command', fmt.position(v.commandPosition)], ['Actual', fmt.position(v.actualPosition)], ['Error', fmt.percent(v.positionError)]);
      if (a.type === 'VPORT_SLOW_RESPONSE') lines.push(['Response', a.detail]);
      if (a.type === 'VPORT_HUNTING') lines.push(['Oscillation', a.detail]);
      break;
    case 'VPORT_TRIM_WEAR':
      lines.push(['Expected Flow', fmt.flow(expectedFlow)], ['Actual Flow', fmt.flow(actualFlow)], ['Flow Deviation', fmt.signedPercent(flowDeviation)], ['Trim Health', fmt.percent(trimHealth)], ['Estimated Maintenance Window', maintenanceWindow(trimHealth)]);
      break;
    case 'ESD_FAIL_TO_CLOSE': case 'ESD_PARTIAL_CLOSURE': case 'ESD_SLOW_SHUTDOWN':
      lines.push(['Trip Command', 'CLOSE'], ['Actual State', esdStateText()]);
      if (a.type === 'ESD_SLOW_SHUTDOWN') lines.push(['Shutdown Time', fmt.seconds(S.esdValve.sim.tripping ? S.esdValve.sim.tripElapsed : S.esdValve.sim.lastTripDuration)]);
      lines.push(['Steam Flow', fmt.flow(S.steam.flow)]);
      break;
    case 'ESD_RESPONSE_DEGRADATION': {
      const ct = S.esdValve.cycleTest;
      lines.push(['Cycle', ct ? `${ct.current} / ${ct.total}` : '—'], ['Response Delay', fmt.seconds(ct?.lastDelay || 0)], ['Expected', `< ${fmt.seconds(S.esdValve.sim.acceptableDelay)}`], ['Stage', esdCycleStage(ct?.lastDelay || 0)]);
      break;
    }
    case 'ESD_LOW_AIR':
      lines.push(['Air Pressure', fmt.pressure(S.esdValve.sim.airPressure)], ['Minimum Required', fmt.pressure(S.esdValve.sim.minAirPressure)], ['Trip Command', S.esdValve.command === 0 ? 'CLOSE' : 'NONE'], ['Actual State', esdStateText()]);
      break;
    case 'BALL_SLOW_OPERATION':
      { const k = ballStrokeInfo(); lines.push(['Command', k.command], ['Actual', k.actual], ['Response Time', fmt.seconds(k.responseTime)], ['Expected', `< ${fmt.seconds(S.ballValve.sim.acceptableTime)}`]); }
      break;
    case 'BALL_FAIL_TO_OPEN': case 'BALL_FAIL_TO_CLOSE':
      lines.push(['Command', S.ballValve.command === 100 ? 'OPEN' : 'CLOSE'], ['Actual', ballStateText()], ['Steam Flow', fmt.flow(S.steam.flow)]);
      break;
    case 'BALL_PASSING':
      lines.push(['Command', 'CLOSE'], ['Valve State', 'CLOSED'], ['Leakage Flow', fmt.flow(S.steam.flow)]);
      break;
    case 'PSV_UNEXPECTED_OPENING': case 'PSV_FAILURE_TO_OPEN':
      lines.push(['Set Pressure', fmt.pressure(S.safetyValve.setPressure)], ['Current Pressure', fmt.pressure(S.safetyValve.sim.linePressure, 2)], ['Valve State', S.safetyValve.lift > 0.5 ? 'OPEN' : 'CLOSED'], ['Relief Flow', fmt.flow(S.safetyValve.reliefFlow)]);
      break;
    case 'PSV_CHATTERING':
      lines.push(['Set Pressure', fmt.pressure(S.safetyValve.setPressure)], ['Current Pressure', fmt.pressure(S.safetyValve.sim.linePressure, 2)], ['Opening Count', String(S.safetyValve.sim.openCount)], ['Valve State', S.safetyValve.lift > 0.5 ? 'OPEN' : 'CLOSED']);
      break;
    case 'TRAP_FAILED_OPEN': case 'TRAP_BLOCKED': case 'TRAP_POOR_REMOVAL':
      lines.push(['Inlet Temperature', fmt.temperature(S.steamTrap.sim.inletTemp)], ['Outlet Temperature', fmt.temperature(S.steamTrap.sim.outletTemp)], ['ΔT', fmt.temperature(S.steamTrap.sim.inletTemp - S.steamTrap.sim.outletTemp)], ['Discharge', fmt.flow(Math.max(0, S.condensate.flow))]);
      break;
    case 'CHECK_REVERSE_FLOW': case 'CHECK_FAILURE_TO_CLOSE': case 'CHECK_FAILURE_TO_OPEN':
      lines.push(['Expected Direction', 'CONDENSATE →'], ['Actual', S.condensate.direction < 0 ? '← REVERSE' : S.condensate.flow > 0 ? 'CONDENSATE →' : 'NO FLOW'], ['ΔP', fmt.pressure(S.checkValve.sim.upstreamPressure - S.checkValve.sim.downstreamPressure)]);
      break;
    default:
      lines.push(['Evidence', a.detail]);
  }
  return {
    componentId: a.component,
    component: def?.componentLabel || ANOMALY_CATALOG[a.component]?.label || a.component,
    title: (ANOMALY_LABELS[a.type] || def?.label || a.type).replace(/^(V-Port|ESD|Ball Valve|Safety Valve|Steam Trap|Check Valve) /, ''),
    type: a.type,
    status: a.status,
    level,
    lines,
    detail: a.detail,
    detectedAt: a.detectedAt || null,
    explain: def?.explain || '',
    subtitle: subtitleFor(a.type),
    impact: impactFor(a.type),
    warning: level === 'critical' ? 'Attention required. Monitor closely and plan inspection.' : 'Early indication only. Trend and schedule inspection at the next opportunity.',
  };
}

function subtitleFor(type) {
  switch (type) {
    case 'VPORT_POSITION_MISMATCH': { const v = S.vPortValve; return `Actual position is not tracking commanded position. Deviation: ${Math.round(v.positionError)}% (${Math.round(v.commandPosition)}% cmd / ${Math.round(v.actualPosition)}% act).`; }
    case 'VPORT_STICKING': return 'Valve not moving on command';
    case 'VPORT_SLOW_RESPONSE': return 'Valve reaches command too slowly';
    case 'VPORT_HUNTING': return 'Position oscillating around command';
    case 'VPORT_TRIM_WEAR': return 'Flow above expected for position';
    case 'BALL_SLOW_OPERATION': return 'Valve is taking longer than expected to close';
    case 'BALL_FAIL_TO_CLOSE': return 'Valve did not close on command';
    case 'BALL_FAIL_TO_OPEN': return 'Valve did not open on command';
    case 'BALL_PASSING': return 'Closed valve passing steam';
    case 'ESD_FAIL_TO_CLOSE': return 'Trip issued, valve still open';
    case 'ESD_SLOW_SHUTDOWN': return 'Shutdown slower than acceptable';
    case 'ESD_PARTIAL_CLOSURE': return 'Valve stopped part-way on trip';
    case 'ESD_LOW_AIR': return 'Instrument air below minimum';
    case 'ESD_RESPONSE_DEGRADATION': return 'Valve response time is increasing over repeated cycles.';
    case 'PSV_UNEXPECTED_OPENING': return 'Lifting below set pressure';
    case 'PSV_FAILURE_TO_OPEN': return 'Pressure above set, valve closed';
    case 'PSV_CHATTERING': return 'Rapid open / close cycling';
    case 'TRAP_FAILED_OPEN': return 'Live steam passing to condensate';
    case 'TRAP_BLOCKED': return 'No condensate discharge';
    case 'TRAP_POOR_REMOVAL': return 'Sluggish condensate removal';
    case 'CHECK_REVERSE_FLOW': return 'Condensate flowing backward';
    case 'CHECK_FAILURE_TO_OPEN': return 'Disc stuck closed';
    case 'CHECK_FAILURE_TO_CLOSE': return 'Disc stuck open';
    default: return '';
  }
}

function impactFor(type) {
  switch (type) {
    case 'VPORT_TRIM_WEAR': return 'Steam flow above expected for position — reduced control accuracy';
    case 'VPORT_STICKING': return 'Valve not following control demand — steam flow held at current opening';
    case 'VPORT_SLOW_RESPONSE': return 'Delayed steam-flow response to control moves';
    case 'VPORT_HUNTING': return 'Oscillating steam flow — cyclic drying variation';
    case 'ESD_FAIL_TO_CLOSE': case 'ESD_PARTIAL_CLOSURE': case 'ESD_LOW_AIR': return 'Steam isolation not guaranteed on shutdown demand';
    case 'ESD_SLOW_SHUTDOWN': return 'Delayed steam isolation on trip';
    case 'ESD_RESPONSE_DEGRADATION': return 'Valve response time is increasing over multiple cycles';
    case 'BALL_FAIL_TO_OPEN': return 'No steam to the Yankee — production impact';
    case 'BALL_FAIL_TO_CLOSE': case 'BALL_PASSING': return 'Steam line cannot be fully isolated';
    case 'BALL_SLOW_OPERATION': return 'Steam isolation is delayed — the valve takes longer than expected to close';
    case 'PSV_UNEXPECTED_OPENING': return 'Steam loss to atmosphere and reduced line pressure';
    case 'PSV_FAILURE_TO_OPEN': return 'Over-pressure protection compromised';
    case 'PSV_CHATTERING': return 'Seat damage risk, pressure instability';
    case 'TRAP_FAILED_OPEN': return 'Live steam loss to condensate system';
    case 'TRAP_BLOCKED': return 'Condensate backing up into the Yankee — drying and water-hammer risk';
    case 'TRAP_POOR_REMOVAL': return 'Reduced heat transfer, uneven drying';
    case 'CHECK_REVERSE_FLOW': case 'CHECK_FAILURE_TO_CLOSE': return 'Condensate returning toward the trap / Yankee';
    case 'CHECK_FAILURE_TO_OPEN': return 'Condensate cannot reach the return header';
    default: return 'Steam flow is significantly below expected flow and may affect Yankee drying performance';
  }
}

/* --------------------------------- insights --------------------------------- */

function insights({ v, a, flowDeviation, trimHealth, moisture, components }) {
  const out = [];
  if (a.type && (a.status === 'ANOMALY' || a.status === 'WARNING')) {
    out.push(`${ANOMALY_LABELS[a.type]}: ${a.detail}.`);
  } else {
    out.push('All monitored components are within their normal operating ranges.');
  }
  if (a.component === 'vPortValve' && a.type !== 'VPORT_TRIM_WEAR' && a.status !== 'NORMAL') out.push(`V-Port position error (${fmt.percent(v.positionError)}) exceeds the configured ${THRESHOLDS.positionErrorWarning}% demo threshold.`);
  if (Math.abs(flowDeviation) > THRESHOLDS.flowDeviationWarning) out.push(`Flow deviation ${fmt.signedPercent(flowDeviation)} vs expected exceeds the configured ${THRESHOLDS.flowDeviationWarning}% demo threshold.`);
  out.push(trimHealth < THRESHOLDS.trimHealthWarning ? `Trim health estimate ${trimHealth}% — estimated maintenance window ${maintenanceWindow(trimHealth)} (simulated, not a prediction).` : 'Trim health estimate shows no significant degradation.');
  out.push(moisture <= THRESHOLDS.moistureTarget ? `Paper moisture within target (${fmt.moisture(moisture)} vs ${fmt.moisture(THRESHOLDS.moistureTarget)}).` : `Paper moisture above target (${fmt.moisture(moisture)} vs ${fmt.moisture(THRESHOLDS.moistureTarget)}).`);
  const normalOthers = components.filter((c) => c.level === 'normal' && c.id !== 'vPortValve').map((c) => c.name.toLowerCase());
  if (normalOthers.length) out.push(`No abnormal condition in ${normalOthers.join(', ')}.`);
  if (a.status !== 'NORMAL' || trimHealth < THRESHOLDS.trimHealthWarning) out.push('Consider inspection during the next planned shutdown.');
  return out;
}

/* ----------------------------- history & events ----------------------------- */

/**
 * Trend history: a rolling 10-minute window of real time, sampled every 2 s.
 * The backfill uses the same spacing and gentle noise around the current operating
 * point, so live samples continue the line without an artificial cliff. Simulated
 * events (anomaly detected / cleared) are recorded as markers on the trends.
 */
export function createHistory() {
  const series = { flow: [], pressure: [], temperature: [], moisture: [] };
  const markers = [];
  const now = Date.now();
  const snap = snapshot();
  const base = { flow: snap.kpis.flow.value, pressure: snap.kpis.pressure.value, temperature: snap.kpis.temperature.value, moisture: snap.kpis.moisture.value };
  const noise = { flow: 60, pressure: 0.03, temperature: 0.6, moisture: 0.04 };
  const n = Math.floor(SIM.historyWindowMs / SIM.sampleEvery);
  for (let i = n; i > 0; i--) {
    const t = now - i * SIM.sampleEvery;
    const drift = Math.sin(i / 37) * 0.6 + Math.sin(i / 11) * 0.3;
    for (const k of Object.keys(series)) series[k].push({ t, v: base[k] + noise[k] * (drift + (Math.random() - 0.5) * 0.5) });
  }
  let lastSample = 0;

  function sample(now = Date.now()) {
    if (now - lastSample < SIM.sampleEvery) return false;
    lastSample = now;
    const s = snapshot();
    push('flow', now, s.kpis.flow.value);
    push('pressure', now, s.kpis.pressure.value);
    push('temperature', now, s.kpis.temperature.value);
    push('moisture', now, s.kpis.moisture.value);
    while (markers.length && markers[0].t < now - SIM.historyWindowMs) markers.shift();
    return true;
  }
  function push(k, t, v) {
    series[k].push({ t, v });
    while (series[k].length && series[k][0].t < t - SIM.historyWindowMs) series[k].shift();
  }
  /** Change of a series over roughly the last minute (for KPI trend arrows). */
  function delta(k, n = 30) {
    const arr = series[k];
    if (arr.length < 2) return 0;
    return arr[arr.length - 1].v - arr[Math.max(0, arr.length - 1 - n)].v;
  }
  function addMarker(t, label, tone) { markers.push({ t, label, tone }); }
  return { series, markers, sample, delta, addMarker, windowMs: SIM.historyWindowMs };
}

export function createEventLog(history) {
  const events = [];
  const now = Date.now();
  const add = (t, event, details, severity) => { events.unshift({ t, event, details, severity }); if (events.length > 12) events.pop(); };
  add(now, 'Monitoring started', 'Digital twin connected · all components normal', 'Info');

  let lastStatus = S.anomaly.status, lastType = null, lastFlow = S.steam.flow, prevFlowSeen = S.steam.flow;
  let lastScenario = `${S.anomalySim.component}:${S.anomalySim.anomaly}`;

  function update() {
    const now = Date.now();
    const a = S.anomaly;
    const flaggedNow = a.status === 'ANOMALY' || a.status === 'WARNING';
    const flaggedBefore = lastStatus === 'ANOMALY' || lastStatus === 'WARNING';
    if (flaggedNow && !flaggedBefore) {
      const label = ANOMALY_LABELS[a.type] || 'Anomaly';
      add(now, `${label} detected`, a.detail, a.status === 'WARNING' ? 'Warning' : 'Critical');
      history?.addMarker(now, label, a.status === 'WARNING' ? 'warn' : 'alarm');
    } else if (!flaggedNow && flaggedBefore) {
      add(now, 'Returned to normal', lastType ? ANOMALY_LABELS[lastType] : '', 'Info');
      history?.addMarker(now, 'Returned to normal', 'ok');
    }
    lastStatus = a.status; if (a.type) lastType = a.type;

    const scenario = `${S.anomalySim.component}:${S.anomalySim.anomaly}`;
    if (scenario !== lastScenario) {
      const comp = ANOMALY_CATALOG[S.anomalySim.component];
      const def = comp?.anomalies.find((x) => x.id === S.anomalySim.anomaly);
      add(now, 'Simulation scenario changed', `${comp?.label || S.anomalySim.component} · ${def?.label || S.anomalySim.anomaly}`, 'Info');
      history?.addMarker(now, `Scenario: ${def?.label || S.anomalySim.anomaly}`, 'info');
      lastScenario = scenario;
    }
    // Flow steps are logged once the ramp has settled (the engine snaps the flow to its target).
    const flow = S.steam.flow;
    const settled = Math.abs(flow - prevFlowSeen) < 5;
    prevFlowSeen = flow;
    if (settled && Math.abs(flow - lastFlow) > 0.15 * S.steam.maxFlow && Math.abs(flow - lastFlow) > 500) {
      add(now, flow < lastFlow ? 'Steam flow decreased' : 'Steam flow increased', `${fmt.flow(lastFlow)} → ${fmt.flow(flow)}`, 'Info');
      lastFlow = flow;
    }
  }
  return { events, update };
}
