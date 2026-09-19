import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/**
 * Creates renderer, scene, camera, lights, controls and the render loop.
 * Returns a context object shared by the rest of the app.
 */
export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Label overlay (CSS2D) for component status tags.
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9ecf0);

  // Soft studio environment for metallic PBR materials (no visible backdrop).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.05, 200);
  camera.position.set(2, 2.5, 5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.25;
  controls.maxDistance = 45;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // never go below the floor
  controls.target.set(3.8, 1.0, 0);

  // --- Lighting: hemisphere fill + warm key + cool rim ---------------------------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x5a6068, 0.45);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2e3, 1.6);
  key.position.set(4, 9, 6);
  key.target.position.set(5, 0.8, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.6);
  rim.position.set(-6, 5, -7);
  scene.add(rim);

  // Subtle floor grid for scale (sits just above the GLB ground plane).
  // Sized to stay inside the GLB ground slab (x -6..20, z -8..12).
  const grid = new THREE.GridHelper(20, 20, 0x5c646e, 0x4a525b);
  grid.position.set(7, 0.002, 2);
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  scene.add(grid);

  // --- Frame loop --------------------------------------------------------------
  const clock = new THREE.Clock();
  const frameCallbacks = new Set();
  let running = true;
  let renderEnabled = true;

  function onFrame(fn) {
    frameCallbacks.add(fn);
    return () => frameCallbacks.delete(fn);
  }

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1); // clamp for tab switches
    for (const fn of frameCallbacks) fn(dt);
    if (!renderEnabled) return;                 // view hidden: keep simulating, skip drawing
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  /** Enable/disable drawing (used when switching between the Twin and Dashboard tabs). */
  function setRenderEnabled(enabled) {
    renderEnabled = !!enabled;
    if (renderEnabled && container.clientWidth > 0) resize();
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  function dispose() {
    running = false;
    window.removeEventListener('resize', resize);
    controls.dispose();
    envTex.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    labelRenderer.domElement.remove();
  }

  return { renderer, labelRenderer, scene, camera, controls, onFrame, start: loop, resize, dispose, setRenderEnabled };
}
