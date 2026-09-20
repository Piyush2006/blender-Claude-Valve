import { simulationState as S } from '../simulation/simulationState.js';
import { anomalyEntry } from '../dashboard/dashboardData.js';
import { fmt, THRESHOLDS, flowDeviationPercent } from '../simulation/units.js';
import { ANOMALY_LABELS, esdStateText, ballStateText, ballResponseTime, ballStrokeInfo } from '../simulation/anomalyEngine.js';
import { anomalyByType } from '../simulation/anomalyCatalog.js';
import { positionHistory } from '../dashboard/liveHistory.js';

/**
 * Maintenance ticket store (lightweight demo workflow, local application state,
 * persisted in localStorage — no CMMS / e-mail connection).
 *
 *  - captures ticket measurements from the SAME simulationState the Twin uses
 *  - ticket workflow: OPEN → ASSIGNED → IN PROGRESS → RESOLVED → CLOSED
 *  - activity timeline, simulated e-mail notifications
 */
export const history = positionHistory;

export const USERS = [
  { id: 'maint-eng', name: 'Maintenance Engineer', email: 'maintenance.engineer@example.com' },
  { id: 'inst-eng', name: 'Instrumentation Engineer', email: 'instrumentation.engineer@example.com' },
  { id: 'elec-eng', name: 'Electrical Engineer', email: 'electrical.engineer@example.com' },
  { id: 'shift-eng', name: 'Shift Engineer', email: 'shift.engineer@example.com' },
  { id: 'maint-mgr', name: 'Maintenance Manager', email: 'maintenance.manager@example.com' },
];
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
export const SEVERITIES = ['Critical', 'Warning', 'Info'];
export const STATUS_FLOW = ['OPEN', 'ASSIGNED', 'IN PROGRESS', 'RESOLVED', 'CLOSED'];

const STORAGE_KEY = 'twin.maintenance.v1';
const listeners = new Set();
const store = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { const parsed = JSON.parse(raw); if (parsed && Array.isArray(parsed.tickets)) return { tickets: parsed.tickets, nextId: parsed.nextId || 1024, emails: parsed.emails || [] }; }
  } catch { /* ignore */ }
  return { tickets: [], nextId: 1024, emails: [] };
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ tickets: store.tickets, nextId: store.nextId, emails: store.emails })); } catch { /* ignore */ }
}
function emit() { for (const fn of listeners) fn(); }
export function onTicketsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/* ------------------------------ active anomalies ------------------------------ */

/** Detection record for a component (or the primary anomaly when omitted). */
export function activeAnomaly(componentId = null) {
  const list = (S.anomalies || []).filter((x) => x.active && x.type);
  const rec = componentId ? list.find((x) => x.component === componentId) : list[0];
  return rec ? { key: `${rec.component}:${rec.type}`, componentId: rec.component, type: rec.type, detectedAt: rec.detectedAt, status: rec.status } : null;
}

/* ------------------------------ anomaly capture ------------------------------ */

/** Captures a component's active anomaly with exact measurements from the Twin state. */
export function captureAnomaly(componentId = null) {
  const rec = activeAnomaly(componentId);
  if (!rec) return null;
  const an = anomalyEntry((S.anomalies || []).find((x) => x.component === rec.componentId));
  const v = S.vPortValve;
  const measurements = {
    commandPosition: v.commandPosition, actualPosition: v.actualPosition, positionError: v.positionError,
    steamFlow: S.steam.flow, expectedFlow: v.expectedFlow, targetFlow: targetFlow(), flowDeviation: flowDeviationPercent(S.steam.flow, targetFlow()),
    steamPressure: S.steam.pressure, steamTemperature: S.steam.temperature, trimHealth: Math.round(v.sim.trimWear.health),
    esdState: esdStateText(), ballState: ballStateText(), ballResponse: ballResponseTime(), ballAcceptable: S.ballValve.sim.acceptableTime,
    psvSet: S.safetyValve.setPressure, psvLine: S.safetyValve.sim.linePressure, psvOpen: S.safetyValve.lift > 0.5, reliefFlow: S.safetyValve.reliefFlow,
    trapInlet: S.steamTrap.sim.inletTemp, trapOutlet: S.steamTrap.sim.outletTemp,
    condensateFlow: S.condensate.flow, condensateDirection: S.condensate.direction,
  };
  return {
    componentId: an.componentId, component: an.component, title: an.title, type: rec.type,
    level: an.level, severity: an.level === 'critical' ? 'Critical' : 'Warning',
    lines: an.lines, impact: an.impact, detail: an.detail, subtitle: an.subtitle,
    detectedAt: rec.detectedAt || Date.now(), capturedAt: Date.now(),
    measurements,
    description: describe(rec.type, measurements),
    scenario: { component: S.anomalySim.component, anomaly: S.anomalySim.anomaly },
  };
}

