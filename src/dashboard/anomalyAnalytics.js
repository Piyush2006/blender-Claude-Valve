import { simulationState as S } from '../simulation/simulationState.js';
import { fmt, THRESHOLDS, flowDeviationPercent } from '../simulation/units.js';
import { ballStateText, ballResponseTime, ballStrokeInfo, esdStateText, esdCycleStage } from '../simulation/anomalyEngine.js';
import { ANOMALY_CATALOG } from '../simulation/anomalyCatalog.js';

/**
 * Per-anomaly analytics for the Dashboard detail panel. Live values come from
 * simulationState (same numbers as the Twin). Yesterday / 7-day baselines and
 * the older activity entries are a SIMULATED historian — clearly marked in the UI.
 */

/** Flow expected at the COMMANDED V-Port position (healthy trim), kg/h. */
export function targetFlow() {
  const gate = S.ballValve.position > 2 && S.esdValve.position > 2 ? 1 : 0;
  return Math.round(S.steam.maxFlow * (S.vPortValve.commandPosition / 100) * gate);
}

/** Which chart the detail panel draws for an anomaly / component. */
export function chartKind(componentId) {
  if (componentId === 'vPortValve') return 'position';
  if (componentId === 'ballValve') return 'ballResponse';
  if (componentId === 'esdValve') return S.esdValve.cycleTest ? 'esdCycle' : 'esdResponse';
  if (['safetyValve', 'steamTrap', 'checkValve', 'rotaryJoint', 'yankee'].includes(componentId)) return 'series';
  return 'flow';
}

export const SERIES_COLORS = { a: '#2563EB', b: '#DC2626', c: '#16A34A', d: '#7C3AED', ref: '#94A3B8' };

/**
 * Component-specific series chart definitions (title, legend, spec for createSeriesChart).
 * Live values only; thresholds are the demo limits used by the detectors.
 */
export function seriesChartFor(componentId, entry) {
  const onsetAt = entry?.detectedAt || null;
  switch (componentId) {
    case 'safetyValve': {
      const set = S.safetyValve.setPressure;
      return {
        title: 'Line Pressure vs Set Pressure', note: 'shaded = valve open (relieving)',
        legend: [['Line pressure (bar)', SERIES_COLORS.a], ['Set pressure', SERIES_COLORS.b, true], ['Valve open', 'rgba(245,158,11,0.25)']],
        spec: { left: { unit: 'bar', min: set - 3, max: set + 1 }, series: [{ key: 'psvLine', color: SERIES_COLORS.a }], refLines: [{ value: set, color: SERIES_COLORS.b, label: `set ${set.toFixed(1)} bar` }], shadeWhere: { key: 'psvLift', above: 0.5, color: 'rgba(245,158,11,0.18)', label: 'open' }, onsetAt },
      };
    }
    case 'steamTrap':
      return {
        title: 'Inlet vs Outlet Temperature', note: 'band = ΔT across the trap (live steam passing when ΔT < 15 °C)',
        legend: [['Inlet (°C)', SERIES_COLORS.b], ['Outlet (°C)', SERIES_COLORS.a], ['ΔT', 'rgba(37,99,235,0.12)']],
        spec: { left: { unit: '°C', min: 40, max: 180 }, series: [{ key: 'trapIn', color: SERIES_COLORS.b }, { key: 'trapOut', color: SERIES_COLORS.a }], shadeBetween: { a: 'trapIn', b: 'trapOut', color: 'rgba(37,99,235,0.12)' }, refLines: [{ value: 85, color: SERIES_COLORS.ref, label: 'poor removal < 85 °C' }], onsetAt },
      };
    case 'checkValve':
      return {
        title: 'Condensate Flow Through Check Valve', note: 'negative = reverse flow (shaded red)',
        legend: [['Condensate flow (kg/h)', SERIES_COLORS.a], ['Reverse flow', 'rgba(220,38,38,0.2)'], ['ΔP (bar)', SERIES_COLORS.d]],
        spec: { left: { unit: 'kg/h', min: -1000, max: 1000 }, right: { unit: 'bar', min: -1, max: 1 }, series: [{ key: 'condFlow', color: SERIES_COLORS.a }, { key: 'dP', color: SERIES_COLORS.d, axis: 'right', dash: '4 3', width: 1.5 }], refLines: [{ value: 0, color: SERIES_COLORS.ref, dash: '2 2' }], areaBelowZero: { key: 'condFlow', color: 'rgba(220,38,38,0.2)' }, onsetAt },
      };
    case 'rotaryJoint':
      return {
        title: 'Rotary Joint Seal Temperature', note: 'steam temperature shown as reference',
        legend: [['Seal temperature (°C)', SERIES_COLORS.b], ['Steam temperature', SERIES_COLORS.ref, true]],
        spec: { left: { unit: '°C', min: 100, max: 190 }, series: [{ key: 'sealTemp', color: SERIES_COLORS.b }, { key: 'steamTemp', color: SERIES_COLORS.ref, dash: '5 3', width: 1.5 }], onsetAt },
      };
    case 'yankee':
      return {
        title: 'Yankee Surface Temperature & Paper Moisture', note: 'moisture on the right axis (target 5.0 %)',
        legend: [['Surface temperature (°C)', SERIES_COLORS.b], ['Paper moisture (%)', SERIES_COLORS.a], ['Moisture target', SERIES_COLORS.ref, true]],
        spec: { left: { unit: '°C', min: 50, max: 130 }, right: { unit: '%', min: 3, max: 8 }, series: [{ key: 'yankeeTemp', color: SERIES_COLORS.b }, { key: 'moisture', color: SERIES_COLORS.a, axis: 'right' }], refLines: [{ value: THRESHOLDS.moistureTarget, color: SERIES_COLORS.ref, axis: 'right', label: 'target' }], onsetAt },
      };
    default:
      return null;
  }
}

