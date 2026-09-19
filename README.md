# Yankee Steam Digital Twin — Phase 1

Three.js + Vite application built around the Blender export
`public/model/Yankee_Steam_DigitalTwin.glb` (the GLB is loaded as-is and never modified).

```bash
npm install
npm run dev      # http://localhost:3113
npm run build    # production bundle in dist/
```

## Architecture

```
src/
  main.js                          bootstrap: scene → load GLB → map → animators → UI → loop
  components/componentRegistry.js  mapping layer: component ids → actual GLB object names
  scene/sceneSetup.js              renderer, camera, lights, OrbitControls, CSS2D labels, frame loop
  scene/sceneLoader.js             GLTFLoader (picks the "YankeeProcess" scene), runtime material overrides
  scene/modelMap.js                resolves registry names → Object3D, stores rest transforms, console report
  scene/cameraViews.js             initial / overview presets, smooth fly-to, focus-on-component
  scene/layoutOverrides.js         runtime layout fixes: PSV relocated next to the Yankee + vent riser
  scene/proceduralEquipment.js     rotary joint, separator tank + condensate/blow-through piping (procedural)
  simulation/simulationState.js    central state (single source of truth for 3D + UI) + command helpers
  simulation/simulationEngine.js   valve slew, flow = ball × esd × vport, segment presence, simulated values
  simulation/anomalyCatalog.js     component → anomaly catalog (labels, detector types, severity)
  simulation/anomalyEngine.js      detectors for V-Port, ESD, Ball, Safety valve, Steam trap, Check valve
  ui/flowTags.js                   3D tags: condensate flow direction at the check valve, PSV "VENTING"
  animation/valveController.js     ball / ESD / V-Port / check / safety valve kinematics from state
  animation/yankeeAnimator.js      Yankee rotation + paper-web texture scroll
  animation/steamFlow.js           in-pipe steam shader + light particle stream on SteamFlow_P1..P5
  ui/controlPanel.js               temporary phase-1 controls
  ui/statusPanel.js                component status list (green NORMAL / red anomaly) + KPIs
  ui/infoPanel.js                  selected-component card
  ui/interaction.js                click-to-select, blue selection / red anomaly tint, floating 3D status tags
  ui/detection.js                  shared detection text / reasoning formatting
  ui/panels.js                     collapsible side panels (state remembered in localStorage)
  ui/navigation.js                 top bar: Twin / Dashboard tabs + live local clock
  dashboard/dashboardData.js       dashboard data layer: derives everything from simulationState (+ simulated extras)
  dashboard/dashboard.js           dashboard view (KPIs, schematic, V-Port card, trends, tables, insights)
  dashboard/schematic.js           lightweight SVG process schematic (click → Twin selection)
  dashboard/charts.js              dependency-free SVG sparklines / trend charts / bars
```

## GLB inspection summary

The file contains **11 scenes**. `YankeeProcess` (the default scene) is the complete
process and is the only one added to the Three.js scene. The other ten are standalone
exterior / cutaway ("_Section") views of the individual valves.

| Component | Root node | Moving parts (child nodes) |
|---|---|---|
| Ball Valve | `P_BallValve` | `P_BallValve_Stem` (rotates about local Y) → `P_BallValve_Ball`, `P_BallValve_Handle` |
| ESD Valve | `P_ESDValve` | `P_ESDValve_Stem` → `P_ESDValve_Ball`, `P_ESDValve_Position_Indicator`; `P_ESDValve_Actuator_Piston`/`_B` (slide along X); `P_ESDValve_Actuator_Spring`/`_B` (extend); `P_ESDValve_Solenoid` |
| V-Port Control Valve | `P_VPortControlValve` | `P_ValveShaft` (rotates about local Z, 0° closed → −90° open) → `P_VPort`, `P_ActuatorLever`; `P_ActuatorStem` (Y translate), `P_ActuatorSpring` (Y scale); `P_Positioner` group |
| Safety / Relief Valve | `P_SafetyValve` | `P_SafetyValve_Stem` → `P_SafetyValve_Disc` (lift, unused in phase 1) |
| Steam Trap | `SteamTrap` | `SteamTrap_Body`, `SteamTrap_Bucket`, `SteamTrap_Cover` |
| Check Valve | `P_CheckValve` | `P_CheckValve_Stem` (X translate) → `P_CheckValve_Disc`; `P_CheckValve_Spring` |
| Yankee Dryer | `Yankee_Cylinder` | rotates about local X |
| Paper Web | `Paper_Web` | single static strip; UV `u` runs along the web path |
| Steam piping | `SteamSupply_Inlet`, `Steam_P1…P5`, `Yankee_Steam_Inlet`, `Steam_Branch_PSV`, `Safety_Discharge` | glass sight-tube (`YP_Pipe_Glass`) between steel collars |
| In-pipe steam volumes | `SteamFlow_P1…P5` | thin cylinders on the pipe centreline (used for the steam effect) |
| Condensate piping | `Yankee_Condensate_Outlet`, `Condensate_C1…C3`, `Condensate_Return` | |
| Pneumatic air | `Air_Main`, `Air_Drop_ESD` | |
| Sensors | `Steam_Pressure_Sensor`, `Steam_Temperature_Sensor`, `Steam_Flow_Sensor` | |

