import { simulationState as S, subscribe, setComponentAnomaly, setVPortActual } from '../simulation/simulationState.js';
import { fmt, THRESHOLDS, levelOfStatus, flowDeviationPercent } from '../simulation/units.js';
import { ANOMALY_LABELS } from '../simulation/anomalyEngine.js';
import { knowledgeFor } from './knowledge.js';
import { createPositionChart, createBallResponseChart, createFlowChart, CHART_COLORS } from '../dashboard/anomalyCharts.js';
import { chartKind } from '../dashboard/anomalyAnalytics.js';
import { ballSamplesWallClock } from '../dashboard/liveHistory.js';
import * as store from './ticketStore.js';

/**
 * Maintenance UI: anomaly details drawer, ticket drawer, create / resolve / assign
 * modals and the simulated e-mail preview. All measurements come from the shared
 * simulationState (via ticketStore.captureAnomaly / liveValuesFor) in Twin units.
 */
export function createMaintenanceUI({ onOpenComponent }) {
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const dateTimeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const when = (t) => t ? dateTimeFmt.format(new Date(t)) : '—';
  const clock = (t) => t ? timeFmt.format(new Date(t)) : '—';

  /* ------------------------------ drawer shell ------------------------------ */
  const backdrop = el('div', 'mt-drawer-backdrop'); backdrop.hidden = true;
  const drawer = el('aside', 'mt-drawer'); drawer.hidden = true; drawer.setAttribute('role', 'dialog'); drawer.id = 'mt-drawer';
  drawer.innerHTML = `<div class="mt-drawer-head"><div class="head-main"></div><button class="btn-icon close" type="button" title="Close" data-act="close">×</button></div><div class="mt-drawer-tabs"></div><div class="mt-drawer-body"></div><div class="mt-drawer-foot"></div>`;
  document.body.append(backdrop, drawer);
  const headEl = drawer.querySelector('.head-main'), tabsEl = drawer.querySelector('.mt-drawer-tabs'), bodyEl = drawer.querySelector('.mt-drawer-body'), footEl = drawer.querySelector('.mt-drawer-foot');

  const view = { mode: null, ticketId: null, tab: 'details', range: '60m', chart: null, chartKind: null, lastKey: '' };
  let dirty = false, lastRender = 0;

  function open(mode, opts = {}) {
    view.mode = mode; view.ticketId = opts.ticketId || null; view.tab = opts.tab || (mode === 'anomaly' ? 'overview' : 'details');
    view.lastKey = '';
    drawer.hidden = false; backdrop.hidden = false;
    requestAnimationFrame(() => { drawer.classList.add('is-open'); backdrop.classList.add('is-open'); });
    render(true);
  }
  function close() {
    drawer.classList.remove('is-open'); backdrop.classList.remove('is-open');
    setTimeout(() => { if (!drawer.classList.contains('is-open')) { drawer.hidden = true; backdrop.hidden = true; } }, 220);
    view.mode = null;
  }
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) { if (modalOpen()) closeModal(); else close(); } });

  drawer.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    act(btn.dataset.act, btn);
  });
  tabsEl.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) { view.tab = b.dataset.tab; render(true); } });
  bodyEl.addEventListener('change', (e) => { if (e.target.matches('[data-range]')) { view.range = e.target.value; render(true); } });

  subscribe(() => { if (view.mode) { const now = Date.now(); if (now - lastRender > 500) render(); else dirty = true; } });
  setInterval(() => { if (dirty && view.mode) render(); }, 500);
  store.onTicketsChange(() => { if (view.mode) render(true); });

  /* ------------------------------ rendering ------------------------------ */
  function render(force = false) {
    lastRender = Date.now(); dirty = false;
    if (view.mode === 'ticket') renderTicket(force);
  }

  function setTabs(list, active) {
    const html = list.map(([id, label]) => `<button type="button" data-tab="${id}" class="${id === active ? 'is-active' : ''}">${label}</button>`).join('');
    if (tabsEl.innerHTML !== html) tabsEl.innerHTML = html;
  }
  function setHtml(host, html) { if (host.innerHTML !== html) host.innerHTML = html; }

  // ---- analytics (shared by anomaly and ticket views)
  function analyticsHtml(componentId, detectedAt) {
    const rows = store.historicalComparison(componentId);
    return `<div class="mt-section"><h4>Current Values</h4><div class="mt-kv" data-live-values>${liveKv(componentId)}</div></div>
      <div class="mt-section"><div class="mt-range"><h4 style="margin:0">${chartKind(componentId) === 'position' ? 'Command vs Actual Position' : chartKind(componentId) === 'ballResponse' ? 'Ball Valve Open/Close Response' : 'Steam Flow vs Expected'}</h4>
        ${chartKind(componentId) === 'ballResponse' ? '<span class="mt-note">last stroke · 200 ms samples</span>' : `<select data-range><option value="60m" ${view.range === '60m' ? 'selected' : ''}>Last 60 Minutes (live)</option><option value="24h" ${view.range === '24h' ? 'selected' : ''}>Last 24 Hours</option><option value="7d" ${view.range === '7d' ? 'selected' : ''}>Last 7 Days</option></select>`}</div>
        <div class="mt-legend">${chartKind(componentId) === 'position' ? `<span><i style="background:${CHART_COLORS.cmd}"></i>Commanded (%)</span><span><i style="background:${CHART_COLORS.act}"></i>Actual (%)</span>` : chartKind(componentId) === 'ballResponse' ? `<span><i style="background:${CHART_COLORS.cmd}"></i>Command</span><span><i style="background:${CHART_COLORS.act}"></i>Actual state</span>` : `<span><i style="background:${CHART_COLORS.flow}"></i>Steam flow (kg/h)</span><span><i style="background:${CHART_COLORS.expected}"></i>Expected</span>`}</div>
        <div data-chart></div>
        <p class="mt-note">${chartKind(componentId) === 'ballResponse' || view.range === '60m' ? 'Live samples from the Twin.' : 'Simulated historian: healthy baseline before the anomaly onset, live values after.'}</p></div>
      <div class="mt-section"><h4>Historical Comparison</h4><table class="mt-comp-table"><thead><tr><th>Parameter</th><th>Today</th><th>Yesterday</th><th>7-Day Avg</th></tr></thead><tbody data-comp>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="today mono">${esc(r.today)}</td><td class="mono">${esc(r.yesterday)}</td><td class="mono">${esc(r.avg7)}</td></tr>`).join('')}</tbody></table><p class="mt-note">Yesterday and 7-day values are a simulated baseline (same units as the Twin).</p></div>`;
  }
  function liveKv(componentId) {
    const v = S.vPortValve;
    if (componentId === 'vPortValve') {
      const target = store.targetFlow();
      const dev = flowDeviationPercent(S.steam.flow, target);
      const errBad = v.positionError > THRESHOLDS.positionErrorWarning, devBad = Math.abs(dev) > THRESHOLDS.flowDeviationWarning;
      return kv([['Commanded Position', fmt.position(v.commandPosition)], ['Actual Position', fmt.position(v.actualPosition), errBad ? 'bad' : ''], ['Position Error', fmt.percent(v.positionError), errBad ? 'bad' : 'good'], ['Steam Flow', fmt.flow(S.steam.flow)], ['Expected Flow (at command)', fmt.flow(target)], ['Flow Deviation', fmt.signedPercent(dev), devBad ? 'bad' : 'good']]);
    }
    return kv(store.liveValuesFor(componentId).concat([['Steam Pressure', fmt.pressure(S.steam.pressure)]]));
  }
  function kv(rows) { return rows.map(([k, v, cls]) => `<div><span>${esc(k)}</span><b class="${cls || ''}">${esc(String(v))}</b></div>`).join(''); }
  function mountChart(componentId, detectedAt) {
    const host = bodyEl.querySelector('[data-chart]'); if (!host) return;
    const kind = chartKind(componentId);
    view.chart = kind === 'position' ? createPositionChart(host) : kind === 'ballResponse' ? createBallResponseChart(host) : createFlowChart(host);
    view.chartKind = kind;
    updateAnalytics(componentId, detectedAt);
  }
  function updateAnalytics(componentId, detectedAt) {
    const kvHost = bodyEl.querySelector('[data-live-values]'); if (kvHost) setHtml(kvHost, liveKv(componentId));
    const comp = bodyEl.querySelector('[data-comp]'); if (comp) setHtml(comp, store.historicalComparison(componentId).map((r) => `<tr><td>${esc(r.label)}</td><td class="today mono">${esc(r.today)}</td><td class="mono">${esc(r.yesterday)}</td><td class="mono">${esc(r.avg7)}</td></tr>`).join(''));
    if (view.chart && bodyEl.querySelector('[data-chart] svg')) {
      if (view.chartKind === 'ballResponse') view.chart.update(ballSamplesWallClock(), { windowMs: 40 * 1000, acceptable: S.ballValve.sim.acceptableTime });
      else {
        const rangeMs = view.range === '60m' ? 60 * 60 * 1000 : view.range === '24h' ? 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
        view.chart.update(store.trendSeries(view.range, detectedAt), { onsetAt: detectedAt, rangeMs });
      }
    }
  }

  // ---- ticket details
  function renderTicket(force) {
    const t = store.getTicket(view.ticketId);
    if (!t) { close(); return; }
    const live = store.verifyComponent(t);
    const liveLevel = live.normal ? 'normal' : levelOfStatus(live.status);
    setHtml(headEl, `<h2>🎫 ${t.id} — ${esc(t.component)} — ${esc(t.issue)} <span class="st" data-st="${t.status}">${t.status}</span></h2>
      <div class="sub"><span>Priority <span class="pr" data-pr="${t.priority}">${t.priority}</span></span><span>Severity: <b>${esc(t.severity)}</b></span><span>Assigned: <b>${esc(t.assignee || 'Unassigned')}</b></span><span>Due: <b class="mono">${esc(t.dueDate || '—')}</b></span></div>`);
    setTabs([['details', 'Details'], ['analytics', 'Analytics'], ['activity', 'Activity']], view.tab);
    let html = '';
    if (view.tab === 'details') {
      const idx = store.STATUS_FLOW.indexOf(t.status);
      html = `<div class="mt-flow">${store.STATUS_FLOW.map((s, i) => `<span class="st ${i < idx ? 'done' : i === idx ? 'now' : ''}" data-st="${s}">${s}</span>${i < store.STATUS_FLOW.length - 1 ? '<span class="arrow">→</span>' : ''}`).join('')}</div>
        <div class="mt-section"><h4>Anomaly Snapshot <span class="mt-note">(captured ${when(t.anomaly.capturedAt)})</span></h4>
          <div class="mt-kv">${kv([['Detected', clock(t.anomaly.detectedAt)], ['Anomaly', ANOMALY_LABELS[t.type] || t.issue]].concat(t.anomaly.lines))}</div></div>
        <div class="mt-section"><h4>Description</h4><div class="mt-desc is-${t.anomaly.level}">${esc(t.description)}</div></div>
        ${t.resolution ? `<div class="mt-section"><h4>Resolution</h4><div class="mt-kv"><div><span>Root Cause</span><b style="font-family:inherit">${esc(t.resolution.rootCause)}</b></div><div><span>Corrective Action</span><b style="font-family:inherit">${esc(t.resolution.correctiveAction)}</b></div></div><p style="margin:6px 0 0">${esc(t.resolution.notes)}</p></div>` : ''}
        <div class="mt-section"><h4>Current Component State <span class="mt-note">(live from the Twin)</span></h4>
          <p style="margin:0 0 6px"><span class="mt-state-pill is-${liveLevel}">${liveLevel === 'normal' ? '🟢 NORMAL' : liveLevel === 'attention' ? '🟡 WARNING' : '🔴 ANOMALY'}</span> ${liveLevel === 'normal' ? 'values are within normal range' : 'the flagged condition is still present'}</p>
          <div class="mt-kv" data-live-values>${kv(store.liveValuesFor(t.componentId))}</div>
          ${t.status === 'IN PROGRESS' ? `<p class="mt-note">Perform the repair in the Twin (Anomaly Simulation → Normal, or correct the actual position), then mark the ticket resolved.</p>` : ''}
          ${t.status === 'RESOLVED' && !live.normal ? `<p class="mt-note" style="color:var(--warn)">Component is not yet NORMAL in the Twin — verify before closing.</p>` : ''}
          ${t.verification ? `<p class="mt-note">Verified ${t.verification.normal ? 'NORMAL' : t.verification.status} at ${when(t.verification.at)}.</p>` : ''}</div>`;
      if (force) setHtml(bodyEl, html); else { const host = bodyEl.querySelector('[data-live-values]'); if (host) setHtml(host, kv(store.liveValuesFor(t.componentId))); const pill = bodyEl.querySelector('.mt-state-pill'); if (pill && !pill.classList.contains(`is-${liveLevel}`)) render(true); }
    } else if (view.tab === 'analytics') {
      if (force) { setHtml(bodyEl, analyticsHtml(t.componentId, t.anomaly.detectedAt)); mountChart(t.componentId, t.anomaly.detectedAt); }
      else updateAnalytics(t.componentId, t.anomaly.detectedAt);
    } else {
      html = `<div class="mt-section"><h4>Activity Log</h4>${timeline(t.activity)}</div>`;
      setHtml(bodyEl, html);
    }
    const email = store.emailFor(t.id);
    const actions = [];
    if (t.status === 'OPEN') actions.push(`<button class="btn btn-primary" type="button" data-act="assign">ASSIGN</button>`);
    if (t.status === 'ASSIGNED') actions.push(`<button class="btn btn-primary" type="button" data-act="start">START WORK</button>`, `<button class="btn" type="button" data-act="assign">REASSIGN</button>`);
    if (t.status === 'IN PROGRESS') actions.push(`<button class="btn btn-primary" type="button" data-act="resolve">MARK RESOLVED</button>`, `<button class="btn" type="button" data-act="repair" title="Demo helper: resets the anomaly scenario to Normal">SIMULATE REPAIR</button>`);
    if (t.status === 'RESOLVED') actions.push(`<button class="btn ${live.normal ? 'btn-ok' : ''}" type="button" data-act="closeTicket">CLOSE TICKET</button>`);
    actions.push(`<button class="btn" type="button" data-act="tab" data-tab="analytics">VIEW ANALYTICS</button>`, `<button class="btn" type="button" data-act="twin" data-id="${t.componentId}">VIEW IN TWIN</button>`);
    if (email) actions.push(`<button class="btn" type="button" data-act="email">EMAIL</button>`);
    setHtml(footEl, actions.join(''));
  }

  function timeline(items) {
    if (!items.length) return '<p class="mt-note">No activity yet.</p>';
    return `<ul class="mt-timeline">${items.map((a) => `<li><span class="when">${when(a.t)} · ${clock(a.t)}</span>${esc(a.text)}</li>`).join('')}</ul>`;
  }

  /* ------------------------------ actions ------------------------------ */
  function act(name, btn) {
    const t = view.ticketId ? store.getTicket(view.ticketId) : null;
    switch (name) {
      case 'close': close(); break;
      case 'twin': close(); onOpenComponent?.(btn.dataset.id); break;
      case 'ticket': open('ticket', { ticketId: btn.dataset.id }); break;
      case 'tab': view.tab = btn.dataset.tab; render(true); break;
      case 'create': openCreateTicket(); break;
      case 'assign': if (t) assignModal(t); break;
      case 'start': if (t) store.startWork(t.id); break;
      case 'resolve': if (t) resolveModal(t); break;
      case 'repair': if (t) { simulateRepair(t.componentId); store.logActivity(t.id, 'Maintenance performed in the Twin (component simulation reset to Normal)'); } break;
      case 'closeTicket': if (t) { store.closeTicket(t.id); } break;
      case 'email': if (t) { const e = store.emailFor(t.id); if (e) emailModal(e, t); } break;
      default: break;
    }
  }

  /* ------------------------------ modals ------------------------------ */
  let modalEl = null;
  function modalOpen() { return !!modalEl; }
  function closeModal() { modalEl?.remove(); modalEl = null; }
  function modal(title, bodyHtml, footHtml) {
    closeModal();
    modalEl = el('div', 'mt-modal-backdrop');
    modalEl.innerHTML = `<div class="mt-modal" role="dialog" aria-modal="true"><div class="mt-modal-head"><h3>${title}</h3><button class="btn-icon close" type="button" data-m="close" title="Close">×</button></div><div class="mt-modal-body">${bodyHtml}</div>${footHtml ? `<div class="mt-modal-foot">${footHtml}</div>` : ''}</div>`;
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl || e.target.closest('[data-m="close"]')) closeModal(); });
    document.body.appendChild(modalEl);
    return modalEl;
  }

  function openCreateTicket(componentId = null) {
    const cap = store.captureAnomaly(componentId);
    if (!cap) return;
    const existing = store.ticketsFor(cap.componentId, cap.type)[0];
    if (existing) { open('ticket', { ticketId: existing.id }); return; }
    const prio = suggestPriority(cap);
    const due = new Date(Date.now() + ({ P1: 1, P2: 3, P3: 7, P4: 14 }[prio] || 3) * 86400000).toISOString().slice(0, 10);
    const m = modal('Create Maintenance Ticket', `
      <div class="mt-form">
        <label class="full">Issue<input name="issue" value="${esc(cap.component)} — ${esc(cap.title)}" readonly></label>
        <label>Component<input value="${esc(cap.component)}" readonly></label>
        <label>Anomaly<input value="${esc(ANOMALY_LABELS[cap.type] || cap.title)}" readonly></label>
        <label>Detected<input value="${esc(when(cap.detectedAt))}" readonly></label>
        <label>Current Status<input value="${cap.level === 'critical' ? 'ANOMALY' : 'WARNING'}" readonly></label>
        <label>Severity<select name="severity">${store.SEVERITIES.map((s) => `<option ${s === cap.severity ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Priority<select name="priority">${store.PRIORITIES.map((p) => `<option ${p === prio ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label>Assign To<select name="assignee"><option value="">— Unassigned —</option>${store.USERS.map((u) => `<option value="${u.id}" ${u.id === 'maint-eng' ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
        <label>Due Date<input type="date" name="due" value="${due}"></label>
        <label class="full">Description<textarea name="description">${esc(cap.description)}</textarea></label>
        <label class="full check"><input type="checkbox" name="notify" checked> Send email notification to the assignee</label>
      </div>`,
      `<button class="btn" type="button" data-m="close">CANCEL</button><button class="btn btn-primary" type="button" data-m="submit">CREATE TICKET</button>`);
    m.querySelector('[data-m="submit"]').addEventListener('click', () => {
      const f = (n) => m.querySelector(`[name="${n}"]`);
      const { ticket, email } = store.createTicket({ capture: cap, severity: f('severity').value, priority: f('priority').value, assigneeId: f('assignee').value || null, dueDate: f('due').value, description: f('description').value.trim() || cap.description, notify: f('notify').checked });
      confirmModal(ticket, email);
    });
  }

  function confirmModal(ticket, email) {
    const m = modal('Ticket Created', `
      <div class="mt-confirm"><div class="big">✓</div><h3>Ticket ${ticket.id} created successfully</h3>
        <div>${esc(ticket.component)} — ${esc(ticket.issue)}</div>
        <div class="mt-kv" style="margin-top:10px;text-align:left"><div><span>Status</span><b style="font-family:inherit"><span class="st" data-st="${ticket.status}">${ticket.status}</span></b></div><div><span>Priority</span><b><span class="pr" data-pr="${ticket.priority}">${ticket.priority}</span></b></div><div><span>Assigned</span><b style="font-family:inherit">${esc(ticket.assignee || 'Unassigned')}</b></div><div><span>Due</span><b>${ticket.dueDate || '—'}</b></div></div>
        ${email ? `<p class="ok-line">✓ Email notification queued</p>${emailHtml(email)}` : '<p class="mt-note">No email notification sent.</p>'}
      </div>`,
      `<button class="btn" type="button" data-m="close">CLOSE</button><button class="btn btn-primary" type="button" data-m="open">OPEN TICKET</button>`);
    const openTicket = () => { closeModal(); open('ticket', { ticketId: ticket.id }); };
    m.querySelector('[data-m="open"]').addEventListener('click', openTicket);
    m.querySelector('[data-m="openmail"]')?.addEventListener('click', openTicket);
  }
  function emailHtml(email) {
    return `<div class="mt-email"><div class="hd">✉ SIMULATED EMAIL <span class="mt-note" style="font-weight:500;letter-spacing:0">(no message is actually sent)</span></div>
      <div class="row"><span>TO</span><div>${esc(email.to)}</div></div><div class="row"><span>SUBJECT</span><div>${esc(email.subject)}</div></div>
      <pre>${esc(email.body)}</pre><div class="foot"><button class="btn btn-primary" type="button" data-m="openmail">OPEN TICKET</button></div></div>`;
  }
  function emailModal(email, ticket) {
    const m = modal('Email Notification', emailHtml(email), `<button class="btn" type="button" data-m="close">CLOSE</button>`);
    m.querySelector('[data-m="openmail"]').addEventListener('click', () => { closeModal(); open('ticket', { ticketId: ticket.id }); });
  }

  function assignModal(t) {
    const m = modal(`Assign ${t.id}`, `<div class="mt-form"><label class="full">Assign To<select name="assignee">${store.USERS.map((u) => `<option value="${u.id}" ${u.id === t.assigneeId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label></div>`,
      `<button class="btn" type="button" data-m="close">CANCEL</button><button class="btn btn-primary" type="button" data-m="submit">ASSIGN</button>`);
    m.querySelector('[data-m="submit"]').addEventListener('click', () => { store.assignTicket(t.id, m.querySelector('[name="assignee"]').value); closeModal(); });
  }

  function resolveModal(t) {
    const kb = knowledgeFor(t.type);
    const m = modal(`Resolve ${t.id}`, `<div class="mt-form">
        <label class="full">Root Cause<select name="root">${kb.rootCauses.map((c) => `<option>${esc(c)}</option>`).join('')}<option>Other</option></select></label>
        <label class="full">Corrective Action<input name="action" placeholder="e.g. Recalibrated positioner and verified stroke" value="${esc(kb.recommendations[0] || '')}"></label>
        <label class="full">Resolution Notes<textarea name="notes" placeholder="What was found and what was done"></textarea></label>
      </div><p class="mt-note">After resolving, the ticket keeps monitoring the component; close it once the Twin shows NORMAL.</p>`,
      `<button class="btn" type="button" data-m="close">CANCEL</button><button class="btn btn-primary" type="button" data-m="submit">MARK RESOLVED</button>`);
    m.querySelector('[data-m="submit"]').addEventListener('click', () => {
      const f = (n) => m.querySelector(`[name="${n}"]`).value.trim();
      store.resolveTicket(t.id, { rootCause: f('root'), correctiveAction: f('action'), notes: f('notes') });
      closeModal();
    });
  }

  return {
    openCreateTicket,
    openTicket: (id, tab) => open('ticket', { ticketId: id, tab }),
    close,
  };
}

/* ------------------------------ helpers ------------------------------ */
/** Demo helper: clears the component's simulated anomaly (the Twin then shows NORMAL). */
function simulateRepair(componentId) {
  setComponentAnomaly(componentId, 'normal');
  if (componentId === 'vPortValve') setVPortActual(S.vPortValve.commandPosition);
}
function suggestPriority(cap) {
  return cap.level === 'critical' ? 'P1' : 'P2';
}
export function durationText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m ${r.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`;
}
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
