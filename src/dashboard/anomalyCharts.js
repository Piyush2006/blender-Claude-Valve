/**
 * Compact SVG charts for the anomaly detail panel (no dependencies):
 *
 *   createPositionChart     — V-Port commanded vs actual position (%), the gap shaded red
 *   createBallResponseChart — Ball valve OPEN/CLOSE command step vs actual state, lag shaded amber
 *   createFlowChart         — steam flow vs expected (generic fallback)
 *   createEsdCycleChart     — ESD cyclic ON/OFF test: command square wave vs actual state over
 *                             10–15 cycles, degrading cycles shaded, cycle markers C1…Cn
 *   createSeriesChart       — configurable time-series chart (left/right axes, reference lines,
 *                             shaded bands) used for the ESD, safety valve, trap, check valve,
 *                             rotary joint and Yankee views
 */
const NS = 'http://www.w3.org/2000/svg';
export const CHART_COLORS = { cmd: '#2563EB', act: '#16A34A', flow: '#16A34A', expected: '#94A3B8', gap: 'rgba(220,38,38,0.14)', lag: 'rgba(245,158,11,0.18)' };

function svgEl(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function base(host, height) {
  const svg = svgEl('svg', { class: 'an-chart' });
  host.appendChild(svg);
  const H = height, T = 8, B = 22;
  function frame() {
    const W = Math.max(280, host.clientWidth || 520);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    return { W, H, T, B };
  }
  const line = (x1, y1, x2, y2, stroke, dash, width = 1) => svg.appendChild(svgEl('line', { x1, y1, x2, y2, stroke, 'stroke-width': width, ...(dash ? { 'stroke-dasharray': dash } : {}) }));
  const text = (x, y, s, anchor = 'start', fill) => svg.appendChild(svgEl('text', { x, y, 'text-anchor': anchor, ...(fill ? { fill } : {}) }, s));
  const path = (d, stroke, width, dash, fill = 'none') => svg.appendChild(svgEl('path', { d, fill, stroke, 'stroke-width': width, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', ...(dash ? { 'stroke-dasharray': dash } : {}) }));
  const timeFmt = (rangeMs) => rangeMs > 3 * 3600 * 1000
    ? (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    : rangeMs > 5 * 60 * 1000
      ? (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
      : (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return { svg, frame, line, text, path, timeFmt };
}

function linePath(points, fx, fy) { return points.map((p, i) => `${i ? 'L' : 'M'}${fx(p).toFixed(1)},${fy(p).toFixed(1)}`).join(' '); }

/* ------------------------------ V-Port: command vs actual ------------------------------ */
export function createPositionChart(host, { height = 170 } = {}) {
  const c = base(host, height);
  function update(points, { rangeMs = 60 * 60 * 1000, onsetAt = null } = {}) {
    const { W, H, T, B } = c.frame();
    const L = 34, R = 12;
    if (!points || points.length < 2) { c.text(W / 2, H / 2, 'collecting samples…', 'middle'); return; }
    const t1 = points[points.length - 1].t, t0 = t1 - rangeMs;
    const pts = points.filter((p) => p.t >= t0);
    const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - T - B);
    for (let i = 0; i <= 4; i++) { const yy = T + (i / 4) * (H - T - B); c.line(L, yy, W - R, yy, 'rgba(15,23,42,0.08)'); c.text(L - 4, yy + 3, `${100 - i * 25}%`, 'end'); }
    const ft = c.timeFmt(rangeMs);
    for (let i = 0; i <= 4; i++) { const t = t0 + (i / 4) * (t1 - t0); c.text(x(t), H - 7, ft(t), i === 0 ? 'start' : i === 4 ? 'end' : 'middle'); }
    if (pts.length > 1) {
      // shaded gap between command and actual
      const d = linePath(pts, (p) => x(p.t), (p) => y(p.cmd)) + ' ' + [...pts].reverse().map((p) => `L${x(p.t).toFixed(1)},${y(p.act).toFixed(1)}`).join(' ') + ' Z';
      c.path(d, 'none', 0, null, CHART_COLORS.gap);
      c.path(linePath(pts, (p) => x(p.t), (p) => y(p.cmd)), CHART_COLORS.cmd, 2);
      c.path(linePath(pts, (p) => x(p.t), (p) => y(p.act)), CHART_COLORS.act, 2);
      const last = pts[pts.length - 1];
      c.svg.appendChild(svgEl('circle', { cx: x(last.t), cy: y(last.act), r: 3.5, fill: CHART_COLORS.act, stroke: '#fff', 'stroke-width': 1.5 }));
    }
    if (onsetAt && onsetAt >= t0 && onsetAt <= t1) { const xm = x(onsetAt); c.line(xm, T, xm, H - B, 'rgba(220,38,38,0.6)', '3 3'); }
  }
  return { update };
}

/* ------------------------------ Ball valve: open / close response ------------------------------ */
export function createBallResponseChart(host, { height = 170 } = {}) {
  const c = base(host, height);
  function update(points, { windowMs = 40 * 1000, acceptable = 2 } = {}) {
    const { W, H, T, B } = c.frame();
    const L = 46, R = 12;
    if (!points || points.length < 2) { c.text(W / 2, H / 2, 'collecting samples…', 'middle'); return; }
    const t1 = points[points.length - 1].t;
    // Frame the most recent CLOSE stroke (the safety-relevant direction); fall back to the last command change.
    let lastCmdChange = null, lastClose = null;
    for (let i = points.length - 1; i > 0; i--) {
      if (points[i].cmd !== points[i - 1].cmd) { if (!lastCmdChange) lastCmdChange = points[i].t; if (points[i].cmd === 0) { lastClose = points[i].t; break; } }
    }
    const anchor = lastClose ?? lastCmdChange;
    const t0 = anchor ? Math.max(points[0].t, anchor - windowMs * 0.15) : t1 - windowMs;
    const tEnd = anchor ? t0 + windowMs : t1;
    lastCmdChange = anchor;
    const pts = points.filter((p) => p.t >= t0);
    const x = (t) => L + ((t - t0) / Math.max(1, tEnd - t0)) * (W - L - R);
    const y = (v) => T + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - T - B);
    c.line(L, y(100), W - R, y(100), 'rgba(15,23,42,0.08)'); c.line(L, y(0), W - R, y(0), 'rgba(15,23,42,0.08)'); c.line(L, y(50), W - R, y(50), 'rgba(15,23,42,0.05)', '2 3');
    c.text(L - 5, y(100) + 3, 'OPEN', 'end'); c.text(L - 5, y(0) + 3, 'CLOSED', 'end');
    const ft = c.timeFmt(windowMs);
    for (let i = 0; i <= 4; i++) { const t = t0 + (i / 4) * (tEnd - t0); c.text(x(t), H - 7, ft(t), i === 0 ? 'start' : i === 4 ? 'end' : 'middle'); }
    if (pts.length > 1) {
      // command as a step; actual as the physical position; lag shaded
      const step = [];
      for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (i && pts[i - 1].cmd !== p.cmd) step.push({ t: p.t, v: pts[i - 1].cmd }); step.push({ t: p.t, v: p.cmd }); }
      const lagD = linePath(step, (p) => x(p.t), (p) => y(p.v)) + ' ' + [...pts].reverse().map((p) => `L${x(p.t).toFixed(1)},${y(p.pos).toFixed(1)}`).join(' ') + ' Z';
      c.path(lagD, 'none', 0, null, CHART_COLORS.lag);
      c.path(linePath(step, (p) => x(p.t), (p) => y(p.v)), CHART_COLORS.cmd, 2);
      c.path(linePath(pts, (p) => x(p.t), (p) => y(p.pos)), CHART_COLORS.act, 2);
      if (lastCmdChange && lastCmdChange >= t0) {
        const xa = x(lastCmdChange), xe = x(lastCmdChange + acceptable * 1000);
        c.line(xa, T, xa, H - B, 'rgba(37,99,235,0.5)', '3 3');
        c.line(xe, T, xe, H - B, 'rgba(22,163,74,0.5)', '3 3');
        c.text(xe + 3, T + 9, `expected < ${acceptable} s`, 'start', '#16A34A');
      }
    }
  }
  return { update };
}

/* ------------------------------ generic: steam flow ------------------------------ */
export function createFlowChart(host, { height = 170, unit = 'kg/h' } = {}) {
  const c = base(host, height);
  function update(points, { rangeMs = 60 * 60 * 1000, onsetAt = null } = {}) {
    const { W, H, T, B } = c.frame();
    const L = 44, R = 12;
    if (!points || points.length < 2) { c.text(W / 2, H / 2, 'collecting samples…', 'middle'); return; }
    const t1 = points[points.length - 1].t, t0 = t1 - rangeMs;
    const pts = points.filter((p) => p.t >= t0);
    const max = Math.max(1000, ...pts.map((p) => Math.max(p.flow, p.expected))) * 1.1;
    const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - Math.max(0, v) / max) * (H - T - B);
    for (let i = 0; i <= 4; i++) { const yy = T + (i / 4) * (H - T - B); c.line(L, yy, W - R, yy, 'rgba(15,23,42,0.08)'); c.text(L - 4, yy + 3, `${Math.round((max * (1 - i / 4)) / 100) * 100}`, 'end'); }
    c.text(L - 4, H - 7, unit, 'end');
    const ft = c.timeFmt(rangeMs);
    for (let i = 0; i <= 4; i++) { const t = t0 + (i / 4) * (t1 - t0); c.text(x(t), H - 7, ft(t), i === 0 ? 'start' : i === 4 ? 'end' : 'middle'); }
    if (pts.length > 1) {
      c.path(linePath(pts, (p) => x(p.t), (p) => y(p.expected)), CHART_COLORS.expected, 1.5, '5 3');
      c.path(linePath(pts, (p) => x(p.t), (p) => y(p.flow)), CHART_COLORS.flow, 2);
      const last = pts[pts.length - 1];
      c.svg.appendChild(svgEl('circle', { cx: x(last.t), cy: y(last.flow), r: 3.5, fill: CHART_COLORS.flow, stroke: '#fff', 'stroke-width': 1.5 }));
    }
    if (onsetAt && onsetAt >= t0 && onsetAt <= t1) { const xm = x(onsetAt); c.line(xm, T, xm, H - B, 'rgba(220,38,38,0.6)', '3 3'); }
  }
  return { update };
}

/* ------------------------------ generic multi-series chart ------------------------------ */
/**
 * spec: {
 *   rangeMs, left: { unit, min?, max?, fixed? }, right?: { unit, min?, max? },
 *   series: [{ key, color, width?, dash?, axis?: 'left'|'right', step?: boolean }],
 *   refLines?: [{ value, color, label?, axis? }],
 *   shadeBetween?: { a, b, color },                 // band between two left-axis series
 *   shadeWhere?: { key, above, color, label? },     // vertical bands while series > threshold
 *   areaBelowZero?: { key, color },                 // fill the negative part of a series
 *   onsetAt?
 * }
 */
export function createSeriesChart(host, { height = 170 } = {}) {
  const c = base(host, height);
  const fmtNum = (v, unit) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) + (unit ? '' : '');
  function update(points, spec) {
    const { W, H, T, B } = c.frame();
    const L = 46, R = spec.right ? 46 : 12;
    if (!points || points.length < 2) { c.text(W / 2, H / 2, 'collecting samples…', 'middle'); return; }
    const rangeMs = spec.rangeMs || 10 * 60 * 1000;
    const t1 = points[points.length - 1].t, t0 = t1 - rangeMs;
    const pts = points.filter((p) => p.t >= t0);
    if (pts.length < 2) { c.text(W / 2, H / 2, 'collecting samples…', 'middle'); return; }
    const axisRange = (ax, keys, refs) => {
      if (ax.fixed) return [ax.min, ax.max];
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) for (const k of keys) { const v = p[k]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      for (const r of refs) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
      if (ax.min != null) lo = Math.min(lo, ax.min); if (ax.max != null) hi = Math.max(hi, ax.max);
      if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
      const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.02, 0.5);
      return [lo - pad, hi + pad];
    };
    const leftKeys = spec.series.filter((s) => (s.axis || 'left') === 'left').map((s) => s.key);
    const rightKeys = spec.series.filter((s) => s.axis === 'right').map((s) => s.key);
    const [lLo, lHi] = axisRange(spec.left, leftKeys, (spec.refLines || []).filter((r) => (r.axis || 'left') === 'left').map((r) => r.value));
    const [rLo, rHi] = spec.right ? axisRange(spec.right, rightKeys, (spec.refLines || []).filter((r) => r.axis === 'right').map((r) => r.value)) : [0, 1];
    const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const yL = (v) => T + (1 - (v - lLo) / Math.max(1e-9, lHi - lLo)) * (H - T - B);
    const yR = (v) => T + (1 - (v - rLo) / Math.max(1e-9, rHi - rLo)) * (H - T - B);
    const yFor = (s) => (s.axis === 'right' ? yR : yL);
    // grid + axes
    for (let i = 0; i <= 4; i++) {
      const yy = T + (i / 4) * (H - T - B);
      c.line(L, yy, W - R, yy, 'rgba(15,23,42,0.08)');
      c.text(L - 4, yy + 3, fmtNum(lHi - (i / 4) * (lHi - lLo)), 'end');
      if (spec.right) c.text(W - R + 4, yy + 3, fmtNum(rHi - (i / 4) * (rHi - rLo)), 'start');
    }
    c.text(L - 4, H - 7, spec.left.unit, 'end');
    if (spec.right) c.text(W - R + 4, H - 7, spec.right.unit, 'start');
    const ft = c.timeFmt(rangeMs);
    for (let i = 0; i <= 4; i++) { const t = t0 + (i / 4) * (t1 - t0); c.text(x(t), H - 7, ft(t), i === 0 ? 'start' : i === 4 ? 'end' : 'middle'); }
    // shaded bands while a series is above a threshold (e.g. safety valve open)
    if (spec.shadeWhere) {
      const { key, above, color, label } = spec.shadeWhere;
      let start = null, labelled = false;
      for (let i = 0; i <= pts.length; i++) {
        const on = i < pts.length && pts[i][key] > above;
        if (on && start == null) start = pts[i].t;
        if (!on && start != null) {
          const end = i < pts.length ? pts[i].t : t1;
          c.svg.appendChild(svgEl('rect', { x: x(start), y: T, width: Math.max(1, x(end) - x(start)), height: H - T - B, fill: color }));
          if (label && !labelled) { c.text(x(start) + 3, T + 9, label, 'start', '#B45309'); labelled = true; }
          start = null;
        }
      }
    }
    if (spec.shadeBetween) {
      const { a, b, color } = spec.shadeBetween;
      const d = linePath(pts, (p) => x(p.t), (p) => yL(p[a])) + ' ' + [...pts].reverse().map((p) => `L${x(p.t).toFixed(1)},${yL(p[b]).toFixed(1)}`).join(' ') + ' Z';
      c.path(d, 'none', 0, null, color);
    }
    if (spec.areaBelowZero) {
      const { key, color } = spec.areaBelowZero;
      const clipped = pts.map((p) => ({ t: p.t, v: Math.min(0, p[key]) }));
      const d = linePath(clipped, (p) => x(p.t), (p) => yL(p.v)) + ` L${x(t1).toFixed(1)},${yL(0).toFixed(1)} L${x(clipped[0].t).toFixed(1)},${yL(0).toFixed(1)} Z`;
      c.path(d, 'none', 0, null, color);
    }
    for (const r of spec.refLines || []) {
      const y = (r.axis === 'right' ? yR : yL)(r.value);
      c.line(L, y, W - R, y, r.color, r.dash || '5 3', 1.2);
      if (r.label) c.text(L + 4, y - 3, r.label, 'start', r.color);
    }
    for (const s of spec.series) {
      const y = yFor(s);
      let seq = pts;
      if (s.step) { seq = []; for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (i && pts[i - 1][s.key] !== p[s.key]) seq.push({ t: p.t, [s.key]: pts[i - 1][s.key] }); seq.push(p); } }
      c.path(linePath(seq, (p) => x(p.t), (p) => y(p[s.key])), s.color, s.width || 2, s.dash);
      const last = pts[pts.length - 1];
      if (!s.dash) c.svg.appendChild(svgEl('circle', { cx: x(last.t), cy: y(last[s.key]), r: 3.5, fill: s.color, stroke: '#fff', 'stroke-width': 1.5 }));
    }
    if (spec.onsetAt && spec.onsetAt >= t0 && spec.onsetAt <= t1) { const xm = x(spec.onsetAt); c.line(xm, T, xm, H - B, 'rgba(220,38,38,0.6)', '3 3'); }
  }
  return { update };
}

