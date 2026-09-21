import { subscribe, setSelection, VPORT_MODES } from '../simulation/simulationState.js';
import { ANOMALY_CATALOG } from '../simulation/anomalyCatalog.js';
import { esdStateText, ballStateText } from '../simulation/anomalyEngine.js';

const ANOMALY_COMPONENTS = ANOMALY_CATALOG;
import { COMPONENTS } from '../components/componentRegistry.js';
import { describeOnOff } from './controlPanel.js';
import { detectionText, detectionReasonHtml, anomalyShortName } from './detection.js';

/**
 * Small information card for the selected component.
 * The DOM is built once per selection; subsequent state updates only patch
 * the value cells so buttons stay stable while the simulation runs.
 */
export function createInfoPanel(container, { onFocus }) {
  container.hidden = true;
  let currentId = null;
  let valueCells = [];
  let stateEl = null;
  let detectEl = null;
  let detectHtml = '';

  function build(def, rows) {
    container.innerHTML = `
      <div class="info-head">
        <div>
          <div class="info-name">${def.label}</div>
          <div class="info-tag mono">${def.tag} · ${def.root}</div>
        </div>
        <button class="btn-icon" id="info-close" title="Close">×</button>
      </div>
      <div class="info-state ok"><span class="dot"></span> <span data-state></span></div>
      <div class="kv">
        ${rows.map(([k]) => `<div><span>${k}</span><b class="mono" data-value></b></div>`).join('')}
      </div>
      ${def.id in ANOMALY_COMPONENTS ? '<div class="detect" data-detect></div>' : ''}
      <div class="row"><button class="btn btn-sm" id="info-focus">FOCUS CAMERA</button></div>
    `;
    container.querySelector('#info-close').onclick = () => setSelection(null);
    container.querySelector('#info-focus').onclick = () => onFocus();
    valueCells = [...container.querySelectorAll('[data-value]')];
    stateEl = container.querySelector('.info-state');
    detectEl = container.querySelector('[data-detect]');
    detectHtml = '';
  }

  subscribe((s) => {
    const id = s.selection.componentId;
    if (!id) {
      if (currentId !== null) { container.hidden = true; currentId = null; }
      return;
    }
    const def = COMPONENTS.find((c) => c.id === id);
    const st = s[def.stateKey];
    const rows = rowsFor(id, s);
    const key = `${id}:${rows.map(([k]) => k).join('|')}`;   // rebuild when the row set changes (V-Port scenarios)
    if (key !== currentId) {
      build(def, rows);
      currentId = key;
      container.hidden = false;
    }
    stateEl.classList.toggle('ok', st.status === 'NORMAL');
    stateEl.classList.toggle('detecting', st.status === 'DETECTING' || st.status === 'WARNING');
    stateEl.classList.toggle('alarm', st.status === 'ANOMALY');
    const own = (s.anomalies || []).find((x) => x.component === id && x.active);
    const stateText = own ? `State: ${st.status} — ${anomalyShortName(own.type)}` : `State: ${st.status}`;
    stateEl.querySelector('[data-state]').textContent = stateText;
    if (detectEl) {
      const html = detectionReasonHtml(s, id);
      if (html !== detectHtml) { detectEl.innerHTML = html; detectHtml = html; }
      const lvl = st.status.toLowerCase();
      detectEl.className = `detect is-${lvl}`;
    }
    rows.forEach(([, v], i) => {
      if (valueCells[i] && valueCells[i].textContent !== v) valueCells[i].textContent = v;
    });
  });
}

function scenarioLabel(mode) {
  return VPORT_MODES.find((m) => m.id === mode)?.label || mode;
}

