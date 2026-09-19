import { anomalyByType, ANOMALY_CATALOG } from '../simulation/anomalyCatalog.js';

/** Shared formatting for anomaly detection state (all components / scenarios). */

export function anomalyShortName(type) {
  return anomalyByType(type)?.short || 'ANOMALY';
}

export function anomalyComponentLabel(type) {
  return anomalyByType(type)?.componentLabel || '';
}

export function detectionText(s) {
  const a = s.anomaly;
  switch (a.status) {
    case 'DETECTING':
      return `DETECTING · ${a.persistenceTime.toFixed(1)} / ${a.persistenceRequired.toFixed(1)} s`;
    case 'WARNING':
      return `WARNING · ${anomalyShortName(a.type)}`;
    case 'ANOMALY':
      return `ANOMALY · ${anomalyShortName(a.type)}`;
    default:
      return 'NORMAL';
  }
}

/** Multi-line, transparent explanation of the active detection rule (info card). */
export function detectionReasonHtml(s, componentId) {
  const v = s.vPortValve, a = s.anomaly, sim = s.anomalySim;
  const lines = [];
  const rule = (txt) => lines.push(`<div class="mono">${txt}</div>`);
  const flagged = sim.component === componentId;
  const scenario = ANOMALY_CATALOG[sim.component]?.anomalies.find((x) => x.id === sim.anomaly);

  if (!flagged) {
    return `<div class="detect-title">Detection</div><div class="muted">No anomaly simulated on this component</div>`;
  }
  rule(`Scenario: ${scenario?.label || 'Normal'}`);

  if (sim.component === 'vPortValve') {
    const c = Math.round(v.commandPosition), act = Math.round(v.actualPosition), e = Math.round(v.positionError);
    switch (v.mode) {
      case 'sticking':
        rule(`|${c} − ${act}| = ${e}% ${e > a.threshold ? '&gt;' : '≤'} ${a.threshold}%`);
        rule(`movement ${Math.abs(v.actualVelocity).toFixed(1)} %/s (limit 1.0)`);
        break;
      case 'slowResponse': {
        const sr = v.sim.slowResponse;
        rule(`response time ${sr.responseTime.toFixed(0)} s / stroke`);
        rule(sr.moving ? `moving for ${sr.moveElapsed.toFixed(1)} s` : sr.lastMoveDuration ? `last move took ${sr.lastMoveDuration.toFixed(1)} s` : 'valve at command');
        rule(`acceptable ${sr.acceptableTime.toFixed(1)} s`);
        break;
      }
      case 'hunting':
        rule(a.detail || 'measuring…');
        rule('limits: swing &gt; 4% · ≥ 3 crossings / 3 s');
        break;
      case 'trimWear':
        rule(`expected ${v.expectedFlow.toLocaleString()} kg/h`);
        rule(`actual ${s.steam.flow.toLocaleString()} kg/h`);
        rule(`${a.detail} (limit +10%)`);
        break;
      default:
        rule('|Commanded − Actual|');
        rule(`|${c} − ${act}| = ${e}%`);
        rule(`Allowed error = ${a.threshold}%`);
        if (a.status !== 'NORMAL') rule(`${e}% &gt; ${a.threshold}%`);
    }
  } else {
    rule(a.detail || '—');
  }

  if (a.status === 'NORMAL') {
    return `<div class="detect-title">Detection</div>${lines.join('')}<div class="muted">No anomaly</div>`;
  }
  rule(`Persisted ${a.persistenceTime.toFixed(1)} / ${a.persistenceRequired.toFixed(1)} s`);
  const result = a.status === 'DETECTING' ? '→ waiting for persistence…' : `→ ${anomalyShortName(a.type)} DETECTED`;
  return `<div class="detect-title">Detection</div>${lines.join('')}<div class="detect-result">${result}</div>`;
}