The two animation clips in the file (`ValveShaftAction.001`) target the standalone-scene
`ValveShaft` nodes only and confirm the V-Port stroke: 0° → −90° about Z.

## Runtime-only material adjustments (GLB untouched)

* Valve bodies / actuator housings get a see-through clone ("Show valve internals" toggle)
  so the ball, V-Port segment, actuator spring/stem and check-valve disc can be seen moving.
* `YP_Pipe_Glass` gets `depthWrite=false` and a softer environment reflection.
* `SteamFlow_P*` volumes get an animated shader material; a small point stream is parented to them.
* `Paper_Web` gets a generated fibre texture whose offset scrolls at the Yankee surface speed.

## Runtime layout overrides (GLB untouched)

* **Safety / relief valve relocated.** The export places `P_SafetyValve` on the first
  steam segment next to the supply. Because it protects the Yankee drum, the assembly
  (`P_SafetyValve`, `Steam_Branch_PSV`, `Safety_Discharge`) is translated +6.6 m in X at
  load time so it sits on `Steam_P5`, the last segment before the Yankee steam inlet.
* **Vent to atmosphere.** The exported discharge elbow ends 0.65 m above the valve. A
  plain vent riser (Ø60 mm cylinder, coupling flange, drip collar and rain cap) is added
  on top of it up to 5 m, so the relief path visibly goes to a safe location and never
  back into the process line. Constants live in `PSV_LAYOUT` in `layoutOverrides.js`.
  Recommended: mirror this in the Blender source for the next export, then delete the override.

* **Inline instruments hidden.** `Steam_Pressure_Sensor`, `Steam_Temperature_Sensor` and
  `Steam_Flow_Sensor` are set `visible = false` at load (`HIDDEN_OBJECTS` in
  `layoutOverrides.js`); they remain in the GLB and can be re-enabled by removing them from the list.

## Procedural equipment (GLB untouched)

Built in `proceduralEquipment.js` from Three.js primitives using **clones of the GLB's own
materials**, added to the process scene before the mapping layer so they behave like native
components (selectable, labelled, listed in Component Status, info card):

* **`Yankee_Rotary_Joint`** — stationary cast housing (bolted inlet flange, ribs, bearing ring,
  syphon/vent stub, torque arm tied to the inlet pedestal) wrapped around the existing
  Yankee steam-inlet journal, plus **`Yankee_Rotary_Joint_Rotor`**, a chrome collar with drive
  lugs that rotates with the Yankee (driven in `yankeeAnimator.js`). Nothing is merged with
  the Yankee or the pipe.
* **`Separator_Tank`** — vertical vessel (shell, dished heads, stiffener bands, side inlet
  nozzle, top and bottom flanged nozzles, level gauge, name plate, three legs) at x = 10.75.
* Piping groups `Cond_Yankee_to_Separator` (Condensate_C1 → side inlet),
  `Cond_Separator_to_Trap` (bottom outlet → steam trap) and `Separator_BlowThrough_Return`
  (top outlet → up and away to a steam return, tagged) — separate geometry, flanged ends.
* To make room, `SteamTrap`, `Condensate_C2`, `P_CheckValve`, `Condensate_C3`,
  `Condensate_Return` and `Support_Condensate_C3` are translated +1.9 m in X (transform only).
