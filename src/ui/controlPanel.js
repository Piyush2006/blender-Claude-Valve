import {
  simulationState as S, subscribe,
  setBallValveCommand, setEsdValveCommand, setVPortCommand, setVPortActual,
  setVPortStuck, setVPortSimParam, setAnomalyScenario, resetAnomalySimulation, setComponentSimParam,
  setSafetyValveSetPressure, setYankeeRunning, setXrayValves,
} from '../simulation/simulationState.js';
import { ANOMALY_CATALOG, COMPONENT_ORDER, anomalyDef } from '../simulation/anomalyCatalog.js';
import { detectionText, anomalyShortName } from './detection.js';
import { esdStateText, ballStateText } from '../simulation/anomalyEngine.js';
import { fmt, UNITS } from '../simulation/units.js';

/**
 * Left panel with two tabs sharing the one simulationState:
 *   CONTROLS            — operate the plant (ball / ESD / V-Port command / PSV set pressure / Yankee / view)
 *   ANOMALY SIMULATION  — create and test fault conditions (component → anomaly → relevant controls)
 * Switching tabs only shows/hides DOM; nothing in the simulation is touched.
 */
export function createControlPanel(container, { cameraRig, onValveXray }) {
  container.innerHTML = `
    <div class="panel-title">Control Panel</div>
    <div class="ptabs" role="tablist">
      <button class="ptab" data-tab="controls" role="tab">CONTROLS</button>
      <button class="ptab" data-tab="anomaly" role="tab">ANOMALY SIMULATION</button>
    </div>

    <!-- ============================== TAB 1 — CONTROLS ============================== -->
    <div data-tab-panel="controls">
      <div class="tab-head">
        <div><h2>CONTROLS</h2><p>Operate the plant</p></div>
        <span class="mode-pill is-ok"><i class="dot"></i>SYSTEM READY</span>
      </div>

      <section class="ctl">
        <h3>Ball Valve <span class="mono" id="ball-pos"></span></h3>
        <div class="row">
          <button id="ball-open" class="btn">OPEN BALL</button>
          <button id="ball-close" class="btn btn-warn">CLOSE BALL</button>
        </div>
      </section>

      <section class="ctl">
        <h3>ESD Valve <span class="mono" id="esd-pos"></span></h3>
        <div class="row">
          <button id="esd-open" class="btn">OPEN ESD</button>
          <button id="esd-trip" class="btn btn-danger">TRIGGER ESD</button>
        </div>
      </section>

      <section class="ctl">
        <h3>V-Port Control Valve <span class="mono" id="ctl-vport-act"></span></h3>
        <p class="desc">Controls steam flow to Yankee dryer</p>
        <label class="slider-label">Commanded Position <b class="mono" id="ctl-vport-cmd-val"></b>
          <input id="ctl-vport-slider" type="range" min="0" max="100" step="1" />
        </label>
        <div class="scale"><span>0%</span><span>100%</span></div>
        <div class="row presets">
          ${[0, 25, 50, 75, 100].map((p) => `<button class="btn btn-sm" data-vport="${p}">${p}%</button>`).join('')}
        </div>
      </section>

      <section class="ctl">
        <h3>Safety / Relief Valve <span class="mono" id="ctl-psv-state"></span></h3>
        <p class="desc">Pressure protection device</p>
        <label class="slider-label">Set Pressure <b class="mono" id="ctl-psv-set-val"></b>
          <input id="ctl-psv-set" type="range" min="5" max="20" step="0.1" />
        </label>
        <div class="scale"><span>${fmt.pressure(5)}</span><span>${fmt.pressure(20)}</span></div>
      </section>

      <section class="ctl">
        <h3>Yankee Dryer <span class="mono" id="yankee-rpm"></span></h3>
        <p class="desc">Current speed</p>
        <div class="row">
          <button id="yankee-start" class="btn">START DRYER</button>
          <button id="yankee-stop" class="btn btn-warn">STOP DRYER</button>
        </div>
      </section>

      <section class="ctl">
        <h3>View</h3>
        <div class="row">
          <button id="view-reset" class="btn">RESET VIEW</button>
          <button id="view-overview" class="btn">OVERVIEW</button>
        </div>
        <div class="row toggles">
          <label class="toggle"><input id="xray-valves" type="checkbox" /> <span>Show valve internals</span></label>
        </div>
        <p class="hint">Orbit: left-drag · Pan: right-drag / shift+drag · Zoom: wheel · Click a component for details</p>
      </section>

      <p class="tab-note">ℹ Use this tab to control and operate the steam system. For fault simulation, switch to the <b>Anomaly Simulation</b> tab.</p>
    </div>

    <!-- ========================= TAB 2 — ANOMALY SIMULATION ========================= -->
    <div data-tab-panel="anomaly">
      <div class="tab-head">
        <div><h2>ANOMALY SIMULATION</h2><p>Create and test fault conditions</p></div>
        <span class="mode-pill is-sim"><i class="dot"></i>SIMULATION MODE</span>
      </div>

      <section class="ctl ctl-vport">
        <label class="field-label">Component
          <select id="anom-component" class="select">
            ${COMPONENT_ORDER.map((id) => `<option value="${id}">${ANOMALY_CATALOG[id].label}</option>`).join('')}
          </select>
        </label>
        <label class="field-label">Anomaly
          <select id="vport-mode" class="select"></select>
        </label>
        <div class="vp-divider"></div>

        <!-- V-Port Control Valve (existing scenario controls) -->
        <div data-comp="vPortValve">
          <label class="slider-label" data-modes="trimWear">Trim Health <b class="mono" id="vport-health-val"></b>
            <input id="vport-health" type="range" min="0" max="100" step="1" />
          </label>
          <div class="kv" data-modes="trimWear"><div><span>Wear Level</span><b id="vport-wear" class="mono"></b></div></div>

          <label class="slider-label">Commanded Position <b class="mono" id="vport-cmd-val"></b>
            <input id="vport-slider" type="range" min="0" max="100" step="1" />
          </label>

          <label class="slider-label" data-modes="positionMismatch sticking">Actual Position <b class="mono" id="vport-act-val"></b>
            <input id="vport-actual" type="range" min="0" max="100" step="1" />
          </label>
          <div class="row" data-modes="sticking">
            <button id="vport-stick" class="btn btn-sm btn-warn">SIMULATE STUCK</button>
            <button id="vport-release" class="btn btn-sm">RELEASE VALVE</button>
          </div>

          <label class="slider-label" data-modes="slowResponse">Response Time <b class="mono" id="vport-rt-val"></b>
            <input id="vport-rt" type="range" min="1" max="20" step="1" />
          </label>
          <label class="slider-label" data-modes="slowResponse">Acceptable Response <b class="mono" id="vport-acc-val"></b>
            <input id="vport-acc" type="range" min="1" max="10" step="0.5" />
          </label>

          <label class="slider-label" data-modes="hunting">Oscillation Amplitude <b class="mono" id="vport-amp-val"></b>
            <input id="vport-amp" type="range" min="0" max="20" step="1" />
          </label>
          <label class="slider-label" data-modes="hunting">Oscillation Frequency <b class="mono" id="vport-freq-val"></b>
            <input id="vport-freq" type="range" min="0.1" max="2" step="0.1" />
          </label>

          <div class="kv">
            <div data-modes="normal slowResponse hunting trimWear"><span>Actual Position</span><b id="vport-act-ro" class="mono"></b></div>
            <div data-modes="normal positionMismatch slowResponse hunting"><span>Position Error</span><b id="vport-err" class="mono"></b></div>
            <div data-modes="sticking"><span>Sticking Status</span><b id="vport-stick-status" class="mono"></b></div>
            <div data-modes="trimWear"><span>Expected Flow</span><b id="vport-expected" class="mono"></b></div>
            <div><span id="vport-flow-label">Steam Flow</span><b id="vport-flow" class="mono"></b></div>
          </div>
        </div>

        <!-- ESD Valve -->
        <div data-comp="esdValve">
          <div class="kv"><div><span>Trip Command</span><b id="esd-trip-cmd" class="mono"></b></div></div>
          <div class="row">
            <button id="anom-esd-trip" class="btn btn-sm btn-danger">TRIP (CLOSE)</button>
            <button id="anom-esd-open" class="btn btn-sm">RESET (OPEN)</button>
          </div>
          <label class="slider-label" data-anom="slowShutdown">Shutdown Time <b class="mono" id="esd-st-val"></b>
            <input id="esd-st" type="range" min="1" max="20" step="1" data-sim="esdValve:shutdownTime" />
          </label>
          <label class="slider-label" data-anom="slowShutdown">Acceptable Shutdown <b class="mono" id="esd-acc-val"></b>
            <input id="esd-acc" type="range" min="1" max="10" step="0.5" data-sim="esdValve:acceptableTime" />
          </label>
          <label class="slider-label" data-anom="partialClosure">Stops At <b class="mono" id="esd-partial-val"></b>
            <input id="esd-partial" type="range" min="5" max="80" step="5" data-sim="esdValve:partialOpen" />
          </label>
          <label class="slider-label" data-anom="lowAirPressure">Air Pressure <b class="mono" id="esd-air-val"></b>
            <input id="esd-air" type="range" min="0" max="7" step="0.1" data-sim="esdValve:airPressure" />
          </label>
          <div class="kv">
            <div data-anom="lowAirPressure"><span>Minimum Required</span><b id="esd-minair" class="mono"></b></div>
            <div><span>Actual State</span><b id="esd-state" class="mono"></b></div>
            <div><span>Steam Flow</span><b id="esd-flow" class="mono"></b></div>
          </div>
        </div>

        <!-- Ball Valve -->
        <div data-comp="ballValve">
          <div class="kv"><div><span>Command</span><b id="ball-cmd" class="mono"></b></div></div>
          <div class="row">
            <button id="anom-ball-open" class="btn btn-sm">COMMAND OPEN</button>
            <button id="anom-ball-close" class="btn btn-sm btn-warn">COMMAND CLOSE</button>
          </div>
          <label class="slider-label" data-anom="slowOperation">Operation Time <b class="mono" id="ball-ot-val"></b>
            <input id="ball-ot" type="range" min="2" max="30" step="1" data-sim="ballValve:operationTime" />
          </label>
          <label class="slider-label" data-anom="slowOperation">Acceptable Operation <b class="mono" id="ball-acc-val"></b>
            <input id="ball-acc" type="range" min="1" max="15" step="1" data-sim="ballValve:acceptableTime" />
          </label>
          <label class="slider-label" data-anom="passing">Leakage Flow <b class="mono" id="ball-leak-val"></b>
            <input id="ball-leak" type="range" min="0" max="1000" step="10" data-sim="ballValve:leakage" />
          </label>
          <div class="kv">
            <div><span>Actual State</span><b id="ball-state" class="mono"></b></div>
            <div data-anom="passing"><span>Expected Flow</span><b class="mono">${fmt.flow(0)}</b></div>
            <div><span id="ball-flow-label">Steam Flow</span><b id="ball-flow" class="mono"></b></div>
          </div>
        </div>

        <!-- Safety / Relief Valve (pressure-driven; set pressure comes from the Controls tab) -->
        <div data-comp="safetyValve">
          <div class="kv">
            <div><span>Set Pressure</span><b id="psv-set" class="mono"></b></div>
            <div><span>Current Pressure</span><b id="psv-cur" class="mono"></b></div>
            <div><span>Valve State</span><b id="psv-state" class="mono"></b></div>
            <div><span>Relief Flow</span><b id="psv-relief" class="mono"></b></div>
            <div data-anom="chattering pressureRelief"><span>Opening Count</span><b id="psv-count" class="mono"></b></div>
          </div>
        </div>

        <!-- Steam Trap -->
        <div data-comp="steamTrap">
          <div class="kv">
            <div><span>Inlet Temperature</span><b id="trap-in" class="mono"></b></div>
            <div><span>Outlet Temperature</span><b id="trap-out" class="mono"></b></div>
            <div><span>Temperature Difference</span><b id="trap-dt" class="mono"></b></div>
            <div><span>Trap Pressure</span><b id="trap-p" class="mono"></b></div>
            <div><span>Discharge</span><b id="trap-disc" class="mono"></b></div>
            <div><span>Condition</span><b id="trap-cond" class="mono"></b></div>
          </div>
        </div>

        <!-- Check Valve -->
        <div data-comp="checkValve">
          <div class="kv">
            <div><span>Upstream Pressure</span><b id="cv-up" class="mono"></b></div>
            <div><span>Downstream Pressure</span><b id="cv-down" class="mono"></b></div>
            <div><span>Pressure Differential</span><b id="cv-dp" class="mono"></b></div>
            <div><span>Disc</span><b id="cv-disc" class="mono"></b></div>
            <div><span>Flow</span><b id="cv-flow" class="mono"></b></div>
            <div><span>Direction</span><b id="cv-dir" class="mono"></b></div>
          </div>
        </div>

        <div class="anom-msg" id="anom-msg" hidden>
          <div class="anom-msg-text" id="anom-msg-text"></div>
          <div class="anom-msg-status" id="anom-msg-status"></div>
        </div>
        <div class="kv"><div><span>Status</span><b id="vport-detect" class="mono"></b></div></div>
      </section>

      <section class="ctl">
        <h3>Live System Impact <span class="chip" id="vport-chip"></span></h3>
        <div class="kv impact">
          <div><span>Steam Pressure</span><b id="imp-pressure" class="mono"></b></div>
          <div><span>Steam Flow to Yankee</span><b id="imp-flow" class="mono"></b></div>
          <div><span>Yankee Surface Temperature</span><b id="imp-temp" class="mono"></b></div>
          <div><span>Paper Moisture</span><b id="imp-moisture" class="mono"></b></div>
        </div>
      </section>

      <div class="row"><button id="vport-reset" class="btn btn-sm btn-danger">RESET SIMULATION</button></div>
      <p class="tab-note">This is a simulation for demonstration. It does not represent a certified safety-valve or process calculation.</p>
    </div>
  `;

  const $ = (id) => container.querySelector(`#${id}`);

  // --- Tabs (pure show/hide; the simulation is never touched) ---------------------------
  const tabs = [...container.querySelectorAll('.ptab')];
  const tabPanels = [...container.querySelectorAll('[data-tab-panel]')];
  let currentTab = 'controls';
  try { currentTab = localStorage.getItem('twin.panelTab') || 'controls'; } catch { /* ignore */ }
  function showTab(name) {
    currentTab = name;
    for (const t of tabs) { t.classList.toggle('is-active', t.dataset.tab === name); t.setAttribute('aria-selected', String(t.dataset.tab === name)); }
    for (const p of tabPanels) p.hidden = p.dataset.tabPanel !== name;
    try { localStorage.setItem('twin.panelTab', name); } catch { /* ignore */ }
  }
  for (const t of tabs) t.addEventListener('click', () => showTab(t.dataset.tab));
  showTab(currentTab);

  // --- Controls tab -------------------------------------------------------------------------
  $('ball-open').onclick = () => setBallValveCommand(true);
  $('ball-close').onclick = () => setBallValveCommand(false);
  $('esd-open').onclick = () => setEsdValveCommand(true);
  $('esd-trip').onclick = () => setEsdValveCommand(false);
  $('yankee-start').onclick = () => setYankeeRunning(true);
  $('yankee-stop').onclick = () => setYankeeRunning(false);
  $('view-reset').onclick = () => cameraRig.reset();
  $('view-overview').onclick = () => cameraRig.overview();
  const ctlSlider = $('ctl-vport-slider');
  ctlSlider.value = S.vPortValve.commandPosition;
  ctlSlider.addEventListener('input', () => setVPortCommand(ctlSlider.value));
  container.querySelectorAll('[data-vport]').forEach((b) => { b.onclick = () => setVPortCommand(b.dataset.vport); });
  const psvSet = $('ctl-psv-set');
  psvSet.value = S.safetyValve.setPressure;
  psvSet.addEventListener('input', () => setSafetyValveSetPressure(psvSet.value));
  const xrayValves = $('xray-valves');
  xrayValves.checked = S.view.xrayValves;
  xrayValves.addEventListener('change', () => { setXrayValves(xrayValves.checked); onValveXray(xrayValves.checked); });

  // --- Anomaly tab: selectors + scenario inputs (all write into the one central state) ----
  const compSel = $('anom-component');
  const anomSel = $('vport-mode');
  function fillAnomalies(component, selected) {
    anomSel.innerHTML = ANOMALY_CATALOG[component].anomalies.map((a) => `<option value="${a.id}">${a.label}</option>`).join('');
    anomSel.value = selected;
  }
  compSel.value = S.anomalySim.component;
  fillAnomalies(S.anomalySim.component, S.anomalySim.anomaly);
  compSel.addEventListener('change', () => setAnomalyScenario(compSel.value, 'normal'));
  anomSel.addEventListener('change', () => setAnomalyScenario(compSel.value, anomSel.value));
  $('vport-reset').onclick = () => resetAnomalySimulation();

  const slider = $('vport-slider');
  slider.value = S.vPortValve.commandPosition;
  slider.addEventListener('input', () => setVPortCommand(slider.value));
  const actual = $('vport-actual');
  actual.value = S.vPortValve.actualPosition;
  actual.addEventListener('input', () => setVPortActual(actual.value));
  $('vport-stick').onclick = () => setVPortStuck(true);
  $('vport-release').onclick = () => setVPortStuck(false);
  const bindParam = (id, mode, key) => {
    const el = $(id);
    el.value = S.vPortValve.sim[mode][key];
    el.addEventListener('input', () => setVPortSimParam(mode, key, el.value));
    return el;
  };
  const health = bindParam('vport-health', 'trimWear', 'health');
  const rt = bindParam('vport-rt', 'slowResponse', 'responseTime');
  const acc = bindParam('vport-acc', 'slowResponse', 'acceptableTime');
  const amp = bindParam('vport-amp', 'hunting', 'amplitude');
  const freq = bindParam('vport-freq', 'hunting', 'frequency');
  const simInputs = [...container.querySelectorAll('[data-sim]')].map((el) => {
    const [component, key] = el.dataset.sim.split(':');
    el.value = S[component].sim[key];
    el.addEventListener('input', () => setComponentSimParam(component, key, el.value));
    return { el, component, key };
  });
  $('anom-esd-trip').onclick = () => setEsdValveCommand(false);
  $('anom-esd-open').onclick = () => setEsdValveCommand(true);
  $('anom-ball-open').onclick = () => setBallValveCommand(true);
  $('anom-ball-close').onclick = () => setBallValveCommand(false);

  // Visibility of scenario-specific rows.
  const compBlocks = [...container.querySelectorAll('[data-comp]')];
  const modeRows = [...container.querySelectorAll('[data-modes]')];
  const anomRows = [...container.querySelectorAll('[data-anom]')];
  let shownKey = null;
  let filledFor = S.anomalySim.component;
  function applyVisibility(component, anomaly) {
    const key = `${component}:${anomaly}`;
    if (key === shownKey) return;
    shownKey = key;
    if (compSel.value !== component) compSel.value = component;
    if (filledFor !== component) { fillAnomalies(component, anomaly); filledFor = component; }
    if (anomSel.value !== anomaly) anomSel.value = anomaly;
    for (const el of compBlocks) el.hidden = el.dataset.comp !== component;
    for (const el of modeRows) el.hidden = !el.dataset.modes.split(' ').includes(anomaly);
    for (const el of anomRows) el.hidden = !el.dataset.anom.split(' ').includes(anomaly);
    $('vport-flow-label').textContent = anomaly === 'trimWear' ? 'Actual Flow' : 'Steam Flow';
    $('ball-flow-label').textContent = anomaly === 'passing' ? 'Leakage Flow' : 'Steam Flow';
  }

  const $$ = {};
  for (const el of container.querySelectorAll('[id]')) $$[el.id] = el;

  subscribe((s) => {
    const v = s.vPortValve, a = s.anomaly, sim = s.anomalySim;
    applyVisibility(sim.component, sim.anomaly);

    // ---- Controls tab
    setText($$['ball-pos'], describeOnOff(s.ballValve.position, s.ballValve.command));
    setText($$['esd-pos'], describeOnOff(s.esdValve.position, s.esdValve.command));
    $$['ball-open'].classList.toggle('active', s.ballValve.command === 100);
    $$['ball-close'].classList.toggle('active', s.ballValve.command === 0);
    $$['esd-open'].classList.toggle('active', s.esdValve.command === 100);
    $$['esd-trip'].classList.toggle('active', s.esdValve.command === 0);
    if (document.activeElement !== ctlSlider) ctlSlider.value = v.commandPosition;
    setText($$['ctl-vport-cmd-val'], fmt.position(v.commandPosition));
    setText($$['ctl-vport-act'], `actual ${fmt.position(v.actualPosition)}`);
    syncParam(psvSet, s.safetyValve.setPressure);
    setText($$['ctl-psv-set-val'], fmt.pressure(s.safetyValve.setPressure));
    setText($$['ctl-psv-state'], s.safetyValve.lift > 0.5 ? 'OPEN' : 'CLOSED');
    $$['yankee-start'].classList.toggle('active', s.yankee.running);
    $$['yankee-stop'].classList.toggle('active', !s.yankee.running);
    setText($$['yankee-rpm'], fmt.speed(s.yankee.speedRpm));

    // ---- Anomaly tab: status chip + detection line (shared by every component)
    setText($$['vport-chip'], a.status);
    $$['vport-chip'].className = `chip is-${a.status.toLowerCase()}`;
    setText($$['vport-detect'], detectionText(s));
    const def = anomalyDef(sim.component, sim.anomaly);
    const msg = $$['anom-msg'];
    if (def && sim.anomaly !== 'normal') {
      msg.hidden = false;
      const level = a.status === 'ANOMALY' ? 'critical' : a.status === 'WARNING' || a.status === 'DETECTING' ? 'attention' : def.severity === 'info' ? 'info' : 'pending';
      msg.dataset.level = level;
      setText($$['anom-msg-text'], def.explain || def.label);
      setText($$['anom-msg-status'], a.status === 'ANOMALY' || a.status === 'WARNING' ? `${a.status === 'WARNING' ? 'WARNING' : 'ANOMALY'} ACTIVE — ${anomalyShortName(a.type)}`
        : a.status === 'DETECTING' ? `DETECTING · ${a.persistenceTime.toFixed(1)} / ${a.persistenceRequired.toFixed(1)} s` : def.severity === 'info' ? 'Correct operation — no anomaly' : 'Waiting for the condition to occur');
    } else {
      msg.hidden = true;
    }

    // ---- V-Port (existing scenario logic)
    if (document.activeElement !== slider) slider.value = v.commandPosition;
    if (document.activeElement !== actual) actual.value = v.actualPosition;
    syncParam(health, v.sim.trimWear.health); syncParam(rt, v.sim.slowResponse.responseTime); syncParam(acc, v.sim.slowResponse.acceptableTime);
    syncParam(amp, v.sim.hunting.amplitude); syncParam(freq, v.sim.hunting.frequency);
    setText($$['vport-cmd-val'], fmt.position(v.commandPosition));
    setText($$['vport-act-val'], fmt.position(v.actualPosition));
    setText($$['vport-act-ro'], fmt.position(v.actualPosition));
    setText($$['vport-err'], fmt.percent(v.positionError));
    setText($$['vport-stick-status'], v.sim.sticking.stuck ? (v.positionError > a.threshold ? 'STUCK · not following command' : 'STUCK') : 'FREE · tracking command');
    setText($$['vport-expected'], fmt.flow(v.expectedFlow));
    setText($$['vport-flow'], fmt.flow(s.steam.flow));
    setText($$['vport-health-val'], fmt.percent(v.sim.trimWear.health));
    setText($$['vport-wear'], fmt.percent(100 - v.sim.trimWear.health));
    setText($$['vport-rt-val'], fmt.seconds(v.sim.slowResponse.responseTime, 0));
    setText($$['vport-acc-val'], fmt.seconds(v.sim.slowResponse.acceptableTime));
    setText($$['vport-amp-val'], `±${fmt.percent(v.sim.hunting.amplitude)}`);
    setText($$['vport-freq-val'], `${v.sim.hunting.frequency.toFixed(1)} Hz`);
    $$['vport-stick'].classList.toggle('active', v.sim.sticking.stuck);
    $$['vport-release'].classList.toggle('active', v.mode === 'sticking' && !v.sim.sticking.stuck);

    for (const { el, component, key } of simInputs) syncParam(el, s[component].sim[key]);

    // ---- ESD
    const e = s.esdValve;
    setText($$['esd-trip-cmd'], e.command === 0 ? 'CLOSE (tripped)' : 'NONE · valve open');
    $$['anom-esd-trip'].classList.toggle('active', e.command === 0);
    $$['anom-esd-open'].classList.toggle('active', e.command === 100);
    setText($$['esd-st-val'], fmt.seconds(e.sim.shutdownTime, 0));
    setText($$['esd-acc-val'], fmt.seconds(e.sim.acceptableTime));
    setText($$['esd-partial-val'], `${e.sim.partialOpen}% open`);
    setText($$['esd-air-val'], fmt.pressure(e.sim.airPressure));
    setText($$['esd-minair'], fmt.pressure(e.sim.minAirPressure));
    setText($$['esd-state'], esdStateText());
    setText($$['esd-flow'], fmt.flow(s.steam.flow));

    // ---- Ball
    const b = s.ballValve;
    setText($$['ball-cmd'], b.command === 100 ? 'OPEN' : 'CLOSE');
    $$['anom-ball-open'].classList.toggle('active', b.command === 100);
    $$['anom-ball-close'].classList.toggle('active', b.command === 0);
    setText($$['ball-ot-val'], fmt.seconds(b.sim.operationTime, 0));
    setText($$['ball-acc-val'], fmt.seconds(b.sim.acceptableTime, 0));
    setText($$['ball-leak-val'], fmt.flow(b.sim.leakage));
    setText($$['ball-state'], ballStateText());
    setText($$['ball-flow'], fmt.flow(s.steam.flow));

    // ---- Safety / relief
    const p = s.safetyValve;
    setText($$['psv-set'], fmt.pressure(p.setPressure));
    setText($$['psv-cur'], fmt.pressure(p.sim.linePressure, 2));
    setText($$['psv-state'], p.lift > 0.5 ? 'OPEN · venting' : p.lift > 0.05 ? 'CLOSING' : 'CLOSED');
    setText($$['psv-relief'], fmt.flow(p.reliefFlow));
    setText($$['psv-count'], String(p.sim.openCount));

    // ---- Steam trap
    const t = s.steamTrap.sim;
    setText($$['trap-in'], fmt.temperature(t.inletTemp));
    setText($$['trap-out'], fmt.temperature(t.outletTemp));
    setText($$['trap-dt'], `ΔT ${fmt.temperature(t.inletTemp - t.outletTemp)}`);
    setText($$['trap-p'], fmt.pressure(t.pressure));
    setText($$['trap-disc'], `${Math.round((s.steamTrap.condensateFactor ?? 1) * 100)}% · ${fmt.flow(Math.max(0, s.condensate.flow))}`);
    setText($$['trap-cond'], trapCondition(s));

    // ---- Check valve
    const c = s.checkValve;
    const dp = c.sim.upstreamPressure - c.sim.downstreamPressure;
    setText($$['cv-up'], fmt.pressure(c.sim.upstreamPressure));
    setText($$['cv-down'], fmt.pressure(c.sim.downstreamPressure));
    setText($$['cv-dp'], `${dp >= 0 ? '+' : ''}${fmt.pressure(dp)}`);
    setText($$['cv-disc'], c.lift > 0.05 ? `OPEN · ${Math.round(c.lift * 100)}% lift` : 'SEATED');
    setText($$['cv-flow'], fmt.flow(Math.abs(s.condensate.flow)));
    setText($$['cv-dir'], s.condensate.direction < 0 ? '◀ REVERSE FLOW' : s.condensate.flow > 0 ? 'CONDENSATE ▶' : 'NO FLOW');

    // ---- Live system impact (same state as the Twin and Dashboard)
    setText($$['imp-pressure'], fmt.pressure(s.steam.pressure));
    setText($$['imp-flow'], fmt.flow(s.steam.flow));
    setText($$['imp-temp'], fmt.temperature(s.yankee.surfaceTemp));
    setText($$['imp-moisture'], fmt.moisture(s.paper.moisture));

  });

  return { showTab, get currentTab() { return currentTab; } };
}

function trapCondition(s) {
  switch (s.steamTrap.sim.anomaly) {
    case 'failedOpen': return 'LIVE STEAM PASSING';
    case 'blocked': return 'CONDENSATE BACKING UP';
    case 'poorRemoval': return 'SLUGGISH DISCHARGE';
    default: return 'CYCLING NORMALLY';
  }
}

function syncParam(el, val) {
  if (document.activeElement !== el && String(el.value) !== String(val)) el.value = val;
}

function setText(el, text) {
  if (el && el.textContent !== String(text)) el.textContent = text;
}

/** Isolation valves are described by discrete state only (never a modulating %). */
export function describeOnOff(position, command = null) {
  if (position >= 99.5) return 'OPEN';
  if (position <= 0.5) return 'CLOSED';
  if (command === 0) return 'CLOSING';
  if (command === 100) return 'OPENING';
  return 'MOVING';
}
