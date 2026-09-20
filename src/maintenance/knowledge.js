/**
 * Maintenance knowledge base: possible causes, recommendations and root-cause
 * options per anomaly type (keyed by the detector type in anomalyCatalog.js).
 * Demo content — typical plant checklists, not a substitute for the OEM manual.
 */
const KB = {
  VPORT_POSITION_MISMATCH: {
    causes: ['Positioner issue', 'Actuator issue', 'Instrument air issue', 'Mechanical sticking', 'Valve / trim issue', 'Control signal issue'],
    recommendations: ['Inspect valve position feedback.', 'Check positioner and control signal.', 'Verify instrument air supply.', 'Inspect for mechanical sticking.'],
    rootCauses: ['Positioner calibration drift', 'Feedback sensor fault', 'Low instrument air', 'Actuator degradation', 'Mechanical binding', 'Control signal fault'],
  },
  VPORT_STICKING: {
    causes: ['Packing over-tightened / stem friction', 'Debris or scale between plug and seat', 'Positioner stiction (I/P or pilot fault)', 'Actuator air leak below breakaway pressure'],
    recommendations: ['Stroke the valve manually and observe breakaway', 'Loosen and re-torque packing to specification', 'Inspect trim for scale, debris or galling', 'Check positioner pilot stage and air leaks'],
    rootCauses: ['Packing friction', 'Trim fouling / scale', 'Positioner stiction', 'Actuator air leak'],
  },
  VPORT_SLOW_RESPONSE: {
    causes: ['Restricted or undersized air supply tubing', 'Positioner gain / tuning too low', 'Volume booster or exhaust restriction', 'Actuator leakage reducing effective force'],
    recommendations: ['Measure stroke time end-to-end and compare with acceptance time', 'Check air supply capacity, filters and tubing for restriction', 'Review positioner tuning (gain, dead-band)', 'Test volume booster / quick exhaust'],
    rootCauses: ['Air supply restriction', 'Positioner tuning', 'Booster fault', 'Actuator leakage'],
  },
  VPORT_HUNTING: {
    causes: ['Positioner gain too high', 'Control loop tuning (PID) too aggressive', 'Excessive stem friction causing limit-cycling', 'Oversized valve operating near seat'],
    recommendations: ['Place loop in manual and confirm oscillation stops', 'Reduce positioner gain and re-tune the flow loop', 'Check packing friction / stem stiction', 'Review valve sizing against operating range'],
    rootCauses: ['Positioner gain', 'Loop tuning', 'Stem friction limit-cycle', 'Valve sizing'],
  },
  VPORT_TRIM_WEAR: {
    causes: ['Erosion of plug / seat from wet steam', 'Cavitation or flashing damage', 'Wire-drawing from operating near seat', 'Seat leakage after seal wear'],
    recommendations: ['Trend flow-vs-position deviation and plan trim inspection', 'Check steam quality and upstream separator performance', 'Schedule trim replacement in the next planned shutdown', 'Confirm leakage class with a seat leakage test'],
    rootCauses: ['Trim erosion', 'Cavitation / flashing', 'Wire-drawing', 'Seat seal wear'],
  },
  ESD_FAIL_TO_CLOSE: {
    causes: ['Solenoid valve failed or stuck', 'Actuator spring failure', 'Stem seized / packing binding', 'Trip signal not reaching the solenoid'],
    recommendations: ['Isolate process and perform full-stroke trip test', 'Verify solenoid de-energises and vents on trip', 'Inspect actuator spring and stem for damage', 'Check wiring and trip relay outputs'],
    rootCauses: ['Solenoid failure', 'Spring failure', 'Stem seized', 'Trip signal fault'],
  },
  ESD_SLOW_SHUTDOWN: {
    causes: ['Exhaust port restricted (silencer blocked)', 'Quick-exhaust valve malfunction', 'Low spring force / actuator degradation', 'Cold or contaminated instrument air'],
    recommendations: ['Measure closing time against the safety requirement', 'Clean or replace exhaust silencers', 'Test quick-exhaust valve operation', 'Inspect actuator spring pack'],
    rootCauses: ['Exhaust restriction', 'Quick-exhaust fault', 'Spring degradation', 'Air quality'],
  },
  ESD_PARTIAL_CLOSURE: {
    causes: ['Debris lodged in the seat', 'Stem or ball galling mid-stroke', 'Insufficient spring force for the differential pressure', 'Mechanical stop misadjusted'],
    recommendations: ['Confirm actual position with local indicator', 'Inspect valve internals for obstruction', 'Verify actuator sizing for shut-off pressure', 'Check travel stops and linkage'],
    rootCauses: ['Seat obstruction', 'Galling', 'Actuator undersized', 'Travel stop misadjusted'],
  },
  ESD_LOW_AIR: {
    causes: ['Instrument air compressor / dryer problem', 'Leaking tubing or fittings', 'Blocked filter-regulator', 'Air header isolation partially closed'],
    recommendations: ['Check instrument air header pressure (bar)', 'Inspect filter-regulator and replace element', 'Leak-test tubing and fittings', 'Confirm air receiver capacity for trip demand'],
    rootCauses: ['Air supply fault', 'Tubing leak', 'Filter blocked', 'Header restriction'],
  },
  BALL_FAIL_TO_OPEN: {
    causes: ['Actuator failure (electrical / pneumatic)', 'Ball seized in seats after prolonged closure', 'Torque insufficient for the differential pressure', 'Limit switch / command wiring fault'],
    recommendations: ['Verify command reaches the actuator', 'Attempt manual override and note breakaway torque', 'Check actuator supply (air / power)', 'Inspect seats and ball for scale build-up'],
    rootCauses: ['Actuator failure', 'Ball seized', 'Insufficient torque', 'Wiring fault'],
  },
  BALL_FAIL_TO_CLOSE: {
    causes: ['Actuator failure', 'Debris preventing full rotation', 'Stem / ball coupling sheared', 'Command wiring fault'],
    recommendations: ['Confirm valve position locally', 'Attempt manual closure and check stem engagement', 'Inspect for foreign material in the bore', 'Test actuator and control wiring'],
    rootCauses: ['Actuator failure', 'Bore obstruction', 'Coupling sheared', 'Wiring fault'],
  },
  BALL_SLOW_OPERATION: {
    causes: ['Actuator issue', 'Low pneumatic air pressure', 'Mechanical friction', 'Valve stem / shaft resistance', 'Actuator degradation', 'Pneumatic supply restriction'],
    recommendations: ['Check actuator response.', 'Verify pneumatic air pressure.', 'Inspect valve stem / shaft movement.', 'Check actuator and air supply.', 'Inspect for mechanical friction.'],
    rootCauses: ['Low air pressure', 'Seat / stem friction', 'Actuator degradation', 'Air supply restriction', 'Gearbox lubrication'],
  },
  BALL_PASSING: {
    causes: ['Seat damage or erosion', 'Ball surface scoring', 'Foreign material on the seat', 'Valve not fully rotated to closed'],
    recommendations: ['Confirm full closure at the position indicator', 'Perform seat leakage test during next isolation', 'Plan seat / ball replacement', 'Check for steam-cut damage on the ball'],
    rootCauses: ['Seat erosion', 'Ball scoring', 'Seat contamination', 'Incomplete rotation'],
  },
  PSV_RELIEF: {
    causes: ['Process pressure reached the set point (correct operation)', 'Upstream pressure control upset', 'Downstream demand drop'],
    recommendations: ['Investigate why line pressure reached the set point', 'Review pressure control loop performance', 'Log the lift event for the valve inspection record'],
    rootCauses: ['Pressure excursion (process)', 'Pressure control upset'],
  },
  PSV_UNEXPECTED_OPENING: {
    causes: ['Spring set pressure drifted low', 'Seat leakage / simmering', 'Vibration causing premature lift', 'Incorrect set pressure after maintenance'],
    recommendations: ['Verify set pressure on a test bench', 'Inspect seat and disc for damage', 'Check for vibration and back-pressure at the outlet', 'Confirm the nameplate set pressure matches the design'],
    rootCauses: ['Set pressure drift', 'Seat leakage', 'Vibration', 'Incorrect setting'],
  },
  PSV_FAILURE_TO_OPEN: {
    causes: ['Disc stuck to seat (corrosion / scale)', 'Inlet blocked or isolated', 'Spring set too high / gag left in place', 'Test lever or lift mechanism seized'],
    recommendations: ['Treat as a safety-critical fault — reduce pressure immediately', 'Verify inlet isolation is open and unobstructed', 'Bench test and recertify the valve', 'Inspect for corrosion between disc and seat'],
    rootCauses: ['Disc stuck', 'Inlet blocked', 'Set too high / gagged', 'Mechanism seized'],
  },
  PSV_CHATTERING: {
    causes: ['Oversized relief valve for the load', 'Excessive inlet pressure drop', 'High built-up back-pressure', 'Blowdown ring set incorrectly'],
    recommendations: ['Check inlet piping pressure drop (< 3 % of set)', 'Verify outlet back-pressure and discharge piping', 'Adjust blowdown ring per OEM', 'Review valve sizing against relief load'],
    rootCauses: ['Oversized valve', 'Inlet pressure drop', 'Back-pressure', 'Blowdown setting'],
  },
  TRAP_FAILED_OPEN: {
    causes: ['Worn valve seat / disc', 'Dirt holding the mechanism open', 'Bellows or float failure', 'Trap oversized for the load'],
    recommendations: ['Confirm with ultrasonic / temperature survey', 'Replace or rebuild the trap element', 'Clean the strainer', 'Check trap sizing for the condensate load'],
    rootCauses: ['Seat wear', 'Dirt', 'Element failure', 'Oversized'],
  },
  TRAP_BLOCKED: {
    causes: ['Strainer blocked', 'Float collapsed or waterlogged', 'Air binding', 'Outlet isolation closed'],
    recommendations: ['Check outlet temperature and condensate discharge', 'Clean the strainer', 'Inspect float / mechanism', 'Verify downstream isolation is open'],
    rootCauses: ['Strainer blocked', 'Float failure', 'Air binding', 'Isolation closed'],
  },
  TRAP_POOR_REMOVAL: {
    causes: ['Trap undersized for the load', 'Partial strainer blockage', 'High back-pressure in the return line', 'Insufficient differential pressure'],
    recommendations: ['Measure inlet / outlet temperatures', 'Clean the strainer', 'Check condensate return back-pressure', 'Review trap sizing'],
    rootCauses: ['Undersized', 'Partial blockage', 'Back-pressure', 'Low ΔP'],
  },
  CHECK_REVERSE_FLOW: {
    causes: ['Disc not seating (wear / debris)', 'Return header pressure above trap discharge', 'Spring broken', 'Valve installed backwards'],
    recommendations: ['Isolate and inspect disc and seat', 'Check return header pressure', 'Replace spring / disc as required', 'Verify flow arrow orientation'],
    rootCauses: ['Disc wear', 'Return back-pressure', 'Spring failure', 'Installation error'],
  },
  CHECK_FAILURE_TO_OPEN: {
    causes: ['Disc stuck closed (scale / corrosion)', 'Spring too stiff for the available ΔP', 'Hinge pin seized', 'Blockage upstream of the disc'],
    recommendations: ['Verify upstream / downstream pressures', 'Inspect disc, hinge and spring', 'Clean or replace internals', 'Confirm cracking pressure against the design'],
    rootCauses: ['Disc stuck', 'Spring too stiff', 'Hinge seized', 'Blockage'],
  },
  CHECK_FAILURE_TO_CLOSE: {
    causes: ['Debris holding the disc open', 'Worn hinge or seat', 'Broken spring', 'Disc deformed'],
    recommendations: ['Inspect for debris', 'Replace worn seat / disc / spring', 'Check for reverse flow at low load', 'Review strainer upstream'],
    rootCauses: ['Debris', 'Wear', 'Spring failure', 'Disc damage'],
  },
};

const GENERIC = {
  causes: ['Component degradation', 'Instrumentation fault', 'Process upset'],
  recommendations: ['Inspect the component at the next opportunity', 'Verify instrumentation and signals', 'Review process conditions'],
  rootCauses: ['Component degradation', 'Instrumentation fault', 'Process upset'],
};

export function knowledgeFor(type) { return KB[type] || GENERIC; }