/* ------------------------------ overview metrics ------------------------------ */

/** Rows of metric boxes: [{ label, value, sub, tone }] per row. */
export function overviewMetrics(entry) {
  const v = S.vPortValve, b = S.ballValve;
  const flow = S.steam.flow;
  const type = entry?.type;
  const componentId = entry?.componentId;
  if (componentId === 'vPortValve') {
    const target = targetFlow();
    const dev = flowDeviationPercent(flow, target);
    const atActualDev = flowDeviationPercent(flow, v.expectedFlow);
    const errBad = v.positionError > THRESHOLDS.positionErrorWarning;
    const trim = type === 'VPORT_TRIM_WEAR';
    return [
      [
        { label: 'Commanded Position', value: fmt.position(v.commandPosition) },
        { label: 'Actual Position', value: fmt.position(v.actualPosition), tone: errBad ? 'critical' : 'normal' },
        { label: 'Position Error', value: fmt.percent(v.positionError), tone: errBad ? 'critical' : 'normal', sub: errBad ? `> ${THRESHOLDS.positionErrorWarning}% threshold` : 'within threshold' },
      ],
      [
        { label: 'Steam Flow', value: fmt.flow(flow), sub: Math.abs(dev) < 0.5 ? 'on target' : `${dev < 0 ? '▼' : '▲'} ${fmt.signedPercent(dev).replace(/^[+−-]/, '')} vs command`, tone: Math.abs(dev) > THRESHOLDS.flowDeviationWarning ? 'critical' : 'normal' },
        { label: `Expected at Command (${fmt.position(v.commandPosition)})`, value: fmt.flow(target) },
        { label: `Expected at Actual (${fmt.position(v.actualPosition)})`, value: fmt.flow(v.expectedFlow), sub: trim ? `${fmt.signedPercent(atActualDev)} above expected` : Math.abs(atActualDev) <= 3 ? '✓ matches' : fmt.signedPercent(atActualDev), tone: trim ? 'attention' : Math.abs(atActualDev) <= 3 ? 'normal' : 'attention' },
      ],
    ];
  }
  if (componentId === 'ballValve') {
    const k = ballStrokeInfo(), rt = k.responseTime, acc = b.sim.acceptableTime;
    const slow = rt > acc;
    return [
      [
        { label: 'Command', value: k.command },
        { label: 'Actual', value: k.actual, tone: k.inProgress ? 'attention' : 'normal', sub: k.inProgress ? 'stroke in progress' : `reached after ${fmt.seconds(rt)}` },
        { label: 'Response Time', value: fmt.seconds(rt), tone: slow ? 'attention' : 'normal', sub: k.inProgress ? 'elapsed so far' : `last ${k.command === 'CLOSE' ? 'closing' : 'opening'} stroke` },
      ],
      [
        { label: 'Expected', value: `< ${fmt.seconds(acc)}` },
        { label: 'Response Deviation', value: rt > acc ? `+${fmt.seconds(rt - acc)}` : fmt.seconds(0), tone: slow ? 'attention' : 'normal' },
        { label: 'Valve State', value: ballStateText(), tone: b.sim.moving ? 'attention' : 'normal', sub: 'current' },
      ],
    ];
  }
  if (componentId === 'esdValve' && S.esdValve.cycleTest) {
    const k = esdCycleSummary();
    const bad = k.currentDelay > k.acceptable;
    return [
      [
        { label: 'Command Cycle', value: `${k.period} sec`, sub: `${k.period} sec ON / ${k.period} sec OFF` },
        { label: 'Cycles Analyzed', value: String(k.current), sub: `~${Math.round(k.durationS)} seconds${k.active ? ' · running' : ''}` },
        { label: 'Initial Response', value: `${k.initial.toFixed(1)} sec`, sub: 'Cycles 1–3', tone: 'normal' },
      ],
      [
        { label: 'Current Response', value: `${k.currentDelay.toFixed(1)} sec`, sub: k.lastRange, tone: bad ? 'attention' : 'normal' },
        { label: 'Status', value: k.trend === 'Degrading' ? 'DEGRADING' : 'STABLE', sub: k.stage.toLowerCase(), tone: k.trend === 'Degrading' ? 'attention' : 'normal' },
        { label: 'Valve State', value: esdStateText(), sub: 'current' },
      ],
    ];
  }
  // Generic: the anomaly's evidence lines (or the component's live values) in rows of three.
  const lines = entry?.lines?.length ? entry.lines : genericLines(componentId);
  const boxes = lines.map(([label, value]) => ({ label, value }));
  const rows = [];
  for (let i = 0; i < boxes.length; i += 3) rows.push(boxes.slice(i, i + 3));
  return rows;
}

