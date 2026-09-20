import { subscribe, simulationState } from '../simulation/simulationState.js';
import { snapshot, fmt, THRESHOLDS } from './dashboardData.js';
import { LEVEL_LABEL, flowDeviationPercent } from '../simulation/units.js';
import { ANOMALY_CATALOG } from '../simulation/anomalyCatalog.js';
import { createSchematic } from './schematic.js';
import { overviewMetrics, impactText, historicalFor, activityFor, chartKind, targetFlow, seriesChartFor, esdCycleSummary } from './anomalyAnalytics.js';
import { createPositionChart, createBallResponseChart, createFlowChart, createSeriesChart, createEsdCycleChart, CHART_COLORS } from './anomalyCharts.js';
import { positionHistory, ballSamplesWallClock, esdSamplesWallClock, processSamplesWallClock } from './liveHistory.js';
import { knowledgeFor } from '../maintenance/knowledge.js';
import { ticketsFor, onTicketsChange, openTicketCount, tickets as allTickets, historicalComparison, trendSeries } from '../maintenance/ticketStore.js';

/**
 * Dashboard view — MONITOR → IDENTIFY ANOMALY → ANALYZE → TAKE ACTION.
 *
 * Reads the same simulationState as the Twin (through dashboardData.snapshot) and
 * never edits it; units come from the shared unit configuration. Layout:
 * status strip → process flow → component status + active anomalies →
 * selected anomaly detail + recent activity. Ticketing opens as a modal /
 * drawer on top of this view (maintenanceUI).
 */
