import * as THREE from 'three';

/**
 * Camera presets and smooth fly-to transitions.
 * The initial view frames Ball Valve → ESD → V-Port with the Yankee in context.
 */
export const VIEWS = {
  initial: {
    position: new THREE.Vector3(-1.0, 1.8, 3.25),
    target: new THREE.Vector3(4.3, 1.02, -0.5),
  },
  overview: {
    position: new THREE.Vector3(5.6, 4.3, 8.9),
    target: new THREE.Vector3(7.2, 1.15, -0.6),
  },
};

export function createCameraRig(camera, controls, onFrame) {
  let anim = null;

  function flyTo(position, target, duration = 1.1) {
    anim = {
      t: 0,
      duration,
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: position.clone(),
      toTarget: target.clone(),
    };
  }

  function reset() {
    flyTo(VIEWS.initial.position, VIEWS.initial.target, 1.2);
  }

  function overview() {
    flyTo(VIEWS.overview.position, VIEWS.overview.target, 1.4);
  }

  /** Frame an object's bounding box, keeping the current viewing direction. */
  function focusBox(box, padding = 2.6) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const dist = Math.max(0.6, (radius * padding) / Math.tan(fov / 2));
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (dir.y < 0.2) dir.y = 0.2;
    dir.normalize();
    flyTo(center.clone().add(dir.multiplyScalar(dist)), center, 1.0);
  }

  onFrame((dt) => {
    if (!anim) return;
    anim.t += dt;
    const k = easeInOut(Math.min(1, anim.t / anim.duration));
    camera.position.lerpVectors(anim.fromPos, anim.toPos, k);
    controls.target.lerpVectors(anim.fromTarget, anim.toTarget, k);
    if (k >= 1) anim = null;
  });

  // Cancel a fly-to when the user grabs the camera.
  controls.addEventListener('start', () => { anim = null; });

  camera.position.copy(VIEWS.initial.position);
  controls.target.copy(VIEWS.initial.target);
  controls.update();

  return { flyTo, reset, overview, focusBox };
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