/* ------------------------------ ESD cyclic response test ------------------------------ */
/**
 * points: { t, cmd, pos } (wall clock); test: { startAt, endAt, period, total, cycles: [{ index, delay }] }
 * X axis = seconds since the test started; Y = valve state. Cycles whose delay exceeds
 * `degradeFrom` are shaded and annotated; cycle markers are drawn below the axis.
 */
export function createEsdCycleChart(host, { height = 200 } = {}) {
  const c = base(host, height);
  function update(points, test, { acceptable = 1, degradeFrom = 2 } = {}) {
    const { W, H, T } = c.frame();
    const B = 46, L = 52, R = 12;
    if (!test || !points || points.length < 2) { c.text(W / 2, H / 2, 'no cycle test recorded', 'middle'); return; }
    const t0 = test.startAt, t1 = test.endAt + 6000;
    const pts = points.filter((p) => p.t >= t0 - 1000 && p.t <= t1);
    const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v) => T + 18 + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - T - B - 18);
    // degrading region
    const firstBad = test.cycles.find((cy) => cy.delay > degradeFrom);
    if (firstBad) {
      const xs = x(t0 + (firstBad.index - 1) * 2 * test.period * 1000);
      c.svg.appendChild(svgEl('rect', { x: xs, y: T, width: W - R - xs, height: H - T - B, fill: 'rgba(220,38,38,0.07)' }));
      c.text(W - R - 4, T + 9, 'Increasing response delay (degrading) →', 'end', '#DC2626');
    }
    c.line(L, y(100), W - R, y(100), 'rgba(15,23,42,0.08)'); c.line(L, y(0), W - R, y(0), 'rgba(15,23,42,0.08)');
    c.text(L - 5, y(100) + 3, 'OPEN', 'end'); c.text(L - 5, y(0) + 3, 'CLOSED', 'end');
    // time axis in seconds since test start
    const totalS = (t1 - t0) / 1000, stepS = totalS > 100 ? 10 : 5;
    for (let sec = 0; sec <= totalS; sec += stepS) { const xx = x(t0 + sec * 1000); c.line(xx, y(0), xx, y(0) + 3, 'rgba(15,23,42,0.35)'); c.text(xx, y(0) + 13, String(sec), 'middle'); }
    c.text((L + W - R) / 2, H - 22, 'Time (seconds)', 'middle');
    // cycle markers
    for (const cy of test.cycles) {
      const xs = x(t0 + (cy.index - 1) * 2 * test.period * 1000), xe = x(t0 + cy.index * 2 * test.period * 1000);
      const bad = cy.delay > acceptable;
      c.svg.appendChild(svgEl('rect', { x: xs + 1, y: H - 16, width: Math.max(2, xe - xs - 2), height: 13, rx: 3, fill: bad ? (cy.delay > degradeFrom ? 'rgba(220,38,38,0.12)' : 'rgba(245,158,11,0.16)') : 'rgba(15,23,42,0.05)' }));
      if (xe - xs > 18) c.text((xs + xe) / 2, H - 6, `C${cy.index}`, 'middle', bad ? (cy.delay > degradeFrom ? '#DC2626' : '#B45309') : undefined);
    }
    if (pts.length > 1) {
      const step = [];
      for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (i && pts[i - 1].cmd !== p.cmd) step.push({ t: p.t, v: pts[i - 1].cmd }); step.push({ t: p.t, v: p.cmd }); }
      const lagD = linePath(step, (p) => x(p.t), (p) => y(p.v)) + ' ' + [...pts].reverse().map((p) => `L${x(p.t).toFixed(1)},${y(p.pos).toFixed(1)}`).join(' ') + ' Z';
      c.path(lagD, 'none', 0, null, CHART_COLORS.lag);
      c.path(linePath(step, (p) => x(p.t), (p) => y(p.v)), CHART_COLORS.cmd, 1.8);
      c.path(linePath(pts, (p) => x(p.t), (p) => y(p.pos)), CHART_COLORS.act, 2);
    }
  }
  return { update };
}
