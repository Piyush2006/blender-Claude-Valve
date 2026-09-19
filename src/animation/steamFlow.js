import * as THREE from 'three';
import { simulationState as S } from '../simulation/simulationState.js';
import { STEAM_SEGMENTS } from '../components/componentRegistry.js';

/**
 * In-pipe steam visualisation.
 *
 * The GLB already contains one thin cylinder per steam-line segment
 * (SteamFlow_P1..P5) sitting on the pipe centreline, inside the pipe bore.
 * We reuse exactly that geometry and only swap its material for an animated
 * shader (wisps of hot steam drifting in +X), plus a very small point stream
 * (≈50 sprites per metre) confined to the cylinder's interior. Nothing is
 * emitted outside the pipe.
 *
 * Presence / intensity / speed are all read from simulationState.flow.
 */

const STEAM_VERT = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const STEAM_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uFlow;      // 0..1 flow rate → speed + brightness
  uniform float uPresence;  // 0..1 steam present in this segment
  uniform float uLeak;      // 0..1 leak jet entering at the segment start (passing valve upstream)
  uniform float uHalfLen;
  uniform float uSeed;
  uniform vec3 uColorHot;
  uniform vec3 uColorCool;
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 3; i++) { s += a * noise(p); p = p * 2.03 + vec3(7.1, 1.7, 3.3); a *= 0.5; }
    return s;
  }

  void main() {
    // Any non-zero flow must stay visible as a slow trickle; a leak jet moves on its own.
    float trickle = (uFlow > 0.002 || uLeak > 0.0) ? 1.0 : 0.0;
    float speed = max(2.8 * uFlow, max(0.5 * trickle, 1.2 * uLeak));   // m/s — stops at zero flow
    vec3 p = vPos + vec3(uSeed, 0.0, 0.0);
    // elongated wisps: low frequency along the pipe, higher across it
    vec3 q1 = vec3(p.x * 2.2 - uTime * speed * 2.2, p.y * 24.0 + uTime * 0.35, p.z * 24.0 - uTime * 0.25);
    vec3 q2 = vec3(p.x * 6.5 - uTime * speed * 6.5, p.y * 40.0 + 3.7, p.z * 40.0 + uTime * 0.5);
    float n1 = fbm(q1);
    float n2 = fbm(q2);
    // high-contrast wisps so the steam reads as moving vapour, not a solid rod
    float wisps = smoothstep(0.42, 0.72, n1) * 0.9 + smoothstep(0.5, 0.8, n2) * 0.5;
    wisps *= 0.65 + 0.35 * smoothstep(0.3, 0.7, n1 * n2 * 2.5);

    // soft silhouette so the cylinder reads as a volume
    float facing = clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0);
    float body = pow(facing, 1.4);

    // density: thin the wisps as flow drops so the change is obvious, not just slower
    float density = max(pow(uFlow, 0.75), 0.18 * trickle);
    // Leak jet: concentrated near the upstream end of the segment, fading along the pipe.
    float leak = uLeak * exp(-(vPos.x + uHalfLen) * 1.3);
    float strength = uPresence * (0.05 + 0.95 * density);
    float a = strength * (0.04 + wisps * (0.35 + 0.65 * density)) * body;
    // Leak jet: a solid turbulent core that fades along the pipe (steam forced past the seats).
    a += leak * (0.45 + 0.7 * wisps) * body;
    a = clamp(a, 0.0, 0.9);
    vec3 col = mix(uColorCool, uColorHot, clamp(wisps * 0.5 + uFlow * 0.35 + leak * 0.8, 0.0, 1.0));
    gl_FragColor = vec4(col, a);
  }
