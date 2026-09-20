/**
 * Central anomaly catalog: which component can simulate which anomaly.
 *
 * `type` is the detector id reported in simulationState.anomaly.type,
 * `severity` decides the flagged status: 'anomaly' → ANOMALY (red),
 * 'warning' → WARNING (amber). The UI, detectors and dashboard all read
 * from this one table.
 */
export const ANOMALY_CATALOG = {
  vPortValve: {
    label: 'V-Port Control Valve',
    anomalies: [
      { id: 'normal', label: 'Normal' },
      { id: 'positionMismatch', label: 'Position Mismatch', type: 'VPORT_POSITION_MISMATCH', short: 'POSITION MISMATCH', severity: 'anomaly', explain: 'Actual position differs from the commanded position.' },
      { id: 'sticking', label: 'Sticking', type: 'VPORT_STICKING', short: 'STICKING', severity: 'anomaly', explain: 'Valve does not move when a new command is given.' },
      { id: 'slowResponse', label: 'Slow Response', type: 'VPORT_SLOW_RESPONSE', short: 'SLOW RESPONSE', severity: 'anomaly', explain: 'Valve reaches the commanded position too slowly.' },
      { id: 'hunting', label: 'Hunting / Oscillation', type: 'VPORT_HUNTING', short: 'HUNTING', severity: 'anomaly', explain: 'Valve oscillates around the commanded position.' },
      { id: 'trimWear', label: 'Trim Wear', type: 'VPORT_TRIM_WEAR', short: 'TRIM WEAR', severity: 'warning', explain: 'Flow is higher than expected for the position — internal trim degradation.' },   // predictive: attention, not critical
    ],
  },
  esdValve: {
    label: 'ESD Valve',
    anomalies: [
      { id: 'normal', label: 'Normal' },
      { id: 'failToClose', label: 'Fail to Close', type: 'ESD_FAIL_TO_CLOSE', short: 'FAIL TO CLOSE', severity: 'anomaly', explain: 'ESD does not close on trip — steam cannot be isolated.' },
      { id: 'slowShutdown', label: 'Slow Shutdown', type: 'ESD_SLOW_SHUTDOWN', short: 'SLOW SHUTDOWN', severity: 'warning', explain: 'ESD closes slower than the acceptable shutdown time.' },
      { id: 'partialClosure', label: 'Partial Closure', type: 'ESD_PARTIAL_CLOSURE', short: 'PARTIAL CLOSURE', severity: 'anomaly', explain: 'ESD stops part-way on trip — steam continues downstream.' },
      { id: 'lowAirPressure', label: 'Low Instrument Air', type: 'ESD_LOW_AIR', short: 'LOW AIR PRESSURE', severity: 'anomaly', explain: 'Instrument air below minimum — actuator cannot complete its stroke.' },
      { id: 'cyclicDegradation', label: 'Cyclic Response Degradation', type: 'ESD_RESPONSE_DEGRADATION', short: 'RESPONSE DEGRADING', severity: 'warning', explain: 'Repeated ON/OFF cycles: the response delay grows — normal → slight delay → degrading → slow response.' },   // predictive: attention
    ],
  },
  ballValve: {
    label: 'Ball Valve',
    anomalies: [
      { id: 'normal', label: 'Normal' },
      { id: 'failToOpen', label: 'Fail to Open', type: 'BALL_FAIL_TO_OPEN', short: 'FAIL TO OPEN', severity: 'anomaly', explain: 'Valve does not open on command — steam remains blocked.' },
      { id: 'failToClose', label: 'Fail to Close', type: 'BALL_FAIL_TO_CLOSE', short: 'FAIL TO CLOSE', severity: 'anomaly', explain: 'Valve does not close on command — steam cannot be isolated.' },
      { id: 'slowOperation', label: 'Slow Response', type: 'BALL_SLOW_OPERATION', short: 'SLOW RESPONSE', severity: 'warning', explain: 'Valve reaches the commanded state much later than expected.' },   // eventually completes: attention, not critical
      { id: 'passing', label: 'Passing / Leakage', type: 'BALL_PASSING', short: 'VALVE PASSING', severity: 'warning', explain: 'Valve is closed but a small steam flow passes the seats.' },
    ],
  },
  safetyValve: {
    label: 'Safety / Relief Valve',
    anomalies: [
      { id: 'normal', label: 'Normal' },
      { id: 'pressureRelief', label: 'Pressure Relief (correct operation)', type: 'PSV_RELIEF', short: 'RELIEVING', severity: 'info', explain: 'Correct operation: pressure reaches the set point, the valve lifts and vents, pressure falls.' },
      { id: 'unexpectedOpening', label: 'Unexpected Opening', type: 'PSV_UNEXPECTED_OPENING', short: 'UNEXPECTED OPENING', severity: 'anomaly', explain: 'Safety valve opens below set point, indicating an abnormal condition.' },
      { id: 'failureToOpen', label: 'Failure to Open', type: 'PSV_FAILURE_TO_OPEN', short: 'FAILURE TO OPEN', severity: 'anomaly', explain: 'Pressure is above the set point but the valve stays closed — no relief.' },
      { id: 'chattering', label: 'Chattering', type: 'PSV_CHATTERING', short: 'CHATTERING', severity: 'anomaly', explain: 'Valve rapidly opens and closes around the set point.' },
    ],
  },
  steamTrap: {
    label: 'Steam Trap',
    anomalies: [
      { id: 'normal', label: 'Normal' },
      { id: 'failedOpen', label: 'Failed Open', type: 'TRAP_FAILED_OPEN', short: 'POSSIBLE FAILED OPEN', severity: 'anomaly', explain: 'Live steam passing — outlet almost as hot as the inlet.' },
      { id: 'blocked', label: 'Blocked', type: 'TRAP_BLOCKED', short: 'BLOCKED', severity: 'anomaly', explain: 'No discharge — condensate is backing up.' },
      { id: 'poorRemoval', label: 'Poor Condensate Removal', type: 'TRAP_POOR_REMOVAL', short: 'POOR CONDENSATE REMOVAL', severity: 'warning', explain: 'Sluggish discharge with a cool outlet.' },
    ],
  },
  checkValve: {
    label: 'Check Valve',
    anomalies: [
      { id: 'normal', label: 'Normal' },
      { id: 'reverseFlow', label: 'Reverse Flow', type: 'CHECK_REVERSE_FLOW', short: 'REVERSE FLOW', severity: 'anomaly', explain: 'Condensate is flowing backward through the check valve.' },
      { id: 'failureToOpen', label: 'Failure to Open', type: 'CHECK_FAILURE_TO_OPEN', short: 'FAILURE TO OPEN', severity: 'anomaly', explain: 'Disc stuck closed although forward pressure is present.' },
      { id: 'failureToClose', label: 'Failure to Close', type: 'CHECK_FAILURE_TO_CLOSE', short: 'FAILURE TO CLOSE', severity: 'anomaly', explain: 'Disc stuck open — reverse flow is not blocked.' },
    ],
  },
};

export const COMPONENT_ORDER = ['vPortValve', 'esdValve', 'ballValve', 'safetyValve', 'steamTrap', 'checkValve'];

export function anomalyDef(component, anomaly) {
  return ANOMALY_CATALOG[component]?.anomalies.find((a) => a.id === anomaly) || null;
}

/** Lookup by detector type: { component, ...def } */
export function anomalyByType(type) {
  for (const [component, c] of Object.entries(ANOMALY_CATALOG)) {
    const def = c.anomalies.find((a) => a.type === type);
    if (def) return { component, componentLabel: c.label, ...def };
  }
  return null;
}