/** Flow the control system expects at the COMMANDED position (healthy trim), kg/h. */
export function targetFlow() {
  const gate = S.ballValve.position > 2 && S.esdValve.position > 2 ? 1 : 0;
  return Math.round(S.steam.maxFlow * (S.vPortValve.commandPosition / 100) * gate);
}

function describe(type, m) {
  const f = fmt;
  switch (type) {
    case 'VPORT_POSITION_MISMATCH': case 'VPORT_STICKING': case 'VPORT_SLOW_RESPONSE': case 'VPORT_HUNTING':
      return `Actual position is ${f.position(m.actualPosition)} while commanded position is ${f.position(m.commandPosition)}. Position error is ${f.percent(m.positionError)}. Steam flow is ${f.flow(m.steamFlow)} compared with expected flow of ${f.flow(m.targetFlow)} at the commanded position.`;
    case 'VPORT_TRIM_WEAR':
      return `Commanded and actual positions agree at ${f.position(m.actualPosition)}, but steam flow is ${f.flow(m.steamFlow)} versus an expected ${f.flow(m.expectedFlow)} (deviation ${f.signedPercent(flowDeviationPercent(m.steamFlow, m.expectedFlow))}). Trim health estimate ${m.trimHealth}%.`;
    case 'BALL_SLOW_OPERATION': {
      const k = ballStrokeInfo(); const target = k.command === 'CLOSE' ? 'CLOSED' : 'OPEN';
      return k.inProgress
        ? `Ball Valve received a ${k.command} command and is taking ${k.responseTime.toFixed(1)} seconds so far to reach the ${target} state against an expected response of less than ${m.ballAcceptable.toFixed(0)} seconds. Current state: ${m.ballState}.`
        : `Ball Valve received a ${k.command} command but took ${k.responseTime.toFixed(1)} seconds to reach the ${target} state against an expected response of less than ${m.ballAcceptable.toFixed(0)} seconds. Current state: ${m.ballState}.`;
    }
    case 'ESD_FAIL_TO_CLOSE': case 'ESD_PARTIAL_CLOSURE': case 'ESD_SLOW_SHUTDOWN':
      return `Trip command CLOSE was issued; the ESD valve actual state is ${m.esdState}. Steam flow of ${f.flow(m.steamFlow)} continues downstream.`;
    case 'ESD_LOW_AIR':
      return `Instrument air pressure is ${f.pressure(S.esdValve.sim.airPressure)} against a minimum of ${f.pressure(S.esdValve.sim.minAirPressure)}; the actuator cannot complete its stroke (state ${m.esdState}).`;
    case 'BALL_FAIL_TO_OPEN': case 'BALL_FAIL_TO_CLOSE':
      return `Ball valve command is ${S.ballValve.command === 100 ? 'OPEN' : 'CLOSE'} but the actual state is ${m.ballState}. Steam flow is ${f.flow(m.steamFlow)}.`;
    case 'BALL_PASSING':
      return `Ball valve is commanded CLOSE and reads CLOSED, but a leakage flow of ${f.flow(m.steamFlow)} passes the seats (expected 0).`;
    case 'PSV_UNEXPECTED_OPENING':
      return `Safety valve is OPEN at ${f.pressure(m.psvLine, 2)}, below its set pressure of ${f.pressure(m.psvSet)}. Relief flow ${f.flow(m.reliefFlow)}.`;
    case 'PSV_FAILURE_TO_OPEN':
      return `Line pressure ${f.pressure(m.psvLine, 2)} exceeds the set pressure of ${f.pressure(m.psvSet)} but the safety valve remains CLOSED (no relief).`;
    case 'PSV_CHATTERING':
      return `Safety valve is cycling open/closed around its set pressure of ${f.pressure(m.psvSet)} (${S.safetyValve.sim.openCount} openings).`;
    case 'TRAP_FAILED_OPEN': case 'TRAP_BLOCKED': case 'TRAP_POOR_REMOVAL':
      return `Steam trap inlet ${f.temperature(m.trapInlet)}, outlet ${f.temperature(m.trapOutlet)} (ΔT ${f.temperature(m.trapInlet - m.trapOutlet)}). Discharge ${f.flow(Math.max(0, m.condensateFlow))}.`;
    case 'CHECK_REVERSE_FLOW': case 'CHECK_FAILURE_TO_CLOSE': case 'CHECK_FAILURE_TO_OPEN':
      return `Check valve flow direction is ${m.condensateDirection < 0 ? 'REVERSE' : m.condensateFlow > 0 ? 'forward' : 'none'} with ${f.flow(Math.abs(m.condensateFlow))}; ΔP ${f.pressure(S.checkValve.sim.upstreamPressure - S.checkValve.sim.downstreamPressure)}.`;
    default:
      return S.anomaly.detail;
  }
}