function rowsFor(id, s) {
  switch (id) {
    case 'ballValve':
      return [
        ['Command', s.ballValve.command === 100 ? 'OPEN' : 'CLOSE'],
        ['Actual State', ballStateText()],
        ['Steam Flow', `${s.steam.flow.toLocaleString()} kg/h`],
        ['Upstream Pressure', `${s.steam.supplyPressure.toFixed(1)} bar`],
      ];
    case 'esdValve':
      return [
        ['Trip Command', s.esdValve.tripped ? 'CLOSE' : 'NONE'],
        ['Actual State', esdStateText()],
        ['Steam Flow', `${s.steam.flow.toLocaleString()} kg/h`],
        ['Solenoid', s.esdValve.tripped ? 'DE-ENERGISED' : 'ENERGISED'],
        ['Instrument Air', `${s.esdValve.sim.airPressure.toFixed(1)} bar`],
      ];
    case 'vPortValve': {
      const v = s.vPortValve;
      const base = [
        ['Scenario', scenarioLabel(v.mode)],
        ['Commanded Position', `${Math.round(v.commandPosition)}%`],
        ['Actual Position', `${Math.round(v.actualPosition)}%`],
      ];
      switch (v.mode) {
        case 'slowResponse':
          base.push(['Response Time', `${v.sim.slowResponse.responseTime.toFixed(0)} s (acceptable ${v.sim.slowResponse.acceptableTime.toFixed(1)} s)`]);
          break;
        case 'hunting':
          base.push(['Oscillation', `±${v.sim.hunting.amplitude.toFixed(0)}% @ ${v.sim.hunting.frequency.toFixed(1)} Hz`]);
          break;
        case 'trimWear':
          base.push(['Trim Health', `${Math.round(v.sim.trimWear.health)}%`], ['Expected Flow', `${v.expectedFlow.toLocaleString()} kg/h`]);
          break;
        default:
          base.push(['Position Error', `${Math.round(v.positionError)}%`]);
      }
      base.push([v.mode === 'trimWear' ? 'Actual Flow' : 'Steam Flow', `${s.steam.flow.toLocaleString()} kg/h`], ['Detection', detectionText(s)]);
      return base;
    }
    case 'safetyValve':
      return [
        ['Set Pressure', `${s.safetyValve.setPressure.toFixed(1)} bar`],
        ['Current Pressure', `${s.safetyValve.sim.linePressure.toFixed(1)} bar`],
        ['Valve State', s.safetyValve.lift > 0.5 ? 'OPEN · venting' : 'CLOSED'],
        ['Relief Flow', `${s.safetyValve.reliefFlow.toLocaleString()} kg/h`],
        ['Openings (3 s)', String(s.safetyValve.sim.openings.length)],
      ];
    case 'steamTrap':
      return [
        ['Inlet Temperature', `${Math.round(s.steamTrap.sim.inletTemp)} °C`],
        ['Outlet Temperature', `${Math.round(s.steamTrap.sim.outletTemp)} °C`],
        ['ΔT', `${Math.round(s.steamTrap.sim.inletTemp - s.steamTrap.sim.outletTemp)} °C`],
        ['Trap Pressure', `${s.steamTrap.sim.pressure.toFixed(1)} bar`],
        ['Discharge', `${s.condensate.flow.toLocaleString()} kg/h`],
      ];
    case 'checkValve':
      return [
        ['Upstream Pressure', `${s.checkValve.sim.upstreamPressure.toFixed(1)} bar`],
        ['Downstream Pressure', `${s.checkValve.sim.downstreamPressure.toFixed(1)} bar`],
        ['Disc Lift', `${Math.round(s.checkValve.lift * 100)}%`],
        ['Flow', `${Math.abs(s.condensate.flow).toLocaleString()} kg/h ${s.condensate.direction < 0 ? '(REVERSE)' : ''}`.trim()],
      ];
    case 'rotaryJoint':
      return [
        ['Steam Inlet Flow', `${s.steam.flow.toLocaleString()} kg/h`],
        ['Seal Temp', `${s.rotaryJoint.sealTemp} °C`],
        ['Yankee Speed', `${s.yankee.speedRpm.toFixed(1)} rpm`],
        ['Housing', 'STATIONARY · collar rotating'],
      ];
    case 'separator':
      return [
        ['Level', `${s.separator.level}%`],
        ['Pressure', `${s.separator.pressure.toFixed(1)} bar`],
        ['Condensate Out', `${s.condensate.flow.toLocaleString()} kg/h`],
        ['Blow-through', `${s.separator.blowThrough.toLocaleString()} kg/h`],
      ];
    case 'yankee':
      return [
        ['Running', s.yankee.running ? 'YES' : 'NO'],
        ['Speed', `${s.yankee.speedRpm.toFixed(1)} rpm`],
        ['Paper Speed', `${s.paper.speedMpm.toFixed(1)} m/min`],
        ['Shell Temp', `${s.yankee.surfaceTemp} °C`],
      ];
    default:
      return [];
  }
}
