/**
 * Component registry — the single mapping between process components and the
 * object names that exist in Yankee_Steam_DigitalTwin.glb (scene "YankeeProcess").
 *
 * Names below were taken from an inspection of the exported GLB and must not be
 * guessed. Every entry is resolved at runtime by modelMap.js which reports any
 * name that cannot be found.
 */

export const PROCESS_SCENE_NAME = 'YankeeProcess';

/** Interactive / animated components, in process order. */
export const COMPONENTS = [
  {
    id: 'ballValve',
    label: 'Ball Valve',
    tag: 'HV-101',
    kind: 'valve',
    root: 'P_BallValve',
    parts: {
      body: 'P_BallValve_Body',
      stem: 'P_BallValve_Stem',       // parent of ball + handle → rotate about local Y
      ball: 'P_BallValve_Ball',
      handle: 'P_BallValve_Handle',
    },
    stateKey: 'ballValve',
  },
  {
    id: 'esdValve',
    label: 'ESD Valve',
    tag: 'XV-102',
    kind: 'valve',
    root: 'P_ESDValve',
    parts: {
      body: 'P_ESDValve_Body',
      stem: 'P_ESDValve_Stem',        // parent of ball + position indicator → rotate about local Y
      ball: 'P_ESDValve_Ball',
      indicator: 'P_ESDValve_Position_Indicator',
      actuator: 'P_ESDValve_Actuator',
      pistonA: 'P_ESDValve_Actuator_Piston',      // slides along local +X
      pistonB: 'P_ESDValve_Actuator_Piston_B',    // slides along local -X
      springA: 'P_ESDValve_Actuator_Spring',      // origin at outer end, extends toward -X
      springB: 'P_ESDValve_Actuator_Spring_B',    // origin at outer end, extends toward +X
      solenoid: 'P_ESDValve_Solenoid',
    },
    stateKey: 'esdValve',
  },
  {
    id: 'vPortValve',
    label: 'V-Port Control Valve',
    tag: 'FCV-103',
    kind: 'valve',
    root: 'P_VPortControlValve',
    parts: {
      body: 'P_ValveBody',
      shaft: 'P_ValveShaft',          // rotates about local Z: 0° closed → -90° open (from the GLB animation clip)
      vport: 'P_VPort',               // child of shaft
      lever: 'P_ActuatorLever',       // child of shaft
      actuator: 'P_PneumaticActuator',
      actuatorHousing: 'P_ActuatorHousing',
      actuatorStem: 'P_ActuatorStem', // translates along local Y
      actuatorSpring: 'P_ActuatorSpring', // scales along local Y
      positioner: 'P_Positioner',
      positionerDisplay: 'P_PositionerDisplay',
      seat: 'P_ValveSeat',
    },
    stateKey: 'vPortValve',
  },
  {
    id: 'safetyValve',
    label: 'Safety / Relief Valve',
    tag: 'PSV-104',
    kind: 'valve',
    root: 'P_SafetyValve',
    parts: {
      body: 'P_SafetyValve_Body',
      stem: 'P_SafetyValve_Stem',     // lifts along local Y (parent of disc)
      disc: 'P_SafetyValve_Disc',
      spring: 'P_SafetyValve_Spring',
      handle: 'P_SafetyValve_Handle',
    },
    stateKey: 'safetyValve',
  },
  {
    id: 'steamTrap',
    label: 'Steam Trap',
    tag: 'ST-105',
    kind: 'trap',
    root: 'SteamTrap',
    parts: {
      body: 'SteamTrap_Body',
      bucket: 'SteamTrap_Bucket',
      cover: 'SteamTrap_Cover',
    },
    stateKey: 'steamTrap',
  },
  {
    id: 'checkValve',
    label: 'Check Valve',
    tag: 'NRV-106',
    kind: 'valve',
    root: 'P_CheckValve',
    parts: {
      body: 'P_CheckValve_Body',
      stem: 'P_CheckValve_Stem',      // translates along local +X when lifting (parent of disc)
      disc: 'P_CheckValve_Disc',
      spring: 'P_CheckValve_Spring',  // origin at guide end, extends toward -X
    },
    stateKey: 'checkValve',
  },
  {
    id: 'rotaryJoint',
    label: 'Rotary Joint',
    tag: 'RJ-202',
    kind: 'joint',
    root: 'Yankee_Rotary_Joint',      // procedural (proceduralEquipment.js), wraps the inlet journal
    parts: {
      housing: 'Yankee_Rotary_Joint_Housing',
      rotor: 'Yankee_Rotary_Joint_Rotor',   // turns with the Yankee
    },
    stateKey: 'rotaryJoint',
  },
  {
    id: 'yankee',
    label: 'Yankee Dryer',
    tag: 'YD-201',
    kind: 'dryer',
    root: 'Yankee_Cylinder',          // rotates about local X (axis of the cylinder)
    parts: {},
    stateKey: 'yankee',
  },
  {
    id: 'separator',
    label: 'Separator Tank',
    tag: 'V-301',
    kind: 'vessel',
    root: 'Separator_Tank',           // procedural (proceduralEquipment.js)
    parts: {
      shell: 'Separator_Tank_Shell',
    },
    stateKey: 'separator',
  },
];