/* ------------------------------ verification ------------------------------ */

/** Is the ticket's component currently normal in the Twin? (used before CLOSE) */
export function verifyComponent(ticket) {
  const st = S[ticket.componentId]?.status || 'NORMAL';
  const same = !!activeAnomaly(ticket.componentId);
  return { normal: st === 'NORMAL' && !same, status: st };
}

/** Current live values for a component (verify view, ticket drawer). */
export function liveValuesFor(componentId) {
  const v = S.vPortValve;
  switch (componentId) {
    case 'vPortValve': return [['Commanded', fmt.position(v.commandPosition)], ['Actual', fmt.position(v.actualPosition)], ['Error', fmt.percent(v.positionError)], ['Steam Flow', fmt.flow(S.steam.flow)], ['Expected Flow (at command)', fmt.flow(targetFlow())]];
    case 'esdValve': return [['Trip Command', S.esdValve.command === 0 ? 'CLOSE' : 'NONE'], ['Actual State', esdStateText()], ['Steam Flow', fmt.flow(S.steam.flow)]];
    case 'ballValve': { const k = ballStrokeInfo(); return [['Command', k.command], ['Actual', k.actual], ['Response Time', fmt.seconds(k.responseTime)], ['Expected', `< ${fmt.seconds(S.ballValve.sim.acceptableTime)}`], ['Valve State', ballStateText()]]; }
    case 'safetyValve': return [['Set Pressure', fmt.pressure(S.safetyValve.setPressure)], ['Current Pressure', fmt.pressure(S.safetyValve.sim.linePressure, 2)], ['Valve State', S.safetyValve.lift > 0.5 ? 'OPEN' : 'CLOSED'], ['Relief Flow', fmt.flow(S.safetyValve.reliefFlow)]];
    case 'steamTrap': return [['Inlet', fmt.temperature(S.steamTrap.sim.inletTemp)], ['Outlet', fmt.temperature(S.steamTrap.sim.outletTemp)], ['ΔT', fmt.temperature(S.steamTrap.sim.inletTemp - S.steamTrap.sim.outletTemp)], ['Discharge', fmt.flow(Math.max(0, S.condensate.flow))]];
    case 'checkValve': return [['Direction', S.condensate.direction < 0 ? '← REVERSE' : S.condensate.flow > 0 ? 'CONDENSATE →' : 'NO FLOW'], ['Flow', fmt.flow(Math.abs(S.condensate.flow))]];
    default: return [];
  }
}

/* ------------------------------ tickets ------------------------------ */

export function tickets() { return store.tickets; }
export function getTicket(id) { return store.tickets.find((t) => t.id === id) || null; }
export function openTicketCount() { return store.tickets.filter((t) => t.status !== 'CLOSED').length; }
export function ticketsFor(componentId, type) { return store.tickets.filter((t) => t.componentId === componentId && (!type || t.type === type) && t.status !== 'CLOSED'); }