function genericLines(componentId) {
  switch (componentId) {
    case 'esdValve': return [['Trip Command', S.esdValve.command === 0 ? 'CLOSE' : 'NONE'], ['Actual State', esdStateText()], ['Steam Flow', fmt.flow(S.steam.flow)]];
    case 'safetyValve': return [['Set Pressure', fmt.pressure(S.safetyValve.setPressure)], ['Current Pressure', fmt.pressure(S.safetyValve.sim.linePressure, 2)], ['Valve State', S.safetyValve.lift > 0.5 ? 'OPEN' : 'CLOSED']];
    case 'steamTrap': return [['Inlet', fmt.temperature(S.steamTrap.sim.inletTemp)], ['Outlet', fmt.temperature(S.steamTrap.sim.outletTemp)], ['Discharge', fmt.flow(Math.max(0, S.condensate.flow))]];
    case 'checkValve': return [['Direction', S.condensate.direction < 0 ? 'REVERSE' : 'FORWARD'], ['Condensate Flow', fmt.flow(Math.abs(S.condensate.flow))], ['ΔP', fmt.pressure(S.checkValve.sim.upstreamPressure - S.checkValve.sim.downstreamPressure)]];
    case 'yankee': return [['Speed', fmt.speed(S.yankee.speedRpm)], ['Surface Temp', fmt.temperature(S.yankee.surfaceTemp)], ['Paper Moisture', fmt.moisture(S.paper.moisture)]];
    case 'rotaryJoint': return [['Seal Temp', fmt.temperature(S.rotaryJoint.sealTemp)], ['Steam Pressure', fmt.pressure(S.steam.pressure)], ['Steam Flow', fmt.flow(S.steam.flow)]];
    default: return [['Steam Flow', fmt.flow(S.steam.flow)], ['Steam Pressure', fmt.pressure(S.steam.pressure)], ['Steam Temperature', fmt.temperature(S.steam.temperature)]];
  }
}