* Resulting path: Yankee → Separator → Steam Trap → Check Valve → Condensate Return, with
  blow-through leaving the separator top. This is a simplified digital-twin arrangement,
  not a plant-specific design. No anomaly logic was added for the new equipment.

## Units & thresholds (single source of truth)

`src/simulation/units.js` defines the units the Twin uses — **bar, kg/h, °C, %, rpm** — plus
formatters and the configurable demo thresholds (`THRESHOLDS`: position error 10 %, flow
deviation 10 % attention / 25 % critical, trim health 75 % / 50 %, moisture target 5.0 %).
Both the Twin panels and the Dashboard format values through it, so a measurement can never
appear in two different units. The thresholds are demo values, not engineering limits.
Severity is centralized there too: `levelOfStatus()` (ANOMALY → critical, WARNING/DETECTING →
attention) and `levelOfDeviation()`; System Status is the worst component level.

## Dashboard tab

`[Twin] [Dashboard]` in the top bar. The Dashboard is monitoring-only and reads the **same
`simulationState`** as the Twin through `dashboardData.snapshot()` — no second copy of any
value. Units are the Twin's (bar, kg/h, °C) via `units.js`.

* KPIs: system status, steam pressure, steam flow (with command-based target and deviation %),
  steam temperature, paper moisture (target), active-anomaly count.
* Process Overview: SVG schematic of the full line (supply → ball → ESD → V-Port → PSV branch →
  rotary joint → Yankee → separator → trap → check valve → return; blow-through → steam return)
  with live status dots. Clicking a component opens the Twin with it selected.