function addActivity(t, text, when = Date.now()) { t.activity.push({ t: when, text }); }

export function createTicket({ capture, severity, priority, assigneeId, dueDate, description, notify }) {
  const id = `MT-${store.nextId++}`;
  const user = USERS.find((u) => u.id === assigneeId) || null;
  const now = Date.now();
  const t = {
    id, componentId: capture.componentId, component: capture.component, issue: capture.title, type: capture.type,
    severity, priority, assigneeId: user?.id || null, assignee: user?.name || null, dueDate: dueDate || null,
    description, status: 'OPEN', createdAt: now, updatedAt: now,
    anomaly: capture,                       // frozen link to the Twin: component, anomaly, detection time, values
    resolution: null, activity: [],
  };
  addActivity(t, `${ANOMALY_LABELS[capture.type] || capture.title} detected`, capture.detectedAt);
  addActivity(t, `Ticket ${id} created (${priority} · ${severity})`, now);
  if (user) addActivity(t, `Assignee set to ${user.name}`, now + 1);
  store.tickets.unshift(t);
  let email = null;
  if (notify && user) email = queueEmail(t, user);
  save(); emit();
  return { ticket: t, email };
}

export function assignTicket(id, assigneeId) {
  const t = getTicket(id); const user = USERS.find((u) => u.id === assigneeId);
  if (!t || !user) return;
  t.assigneeId = user.id; t.assignee = user.name;
  if (t.status === 'OPEN') t.status = 'ASSIGNED';
  t.updatedAt = Date.now();
  addActivity(t, `Assigned to ${user.name}`);
  save(); emit();
}

export function startWork(id) { transition(id, 'ASSIGNED', 'IN PROGRESS', 'Work started'); }
export function resolveTicket(id, { notes, rootCause, correctiveAction }) {
  const t = getTicket(id); if (!t || t.status !== 'IN PROGRESS') return;
  t.resolution = { notes, rootCause, correctiveAction, at: Date.now() };
  t.status = 'RESOLVED'; t.updatedAt = Date.now();
  addActivity(t, `Marked resolved — ${rootCause || 'root cause not stated'}`);
  save(); emit();
}
export function closeTicket(id) {
  const t = getTicket(id); if (!t || t.status !== 'RESOLVED') return;
  const check = verifyComponent(t);
  t.status = 'CLOSED'; t.updatedAt = Date.now();
  t.verification = { at: Date.now(), normal: check.normal, values: liveValuesFor(t.componentId) };
  addActivity(t, `Verified ${check.normal ? 'NORMAL' : check.status} in the Twin`);
  addActivity(t, 'Ticket closed', Date.now() + 1);
  save(); emit();
}
export function logActivity(id, text) { const t = getTicket(id); if (!t) return; addActivity(t, text); save(); emit(); }
function transition(id, from, to, text) {
  const t = getTicket(id); if (!t || t.status !== from) return;
  t.status = to; t.updatedAt = Date.now(); addActivity(t, text); save(); emit();
}

/* ------------------------------ simulated e-mail ------------------------------ */

export function emails() { return store.emails; }
export function emailFor(ticketId) { return store.emails.find((e) => e.ticketId === ticketId) || null; }

function queueEmail(t, user) {
  const m = t.anomaly.measurements;
  const lines = t.anomaly.lines.map(([k, v]) => `${k}: ${v}`).join('\n');
  const email = {
    ticketId: t.id, to: user.email, at: Date.now(),
    subject: `[${t.id}] ${t.component} - ${t.issue}`,
    body: `Maintenance ticket ${t.id} has been assigned to you.\n\nComponent: ${t.component}\nIssue: ${t.issue}\nSeverity: ${t.severity}\nPriority: ${t.priority}\nDue: ${t.dueDate || 'not set'}\n\n${lines}\n\nSteam Flow: ${fmt.flow(m.steamFlow)}\nExpected: ${fmt.flow(m.targetFlow)}\n\n${t.description}`,
  };
  store.emails.unshift(email);
  addActivity(t, `Email notification sent to ${user.email}`, Date.now() + 2);
  return email;
}

