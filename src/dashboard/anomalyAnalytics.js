import { simulationState as S } from '../simulation/simulationState.js';
import { fmt, THRESHOLDS, flowDeviationPercent } from '../simulation/units.js';
import { ballStateText, ballResponseTime, ballStrokeInfo, esdStateText } from '../simulation/anomalyEngine.js';
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
  return 'flow';
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

/** Compact impact banner text. */
export function impactText(entry) {
  if (!entry) return '';
  if (entry.componentId === 'vPortValve' && entry.type !== 'VPORT_TRIM_WEAR') return 'Steam flow is significantly below expected flow and may affect Yankee drying performance.';
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
    const today = S.vPortValve.positionError;
    const rows = [['Today', fmt.percent(today), today > THRESHOLDS.positionErrorWarning ? 'critical' : 'normal'], ['Yesterday', fmt.percent(18), 'attention'], ['7-Day Average', fmt.percent(11), 'attention']];
    return { title: 'Position Error — Historical', rows, trend: trendOf(today, 18) };
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
    case 'esdValve': return [{ daysAgo: 6, level: 'info', text: 'Partial-stroke test passed' }, { daysAgo: 30, level: 'info', text: 'Maintenance — solenoid replaced' }];
    case 'safetyValve': return [{ daysAgo: 21, level: 'info', text: 'Bench test — set pressure verified' }];
    case 'steamTrap': return [{ daysAgo: 8, level: 'info', text: 'Trap survey — passing' }];
    case 'checkValve': return [{ daysAgo: 45, level: 'info', text: 'Maintenance — disc and spring inspected' }];
    case 'yankee': return [{ daysAgo: 5, level: 'info', text: 'Doctor blade changed' }];
    case 'rotaryJoint': return [{ daysAgo: 12, level: 'info', text: 'Seal wear check — within limits' }];
    default: return [];
  }
}
