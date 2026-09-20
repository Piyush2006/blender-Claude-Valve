import './ui/styles.css';
import './dashboard/dashboard.css';
import './maintenance/maintenance.css';
import { createScene } from './scene/sceneSetup.js';
import { loadModel, applyValveXray, disposeModel } from './scene/sceneLoader.js';
import { buildModelMap, reportModelMap } from './scene/modelMap.js';
import { createCameraRig } from './scene/cameraViews.js';
import { applyLayoutOverrides } from './scene/layoutOverrides.js';
import { addProceduralEquipment } from './scene/proceduralEquipment.js';
import { simulationState, notify } from './simulation/simulationState.js';
import { loadDemoScenario } from './simulation/demoScenario.js';
import { tickSimulation } from './simulation/simulationEngine.js';
import { createValveController } from './animation/valveController.js';
import { createYankeeAnimator } from './animation/yankeeAnimator.js';
import { createSteamFlow } from './animation/steamFlow.js';
import { createInteraction } from './ui/interaction.js';
import { createControlPanel } from './ui/controlPanel.js';
import { createStatusPanel } from './ui/statusPanel.js';
import { createInfoPanel } from './ui/infoPanel.js';
import { makeCollapsible } from './ui/panels.js';
import { createNavigation } from './ui/navigation.js';
import { createFlowTags } from './ui/flowTags.js';
import { createDashboard } from './dashboard/dashboard.js';
import { createMaintenanceUI } from './maintenance/maintenanceUI.js';
import { createMaintenanceView } from './maintenance/maintenanceView.js';
import { setSelection } from './simulation/simulationState.js';

async function bootstrap() {
  const viewport = document.getElementById('viewport');
  const loading = document.getElementById('loading');
  const loadingBar = document.getElementById('loading-bar');

  const ctx = createScene(viewport);
  const cameraRig = createCameraRig(ctx.camera, ctx.controls, ctx.onFrame);

  let model;
  try {
    model = await loadModel((p) => { loadingBar.style.transform = `scaleX(${p.toFixed(3)})`; });
  } catch (err) {
    console.error('Failed to load GLB', err);
    loading.classList.add('error');
    loading.firstElementChild.textContent = `Failed to load model: ${err.message || err}`;
    return;
  }

  const { root } = model;
  ctx.scene.add(root);

  // Rotary joint, separator tank and their piping (procedural, built from GLB materials).
  addProceduralEquipment(root);

  // --- Mapping layer: resolve GLB objects and report their names --------------------
  const map = buildModelMap(root);
  reportModelMap(map);
  applyValveXray(root, simulationState.view.xrayValves);
  const layout = applyLayoutOverrides(map, ctx.scene);   // PSV moved next to the Yankee + vent riser

  // --- Animation layers ----------------------------------------------------------------
  const valves = createValveController(map);
  const yankee = createYankeeAnimator(map);
  const steam = createSteamFlow(map, ctx.renderer, ctx.camera);
  if (layout.vent?.userData.ventBore) ctx.scene.add(steam.addVentSegment(layout.vent.userData.ventBore));   // PSV venting steam
  if (!yankee.paperAvailable) console.warn('[DigitalTwin] Paper_Web not animatable (no UVs or mesh missing).');

  // --- UI ---------------------------------------------------------------------------------
  const interaction = createInteraction({ renderer: ctx.renderer, camera: ctx.camera, scene: ctx.scene, map, cameraRig, extraPickables: layout.vent ? [layout.vent] : [] });
  const flowTags = createFlowTags({ scene: ctx.scene, map });
  const controlPanel = createControlPanel(document.getElementById('controls'), {
    cameraRig,
    onValveXray: (enabled) => applyValveXray(root, enabled),
  });
  createStatusPanel(document.getElementById('status'));
  createInfoPanel(document.getElementById('info'), { onFocus: () => interaction.focusSelected() });
  makeCollapsible(document.getElementById('controls'), { key: 'controls' });
  makeCollapsible(document.getElementById('status'), { key: 'status', showAlarmBadge: true });

  // --- Twin / Dashboard / Reports navigation. The Dashboard only reads simulationState. ------
  let dashboard = null;
  const navigation = createNavigation({
    onViewChange: (view) => ctx.setRenderEnabled(view === 'twin'),
    onNav: (nav) => {
      if (nav === 'controls') controlPanel.showTab?.('controls');
      if (nav === 'analytics') dashboard?.openAnalytics();
    },
  });
  const openComponent = (id) => {
    navigation.showView('twin');
    if (map.components[id]) {
      setSelection(id);
      requestAnimationFrame(() => interaction.focusSelected());
    }
  };
  // --- Maintenance: anomaly details drawer, tickets, MAINTENANCE view (reads the same state) ---
  const maintenance = createMaintenanceUI({ onOpenComponent: openComponent });
  createMaintenanceView(document.getElementById('maintenance-view'), { onOpenTicket: (id) => maintenance.openTicket(id), onBack: () => navigation.go('dashboard') });

  dashboard = createDashboard(document.getElementById('dashboard-view'), {
    onOpenComponent: openComponent,
    onCreateTicket: (componentId) => maintenance.openCreateTicket(componentId),
    onOpenTicket: (id) => maintenance.openTicket(id),
    onOpenReports: () => navigation.go('reports'),
  });

  // --- Frame loop: simulation → animation ---------------------------------------------
  ctx.onFrame((dt) => {
    tickSimulation(dt);
    valves.update();
    yankee.update();
    steam.update();
  });

  // Boot demo scenario: V-Port position mismatch (70 % / 32 %) + ball valve slow response (stroke test).
  loadDemoScenario();
  notify();
  valves.update(); yankee.update(); steam.update();
  ctx.warmUp();                                 // compile shaders + first frame, even if the Twin view is hidden
  loading.hidden = true;
  ctx.start();

  // Debug / test hooks (not used by the app itself).
  window.__twin = {
    maintenance,
    state: simulationState, map, ctx, cameraRig, steam, yankee, valves, navigation,
    /** Advance the simulation deterministically (used by automated checks). */
    step(dt = 0.1, n = 1) {
      for (let i = 0; i < n; i++) { tickSimulation(dt); valves.update(); yankee.update(); steam.update(); }
    },
  };

  window.addEventListener('beforeunload', () => {
    steam.dispose();
    yankee.dispose();
    interaction.dispose();
    flowTags.dispose();
    disposeModel(root);
    ctx.dispose();
  });
}

bootstrap();