`;

const POINT_VERT = /* glsl */ `
  attribute float aOffset;
  attribute float aRadius;
  attribute float aAngle;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aRank;
  uniform float uTime;
  uniform float uFlow;
  uniform float uLeak;
  uniform float uHalfLen;
  uniform float uRadius;
  uniform float uPointScale;
  varying float vAlpha;
  varying float vJet;
  void main() {
    float trickle = (uFlow > 0.002 || uLeak > 0.0) ? 1.0 : 0.0;
    float speed = max(2.8 * uFlow, max(0.5 * trickle, 1.2 * uLeak));   // particles stop when flow is zero
    float t = fract(aOffset + uTime * speed * aSpeed / (2.0 * uHalfLen));
    float ang = aAngle + uTime * 0.7 * aSpeed;
    vec3 p = vec3(-uHalfLen + t * 2.0 * uHalfLen, aRadius * uRadius * cos(ang), aRadius * uRadius * sin(ang));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uPointScale / -mv.z;
    // density: only the first (flow × 100) % of particles by rank are shown (min. a trickle)
    float visible = step(aRank, max(uFlow, 0.12 * trickle));
    // leak jet: extra particles crowd the first part of the segment
    float jet = step(t, 0.45) * step(aRank, uLeak) * uLeak;
    visible = max(visible, step(0.001, jet));
    vJet = jet;
    vAlpha = smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.9, t) * visible;
    gl_PointSize *= 1.0 + 0.6 * jet;
    if (visible < 0.5) gl_PointSize = 0.0;
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAG = /* glsl */ `
  precision highp float;
  uniform float uFlow;
  uniform float uPresence;
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vJet;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float soft = smoothstep(1.0, 0.0, d) * smoothstep(1.0, 0.0, d);
    float a = uPresence * (0.08 + 0.3 * uFlow + 0.55 * vJet) * soft * vAlpha;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export function createSteamFlow(map, renderer, camera) {
  const segments = [];
  const sharedUniforms = { uTime: { value: 0 } };
  const pointScale = { value: 1 };

  function updatePointScale() {
    const h = renderer.domElement.clientHeight;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    pointScale.value = (h / 2) / Math.tan(fov / 2) * renderer.getPixelRatio();
  }
  updatePointScale();
  window.addEventListener('resize', updatePointScale);

  for (const segDef of STEAM_SEGMENTS) {
    const volume = map.byName.get(segDef.volume);
    if (!volume) { console.warn('[steamFlow] missing volume', segDef.volume); continue; }
    const mesh = volume.isMesh ? volume : volume.children.find((c) => c.isMesh);
    if (!mesh) continue;

    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const halfLen = (bb.max.x - bb.min.x) / 2;
    const radius = (bb.max.y - bb.min.y) / 2;

    const material = new THREE.ShaderMaterial({
      vertexShader: STEAM_VERT,
      fragmentShader: STEAM_FRAG,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uFlow: { value: 0 },
        uPresence: { value: 0 },
        uLeak: { value: 0 },
        uHalfLen: { value: halfLen },
        uSeed: { value: Math.random() * 100 },
        uColorHot: { value: new THREE.Color(1.0, 0.72, 0.45) },
        uColorCool: { value: new THREE.Color(0.92, 0.95, 1.0) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide,
    });
    mesh.material = material;            // runtime replacement only; GLB untouched
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
    mesh.userData.isSteam = true;
    mesh.raycast = () => {};             // steam must never intercept clicks

    const points = makePointStream(halfLen, radius, sharedUniforms.uTime, pointScale);
    mesh.add(points);

    segments.push({ def: segDef, mesh, material, points });
  }

  /**
   * Adds a steam volume for the safety-valve discharge: a cylinder (local +X = flow
   * direction) rotated so it runs up the vent riser. Driven by safetyValve.reliefFlow —
   * the same variable shown in the UI — so the venting steam and the number never differ.
   */
  let vent = null;
  function addVentSegment({ x, z, y0, y1, radius }) {
    const halfLen = (y1 - y0) / 2;
    const geo = new THREE.CylinderGeometry(radius, radius, halfLen * 2, 24, 1, false);
    geo.rotateZ(-Math.PI / 2);                        // cylinder axis → local +X (flow direction)
    const material = new THREE.ShaderMaterial({
      vertexShader: STEAM_VERT,
      fragmentShader: STEAM_FRAG,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uFlow: { value: 0 },
        uPresence: { value: 0 },
        uLeak: { value: 0 },
        uHalfLen: { value: halfLen },
        uSeed: { value: 42 },
        // Grey-blue vapour so the vent reads against the bright sky behind the stack.
        uColorHot: { value: new THREE.Color(0.92, 0.86, 0.80) },
        uColorCool: { value: new THREE.Color(0.58, 0.63, 0.72) },
      },
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'SteamFlow_PSV_Vent';
    mesh.userData.name = 'SteamFlow_PSV_Vent';
    mesh.userData.isSteam = true;
    mesh.raycast = () => {};
    mesh.renderOrder = 2;
    mesh.rotation.z = Math.PI / 2;                    // local +X → world +Y: steam travels up the stack
    mesh.position.set(x, (y0 + y1) / 2, z);
    const points = makePointStream(halfLen, radius, sharedUniforms.uTime, pointScale);
    points.material.uniforms.uColor.value.set(0.6, 0.62, 0.68);
    mesh.add(points);
    mesh.visible = false;
    vent = { mesh, material, points };
    return mesh;
  }

  function update() {
    sharedUniforms.uTime.value = S.time;
    const flow = S.flow.fraction;
    if (vent) {
      const psv = S.safetyValve;
      const ventFraction = Math.min(1.5, psv.reliefFlow / psv.sim.reliefCapacity);   // 0 → no particles at all
      // Presence > 1 gives the thin vent bore more body than the wide main-line volumes.
      const presence = ventFraction > 0.001 ? 1.8 : 0;
      vent.material.uniforms.uFlow.value = ventFraction;
      vent.material.uniforms.uPresence.value = presence;
      vent.points.material.uniforms.uFlow.value = ventFraction;
      vent.points.material.uniforms.uPresence.value = presence;
      vent.mesh.visible = presence > 0;
    }
    const ball = S.ballValve;
    const passing = ball.sim?.anomaly === 'passing' && ball.position <= 0.5 && S.steam.flow > 0;
    const leakStrength = passing ? Math.min(1, 0.3 + ball.sim.leakage / 800) : 0;
    for (const seg of segments) {
      const presence = S.flow.segments[seg.def.id] ?? 0;
      // Leak jet only on the segment immediately downstream of the ball valve (P2).
      const leak = seg.def.id === 'P2' ? leakStrength : 0;
      // Upstream of the control valve steam is present even at zero flow (pressurised, idle).
      seg.material.uniforms.uFlow.value = flow;
      seg.material.uniforms.uPresence.value = presence;
      seg.material.uniforms.uLeak.value = leak;
      seg.points.material.uniforms.uFlow.value = flow;
      seg.points.material.uniforms.uPresence.value = presence;
      seg.points.material.uniforms.uLeak.value = leak;
      seg.mesh.visible = presence > 0.01;
    }
  }

  function dispose() {
    window.removeEventListener('resize', updatePointScale);
    for (const seg of segments) {
      seg.material.dispose();
      seg.points.geometry.dispose();
      seg.points.material.dispose();
      seg.mesh.remove(seg.points);
    }
    if (vent) { vent.material.dispose(); vent.points.geometry.dispose(); vent.points.material.dispose(); vent.mesh.geometry.dispose(); vent.mesh.parent?.remove(vent.mesh); }
  }

  return { update, dispose, segments, addVentSegment };
}

function makePointStream(halfLen, radius, uTime, pointScale) {
  const count = Math.max(16, Math.round(halfLen * 2 * 34));
  const offset = new Float32Array(count);
  const rad = new Float32Array(count);
  const ang = new Float32Array(count);
  const spd = new Float32Array(count);
  const size = new Float32Array(count);
  const rank = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    rank[i] = (i + 0.5) / count;               // evenly spread so density scales linearly with flow
    offset[i] = Math.random();
    rad[i] = Math.sqrt(Math.random()) * 0.8;   // keep well inside the steam core
    ang[i] = Math.random() * Math.PI * 2;
    spd[i] = 0.7 + Math.random() * 0.6;
    size[i] = radius * (0.6 + Math.random() * 0.9);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); // required, unused
  geo.setAttribute('aOffset', new THREE.BufferAttribute(offset, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(rad, 1));
  geo.setAttribute('aAngle', new THREE.BufferAttribute(ang, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aRank', new THREE.BufferAttribute(rank, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), halfLen + radius);

  const mat = new THREE.ShaderMaterial({
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    uniforms: {
      uTime,
      uFlow: { value: 0 },
      uPresence: { value: 0 },
      uLeak: { value: 0 },
      uHalfLen: { value: halfLen },
      uRadius: { value: radius },
      uPointScale: pointScale,
      uColor: { value: new THREE.Color(1.0, 0.82, 0.62) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.raycast = () => {};
  return points;
}
