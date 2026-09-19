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
      { id: 'positionMismatch', label: 'Position Mismatch', type: 'VPORT_POSITION_MISMATCH', short: 'POSITION MISMATCH', severity: 'anomaly' },
      { id: 'sticking', label: 'Sticking', type: 'VPORT_STICKING', short: 'STICKING', severity: 'anomaly' },
      { id: 'slowResponse', label: 'Slow Response', type: 'VPORT_SLOW_RESPONSE', short: 'SLOW RESPONSE', severity: 'anomaly' },
      { id: 'hunting', label: 'Hunting / Oscillation', type: 'VPORT_HUNTING', short: 'HUNTING', severity: 'anomaly' },
      { id: 'trimWear', label: 'Trim Wear', type: 'VPORT_TRIM_WEAR', short: 'TRIM WEAR', severity: 'warning' },   // predictive: attention, not critical
    ],
  },
  esdValve: {
    label: 'ESD Valve',
    anomalies: [
      { id: 'normal', label: 'Normal' },
      { id: 'failToClose', label: 'Fail to Close', type: 'ESD_FAIL_TO_CLOSE', short: 'FAIL TO CLOSE', severity: 'anomaly' },
      { id: 'slowShutdown', label: 'Slow Shutdown', type: 'ESD_SLOW_SHUTDOWN', short: 'SLOW SHUTDOWN', severity: 'warning' },
      { id: 'partialClosure', label: 'Partial Closure', type: 'ESD_PARTIAL_CLOSURE', short: 'PARTIAL CLOSURE', severity: 'anomaly' },
      { id: 'lowAirPressure', label: 'Low Pneumatic Air Pressure', type: 'ESD_LOW_AIR', short: 'LOW AIR PRESSURE', severity: 'anomaly' },
    ],
  },
  ballValve: {
    label: 'Ball Valve',
    anomalies: [
      { id: 'normal', label: 'Normal' },
      { id: 'failToOpen', label: 'Fail to Open', type: 'BALL_FAIL_TO_OPEN', short: 'FAIL TO OPEN', severity: 'anomaly' },
      { id: 'failToClose', label: 'Fail to Close', type: 'BALL_FAIL_TO_CLOSE', short: 'FAIL TO CLOSE', severity: 'anomaly' },
      { id: 'slowOperation', label: 'Slow Operation', type: 'BALL_SLOW_OPERATION', short: 'SLOW OPERATION', severity: 'anomaly' },
      { id: 'passing', label: 'Passing / Leakage', type: 'BALL_PASSING', short: 'VALVE PASSING', severity: 'warning' },
    ],
  },
  safetyValve: {
    label: 'Safety / Relief Valve',
    anomalies: [
      { id: 'normal', label: 'Normal' },
      { id: 'pressureRelief', label: 'Pressure Relief (correct operation)', type: 'PSV_RELIEF', short: 'RELIEVING', severity: 'info' },
      { id: 'unexpectedOpening', label: 'Unexpected Opening', type: 'PSV_UNEXPECTED_OPENING', short: 'UNEXPECTED OPENING', severity: 'anomaly' },
      { id: 'failureToOpen', label: 'Failure to Open', type: 'PSV_FAILURE_TO_OPEN', short: 'FAILURE TO OPEN', severity: 'anomaly' },
      { id: 'chattering', label: 'Chattering', type: 'PSV_CHATTERING', short: 'CHATTERING', severity: 'anomaly' },
    ],
  },
  steamTrap: {
    label: 'Steam Trap',
    anomalies: [
      { id: 'normal', label: 'Normal' },
      { id: 'failedOpen', label: 'Failed Open', type: 'TRAP_FAILED_OPEN', short: 'POSSIBLE FAILED OPEN', severity: 'anomaly' },
      { id: 'blocked', label: 'Blocked', type: 'TRAP_BLOCKED', short: 'BLOCKED', severity: 'anomaly' },
      { id: 'poorRemoval', label: 'Poor Condensate Removal', type: 'TRAP_POOR_REMOVAL', short: 'POOR CONDENSATE REMOVAL', severity: 'warning' },
    ],
  },
  checkValve: {
    label: 'Check Valve',
    anomalies: [
      { id: 'normal', label: 'Normal' },
      { id: 'reverseFlow', label: 'Reverse Flow', type: 'CHECK_REVERSE_FLOW', short: 'REVERSE FLOW', severity: 'anomaly' },
      { id: 'failureToOpen', label: 'Failure to Open', type: 'CHECK_FAILURE_TO_OPEN', short: 'FAILURE TO OPEN', severity: 'anomaly' },
      { id: 'failureToClose', label: 'Failure to Close', type: 'CHECK_FAILURE_TO_CLOSE', short: 'FAILURE TO CLOSE', severity: 'anomaly' },
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