* V-Port card: command vs actual bars, position error, **expected (at actual position) vs actual
  flow bars with deviation %**, trim health (from the Twin's trim-wear scenario) with an
  *Estimated Maintenance Window* and Early Warning badge.
* Trends: last 10 min of real time sampled every 2 s (backfilled at the same spacing, so no
  artificial cliff); anomaly / scenario events are drawn as markers to explain changes.
* Component Status table with technically meaningful parameters (PSV set pressure, rotary-joint
  seal temperature, steam-trap inlet/outlet ΔT, check valve open/closed + flow note).
* Active anomalies from the shared anomaly state for every component (Trim Wear shows as 🟡
  attention with expected/actual flow, deviation, trim health, maintenance window); recent
  events (real timestamps) and insights. Isolation valves show OPEN/CLOSED/CLOSING, PSV set vs
  current pressure + relief flow, steam trap temperatures + condition, check valve direction.
* Simulated-only values (paper moisture, trend backfill, event log) are isolated in the `SIM`
  helpers of `dashboardData.js` so they can be replaced by PLC / historian data.
* While the Dashboard is shown the Twin keeps simulating; only WebGL drawing is paused.

## Anomaly Simulation (all components)

The Controls panel section is now **Anomaly Simulation**: `Valve / Component` → `Anomaly`
(populated from `anomalyCatalog.js`) → only the relevant controls → physical effect in the 3D
Twin. `simulationState.anomalySim {component, anomaly}` is the single selector; one anomaly is
active at a time and `setAnomalyScenario()` returns everything else to normal. The V-Port
scenarios are the original implementation, reached through the same selector. Detectors share
the 2 s persistence timer; catalog severity decides ANOMALY (red) vs WARNING (amber).

| Component | Anomaly | Physical effect (3D + flow) | Detector |
|---|---|---|---|
| ESD | Fail to Close | trip ignored, valve stays open, steam continues | trip & position > 90 % |
| ESD | Slow Shutdown | closes at 100 %/*Shutdown Time*, flow falls with it | trip longer than acceptable (latched) |
| ESD | Partial Closure | stops at *Stops At* % open, flow continues | trip & stalled between 5–95 % |
| ESD | Low Air Pressure | stroke authority collapses, stalls part-way | air < minimum |
| Ball | Fail to Open / Close | valve does not move on command | command vs state |
| Ball | Slow Operation | full stroke in *Operation Time* | move longer than acceptable (latched) |
| Ball | Passing / Leakage | closed but *Leakage Flow* passes (steam visible downstream) | closed & flow > 0 (WARNING) |
| PSV | Pressure Relief (correct operation) | demo loop: pressure climbs to set → disc lifts → vents → falls → reseats at blowdown | none (NORMAL) |
| PSV | Unexpected Opening | disc lifts at normal pressure, vents ≈ 1,300 lb/h, main flow dips, "VENTING" tag | open below 95 % of set |
| PSV | Failure to Open | line pressure keeps rising above set, disc seated, no venting | line > set & seated |
| PSV | Chattering | disc cycles at 1.5 Hz around the set point; venting starts/stops with it; opening count | ≥ 3 openings / 3 s |
| Steam trap | Failed Open | outlet ≈ inlet, discharge ×1.4 | ΔT < 15 °C |
| Steam trap | Blocked | outlet 45 °C, no discharge, check valve seats | outlet < 60 °C & no flow |
| Steam trap | Poor Removal | outlet ~75 °C, discharge ×0.5 | 60–85 °C (WARNING) |
| Check valve | Reverse Flow | reverse ΔP, disc near seat, reverse flow, 3D + schematic arrows flip | flow < 0 |
| Check valve | Failure to Open | forward ΔP, disc stuck seated, no flow | ΔP > 0 & seated |
| Check valve | Failure to Close | reverse ΔP, disc stuck open, full reverse flow | ΔP < 0 & open |

Units in the Twin panel stay metric (kg/h, bar, °C) as before; the Dashboard converts.

**Safety-valve venting steam.** `safetyValve.reliefFlow` (kg/h) is the single relief variable:
it is shown in the panel / info card / dashboard and drives a dedicated steam volume inside the
discharge riser (`SteamFlow_PSV_Vent`, built by the existing steam engine's `addVentSegment`).
The discharge elbow and riser are rendered as a near-transparent sight tube so the vapour is
visible; zero relief flow ⇒ no particles. The relief/pressure relationship is a demonstration
model, not a safety-valve sizing calculation.

## Phase 2 · V-Port anomaly scenarios

`vPortValve.mode` selects the scenario (Anomaly Scenario dropdown in the V-Port Simulation
section). The engine decides how **actual** evolves per mode; the animated valve always
slews to actual; one `flow.fraction` drives both the kg/h readout and the in-pipe steam
(speed + density), ramped over ≈0.4 s so they never diverge. Detectors share the 2 s
persistence timer (NORMAL → DETECTING → ANOMALY) and each one has its own rule:

| Mode | Actual position | Detector |
|---|---|---|
| Normal | tracks command (40 %/s) | mismatch rule (never fires) |
| Position Mismatch | operator-set, independent | error > 10 % (original) |
| Sticking | frozen while STUCK; RELEASE lets it track | error > 10 % **and** velocity < 1 %/s |
| Slow Response | full stroke in *Response Time* s | move longer than *Acceptable Response*; verdict latches per move |
| Hunting | command ± amplitude·sin(2π·f·t) | swing > 4 % with ≥ 3 crossings in 3 s |
| Trim Wear | tracks command | flow > expected by 10 % (multiplier 1 + 0.5·wear: 60 % health → ×1.2) |

RESET SIMULATION returns to Normal, 70 / 70, healthy trim.

### Scenario 1 detail — position mismatch

* `vPortValve.commandPosition` and `vPortValve.actualPosition` are **independent** inputs
  (two sliders in the Controls panel). `physicalPosition` slews toward the actual value
  and drives the 3D valve; steam flow = 12,500 kg/h × actual/100 (gated by Ball/ESD).
* `anomalyEngine.js`: `positionError = |commanded − actual|`; error > 10 % starts a
  persistence timer → **DETECTING** (amber, timer shown); ≥ 2 s → **ANOMALY** (red, pulsing
  emissive tint on the whole valve, detection reasoning in the info card). Error ≤ 10 %
  clears immediately and resets the timer. RESET SIMULATION restores 70 / 70.
* Steam visuals scale with flow: wisp speed `2.8·flow` m/s (stops at 0), wisp density
  `flow^0.75`, and only the first `flow × 100 %` of particles (by rank) are drawn.
* A Debug disclosure in the V-Port section shows commanded / actual / physical / error /
  threshold / timer / flow / detection state.

## Known limitations

* The paper web mesh is a static strip; motion is conveyed by texture scrolling, not geometry.
* The ESD actuator pistons/springs animate but sit inside the housing — visible only with
  "Show valve internals" enabled.
* Values are simulated (no PLC / OPC-UA / MQTT). Only the V-Port position-mismatch anomaly is implemented.
