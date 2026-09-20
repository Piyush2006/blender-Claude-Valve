/**
 * Compact SVG charts for the anomaly detail panel (no dependencies):
 *
 *   createPositionChart     — V-Port commanded vs actual position (%), the gap shaded red
 *   createBallResponseChart — Ball valve OPEN/CLOSE command step vs actual state, lag shaded amber
 *   createFlowChart         — steam flow vs expected (generic components)
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