/** Static piping / instrumentation groups (for hierarchy checks & material overrides). */
export const PIPING = {
  steamSupply: ['SteamSupply_Inlet'],
  steamLine: ['Steam_P1', 'Steam_P2', 'Steam_P3', 'Steam_P4', 'Steam_P5', 'Yankee_Steam_Inlet'],
  steamBranch: ['Steam_Branch_PSV', 'Safety_Discharge', 'Separator_BlowThrough_Return'],
  steamFlowVolumes: ['SteamFlow_P1', 'SteamFlow_P2', 'SteamFlow_P3', 'SteamFlow_P4', 'SteamFlow_P5'],
  condensate: ['Yankee_Condensate_Outlet', 'Condensate_C1', 'Cond_Yankee_to_Separator', 'Cond_Separator_to_Trap', 'Condensate_C2', 'Condensate_C3', 'Condensate_Return'],
  pneumatic: ['Air_Main', 'Air_Drop_ESD'],
  sensors: ['Steam_Pressure_Sensor', 'Steam_Temperature_Sensor', 'Steam_Flow_Sensor'],
  paper: ['Paper_Web'],
  doctorBlade: ['Doctor_Blade_Blade', 'Doctor_Blade_Holder', 'Doctor_Blade_Stand_Left', 'Doctor_Blade_Stand_Right'],
  structure: [
    'Process_Ground', 'Support_Steam_P1', 'Support_Steam_P2', 'Support_Steam_P3', 'Support_Steam_P4',
    'Support_Condensate_C1', 'Support_Condensate_C3', 'Yankee_Foundation_Inlet', 'Yankee_Foundation_Outlet',
    'Yankee_Pedestal_Inlet', 'Yankee_Pedestal_Outlet',
  ],
};

/**
 * Steam flow segments: which GLB volume each covers and which valves must be
 * open for steam to be present there. Flow direction is +X (supply → Yankee).
 */
export const STEAM_SEGMENTS = [
  { id: 'P1', volume: 'SteamFlow_P1', pipe: 'Steam_P1', upstreamOf: ['ballValve'] },
  { id: 'P2', volume: 'SteamFlow_P2', pipe: 'Steam_P2', upstreamOf: ['esdValve'], downstreamOf: ['ballValve'] },
  { id: 'P3', volume: 'SteamFlow_P3', pipe: 'Steam_P3', upstreamOf: ['vPortValve'], downstreamOf: ['ballValve', 'esdValve'] },
  { id: 'P4', volume: 'SteamFlow_P4', pipe: 'Steam_P4', downstreamOf: ['ballValve', 'esdValve', 'vPortValve'] },
  { id: 'P5', volume: 'SteamFlow_P5', pipe: 'Steam_P5', downstreamOf: ['ballValve', 'esdValve', 'vPortValve'] },
];

/**
 * Outer shells that hide the moving parts. They are made semi-transparent at
 * runtime ("valve internals" X-ray) so the ball, V-Port segment, actuator
 * pistons/stem/lever and check-valve disc can be seen moving. GLB unchanged.
 */
export const VALVE_SHELLS = [
  'P_BallValve_Body',
  'P_ESDValve_Body', 'P_ESDValve_Actuator',
  'P_ValveBody', 'P_ActuatorHousing', 'P_PneumaticActuator',
  'P_CheckValve_Body', 'P_CheckValve_Cover',
  'P_SafetyValve_Body', 'P_SafetyValve_Bonnet',
];

/**
 * The steam line in the GLB is modelled as a glass sight-tube (material
 * YP_Pipe_Glass, 7 % opacity) between short steel collars (YP_Pipe_Steam), so
 * the SteamFlow_* volumes inside are visible by design. We only soften the
 * glass's environment reflection at runtime so the steam reads clearly.
 */
export const STEAM_PIPE_GLASS_MATERIALS = ['YP_Pipe_Glass'];
