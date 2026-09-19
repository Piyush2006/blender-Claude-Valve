import * as THREE from 'three';
import { simulationState as S } from '../simulation/simulationState.js';

/**
 * Drives the valve moving parts from the simulation state.
 * All kinematic constants below were derived from the GLB inspection
 * (rest transforms, bounding boxes and the ValveShaft animation clip).
 */

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();

// ESD spring-return actuator: pistons slide inward on trip, springs extend to follow.
const ESD_PISTON_STROKE = 0.045;         // m
const ESD_SPRING_REST_LEN = 0.068;       // m (from GLB bbox)

// V-Port pneumatic actuator (air-to-open): fitted from the two poses present in the GLB
// (20 % open in the process scene, 100 % open in the exterior scene).
const VPORT_STEM_Y_CLOSED = 0.035, VPORT_STEM_Y_OPEN = -0.040;
const VPORT_SPRING_CLOSED = 0.960, VPORT_SPRING_OPEN = 0.304;

// Check valve disc lift (m) and spring free length (m, from bbox).
const CHECK_LIFT = 0.02;
const CHECK_SPRING_LEN = 0.05;

// Safety valve stem lift when relieving (m). Stays 0 in phase 1.
const PSV_LIFT = 0.012;

export function createValveController(map) {
  const ball = map.components.ballValve;
  const esd = map.components.esdValve;
  const vport = map.components.vPortValve;
  const check = map.components.checkValve;
  const psv = map.components.safetyValve;

  function update() {
    updateBallValve();
    updateEsdValve();
    updateVPort();
    updateCheckValve();
    updateSafetyValve();
  }

  function updateBallValve() {
    const stem = ball.parts.stem;
    if (!stem) return;
    const closedFrac = 1 - S.ballValve.position / 100;
    // Quarter turn about the stem axis (local Y). Ball + handle are children of the stem.
    stem.quaternion.copy(ball.rest.stem.quaternion).multiply(_q.setFromAxisAngle(Y_AXIS, -Math.PI / 2 * closedFrac));
  }

  function updateEsdValve() {
    const closedFrac = 1 - S.esdValve.position / 100;
    const { stem, pistonA, pistonB, springA, springB } = esd.parts;
    if (stem) {
      stem.quaternion.copy(esd.rest.stem.quaternion).multiply(_q.setFromAxisAngle(Y_AXIS, Math.PI / 2 * closedFrac));
    }
    // Rack-and-pinion / scotch-yoke: pistons travel toward the centre as the springs extend.
    if (pistonA) pistonA.position.x = esd.rest.pistonA.position.x - ESD_PISTON_STROKE * closedFrac;
    if (pistonB) pistonB.position.x = esd.rest.pistonB.position.x + ESD_PISTON_STROKE * closedFrac;
    const springScale = 1 + (ESD_PISTON_STROKE / ESD_SPRING_REST_LEN) * closedFrac;
    if (springA) springA.scale.x = esd.rest.springA.scale.x * springScale;
    if (springB) springB.scale.x = esd.rest.springB.scale.x * springScale;
  }

  function updateVPort() {
    // Physical pose follows the ACTUAL feedback value (never the command).
    const open = S.vPortValve.physicalPosition / 100;
    const { shaft, actuatorStem, actuatorSpring } = vport.parts;
    if (shaft) {
      // Absolute pose: 0° = closed, -90° about local Z = fully open (matches the GLB clip).
      shaft.quaternion.setFromAxisAngle(Z_AXIS, -Math.PI / 2 * open);
    }
    if (actuatorStem) {
      actuatorStem.position.y = THREE.MathUtils.lerp(VPORT_STEM_Y_CLOSED, VPORT_STEM_Y_OPEN, open);
    }
    if (actuatorSpring) {
      actuatorSpring.scale.y = THREE.MathUtils.lerp(VPORT_SPRING_CLOSED, VPORT_SPRING_OPEN, open);
    }
  }

  function updateCheckValve() {
    const lift = S.checkValve.lift;
    const { stem, spring } = check.parts;
    if (stem) stem.position.x = check.rest.stem.position.x + CHECK_LIFT * lift;
    if (spring) spring.scale.x = check.rest.spring.scale.x * ((CHECK_SPRING_LEN - CHECK_LIFT * lift) / CHECK_SPRING_LEN);
  }

  function updateSafetyValve() {
    const { stem } = psv.parts;
    if (stem) stem.position.y = psv.rest.stem.position.y + PSV_LIFT * S.safetyValve.lift;
  }

  return { update };
}