/** Summary of the ESD cyclic ON/OFF response test (null when none recorded). */
export function esdCycleSummary() {
  const e = S.esdValve, ct = e.cycleTest;
  if (!ct) return null;
  const first = ct.cycles.slice(0, 3), last = ct.cycles.slice(-4);
  const avg = (arr) => (arr.length ? arr.reduce((a, c) => a + c.delay, 0) / arr.length : 0);
  const initial = avg(first) || (e.sim.delayInitial ?? 0.5), current = ct.lastDelay || avg(last);
  const stage = esdCycleStage(current, e.sim);
  const trend = current > initial * 1.5 ? 'Degrading' : 'Stable';
  return { period: ct.period, total: ct.total, current: ct.current, active: ct.active, durationS: 2 * ct.period * ct.total, initial, currentDelay: current, stage, trend, acceptable: e.sim.acceptableDelay, cycles: ct.cycles, lastRange: `Cycles ${Math.max(1, ct.current - 3)}–${ct.current}` };
}

/** Summary of the V-Port cyclic command test (null when none recorded). */
export function vportCycleSummary() {
  const v = S.vPortValve, ct = v.cycleTest, c = v.sim.cyclic;
  if (!ct) return null;
  const first = ct.cycles.slice(0, 3);
  const avg = (arr) => (arr.length ? arr.reduce((a, x) => a + x.delay, 0) / arr.length : 0);
  const initial = avg(first) || c.delayInitial, current = ct.lastDelay || c.delayInitial;
  const stalledFrom = ct.cycles.find((cy) => cy.shortfall > 0)?.index || null;
  return { period: ct.period, total: ct.total, current: ct.current, active: ct.active, hi: c.hi, lo: c.lo, initial, currentDelay: current, acceptable: c.acceptableDelay, stalledFrom, ceiling: ct.ceiling, cycles: ct.cycles,
    stageOf: (cy) => (cy.shortfall > 0 ? 'MISMATCH' : esdCycleStage(cy.delay, c)) };
}

/** Compact impact banner text. */
export function impactText(entry) {
  if (!entry) return '';
  if (entry.type === 'ESD_RESPONSE_DEGRADATION') return 'Valve response time is increasing over multiple cycles.';
  if (entry.componentId === 'vPortValve' && entry.type !== 'VPORT_TRIM_WEAR') {
    const k = vportCycleSummary();
    if (k && k.stalledFrom) return `Response delay has grown from ${k.initial.toFixed(1)} s to ${k.currentDelay.toFixed(1)} s over ${k.current} command cycles (${Math.round(k.current * 2 * k.period / 60)} min); since cycle ${k.stalledFrom} the valve no longer reaches the commanded position (currently ${fmt.position(k.ceiling)} reachable of ${fmt.position(k.hi)}). Steam flow is significantly below expected and may affect Yankee drying performance.`;
    if (k) return `Response delay has grown from ${k.initial.toFixed(1)} s to ${k.currentDelay.toFixed(1)} s over ${k.current} command cycles (${Math.round(k.current * 2 * k.period / 60)} min) and is still increasing.`;
    return 'Steam flow is significantly below expected flow and may affect Yankee drying performance.';
  }
  return `${entry.impact}.`;
}

/* ------------------------------ historical comparison ------------------------------ */

/**
 * Compact "today vs yesterday vs 7-day" block. Today = live Twin value;
 * the baselines are SIMULATED historian values (demo).
 */
