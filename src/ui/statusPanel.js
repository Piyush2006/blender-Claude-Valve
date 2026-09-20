import { subscribe, setSelection } from '../simulation/simulationState.js';
import { COMPONENTS } from '../components/componentRegistry.js';
import { describeOnOff } from './controlPanel.js';
import { ballStateText, esdStateText } from '../simulation/anomalyEngine.js';

/** Component status list (right panel). Green = NORMAL, red = anomaly. */
export function createStatusPanel(container) {
  const shown = COMPONENTS.filter((c) => c.id !== 'yankee');
  container.innerHTML = `
    <div class="panel-title">Component Status</div>
    <ul class="status-list">
      ${shown.map((c) => `
        <li class="status-item" data-id="${c.id}">
          <span class="dot"></span>
          <span class="name">${c.label}</span>
          <span class="state mono" data-state></span>
          <span class="extra mono" data-extra></span>
        </li>`).join('')}
    </ul>
    <div class="panel-title">Process Values</div>
    <div class="kpis">
      <div class="kpi"><span>Steam Pressure</span><b id="kpi-p" class="mono"></b></div>
      <div class="kpi"><span>Steam Temp</span><b id="kpi-t" class="mono"></b></div>
      <div class="kpi"><span>Steam Flow</span><b id="kpi-f" class="mono"></b></div>
      <div class="kpi"><span>Yankee Speed</span><b id="kpi-y" class="mono"></b></div>
    </div>
  `;

  container.querySelectorAll('.status-item').forEach((li) => {
    li.addEventListener('click', () => setSelection(li.dataset.id));
  });

  subscribe((s) => {
    for (const li of container.querySelectorAll('.status-item')) {
      const def = COMPONENTS.find((c) => c.id === li.dataset.id);
      const st = s[def.stateKey];
      li.classList.toggle('is-alarm', st.status === 'ANOMALY');
      li.classList.toggle('is-detecting', st.status === 'DETECTING' || st.status === 'WARNING');
      li.classList.toggle('is-selected', s.selection.componentId === def.id);
      li.querySelector('[data-state]').textContent = st.status;
      li.querySelector('[data-extra]').textContent = extraFor(def.id, s);
    }
    container.querySelector('#kpi-p').textContent = `${s.steam.pressure.toFixed(1)} bar`;
    container.querySelector('#kpi-t').textContent = `${s.steam.temperature} °C`;
    container.querySelector('#kpi-f').textContent = `${s.steam.flow.toLocaleString()} kg/h`;
    container.querySelector('#kpi-y').textContent = `${s.yankee.speedRpm.toFixed(1)} rpm`;
  });
}

function extraFor(id, s) {
  switch (id) {
    case 'ballValve': return ballStateText();
    case 'esdValve': return s.esdValve.tripped ? (s.esdValve.position <= 0.5 ? 'TRIPPED' : `TRIP · ${esdStateText()}`) : describeOnOff(s.esdValve.position, s.esdValve.command);
    case 'vPortValve': return `${Math.round(s.vPortValve.commandPosition)}→${Math.round(s.vPortValve.actualPosition)}%`;
    case 'safetyValve': return s.safetyValve.lift > 0.5 ? 'OPEN' : 'SEATED';
    case 'steamTrap': return `ΔT ${Math.round(s.steamTrap.sim.inletTemp - s.steamTrap.sim.outletTemp)} °C`;
    case 'checkValve': return s.condensate.direction < 0 ? 'REVERSE' : s.checkValve.lift > 0.05 ? 'FLOWING' : 'SEATED';
    case 'rotaryJoint': return `${s.rotaryJoint.sealTemp} °C`;
    case 'separator': return `${s.separator.level}%`;
    default: return '';
  }
}