const RANGES = [['10m', 'Last 10 min'], ['60m', 'Last 60 min'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days']];
const RANGE_MS = { '10m': 10 * 60 * 1000, '60m': 60 * 60 * 1000, '24h': 24 * 3600 * 1000, '7d': 7 * 24 * 3600 * 1000 };

export function createDashboard(container, { onOpenComponent, onCreateTicket, onOpenTicket, onOpenReports }) {
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const clockDate = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  const clockTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  const view = { selectedId: null, userPicked: false, tab: 'overview', range: '60m', chart: null, chartFor: null, menuOpen: false };

  container.innerHTML = `
    <div class="dash">
      <div class="subbar">
        <div class="subbar-left">
          <b class="subbar-title">Yankee Dryer Steam System</b>
          <span class="subbar-sep"></span>
          <span class="cnt" data-cnt="critical"><i class="lg is-critical"></i><b>0</b> Critical</span>
          <span class="cnt" data-cnt="attention"><i class="lg is-attention"></i><b>0</b> Attention</span>
          <span class="subbar-sep"></span>
          <span class="cnt" data-cnt="tickets">Open Tickets: <b>0</b></span>
        </div>
        <div class="subbar-right mono"><span id="clock-date"></span> <span id="clock-time"></span></div>
      </div>

      <section class="card card-process">
        <div class="card-head compact">
          <h2>Process Flow — Yankee Dryer Steam System</h2>
          <span class="legend"><i class="lg is-normal"></i>Normal <i class="lg is-attention"></i>Attention <i class="lg is-critical"></i>Critical</span>
        </div>
        <div id="dash-schematic"></div>
      </section>

      <div class="dash-mid">
        <section class="card card-status">
          <div class="card-head compact"><div><h2>Component Status</h2><p class="card-sub">Select a component to view details</p></div></div>
          <table class="status-table">
            <thead><tr><th>Component</th><th>Status</th><th>Key Parameter / State</th></tr></thead>
            <tbody id="dash-status-body"></tbody>
          </table>
        </section>
        <section class="card card-anomalies">
          <div class="card-head compact"><h2>Active Anomalies <span class="count-badge" id="dash-anom-count">0</span></h2></div>
          <div id="dash-anomalies"></div>
        </section>
      </div>

      <div class="dash-bottom">
        <section class="card card-detail" id="dash-detail">
          <div class="detail-head" id="detail-head"></div>
          <div class="detail-tabs" id="detail-tabs"></div>
          <div class="detail-body" id="detail-body"></div>
        </section>
        <section class="card card-activity">
          <div class="card-head compact"><h2>Recent Activity</h2><span class="card-sub">Last 7 days</span></div>
          <div id="dash-activity"></div>
        </section>
      </div>
      <p class="disclaimer">Live values are read from the Twin's simulation state (bar · kg/h · °C · rpm). Yesterday / 7-day baselines and older activity entries are a simulated historian for the demo; thresholds are demo values, not engineering limits.</p>
    </div>`;

  const q = (sel) => container.querySelector(sel);
  const schematic = createSchematic(q('#dash-schematic'), { onSelect: (id) => select(id) });
  const statusBody = q('#dash-status-body'), anomHost = q('#dash-anomalies'), anomCount = q('#dash-anom-count');
  const detailHead = q('#detail-head'), detailTabs = q('#detail-tabs'), detailBody = q('#detail-body'), activityHost = q('#dash-activity');
  const cnt = { critical: q('[data-cnt=critical] b'), attention: q('[data-cnt=attention] b'), tickets: q('[data-cnt=tickets] b') };

  // Live clock (browser local time — never hard-coded).
  const clockD = q('#clock-date'), clockT = q('#clock-time');
  const tickClock = () => { const n = new Date(); clockD.textContent = clockDate.format(n); clockT.textContent = clockTime.format(n); };
  tickClock(); setInterval(tickClock, 1000);

  /* ------------------------------ selection ------------------------------ */
  function select(id, { user = true } = {}) {
    if (!id) return;
    view.selectedId = id; view.userPicked = user;
    view.tab = view.tab || 'overview';
    update(true, true);
    if (user) q('#dash-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function defaultSelection(s) {
    if (view.userPicked && view.selectedId) return view.selectedId;
    const worst = s.anomalies[0];                          // sorted: critical first
    return worst?.componentId || view.selectedId || 'vPortValve';
  }

  /* ------------------------------ update loop ------------------------------ */
  let lastText = 0, lastChart = 0, trailing = null, cache = {};
  const setHtml = (key, host, html) => { if (cache[key] !== html) { host.innerHTML = html; cache[key] = html; } };

  function update(force = false, rebuildDetail = false) {
    const now = Date.now();
    if (!force && now - lastText < 250) { if (!trailing) trailing = setTimeout(() => { trailing = null; update(true); }, 260); return; }
    lastText = now;
    const s = snapshot();
    const selectedId = defaultSelection(s);
    if (selectedId !== view.selectedId) { view.selectedId = selectedId; rebuildDetail = true; }
    const entry = s.anomalies.find((x) => x.componentId === selectedId) || null;

    // Status strip
    const critical = s.components.filter((c) => c.level === 'critical').length, attention = s.components.filter((c) => c.level === 'attention').length;
    cnt.critical.textContent = critical; cnt.attention.textContent = attention; cnt.tickets.textContent = openTicketCount();
    q('[data-cnt=critical]').dataset.zero = String(critical === 0); q('[data-cnt=attention]').dataset.zero = String(attention === 0);

    // Process flow
    const statuses = {};
    for (const r of s.components) statuses[r.id] = { level: r.level, text: schematicText(r) };
    statuses.separator = { level: 'normal', text: 'Normal' };
    const target = targetFlow();
    const dev = flowDeviationPercent(simulationState.steam.flow, target);
    schematic.update(statuses, `${fmt.pressure(simulationState.steam.supplyPressure)} · ${fmt.temperature(s.kpis.temperature.value)}`, simulationState.condensate.direction < 0, {
      selectedId,
      live: {
        flow: `${fmt.flow(s.kpis.flow.value)}${Math.abs(dev) > THRESHOLDS.flowDeviationWarning ? ` ${dev < 0 ? '▼' : '▲'} ${Math.abs(Math.round(dev))}%` : ''}`,
        flowTone: Math.abs(dev) > THRESHOLDS.flowDeviationWarning ? 'critical' : '',
        moisture: fmt.moisture(s.kpis.moisture.value), moistureTarget: `target ${fmt.moisture(THRESHOLDS.moistureTarget)}`,
        moistureTone: s.kpis.moisture.level === 'normal' ? '' : 'attention',
        condensateTemp: fmt.temperature(simulationState.condensate.temperature),
      },
    });

    // Component status table (no graphics — the process flow already shows the equipment)
    setHtml('status', statusBody, s.components.map((r) => `<tr data-id="${r.id}" class="lvl-${r.level} ${r.id === selectedId ? 'is-selected' : ''}"><td>${r.name}</td><td><i class="lg is-${r.level}"></i>${LEVEL_LABEL[r.level]}</td><td class="mono ${r.level === 'critical' ? 'tone-critical' : r.level === 'attention' ? 'tone-attention' : ''}">${esc(r.state || r.value)}</td></tr>`).join(''));

    // Active anomalies
    setHtml('anoms', anomHost, s.anomalies.length ? s.anomalies.map((x) => anomalyCard(x, now, selectedId)).join('') : `<div class="empty"><i class="lg is-normal"></i>No active anomalies — all monitored components within normal range.</div>`);
    patchDurations(anomHost, now);
    anomCount.textContent = String(s.anomalies.length); anomCount.dataset.zero = String(s.anomalies.length === 0); anomCount.dataset.level = s.kpis.anomalies.level;

    // Detail + activity
    renderDetail(s, entry, selectedId, now, rebuildDetail);   // structural rebuild only on selection / tab / range changes, never on the periodic refresh
    renderActivity(entry, selectedId, now);
    if (view.chart && (force || now - lastChart > 500)) { lastChart = now; updateChart(entry, selectedId); }   // live trend: 2 Hz redraw
  }

  function schematicText(r) {
    switch (r.id) {
      case 'vPortValve': return `${fmt.position(simulationState.vPortValve.commandPosition)} cmd / ${fmt.position(simulationState.vPortValve.actualPosition)} act`;
      case 'yankee': return r.state;
      default: return r.short || r.state || LEVEL_LABEL[r.level];
    }
  }

  /* ------------------------------ anomaly cards ------------------------------ */
  function anomalyCard(x, now, selectedId) {
    const cols = cardColumns(x).map(([k, v, tone]) => `<div class="ac-col"><span>${esc(k)}</span><b class="mono ${tone || ''}">${esc(v)}</b></div>`).join('');
    const ticket = ticketsFor(x.componentId, x.type)[0];
    return `<div class="anomaly is-${x.level} ${x.componentId === selectedId ? 'is-selected' : ''}" data-id="${x.componentId}">
      <div class="ac-main">
        <div class="ac-title"><i class="lg is-${x.level}"></i><div><b>${esc(x.component)}</b><div class="ac-sub">${esc(x.title)}</div></div></div>
        <div class="ac-cols">${cols}
          <div class="ac-col"><span>Duration</span><b class="mono" data-dur="${x.detectedAt || ''}"></b></div>
          <div class="ac-col"><span>Severity</span><b class="tone-${x.level}">${x.level === 'critical' ? 'Critical' : 'Warning'}</b></div>
        </div>
      </div>
      <div class="ac-actions">${ticket ? `<span class="ac-ticket">${ticket.id}</span>` : ''}<button class="btn btn-view" type="button" data-act="view" data-id="${x.componentId}">VIEW</button></div>
    </div>`;
  }
  function cardColumns(x) {
    const v = simulationState.vPortValve, b = simulationState.ballValve;
    switch (x.type) {
      case 'VPORT_POSITION_MISMATCH': case 'VPORT_STICKING': case 'VPORT_SLOW_RESPONSE': case 'VPORT_HUNTING': {
        const dev = flowDeviationPercent(simulationState.steam.flow, targetFlow());
        return [['Command → Actual', `${fmt.position(v.commandPosition)} → ${fmt.position(v.actualPosition)}`, 'tone-critical'], ['Position Error', fmt.percent(v.positionError), 'tone-critical'], ['Steam Flow', `${dev < 0 ? '▼' : '▲'} ${Math.abs(Math.round(dev))}%`, Math.abs(dev) > THRESHOLDS.flowDeviationWarning ? 'tone-critical' : '']];
      }
      case 'BALL_SLOW_OPERATION':
        return [['Command', x.lines[0][1]], ['Actual', x.lines[1][1], b.sim.moving ? 'tone-attention' : ''], ['Response Time', x.lines[2][1], 'tone-attention'], ['Expected', x.lines[3][1]]];
      default:
        return x.lines.slice(0, 3);
    }
  }

  /* ------------------------------ detail panel ------------------------------ */
  function renderDetail(s, entry, selectedId, now, rebuild) {
    const compLabel = ANOMALY_CATALOG[selectedId]?.label || s.components.find((c) => c.id === selectedId)?.name || selectedId;
    const ticket = ticketsFor(selectedId, entry?.type)[0];
    const level = entry ? entry.level : 'normal';
    const head = entry ? `
      <div class="dh-left">
        <div class="dh-title"><span class="dh-icon is-${level}">${level === 'critical' ? '⚠' : '⚠'}</span><h2>${esc(entry.component)} — ${esc(entry.title)}</h2><span class="badge" data-level="${level}">${level === 'critical' ? 'CRITICAL' : 'WARNING'}</span></div>
        <div class="dh-sub">${esc(entry.subtitle || entry.explain)}</div>
      </div>
      <div class="dh-meta">
        <div><span>First Detected</span><b class="mono">${entry.detectedAt ? dateTimeFmt.format(new Date(entry.detectedAt)) : '—'}</b></div>
        <div><span>Duration</span><b class="mono" data-dur="${entry.detectedAt || ''}"></b></div>
        ${ticket ? `<div><span>Ticket</span><b><span class="st" data-st="${ticket.status}">${ticket.status}</span></b></div>` : ''}
      </div>
      <div class="dh-actions">
        <button class="btn" type="button" data-act="twin" data-id="${selectedId}">View in Twin</button>
        ${ticket ? `<button class="btn btn-primary" type="button" data-act="ticket" data-ticket="${ticket.id}">View Ticket ${ticket.id}</button>` : `<button class="btn btn-primary" type="button" data-act="create" data-id="${selectedId}">Create Ticket</button>`}
        <div class="menu-wrap"><button class="btn btn-more" type="button" data-act="menu" title="More">…</button><div class="menu" id="detail-menu" hidden>
          ${ticket ? `<button type="button" data-act="ticket" data-ticket="${ticket.id}">Open ticket ${ticket.id}</button>` : ''}
          <button type="button" data-act="reports">All maintenance tickets</button>
          <button type="button" data-act="tab" data-tab="analytics">Open analytics</button>
        </div></div>
      </div>` : `
      <div class="dh-left">
        <div class="dh-title"><span class="dh-icon is-normal">✓</span><h2>${esc(compLabel)}</h2><span class="badge" data-level="normal">NORMAL</span></div>
        <div class="dh-sub">No active anomaly — values within normal range.</div>
      </div>
      <div class="dh-meta"><div><span>Component</span><b>${esc(compLabel)}</b></div><div><span>Open Tickets</span><b class="mono">${ticketsFor(selectedId).length}</b></div></div>
      <div class="dh-actions">
        <button class="btn" type="button" data-act="twin" data-id="${selectedId}">View in Twin</button>
        ${ticket ? `<button class="btn btn-primary" type="button" data-act="ticket" data-ticket="${ticket.id}">View Ticket ${ticket.id}</button>` : `<button class="btn btn-primary" type="button" disabled title="No active anomaly to raise a ticket for">Create Ticket</button>`}
        <div class="menu-wrap"><button class="btn btn-more" type="button" data-act="menu" title="More">…</button><div class="menu" id="detail-menu" hidden>
          ${ticket ? `<button type="button" data-act="ticket" data-ticket="${ticket.id}">Open ticket ${ticket.id}</button>` : ''}
          <button type="button" data-act="reports">All maintenance tickets</button>
        </div></div>
      </div>`;
    const headKey = `${selectedId}:${entry?.type || 'normal'}:${entry?.detectedAt || 0}:${ticket ? `${ticket.id}:${ticket.status}` : ''}:${ticketsFor(selectedId).length}`;
    if (cache.headKey !== headKey) { detailHead.innerHTML = head; cache.headKey = headKey; }
    patchDurations(detailHead, now);
    const tabs = [['overview', 'Overview'], ['analytics', 'Analytics'], ['causes', 'Possible Causes'], ['recommendations', 'Recommendations'], ['activity', 'Activity']];
    setHtml('tabs', detailTabs, tabs.map(([id, l]) => `<button type="button" data-tab="${id}" class="${id === view.tab ? 'is-active' : ''}">${l}</button>`).join(''));

    const key = `${selectedId}:${entry?.type || 'normal'}:${view.tab}:${view.range}:${selectedId === 'esdValve' ? (simulationState.esdValve.cycleTest ? `ct${simulationState.esdValve.cycleTest.current}${simulationState.esdValve.cycleTest.active ? 'r' : 'd'}` : 'none') : ''}`;
    const structural = rebuild || cache.detailKey !== key;
    cache.detailKey = key;
    if (view.tab === 'overview') {
      const html = `<div class="ov-grid">
        <div class="ov-left">
          ${metricsHtml(entry, selectedId)}
          ${impactBanner(entry, selectedId, level)}
        </div>
        <div class="ov-right">
          <div class="chart-head"><h4>${chartTitle(selectedId, 'overview')}</h4>${rangeSelect(selectedId)}</div>
          <div data-chart></div>
          ${legendHtml(selectedId)}
          ${historicalHtml(entry, selectedId)}
        </div>
      </div>`;
      if (structural) { detailBody.innerHTML = html; mountChart(selectedId, entry); }
      else { patch('[data-metrics]', metricsHtml(entry, selectedId)); patch('[data-hist]', historicalHtml(entry, selectedId)); }
    } else if (view.tab === 'analytics') {
      const rows = historicalComparison(selectedId === 'rotaryJoint' || selectedId === 'yankee' ? 'steam' : selectedId);
      const html = `<div class="an-full">
        <div class="chart-head"><h4>${chartTitle(selectedId, 'analytics')}</h4>${rangeSelect(selectedId)}</div>
        <div data-chart class="tall"></div>
        ${legendHtml(selectedId)}
        <div class="an-two">
          ${historicalHtml(entry, selectedId)}
          <div class="hist-table-wrap"><h4>Historical Comparison</h4><table class="mt-comp-table"><thead><tr><th>Parameter</th><th>Today</th><th>Yesterday</th><th>7-Day Avg</th></tr></thead><tbody data-comp>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="today mono">${esc(r.today)}</td><td class="mono">${esc(r.yesterday)}</td><td class="mono">${esc(r.avg7)}</td></tr>`).join('')}</tbody></table><p class="note">Yesterday / 7-day values are a simulated historian baseline (same units as the Twin).</p></div>
        </div>
      </div>`;
      if (structural) { detailBody.innerHTML = html; mountChart(selectedId, entry); }
      else { patch('[data-hist]', historicalHtml(entry, selectedId)); patch('[data-comp]', rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="today mono">${esc(r.today)}</td><td class="mono">${esc(r.yesterday)}</td><td class="mono">${esc(r.avg7)}</td></tr>`).join('')); }
    } else if (view.tab === 'causes' || view.tab === 'recommendations') {
      const kb = entry ? knowledgeFor(entry.type) : null;
      const list = view.tab === 'causes' ? kb?.causes : kb?.recommendations;
      const html = entry ? `<div class="kb"><h4>${view.tab === 'causes' ? 'Possible Causes' : 'Recommendations'} <span class="note">${view.tab === 'causes' ? '— possible, not confirmed root causes' : '— concise checklist, confirm on site'}</span></h4>${view.tab === 'causes' ? `<ul class="kb-list">${list.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : `<ol class="kb-list">${list.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>`}</div>`
        : `<div class="kb"><p class="note">No active anomaly for this component — nothing to diagnose.</p></div>`;
      if (structural) { detailBody.innerHTML = html; view.chart = null; }
    } else {
      const items = [];
      if (entry?.detectedAt) items.push({ t: entry.detectedAt, text: `${entry.component} — ${entry.title} detected (${entry.detail})` });
      for (const t of allTickets().filter((x) => x.componentId === selectedId)) for (const a of t.activity) if (!/detected$/.test(a.text)) items.push({ t: a.t, text: `${t.id}: ${a.text}` });
      items.sort((a, b) => b.t - a.t);
      const html = `<div class="kb"><h4>Activity</h4>${items.length ? `<ul class="timeline">${items.map((a) => `<li><span class="when mono">${dateTimeFmt.format(new Date(a.t))}</span>${esc(a.text)}</li>`).join('')}</ul>` : '<p class="note">No activity recorded yet.</p>'}</div>`;
      if (structural || cache.act !== html) { detailBody.innerHTML = html; cache.act = html; view.chart = null; }
    }
  }
  /** Live "Duration" fields are patched in place so open menus / dropdowns are not destroyed by the refresh. */
  function patchDurations(host, now) {
    for (const el of host.querySelectorAll('[data-dur]')) {
      const t = Number(el.dataset.dur);
      const txt = t ? durationText(now - t) : '—';
      if (el.textContent !== txt) el.textContent = txt;
    }
  }
  function patch(sel, html) { const el = detailBody.querySelector(sel); if (el && el.innerHTML !== html) el.innerHTML = html; }

  function impactBanner(entry, selectedId, level) {
    if (entry) return `<div class="impact is-${level}"><b>Impact:</b> ${esc(impactText(entry))}</div>`;
    const k = selectedId === 'esdValve' ? esdCycleSummary() : null;
    if (k && k.trend === 'Degrading') return `<div class="impact is-attention"><b>Status: Degrading</b> — valve response time is increasing over multiple cycles (last cyclic test: ${k.initial.toFixed(1)} s → ${k.currentDelay.toFixed(1)} s).</div>`;
    return `<div class="impact is-normal"><b>Status:</b> Component operating normally. Live values shown above.</div>`;
  }
  function metricsHtml(entry, selectedId) {
    const rows = overviewMetrics(entry || { componentId: selectedId, lines: [] });
    return `<div data-metrics><div class="metrics">${rows.map((row) => `<div class="metric-row cols-${row.length}">${row.map((m) => `<div class="metric tone-${m.tone || 'plain'}"><span>${esc(m.label)}</span><b class="mono">${esc(m.value)}</b>${m.sub ? `<small>${esc(m.sub)}</small>` : ''}</div>`).join('')}</div>`).join('')}</div></div>`;
  }
  function historicalHtml(entry, selectedId) {
    const h = historicalFor(entry || { componentId: selectedId });
    const trendCls = h.trend === 'Worsening' ? 'tone-critical' : h.trend === 'Improving' ? 'tone-normal' : 'tone-muted';
    const arrow = h.trend === 'Worsening' ? '↗' : h.trend === 'Improving' ? '↘' : '→';
    return `<div data-hist><div class="hist"><h4>${esc(h.title)}</h4>${h.rows.map(([k, v, tone]) => `<div class="hist-row"><span>${esc(k)}</span><b class="mono tone-${tone || 'plain'}">${esc(v)}</b></div>`).join('')}<div class="hist-row"><span>Trend</span><b class="${trendCls}">${arrow} ${h.trend}</b></div></div></div>`;
  }
  function chartTitle(id, where) {
    const kind = chartKind(id);
    if (kind === 'position') return `Command vs Actual Position${where === 'analytics' ? '' : ` — ${RANGES.find((r) => r[0] === view.range)[1]}`}`;
    if (kind === 'ballResponse') return 'Ball Valve Open/Close Response';
    if (kind === 'esdResponse') return 'ESD Trip Response';
    if (kind === 'esdCycle') { const k = esdCycleSummary(); return `ESD Valve Command vs Actual State — ${k?.current || 0} Cycles`; }
    if (kind === 'series') return seriesChartFor(id)?.title || 'Trend';
    return 'Steam Flow vs Expected';
  }
  function rangeSelect(id) {
    const kind = chartKind(id);
    if (kind === 'ballResponse' || kind === 'esdResponse') return `<span class="note">last stroke · live samples</span>`;
    if (kind === 'esdCycle') { const k = esdCycleSummary(); return `<span class="note">${k?.active ? 'cycle test running' : 'cyclic ON/OFF test'} · ${k?.period || 5} s command cycle</span>`; }
    if (kind === 'series') return `<span class="note">last 10 min · ${esc(seriesChartFor(id)?.note || '')}</span>`;
    return `<select data-range class="range">${RANGES.map(([v, l]) => `<option value="${v}" ${v === view.range ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  }
  function legendHtml(id) {
    const kind = chartKind(id);
    if (kind === 'position') return `<div class="legend-row"><span><i style="background:${CHART_COLORS.cmd}"></i>Commanded (%)</span><span><i style="background:${CHART_COLORS.act}"></i>Actual (%)</span><span><i style="background:${CHART_COLORS.gap};border:1px solid rgba(220,38,38,0.4)"></i>Deviation</span></div>`;
    if (kind === 'ballResponse') return `<div class="legend-row"><span><i style="background:${CHART_COLORS.cmd}"></i>Command (OPEN / CLOSE)</span><span><i style="background:${CHART_COLORS.act}"></i>Actual state</span><span><i style="background:${CHART_COLORS.lag};border:1px solid rgba(245,158,11,0.5)"></i>Response lag</span></div>`;
    if (kind === 'esdCycle') return `<div class="legend-row"><span><i style="background:${CHART_COLORS.cmd}"></i>Command</span><span><i style="background:${CHART_COLORS.act}"></i>Actual</span><span><i style="background:${CHART_COLORS.lag};border:1px solid rgba(245,158,11,0.5)"></i>Response lag</span><span><i style="background:rgba(220,38,38,0.12);border:1px solid rgba(220,38,38,0.4)"></i>Degrading cycles</span></div>`;
    if (kind === 'esdResponse') return `<div class="legend-row"><span><i style="background:${CHART_COLORS.cmd}"></i>Trip command (OPEN / CLOSE)</span><span><i style="background:${CHART_COLORS.act}"></i>Actual state</span><span><i style="background:${CHART_COLORS.lag};border:1px solid rgba(245,158,11,0.5)"></i>Shutdown lag</span></div>`;
    if (kind === 'series') { const def = seriesChartFor(id); return `<div class="legend-row">${(def?.legend || []).map(([l, color, dashed]) => `<span><i style="background:${color};${dashed ? 'height:0;border-top:2px dashed ' + color + ';' : ''}"></i>${esc(l)}</span>`).join('')}</div>`; }
    return `<div class="legend-row"><span><i style="background:${CHART_COLORS.flow}"></i>Steam flow (kg/h)</span><span><i style="background:${CHART_COLORS.expected}"></i>Expected</span></div>`;
  }
  function mountChart(id, entry) {
    const host = detailBody.querySelector('[data-chart]');
    if (!host) { view.chart = null; return; }
    const kind = chartKind(id);
    const height = host.classList.contains('tall') ? 240 : 150;
    view.chart = kind === 'position' ? createPositionChart(host, { height })
      : kind === 'ballResponse' || kind === 'esdResponse' ? createBallResponseChart(host, { height })
      : kind === 'esdCycle' ? createEsdCycleChart(host, { height: Math.max(200, height + 30) })
      : kind === 'series' ? createSeriesChart(host, { height })
      : createFlowChart(host, { height });
    view.chartFor = kind;
    updateChart(entry, id);
  }
  function updateChart(entry, id) {
    if (!view.chart || !detailBody.querySelector('[data-chart] svg')) return;
    const kind = chartKind(id);
    if (kind === 'ballResponse') view.chart.update(ballSamplesWallClock(), { windowMs: 40 * 1000, acceptable: simulationState.ballValve.sim.acceptableTime });
    else if (kind === 'esdResponse') view.chart.update(esdSamplesWallClock(), { windowMs: 40 * 1000, acceptable: simulationState.esdValve.sim.acceptableTime });
    else if (kind === 'esdCycle') view.chart.update(esdSamplesWallClock(), esdTestWallClock(), { acceptable: simulationState.esdValve.sim.acceptableDelay });
    else if (kind === 'series') { const def = seriesChartFor(id, entry); if (def) view.chart.update(processSamplesWallClock(), def.spec); }
    else {
      const live = view.range === '10m' || view.range === '60m';
      const pts = live ? positionHistory : trendSeries(view.range, entry?.detectedAt);
      view.chart.update(pts, { rangeMs: RANGE_MS[view.range], onsetAt: entry?.detectedAt || null });
    }
  }

  /** Cycle-test record with wall-clock start / end for the chart. */
  function esdTestWallClock() {
    const ct = simulationState.esdValve.cycleTest; if (!ct) return null;
    const now = Date.now(), simNow = simulationState.time;
    const wall = (st) => now - (simNow - st) * 1000;
    return { startAt: wall(ct.startSt), endAt: wall(ct.active ? simNow : ct.endSt), period: ct.period, total: ct.total, cycles: ct.cycles };
  }

  /* ------------------------------ recent activity ------------------------------ */
  function renderActivity(entry, selectedId, now) {
    const a = activityFor(selectedId, entry, []);
    const squares = a.days.map((d, i) => `<i class="sq is-${d}" title="${dayFmt.format(new Date(now - (6 - i) * 86400000))}"></i>`).join('');
    const html = `<div class="act-summary"><div class="sq-row">${squares}</div><span>${a.occurrences} occurrence${a.occurrences === 1 ? '' : 's'} · ${a.trend}</span></div>
      <ul class="act-list">${a.items.slice(0, 8).map((i) => {
        const isToday = now - i.t < 86400000 && new Date(i.t).getDate() === new Date(now).getDate();
        return `<li><span class="when mono">${isToday ? timeFmt.format(new Date(i.t)) : dayFmt.format(new Date(i.t))}</span><i class="lg is-${i.level === 'info' ? 'info' : i.level}"></i><span class="txt">${esc(i.text)}</span>${i.tag ? `<span class="tag tone-${i.level}">${i.tag}</span>` : ''}</li>`;
      }).join('')}</ul>`;
    setHtml('activity', activityHost, html);
  }

  /* ------------------------------ events ------------------------------ */
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act], [data-tab], tr[data-id], .anomaly[data-id]');
    if (!btn) { closeMenu(); return; }
    if (btn.dataset.act) {
      const act = btn.dataset.act;
      if (act === 'view') select(btn.dataset.id);
      else if (act === 'twin') onOpenComponent?.(btn.dataset.id);
      else if (act === 'create') onCreateTicket?.(btn.dataset.id);
      else if (act === 'ticket') onOpenTicket?.(btn.dataset.ticket);
      else if (act === 'reports') onOpenReports?.();
      else if (act === 'tab') { view.tab = btn.dataset.tab; update(true, true); }
      else if (act === 'menu') { const m = q('#detail-menu'); m.hidden = !m.hidden; return; }
      closeMenu();
      return;
    }
    if (btn.matches('[data-tab]') && btn.closest('#detail-tabs')) { view.tab = btn.dataset.tab; update(true, true); return; }
    if (btn.matches('tr[data-id]')) select(btn.dataset.id);
    else if (btn.matches('.anomaly[data-id]') && !e.target.closest('button')) select(btn.dataset.id);
  });
  container.addEventListener('change', (e) => { if (e.target.matches('[data-range]')) { view.range = e.target.value; update(true, true); } });
  function closeMenu() { const m = q('#detail-menu'); if (m) m.hidden = true; }

  subscribe(() => update());
  onTicketsChange(() => update(true, true));
  update(true, true);

  return { update: () => update(true, true), select: (id) => select(id), openAnalytics: () => { view.tab = 'analytics'; update(true, true); q('#dash-detail').scrollIntoView({ block: 'start' }); } };
}

export function durationText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${(m % 60).toString().padStart(2, '0')} min`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