export function historicalFor(entry) {
  const componentId = entry?.componentId;
  if (componentId === 'vPortValve') {
    const ct = S.vPortValve.cycleTest;
    const today = ct ? Math.max(S.vPortValve.positionError, S.vPortValve.sim.cyclic.hi - ct.ceiling) : S.vPortValve.positionError;
    const rows = [['Today', fmt.percent(today), today > THRESHOLDS.positionErrorWarning ? 'critical' : 'normal'], ['Yesterday', fmt.percent(15), 'attention'], ['7-Day Average', fmt.percent(11), 'attention']];
    return { title: 'Position Error — Historical', rows, trend: trendOf(today, 15) };
  }
  if (componentId === 'ballValve') {
    const today = ballResponseTime(), acc = S.ballValve.sim.acceptableTime;
    const rows = [['Today', fmt.seconds(today), today > acc ? 'attention' : 'normal'], ['Yesterday', fmt.seconds(2.3), 'normal'], ['7-Day Average', fmt.seconds(2.1), 'normal'], ['Normal', `< ${fmt.seconds(acc)}`, 'muted']];
    return { title: 'Closing Response Time', rows, trend: trendOf(today, 2.3) };
  }
  if (componentId === 'safetyValve') {
    const n = S.safetyValve.sim.openCount;
    return { title: 'Safety Valve Lifts', rows: [['Today', String(n), n ? 'attention' : 'normal'], ['Yesterday', '0', 'normal'], ['7-Day Average', '0', 'normal']], trend: trendOf(n, 0) };
  }
  if (componentId === 'steamTrap') {
    const t = S.steamTrap.sim.outletTemp;
    return { title: 'Trap Outlet Temperature', rows: [['Today', fmt.temperature(t), 'normal'], ['Yesterday', fmt.temperature(98), 'normal'], ['7-Day Average', fmt.temperature(97), 'normal']], trend: Math.abs(t - 98) > 10 ? 'Worsening' : 'Stable' };
  }
  if (componentId === 'esdValve' && S.esdValve.cycleTest) {
    const k = esdCycleSummary();
    const rows = [['Today', fmt.seconds(k.currentDelay), k.currentDelay > k.acceptable ? 'attention' : 'normal'], ['Yesterday', fmt.seconds(0.8), 'normal'], ['7-Day Average', fmt.seconds(0.5), 'normal'], ['Acceptable', `< ${fmt.seconds(k.acceptable)}`, 'muted']];
    return { title: 'ESD Response Delay', rows, trend: trendOf(k.currentDelay, 0.8) };
  }
  if (componentId === 'esdValve') {
    const sim = S.esdValve.sim; const t = sim.tripping ? sim.tripElapsed : sim.lastTripDuration || 0;
    return { title: 'Shutdown Time', rows: [['Today', t ? fmt.seconds(t) : '—', t > sim.acceptableTime ? 'attention' : 'normal'], ['Yesterday', fmt.seconds(2.4), 'normal'], ['7-Day Average', fmt.seconds(2.2), 'normal'], ['Acceptable', `< ${fmt.seconds(sim.acceptableTime)}`, 'muted']], trend: trendOf(t, 2.4) };
  }
  const flow = S.steam.flow, healthy = targetFlow();
  return { title: 'Steam Flow', rows: [['Today', fmt.flow(flow), 'normal'], ['Yesterday', fmt.flow(Math.round(healthy * 1.01)), 'normal'], ['7-Day Average', fmt.flow(healthy), 'normal']], trend: 'Stable' };
}
function trendOf(today, yesterday) { return today > yesterday * 1.15 ? 'Worsening' : today < yesterday * 0.85 ? 'Improving' : 'Stable'; }

/* ------------------------------ recent activity ------------------------------ */

const DAY = 86400000;

/**
 * Recent activity for a component: live detections (real timestamps from the
 * engine) merged with a SIMULATED prior history (relative to today's date).
 * Returns { days: 7 levels (oldest → today), occurrences, trend, items }.
 */
