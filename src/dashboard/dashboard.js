import { subscribe, simulationState } from '../simulation/simulationState.js';
import { snapshot, createHistory, createEventLog, fmt, UNITS, THRESHOLDS } from './dashboardData.js';
import { LEVEL_LABEL } from '../simulation/units.js';
import { createSparkline, createTrendChart, createBar } from './charts.js';
import { createSchematic } from './schematic.js';

/**
 * Dashboard view — system-level monitoring. Reads the same simulationState as
 * the Twin (through dashboardData.snapshot) and never edits it. Units come from
 * the shared unit configuration. The DOM is built once; values are patched at
 * ~4 Hz, charts every 2 s.
 */
export function createDashboard(container, { onOpenComponent }) {
  const history = createHistory();
  const events = createEventLog(history);
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  container.innerHTML = `
    <div class="dash">
      <section class="kpis-row" id="dash-kpis"></section>

      <section class="card card-process">
        <div class="card-head">
          <div><h2>Process Overview</h2><p class="card-sub">Yankee dryer steam line with key components and live status</p></div>
          <span class="legend"><i class="lg is-normal"></i>Normal <i class="lg is-attention"></i>Attention <i class="lg is-critical"></i>Critical</span>
        </div>
        <div id="dash-schematic"></div>
      </section>

      <section class="card card-vport" id="dash-vport">
        <div class="card-head">
          <h2>V-Port Control Valve</h2>
          <span class="badge" data-vp="badge"></span>
        </div>
        <button class="vport-open" data-vp="open" type="button" title="Open in Twin">
          <span class="vport-glyph" aria-hidden="true"></span>
        </button>
        <div class="vp-rows">
          <div class="vp-row"><span>Command Position</span><b class="mono" data-vp="cmd"></b></div>
          <div data-vp="cmdbar"></div>
          <div class="vp-row"><span>Actual Position</span><b class="mono" data-vp="act"></b></div>
          <div data-vp="actbar"></div>
          <div class="vp-row vp-err"><span>Position Error</span><b class="mono" data-vp="err"></b></div>
          <div class="vp-sub">Steam Flow (through valve)</div>
          <div class="vp-row"><span>Expected <small>(at actual position)</small></span><b class="mono" data-vp="exp"></b></div>
          <div data-vp="expbar"></div>
          <div class="vp-row"><span>Actual</span><b class="mono" data-vp="actflow"></b></div>
          <div data-vp="actflowbar"></div>
          <div class="vp-row vp-err"><span>Flow Deviation</span><b class="mono" data-vp="dev"></b></div>
          <div class="vp-divider"></div>
          <div class="vp-row"><span>Trim Health <small>(estimated)</small></span><b class="mono" data-vp="health"></b></div>
          <div data-vp="healthbar"></div>
          <div class="vp-row"><span>Estimated Maintenance Window</span><b class="mono" data-vp="maint"></b></div>
          <div class="vp-row"><span></span><span class="badge" data-vp="warn"></span></div>
        </div>
      </section>

      <section class="trends-row" id="dash-trends"></section>

      <section class="card card-table">
        <div class="card-head"><h2>Component Status</h2></div>
        <table class="status-table">
          <thead><tr><th>Component</th><th>Status</th><th>Key Parameter</th><th>Value</th><th>Notes</th></tr></thead>
          <tbody id="dash-status-body"></tbody>
        </table>
      </section>

      <section class="card card-anomalies">
        <div class="card-head"><h2>Active Anomalies</h2><span class="count-badge" id="dash-anom-count">0</span></div>
        <div id="dash-anomalies"></div>
        <div class="card-head events-head"><h2>Recent Events</h2></div>
        <table class="events-table">
          <thead><tr><th>Time</th><th>Event</th><th>Details</th><th>Severity</th></tr></thead>
          <tbody id="dash-events"></tbody>
        </table>
      </section>

      <section class="card card-insights">
        <div class="card-head"><h2>Insights &amp; Recommendations</h2></div>
        <ul id="dash-insights"></ul>
        <p class="disclaimer">Simulated predictive-maintenance example. Thresholds (${THRESHOLDS.flowDeviationWarning}% / ${THRESHOLDS.flowDeviationCritical}% flow deviation, ${THRESHOLDS.positionErrorWarning}% position error) are configurable demo values, not engineering limits. Maintenance windows are estimates, not predictions.</p>
      </section>
    </div>
  `;

  // --- KPI cards ------------------------------------------------------------------
  const kpiHost = container.querySelector('#dash-kpis');
  const kpi = {};
  const addKpi = (key, title, icon, extraHtml = '') => {
    const card = document.createElement('div');
    card.className = `kpi-card kpi-${key}`;
    card.innerHTML = `<i class="kpi-icon icon-${icon}" aria-hidden="true"></i>
      <div class="kpi-body"><div class="kpi-title">${title}</div><div class="kpi-value"><b data-k="value"></b><span class="kpi-unit" data-k="unit"></span></div>${extraHtml}</div>`;
    kpiHost.appendChild(card);
    kpi[key] = { card, value: card.querySelector('[data-k=value]'), unit: card.querySelector('[data-k=unit]'), delta: card.querySelector('[data-k=delta]'), sub: card.querySelector('[data-k=sub]'), spark: card.querySelector('[data-k=spark]') ? createSparkline(card.querySelector('[data-k=spark]')) : null };
  };
  addKpi('system', 'System Status', 'heart', `<div class="sys-counts"><span><i class="lg is-critical"></i><b data-k="crit"></b> Critical</span><span><i class="lg is-attention"></i><b data-k="att"></b> Attention</span><span><i class="lg is-normal"></i><b data-k="nor"></b> Normal</span></div>`);
  addKpi('pressure', 'Steam Pressure', 'gauge', `<div class="kpi-delta" data-k="delta"></div><div class="kpi-spark" data-k="spark"></div>`);
  addKpi('flow', 'Steam Flow (to Yankee)', 'flow', `<div class="kpi-sub" data-k="sub"></div><div class="kpi-spark" data-k="spark"></div>`);
  addKpi('temperature', 'Steam Temperature', 'temp', `<div class="kpi-delta" data-k="delta"></div><div class="kpi-spark" data-k="spark"></div>`);
  addKpi('moisture', 'Paper Moisture (After Yankee)', 'drop', `<div class="kpi-sub" data-k="sub"></div><div class="kpi-spark" data-k="spark"></div>`);
  addKpi('anomalies', 'Active Anomalies', 'alert', `<div class="kpi-sub" data-k="sub"></div>`);
  const sysCounts = { crit: kpi.system.card.querySelector('[data-k=crit]'), att: kpi.system.card.querySelector('[data-k=att]'), nor: kpi.system.card.querySelector('[data-k=nor]') };

  // --- Process schematic ------------------------------------------------------------
  const schematic = createSchematic(container.querySelector('#dash-schematic'), { onSelect: (id) => onOpenComponent?.(id) });

  // --- V-Port panel ---------------------------------------------------------------
  const vp = {};
  for (const el of container.querySelectorAll('[data-vp]')) vp[el.dataset.vp] = el;
  const cmdBar = createBar(vp.cmdbar, 'accent');
  const actBar = createBar(vp.actbar, 'ok');
  const expBar = createBar(vp.expbar, 'accent');
  const actFlowBar = createBar(vp.actflowbar, 'ok');
  const healthBar = createBar(vp.healthbar, 'ok');
  vp.open.addEventListener('click', () => onOpenComponent?.('vPortValve'));

  // --- Trend charts (Twin units) -------------------------------------------------------
  const TRENDS = [
    { key: 'flow', title: 'Steam Flow Trend', unit: UNITS.flow, fixed: 0, tone: 'accent', target: (s) => s.kpis.flow.target },
    { key: 'pressure', title: 'Steam Pressure Trend', unit: UNITS.pressure, fixed: 1, tone: 'ok' },
    { key: 'temperature', title: 'Steam Temperature Trend', unit: UNITS.temperature, fixed: 0, tone: 'alarm' },
    { key: 'moisture', title: 'Paper Moisture Trend (Exit)', unit: UNITS.moisture, fixed: 1, tone: 'purple', target: () => THRESHOLDS.moistureTarget },
  ];
  const trendHost = container.querySelector('#dash-trends');
  const trendEls = {};
  for (const t of TRENDS) {
    const card = document.createElement('div');
    card.className = 'card trend-card';
    card.innerHTML = `<div class="card-head"><div><h3>${t.title}</h3><span class="trend-unit">${t.unit}</span></div><span class="range-pill">Last 10 min · <b data-t="now"></b></span></div><div data-t="chart"></div>`;
    trendHost.appendChild(card);
    trendEls[t.key] = { now: card.querySelector('[data-t=now]'), chart: createTrendChart(card.querySelector('[data-t=chart]'), { unit: t.unit, fixed: t.fixed }) };
  }

  const statusBody = container.querySelector('#dash-status-body');
  const anomHost = container.querySelector('#dash-anomalies');
  const anomCount = container.querySelector('#dash-anom-count');
  const eventsBody = container.querySelector('#dash-events');
  const insightsList = container.querySelector('#dash-insights');

  // --- Update loop (throttled; the simulation notifies every frame) --------------------
  let lastText = 0, lastCharts = 0, lastStatusHtml = '', lastEventsHtml = '', lastInsightsHtml = '', lastAnomHtml = '';
  let firstPaint = true;
  let trailing = null;

  function update(force = false) {
    const now = Date.now();
    events.update();
    const sampled = history.sample(now);
    if (!force && !firstPaint && now - lastText < 250) {
      if (!trailing) trailing = setTimeout(() => { trailing = null; update(true); }, 260);
      return;
    }
    lastText = now;
    firstPaint = false;
    const s = snapshot();

    // KPIs
    const sys = s.kpis.system;
    setText(kpi.system.value, sys.label); setText(kpi.system.unit, '');
    kpi.system.card.dataset.level = sys.level;
    setText(sysCounts.crit, sys.critical); setText(sysCounts.att, sys.attention); setText(sysCounts.nor, sys.normal);

    setKpiNumber('pressure', fmt.pressureNum(s.kpis.pressure.value), UNITS.pressure, history.delta('pressure'), (d) => fmt.pressure(Math.abs(d)), 0.05);
    setKpiNumber('temperature', fmt.temperatureNum(s.kpis.temperature.value), UNITS.temperature, history.delta('temperature'), (d) => fmt.temperature(Math.abs(d)), 0.5);

    const f = s.kpis.flow;
    setText(kpi.flow.value, fmt.flowNum(f.value)); setText(kpi.flow.unit, UNITS.flow);
    setText(kpi.flow.sub, `Target ${fmt.flow(f.target)} · deviation ${fmt.signedPercent(f.deviation)} · ${LEVEL_LABEL[f.level]}`);
    kpi.flow.sub.dataset.level = f.level; kpi.flow.card.dataset.level = f.level;
    kpi.flow.spark.update(history.series.flow, f.level === 'normal' ? 'ok' : 'alarm');

    const m = s.kpis.moisture;
    setText(kpi.moisture.value, fmt.moistureNum(m.value)); setText(kpi.moisture.unit, UNITS.moisture);
    setText(kpi.moisture.sub, `Target ${fmt.moisture(m.target)} · ${m.level === 'normal' ? 'within target' : 'above target'}`);
    kpi.moisture.sub.dataset.level = m.level;
    kpi.moisture.spark.update(history.series.moisture, m.level === 'normal' ? 'ok' : 'alarm');

    const an = s.kpis.anomalies;
    setText(kpi.anomalies.value, String(an.count)); setText(kpi.anomalies.unit, 'active');
    setText(kpi.anomalies.sub, an.count ? s.anomalies.map((x) => `${x.component} · ${x.title}`).join(', ') : 'No active anomalies');
    kpi.anomalies.card.dataset.level = an.level;

    // Schematic
    const statuses = {};
    for (const r of s.components) statuses[r.id] = { level: r.level, text: schematicText(r) };
    statuses.yankee = { level: 'normal', text: simulationState.yankee.running ? `Running · ${fmt.speed(simulationState.yankee.speedRpm)}` : 'Stopped' };
    statuses.separator = { level: 'normal', text: 'Normal' };
    schematic.update(statuses, `${fmt.pressure(simulationState.steam.supplyPressure)} · ${fmt.temperature(s.kpis.temperature.value)}`, simulationState.condensate.direction < 0);

    // V-Port card
    const v = s.vport;
    const badge = v.level === 'normal' ? 'Normal' : v.status === 'DETECTING' ? 'Detecting' : v.level === 'attention' ? 'Attention Required' : 'Critical';
    setText(vp.badge, badge); vp.badge.dataset.level = v.level;
    setText(vp.cmd, fmt.position(v.command)); cmdBar.update(v.command);
    setText(vp.act, fmt.position(v.actual)); actBar.update(v.actual, v.error > THRESHOLDS.positionErrorWarning ? 'alarm' : 'ok');
    setText(vp.err, `${fmt.percent(v.error)}${v.error > THRESHOLDS.positionErrorWarning ? ' ⚠' : ''}`); vp.err.dataset.tone = v.error > THRESHOLDS.positionErrorWarning ? 'alarm' : 'ok';
    const flowScale = Math.max(v.expectedFlow, v.actualFlow, simulationState.steam.maxFlow) || 1;
    setText(vp.exp, fmt.flow(v.expectedFlow)); expBar.update((v.expectedFlow / flowScale) * 100);
    setText(vp.actflow, fmt.flow(v.actualFlow)); actFlowBar.update((v.actualFlow / flowScale) * 100, v.flowLevel === 'normal' ? 'ok' : v.flowLevel === 'attention' ? 'warn' : 'alarm');
    setText(vp.dev, `${fmt.signedPercent(v.flowDeviation)}${v.flowLevel !== 'normal' ? ' ⚠' : ''}`); vp.dev.dataset.tone = v.flowLevel === 'normal' ? 'ok' : 'alarm';
    setText(vp.health, fmt.percent(v.trimHealth)); healthBar.update(v.trimHealth, v.trimHealth < THRESHOLDS.trimHealthCritical ? 'alarm' : v.trimHealth < THRESHOLDS.trimHealthWarning ? 'warn' : 'ok');
    setText(vp.maint, v.maintenance);
    setText(vp.warn, v.earlyWarning ? 'Early Warning' : 'No warning'); vp.warn.dataset.level = v.earlyWarning ? 'attention' : 'normal';

    // Trends (every 2 s or on new sample)
    if (sampled || force || now - lastCharts > 2000) {
      lastCharts = now;
      for (const t of TRENDS) {
        const series = history.series[t.key];
        trendEls[t.key].chart.update(series, t.tone, { target: t.target ? t.target(s) : null, markers: history.markers, windowMs: history.windowMs });
        setText(trendEls[t.key].now, `${Number(series[series.length - 1].v.toFixed(t.fixed)).toLocaleString('en-US')} ${t.unit}`);
      }
    }

    // Component status table
    const statusHtml = s.components.map((r) => `<tr data-id="${r.id}"><td>${r.name}</td><td><i class="lg is-${r.level}"></i>${LEVEL_LABEL[r.level]}</td><td>${r.param}</td><td class="mono ${r.level === 'critical' ? 'tone-alarm' : r.level === 'attention' ? 'tone-warn' : ''}">${r.value}</td><td>${r.notes}</td></tr>`).join('');
    if (statusHtml !== lastStatusHtml) { statusBody.innerHTML = statusHtml; lastStatusHtml = statusHtml; }

    // Active anomalies (from the shared anomaly state)
    const anomHtml = s.anomalies.length ? s.anomalies.map((x) => `
      <div class="anomaly is-${x.level}" data-id="${x.componentId}" role="button" tabindex="0">
        <div class="anomaly-head"><span class="anomaly-icon">!</span><div><b>${x.component}</b><div class="anomaly-title">${x.title}</div></div><span class="badge" data-level="${x.level}">${x.level === 'critical' ? 'Critical' : 'Attention Required'}</span></div>
        <div class="anomaly-grid mono">${x.lines.map(([k, val]) => `<span>${k}: <b>${val}</b></span>`).join('')}</div>
        <div class="anomaly-meta"><span>Detected: ${events.detectedAt ? timeFmt.format(new Date(events.detectedAt)) : '—'}</span><span>Duration: ${events.detectedAt ? durationText(now - events.detectedAt) : '—'}</span></div>
        <div class="anomaly-text"><b>Impact:</b> ${x.impact}</div>
        <div class="anomaly-text"><b>Early Warning:</b> ${x.warning}</div>
      </div>`).join('') : `<div class="empty"><i class="lg is-normal"></i>No Active Anomalies — all monitored components within normal range.</div>`;
    if (anomHtml !== lastAnomHtml) { anomHost.innerHTML = anomHtml; lastAnomHtml = anomHtml; }
    setText(anomCount, String(s.anomalies.length)); anomCount.dataset.zero = String(s.anomalies.length === 0); anomCount.dataset.level = an.level;

    // Events
    const evHtml = events.events.map((e) => `<tr><td class="mono">${timeFmt.format(new Date(e.t))}</td><td>${e.event}</td><td class="muted">${e.details}</td><td><span class="sev sev-${e.severity.toLowerCase()}">${e.severity}</span></td></tr>`).join('');
    if (evHtml !== lastEventsHtml) { eventsBody.innerHTML = evHtml; lastEventsHtml = evHtml; }

    // Insights
    const insHtml = s.insights.map((i) => `<li>${i}</li>`).join('');
    if (insHtml !== lastInsightsHtml) { insightsList.innerHTML = insHtml; lastInsightsHtml = insHtml; }
  }

  function setKpiNumber(key, valueText, unit, delta, fmtDelta, flatBelow) {
    const k = kpi[key];
    setText(k.value, valueText); setText(k.unit, unit);
    const flat = Math.abs(delta) < flatBelow;
    setText(k.delta, flat ? '— steady' : `${delta > 0 ? '▲ +' : '▼ −'}${fmtDelta(delta)} (last min)`);
    k.delta.dataset.tone = flat ? 'flat' : 'ok';
    k.spark.update(history.series[key], 'ok');
  }

  anomHost.addEventListener('click', (e) => { const card = e.target.closest('.anomaly'); if (card) onOpenComponent?.(card.dataset.id || 'vPortValve'); });
  statusBody.addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) onOpenComponent?.(tr.dataset.id); });

  subscribe(() => update());
  update(true);

  return { update: () => update(true) };
}

function schematicText(r) {
  switch (r.id) {
    case 'ballValve': return r.value.split(' ')[0];
    case 'esdValve': return r.level === 'normal' ? r.value.split(' ')[0] : r.value;
    case 'vPortValve': return r.level === 'normal' ? 'Normal' : LEVEL_LABEL[r.level];
    case 'safetyValve': return r.notes.startsWith('OPEN') ? 'Open' : 'Closed';
    case 'steamTrap': return r.notes.includes('HEALTHY') ? 'Healthy' : LEVEL_LABEL[r.level];
    case 'checkValve': return r.value.includes('REVERSE') ? 'Reverse' : r.value === 'NO FLOW' ? 'No flow' : 'Forward';
    default: return 'Normal';
  }
}
function durationText(ms) { const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000); return m ? `${m} min ${s} s` : `${s} s`; }
function setText(el, text) { if (el && el.textContent !== String(text)) el.textContent = text; }