/* ------------------------------ analytics (simulated historian) ------------------------------ */

/**
 * Historical comparison for a component. "Today" is the live Twin value;
 * yesterday and the 7-day average are a SIMULATED historian baseline built
 * around the healthy expected behaviour. Same units as the Twin.
 */
export function historicalComparison(componentId) {
  const v = S.vPortValve;
  const healthyFlow = targetFlow();
  const jitter = (base, pct, seed) => Math.round(base * (1 + pct * Math.sin(seed)));
  const rows = [];
  if (componentId === 'vPortValve') {
    const sign = Math.sign(v.commandPosition - v.actualPosition) || 1;
    rows.push({ label: 'Commanded Position', today: fmt.position(v.commandPosition), yesterday: fmt.position(v.commandPosition), avg7: fmt.position(v.commandPosition) });
    rows.push({ label: 'Actual Position', today: fmt.position(v.actualPosition), yesterday: fmt.position(v.commandPosition - 18 * sign), avg7: fmt.position(v.commandPosition - 11 * sign) });
    rows.push({ label: 'Position Error', today: fmt.percent(v.positionError), yesterday: fmt.percent(18), avg7: fmt.percent(11) });
  }
  if (componentId === 'ballValve') rows.push({ label: 'Closing Response Time', today: fmt.seconds(ballResponseTime()), yesterday: fmt.seconds(2.3), avg7: fmt.seconds(2.1) });
  rows.push({ label: 'Steam Flow', today: fmt.flow(S.steam.flow), yesterday: fmt.flow(jitter(healthyFlow, 0.012, 1.3)), avg7: fmt.flow(jitter(healthyFlow, 0.008, 2.1)) });
  rows.push({ label: 'Expected Flow (at command)', today: fmt.flow(healthyFlow), yesterday: fmt.flow(healthyFlow), avg7: fmt.flow(healthyFlow) });
  rows.push({ label: 'Steam Pressure', today: fmt.pressure(S.steam.pressure), yesterday: fmt.pressure(7.4 + 0.1 * Math.sin(3.1)), avg7: fmt.pressure(7.4) });
  if (componentId === 'safetyValve') rows.push({ label: 'Safety Valve Openings', today: String(S.safetyValve.sim.openCount), yesterday: '0', avg7: '0' });
  if (componentId === 'steamTrap') rows.push({ label: 'Trap Outlet Temperature', today: fmt.temperature(S.steamTrap.sim.outletTemp), yesterday: fmt.temperature(98), avg7: fmt.temperature(97) });
  if (componentId === 'checkValve') rows.push({ label: 'Condensate Flow', today: fmt.flow(Math.abs(S.condensate.flow)), yesterday: fmt.flow(Math.round(healthyFlow * 0.92)), avg7: fmt.flow(Math.round(healthyFlow * 0.92)) });
  return rows;
}

/** Trend series for the analytics chart: live (last 60 / 10 min) or a simulated 24 h / 7 d historian with the anomaly onset. */
export function trendSeries(range, detectedAt) {
  if (range === 'live' || range === '60m') return positionHistory.slice();
  if (range === '10m') { const from = Date.now() - 10 * 60 * 1000; return positionHistory.filter((p) => p.t >= from); }
  const now = Date.now();
  const n = range === '7d' ? 168 : 144, stepMs = range === '7d' ? 3600 * 1000 : 10 * 60 * 1000;
  const v = S.vPortValve; const healthyFlow = targetFlow();
  const out = [];
  for (let i = n; i >= 0; i--) {
    const t = now - i * stepMs;
    const drift = Math.sin(i / 9) * 0.02 + Math.sin(i / 3.7) * 0.01;
    const afterOnset = detectedAt && t >= detectedAt - stepMs;
    out.push(afterOnset
      ? { t, cmd: v.commandPosition, act: v.actualPosition, flow: S.steam.flow, expected: v.expectedFlow }
      : { t, cmd: v.commandPosition, act: v.commandPosition + drift * 40, flow: healthyFlow * (1 + drift), expected: healthyFlow });
  }
  return out;
}

export { THRESHOLDS, anomalyByType };