export function activityFor(componentId, entry, eventLog = []) {
  const now = Date.now();
  const items = [];
  const label = ANOMALY_CATALOG[componentId]?.label || componentId;
  if (entry) {
    items.push({ t: now, level: entry.level, text: liveActivityText(entry), tag: entry.level === 'critical' ? 'Critical' : 'Warning' });
    if (entry.componentId === 'vPortValve') {
      const dev = flowDeviationPercent(S.steam.flow, targetFlow());
      if (Math.abs(dev) > THRESHOLDS.flowDeviationWarning) items.push({ t: Math.min(now - 1, (entry.detectedAt || now) + 1500), level: 'info', text: `Steam flow ${dev < 0 ? 'dropped' : 'rose'} ${Math.abs(Math.round(dev))}%` });
    }
    if (entry.componentId === 'ballValve' && S.demo?.commandedAt) items.push({ t: S.demo.commandedAt, level: 'info', text: 'Valve close command issued (stroke test)' });
    if (entry.detectedAt) items.push({ t: entry.detectedAt, level: entry.level, text: 'Anomaly first detected' });
  }
  if (componentId === 'esdValve' && S.esdValve.cycleTest) {
    const ct = S.esdValve.cycleTest, simNow = S.time, acc = S.esdValve.sim.acceptableDelay;
    const wall = (st) => now - (simNow - st) * 1000;
    const picks = [];                                           // first cycle + the first cycle of each stage + the latest
    let lastStage = null;
    for (const cy of ct.cycles) { const st = esdCycleStage(cy.delay, S.esdValve.sim); if (st !== lastStage || cy.index === ct.cycles.length) { picks.push(cy); lastStage = st; } }
    for (const cy of picks) items.push({ t: wall(cy.cmdAt), level: cy.delay > acc ? 'attention' : 'normal', text: cy.delay > acc ? `ESD response delay ${cy.delay.toFixed(1)} sec (cycle ${cy.index})` : `ESD cycle normal (${cy.delay.toFixed(1)} sec)`, tag: cy.delay > acc ? 'Warning' : undefined });
  }
  for (const e of eventLog) if (e.componentId === componentId && !items.some((i) => Math.abs(i.t - e.t) < 500)) items.push({ t: e.t, level: e.level || 'info', text: e.event });
  for (const h of simulatedHistory(componentId)) items.push({ t: now - h.daysAgo * DAY, level: h.level, text: h.text, tag: h.level === 'attention' ? 'Warning' : h.level === 'critical' ? 'Critical' : undefined, past: true });
  items.sort((a, b) => b.t - a.t);

  // 7 day squares (oldest → today): worst level per day
  const days = Array.from({ length: 7 }, () => 'normal');
  const rank = { normal: 0, info: 0, attention: 1, critical: 2 };
  for (const i of items) {
    const ago = Math.floor((now - i.t) / DAY);
    if (ago >= 0 && ago < 7 && rank[i.level] > rank[days[6 - ago]]) days[6 - ago] = i.level;
  }
  const occurrences = items.filter((i) => (i.level === 'attention' || i.level === 'critical') && now - i.t < 7 * DAY && !/first detected/.test(i.text)).length;
  const trend = days[6] === 'critical' && days.slice(0, 6).some((d) => d === 'attention') ? 'worsening' : occurrences > 1 ? 'recurring' : occurrences ? 'new' : 'quiet';
  return { days, occurrences, trend, items, label };
}

function liveActivityText(entry) {
  switch (entry.type) {
    case 'VPORT_POSITION_MISMATCH': case 'VPORT_STICKING': return `Position mismatch ${fmt.percent(S.vPortValve.positionError)}`;
    case 'VPORT_SLOW_RESPONSE': return 'V-Port slow response';
    case 'VPORT_HUNTING': return 'Position hunting detected';
    case 'VPORT_TRIM_WEAR': return `Flow ${fmt.signedPercent(flowDeviationPercent(S.steam.flow, S.vPortValve.expectedFlow))} vs expected (trim wear)`;
    case 'BALL_SLOW_OPERATION': return `Slow closing detected · ${fmt.seconds(ballResponseTime())}`;
    default: return entry.title;
  }
}

/** SIMULATED prior history per component (demo historian). */
function simulatedHistory(componentId) {
  switch (componentId) {
    case 'vPortValve': return [
      { daysAgo: 2, level: 'attention', text: 'Position mismatch 18%' },
      { daysAgo: 4, level: 'attention', text: 'Position mismatch 11%' },
      { daysAgo: 39, level: 'info', text: 'Maintenance — packing replaced' },
    ];
    case 'ballValve': return [
      { daysAgo: 3, level: 'attention', text: 'Slow response · 6.2 s' },
      { daysAgo: 10, level: 'info', text: 'Maintenance — actuator inspection' },
    ];
    case 'esdValve': return [{ daysAgo: 2, level: 'info', text: 'Functional test completed' }, { daysAgo: 4, level: 'info', text: 'System operating normally' }, { daysAgo: 39, level: 'info', text: 'Maintenance — actuator checked' }];
    case 'safetyValve': return [{ daysAgo: 21, level: 'info', text: 'Bench test — set pressure verified' }];
    case 'steamTrap': return [{ daysAgo: 8, level: 'info', text: 'Trap survey — passing' }];
    case 'checkValve': return [{ daysAgo: 45, level: 'info', text: 'Maintenance — disc and spring inspected' }];
    case 'yankee': return [{ daysAgo: 5, level: 'info', text: 'Doctor blade changed' }];
    case 'rotaryJoint': return [{ daysAgo: 12, level: 'info', text: 'Seal wear check — within limits' }];
    default: return [];
  }
}
