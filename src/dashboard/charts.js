/** Tiny dependency-free SVG charts for the dashboard (sparklines + trend panels). */

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function pathFor(points, x0, y0, w, h, min, max) {
  if (!points.length) return '';
  const n = points.length;
  const span = max - min || 1;
  const t0 = points[0].t, t1 = points[n - 1].t, ts = Math.max(1, t1 - t0);
  return points.map((p, i) => {
    const x = x0 + (p.t != null && n > 1 ? (p.t - t0) / ts : i / Math.max(1, n - 1)) * w;
    const y = y0 + h - ((p.v - min) / span) * h;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

/** Sparkline with soft area fill; colour follows the trend direction. */
export function createSparkline(container, { width = 200, height = 36 } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'spark', preserveAspectRatio: 'none' });
  const area = el('path', { class: 'spark-area' });
  const line = el('path', { class: 'spark-line' });
  svg.append(area, line);
  container.appendChild(svg);
  return {
    update(points, tone = 'ok') {
      const tail = points.slice(-40);
      let min = Infinity, max = -Infinity;
      for (const p of tail) { min = Math.min(min, p.v); max = Math.max(max, p.v); }
      const pad = (max - min) * 0.25 || 1;
      const d = pathFor(tail, 2, 4, width - 4, height - 8, min - pad, max + pad);
      line.setAttribute('d', d);
      area.setAttribute('d', d ? `${d} L${width - 2},${height} L2,${height} Z` : '');
      svg.dataset.tone = tone;
    },
  };
}

/** Compact trend chart with y-axis labels, x time labels and an optional target line. */
export function createTrendChart(container, { unit, fixed = 0, width = 300, height = 120 } = {}) {
  const padL = 40, padR = 8, padT = 10, padB = 18;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'trend' });
  const grid = el('g', { class: 'trend-grid' });
  const yLabels = el('g', { class: 'trend-ylabels' });
  const xLabels = el('g', { class: 'trend-xlabels' });
  const area = el('path', { class: 'trend-area' });
  const line = el('path', { class: 'trend-line' });
  const targetLine = el('line', { class: 'trend-target', x1: padL, x2: width - padR });
  const targetText = el('text', { class: 'trend-target-label', x: width - padR, 'text-anchor': 'end' });
  const dot = el('circle', { class: 'trend-dot', r: 3 });
  const markerG = el('g', { class: 'trend-markers' });
  svg.append(grid, yLabels, area, line, targetLine, targetText, markerG, dot, xLabels);
  container.appendChild(svg);
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

  return {
    /** opts: { target, markers: [{t, label, tone}], windowMs } */
    update(points, tone = 'ok', opts = {}) {
      if (!points.length) return;
      const target = opts.target ?? null;
      let min = Infinity, max = -Infinity;
      for (const p of points) { min = Math.min(min, p.v); max = Math.max(max, p.v); }
      if (target != null) { min = Math.min(min, target); max = Math.max(max, target); }
      const pad = (max - min) * 0.3 || 1;
      min -= pad; max += pad;
      const w = width - padL - padR, h = height - padT - padB;
      const d = pathFor(points, padL, padT, w, h, min, max);
      line.setAttribute('d', d);
      area.setAttribute('d', `${d} L${width - padR},${padT + h} L${padL},${padT + h} Z`);
      svg.dataset.tone = tone;

      grid.replaceChildren(); yLabels.replaceChildren();
      for (let i = 0; i <= 3; i++) {
        const y = padT + (i / 3) * h;
        grid.appendChild(el('line', { x1: padL, x2: width - padR, y1: y, y2: y }));
        const val = max - (i / 3) * (max - min);
        const t = el('text', { x: padL - 5, y: y + 3, 'text-anchor': 'end' });
        t.textContent = Number(val.toFixed(fixed)).toLocaleString('en-US');
        yLabels.appendChild(t);
      }
      xLabels.replaceChildren();
      const first = points[0].t, last = points[points.length - 1].t;
      [[padL, first, 'start'], [padL + w / 2, (first + last) / 2, 'middle'], [width - padR, last, 'end']].forEach(([x, t, anchor]) => {
        const lbl = el('text', { x, y: height - 4, 'text-anchor': anchor });
        lbl.textContent = timeFmt.format(new Date(t));
        xLabels.appendChild(lbl);
      });
      if (target != null) {
        const y = padT + h - ((target - min) / (max - min)) * h;
        targetLine.setAttribute('y1', y); targetLine.setAttribute('y2', y);
        targetText.setAttribute('y', y - 3);
        targetText.textContent = `Target: ${Number(target.toFixed(fixed)).toLocaleString('en-US')} ${unit}`;
      } else {
        targetLine.setAttribute('y1', -10); targetLine.setAttribute('y2', -10); targetText.textContent = '';
      }
      const lastP = points[points.length - 1];
      dot.setAttribute('cx', width - padR);
      dot.setAttribute('cy', padT + h - ((lastP.v - min) / (max - min)) * h);

      // Event markers: vertical rule + label at the time of a simulated event (explains changes in the line).
      markerG.replaceChildren();
      const span = Math.max(1, last - first);
      for (const mk of opts.markers || []) {
        if (mk.t < first || mk.t > last) continue;
        const x = padL + ((mk.t - first) / span) * w;
        markerG.appendChild(el('line', { class: `marker-line tone-${mk.tone}`, x1: x, x2: x, y1: padT, y2: padT + h }));
        const lbl = el('text', { class: `marker-label tone-${mk.tone}`, x: x + 3, y: padT + 9, 'text-anchor': x > width - 90 ? 'end' : 'start' });
        if (x > width - 90) lbl.setAttribute('x', x - 3);
        lbl.textContent = `${timeFmt.format(new Date(mk.t))} ${mk.label}`;
        markerG.appendChild(lbl);
      }
    },
  };
}

/** Horizontal progress bar used for Command / Actual position and trim health. */
export function createBar(container, tone = 'accent') {
  const wrap = document.createElement('div');
  wrap.className = `bar-track tone-${tone}`;
  const fill = document.createElement('div');
  fill.className = 'bar-fill';
  wrap.appendChild(fill);
  container.appendChild(wrap);
  return {
    update(percent, newTone) {
      fill.style.transform = `scaleX(${Math.max(0, Math.min(1, percent / 100)).toFixed(3)})`;
      if (newTone) wrap.className = `bar-track tone-${newTone}`;
    },
  };
}
