import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/**
 * Procedural industrial equipment added on top of the GLB (the file is untouched):
 *
 *  - Yankee_Rotary_Joint  — stationary steam rotary joint wrapped around the Yankee
 *                           steam-inlet journal; its rotor collar turns with the Yankee.
 *  - Separator_Tank       — vertical separator vessel in the condensate / blow-through
 *                           path downstream of the Yankee, with its own flanged piping:
 *                           Yankee condensate → separator (side inlet), bottom outlet →
 *                           steam trap, top outlet → blow-through / steam return.
 *
 * The existing steam trap, check valve and downstream condensate piping are translated
 * +1.9 m in X (transform only) to make room; nothing is rebuilt, merged or resized.
 * All bodies reuse materials that already exist in the GLB so the look stays consistent.
 */

export const CONDENSATE_SHIFT = new THREE.Vector3(1.9, 0, 0);
const SHIFTED_OBJECTS = ['SteamTrap', 'Condensate_C2', 'P_CheckValve', 'Condensate_C3', 'Condensate_Return', 'Support_Condensate_C3'];

const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const PIPE_R = 0.044;      // condensate pipe radius (from Condensate_C1)
const FLANGE_R = 0.095;    // flange radius (from YP_Flange primitives)
const FLANGE_T = 0.05;

export function addProceduralEquipment(root) {
  shiftCondensateLine(root);

  // Each component gets its own material clones so selection / anomaly tints stay local
  // (the GLB shares one material instance across many meshes).
  const rotaryJoint = buildRotaryJoint(collectMaterials(root));
  root.add(rotaryJoint);

  const separator = buildSeparatorTank(collectMaterials(root));
  root.add(separator);

  const piping = buildSeparatorPiping(collectMaterials(root));
  piping.forEach((g) => root.add(g));

  return { rotaryJoint, separator, piping };
}

/* ------------------------------------------------------------------------------------ */
/* Helpers                                                                                */
/* ------------------------------------------------------------------------------------ */

function collectMaterials(root) {
  const byName = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) if (m?.name && !byName.has(m.name)) byName.set(m.name, m);
  });
  const get = (name, fallback) => {
    const src = byName.get(name) || byName.get(fallback);
    const m = src ? src.clone() : new THREE.MeshStandardMaterial({ color: 0x777c84, metalness: 1, roughness: 0.4 });
    m.name = `${src ? src.name : 'Procedural'}__proc`;
    return m;
  };
  return {
    pipe: get('YP_Pipe_Condensate'),
    steamPipe: get('YP_Pipe_Steam'),
    flange: get('YP_Flange'),
    bolt: get('YP_Bolt'),
    cast: get('YP_Yankee_Frame'),          // dark cast iron
    vessel: get('YP_Trap_Body'),           // grey painted steel
    stainless: get('YPS_Stainless'),
    chrome: get('ESD_Ball_Chrome', 'BV_Ball_Chrome'),
    support: get('YP_Support'),
    accent: get('YPS_Blue_Accent'),
    concrete: get('YP_Concrete'),
  };
}

function findByName(root, name) {
  let found = null;
  root.traverse((o) => { if (!found && (o.userData?.name === name || o.name === name)) found = o; });
  return found;
}

function shiftCondensateLine(root) {
  for (const name of SHIFTED_OBJECTS) {
    const obj = findByName(root, name);
    if (!obj) { console.warn('[procedural] missing', name); continue; }
    obj.position.add(CONDENSATE_SHIFT);
    obj.updateMatrixWorld(true);
  }
}

function named(obj, name) {
  obj.name = name;
  obj.userData.name = name;
  return obj;
}

function mesh(geometry, material, name) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) named(m, name);
  return m;
}

/** Cylinder whose axis runs along `axis` ('x' | 'y' | 'z'), centred at `pos`. */
function cylinder(radius, length, axis, pos, material, name, opts = {}) {
  const geo = new THREE.CylinderGeometry(opts.radiusTop ?? radius, opts.radiusBottom ?? radius, length, opts.segments ?? 40, 1, opts.open ?? false);
  const m = mesh(geo, material, name);
  m.quaternion.setFromUnitVectors(AXIS.y, AXIS[axis]);
  m.position.copy(pos);
  return m;
}

/** Straight tube between two points. */
function tube(a, b, radius, material, name) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = mesh(new THREE.CylinderGeometry(radius, radius, len, 28, 1, true), material, name);
  m.quaternion.setFromUnitVectors(AXIS.y, dir.normalize());
  m.position.copy(a).lerp(b, 0.5);
  return m;
}

/** 90° elbow at corner P turning from direction d1 into d2 (both unit, perpendicular). */
function elbow(P, d1, d2, bendR, radius, material) {
  const geo = new THREE.TorusGeometry(bendR, radius, 14, 20, Math.PI / 2);
  const m = mesh(geo, material);
  const x = d1.clone(), y = d2.clone().negate(), z = x.clone().cross(y);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  m.position.copy(P).addScaledVector(d1, -bendR).addScaledVector(d2, bendR);
  return m;
}

/** Flange disc perpendicular to `dir`, its face at `pos` extending `thickness` along dir. */
function flange(pos, dir, material, thickness = FLANGE_T, radius = FLANGE_R) {
  const m = mesh(new THREE.CylinderGeometry(radius, radius, thickness, 40), material);
  m.quaternion.setFromUnitVectors(AXIS.y, dir);
  m.position.copy(pos).addScaledVector(dir, thickness / 2);
  return m;
}

/** Bolt ring on a flange face. */
function boltRing(pos, dir, count, ringR, material, headR = 0.011, headLen = 0.02) {
  const g = new THREE.Group();
  const u = Math.abs(dir.y) > 0.9 ? AXIS.x.clone() : AXIS.y.clone();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  u.crossVectors(v, dir).normalize();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const p = pos.clone().addScaledVector(u, Math.cos(a) * ringR).addScaledVector(v, Math.sin(a) * ringR);
    const b = mesh(new THREE.CylinderGeometry(headR, headR, headLen, 6), material);
    b.quaternion.setFromUnitVectors(AXIS.y, dir);
    b.position.copy(p).addScaledVector(dir, headLen / 2);
    g.add(b);
  }
  return g;
}

/**
 * Pipe run through waypoints with torus elbows at every interior corner.
 * Waypoints must form axis-aligned 90° turns.
 */
function pipeRun(points, radius, bendR, material, name) {
  const g = named(new THREE.Group(), name);
  const dirs = [];
  for (let i = 0; i < points.length - 1; i++) dirs.push(points[i + 1].clone().sub(points[i]).normalize());
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i].clone(), b = points[i + 1].clone();
    if (i > 0) a.addScaledVector(dirs[i], bendR);
    if (i < points.length - 2) b.addScaledVector(dirs[i], -bendR);
    g.add(tube(a, b, radius, material));
  }
  for (let i = 1; i < points.length - 1; i++) g.add(elbow(points[i], dirs[i - 1], dirs[i], bendR, radius, material));
  return g;
}

function staticTag(text, pos, centerY = 1) {
  const el = document.createElement('div');
  el.className = 'tag tag-static';
  el.innerHTML = `<span class="tag-name">${text}</span>`;
  const tag = new CSS2DObject(el);
  tag.position.copy(pos);
  tag.center.set(0.5, centerY);
  return tag;
}

/* ------------------------------------------------------------------------------------ */
/* Rotary joint                                                                           */
/* ------------------------------------------------------------------------------------ */

const RJ = {
  axisY: 1.1, axisZ: 0,
  housingX0: 7.30, housingX1: 7.485, housingR: 0.165,   // stationary body over the flange pair
  rotorX0: 7.492, rotorX1: 7.552, rotorR: 0.148,        // rotating collar on the journal
};

function buildRotaryJoint(mats) {
  const g = named(new THREE.Group(), 'Yankee_Rotary_Joint');
  const c = (x) => new THREE.Vector3(x, RJ.axisY, RJ.axisZ);
  const len = RJ.housingX1 - RJ.housingX0;

  // Stationary housing: cast body, inlet flange with bolts, rear bearing ring.
  g.add(cylinder(RJ.housingR, len, 'x', c(RJ.housingX0 + len / 2), mats.cast, 'Yankee_Rotary_Joint_Housing'));
  g.add(cylinder(0.19, 0.035, 'x', c(RJ.housingX0 + 0.0175), mats.flange, 'Yankee_Rotary_Joint_Flange'));
  g.add(boltRing(c(RJ.housingX0), AXIS.x.clone().negate(), 8, 0.155, mats.bolt));
  g.add(cylinder(0.175, 0.03, 'x', c(RJ.housingX1 - 0.015), mats.stainless, 'Yankee_Rotary_Joint_BearingRing'));
  // Two shallow cooling ribs on the body.
  for (const x of [RJ.housingX0 + 0.075, RJ.housingX0 + 0.12]) g.add(cylinder(RJ.housingR + 0.008, 0.012, 'x', c(x), mats.cast));

  // Rotating collar (turns with the Yankee): chrome ring with six drive lugs.
  const rotor = named(new THREE.Group(), 'Yankee_Rotary_Joint_Rotor');
  rotor.position.copy(c((RJ.rotorX0 + RJ.rotorX1) / 2));
  const rl = RJ.rotorX1 - RJ.rotorX0;
  const ring = mesh(new THREE.CylinderGeometry(RJ.rotorR, RJ.rotorR, rl, 40), mats.chrome);
  ring.quaternion.setFromUnitVectors(AXIS.y, AXIS.x);
  rotor.add(ring);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const lug = mesh(new THREE.BoxGeometry(rl * 0.8, 0.028, 0.03), mats.bolt);
    lug.position.set(0, Math.cos(a) * (RJ.rotorR + 0.01), Math.sin(a) * (RJ.rotorR + 0.01));
    lug.rotation.x = -a;
    rotor.add(lug);
  }
  g.add(rotor);

  // Syphon / vent connection on top of the housing (short flanged stub).
  const portX = RJ.housingX0 + 0.10;
  const portBase = new THREE.Vector3(portX, RJ.axisY + RJ.housingR - 0.02, RJ.axisZ);
  g.add(tube(portBase, portBase.clone().add(new THREE.Vector3(0, 0.14, 0)), 0.03, mats.steamPipe, 'Yankee_Rotary_Joint_SyphonPort'));
  g.add(flange(portBase.clone().add(new THREE.Vector3(0, 0.12, 0)), AXIS.y, mats.flange, 0.025, 0.058));

  // Torque arm: lug on the housing tied to the inlet bearing pedestal so the body cannot spin.
  const armY = RJ.axisY + 0.10, armZ = 0.27;   // bracket lands on the pedestal face (z = 0.248)
  const lug = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.16), mats.cast);
  lug.position.set(RJ.housingX0 + 0.10, armY, 0.19);
  g.add(lug);
  g.add(tube(new THREE.Vector3(RJ.housingX0 + 0.10, armY, armZ), new THREE.Vector3(7.60, armY, armZ), 0.012, mats.stainless, 'Yankee_Rotary_Joint_TorqueArm'));
  const bracket = mesh(new THREE.BoxGeometry(0.05, 0.08, 0.06), mats.cast);
  bracket.position.set(7.60, armY, armZ);
  g.add(bracket);

  return g;
}

/* ------------------------------------------------------------------------------------ */
/* Separator tank + piping                                                                */
/* ------------------------------------------------------------------------------------ */

const SEP = {
  x: 10.75, z: 0, r: 0.30,
  shellY0: 0.75, shellY1: 1.85, headH: 0.12,
  inletY: 1.50,                 // side inlet nozzle height
  lineY: 0.55,                  // condensate line centreline (Condensate_C1 / steam trap)
  c1End: 9.825,                 // face of Condensate_C1's outlet flange
  trapInlet: 10.0 + 1.9 - 0.175, // steam-trap inlet flange face after the +1.9 m shift
};

function buildSeparatorTank(mats) {
  const g = named(new THREE.Group(), 'Separator_Tank');
  const cx = SEP.x, cz = SEP.z;
  const shellH = SEP.shellY1 - SEP.shellY0;

  g.add(cylinder(SEP.r, shellH, 'y', new THREE.Vector3(cx, SEP.shellY0 + shellH / 2, cz), mats.vessel, 'Separator_Tank_Shell', { segments: 48 }));
  // Dished heads (ellipsoidal): scaled hemispheres.
  for (const [y, sign, name] of [[SEP.shellY1, 1, 'Separator_Tank_TopHead'], [SEP.shellY0, -1, 'Separator_Tank_BottomHead']]) {
    const head = mesh(new THREE.SphereGeometry(SEP.r, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), mats.vessel, name);
    head.scale.set(1, (SEP.headH / SEP.r) * 1.0, 1);
    if (sign < 0) head.rotation.x = Math.PI;
    head.position.set(cx, y, cz);
    g.add(head);
  }
  // Circumferential weld seams / stiffener bands.
  for (const y of [SEP.shellY0 + 0.02, SEP.shellY1 - 0.02]) g.add(cylinder(SEP.r + 0.006, 0.03, 'y', new THREE.Vector3(cx, y, cz), mats.stainless, undefined, { segments: 48 }));

  // Nozzles: side inlet (−X), top blow-through outlet, bottom condensate outlet — all flanged.
  const inlet = new THREE.Vector3(cx - SEP.r + 0.02, SEP.inletY, cz);
  g.add(tube(inlet, inlet.clone().add(new THREE.Vector3(-0.12, 0, 0)), PIPE_R, mats.pipe, 'Separator_Tank_InletNozzle'));
  g.add(flange(inlet.clone().add(new THREE.Vector3(-0.12, 0, 0)), AXIS.x.clone().negate(), mats.flange));

  const top = new THREE.Vector3(cx, SEP.shellY1 + SEP.headH - 0.02, cz);
  g.add(tube(top, top.clone().add(new THREE.Vector3(0, 0.12, 0)), PIPE_R, mats.pipe, 'Separator_Tank_TopNozzle'));
  g.add(flange(top.clone().add(new THREE.Vector3(0, 0.12, 0)), AXIS.y, mats.flange));

  const bottom = new THREE.Vector3(cx, SEP.shellY0 - SEP.headH + 0.02, cz);
  g.add(tube(bottom, bottom.clone().add(new THREE.Vector3(0, -0.06, 0)), PIPE_R, mats.pipe, 'Separator_Tank_BottomNozzle'));
  g.add(flange(bottom.clone().add(new THREE.Vector3(0, -0.06, 0)), AXIS.y.clone().negate(), mats.flange));

  // Level gauge (small stainless standpipe) and a name plate for recognisability.
  const gz = cz + SEP.r + 0.05;
  g.add(tube(new THREE.Vector3(cx + 0.12, 0.95, gz), new THREE.Vector3(cx + 0.12, 1.65, gz), 0.014, mats.stainless, 'Separator_Tank_LevelGauge'));
  for (const y of [0.95, 1.65]) g.add(tube(new THREE.Vector3(cx + 0.12, y, cz + SEP.r - 0.01), new THREE.Vector3(cx + 0.12, y, gz), 0.012, mats.stainless));
  const plate = mesh(new THREE.BoxGeometry(0.16, 0.10, 0.006), mats.accent);
  plate.position.set(cx - 0.1, 1.25, cz + SEP.r + 0.003);
  g.add(plate);

  // Three support legs with base plates.
  const legTop = SEP.shellY0 - 0.02, legR = SEP.r - 0.06;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const lx = cx + Math.cos(a) * legR, lz = cz + Math.sin(a) * legR;
    const leg = mesh(new THREE.BoxGeometry(0.06, legTop, 0.06), mats.support, i === 0 ? 'Separator_Tank_Leg' : undefined);
    leg.position.set(lx, legTop / 2, lz);
    g.add(leg);
    const base = mesh(new THREE.BoxGeometry(0.16, 0.02, 0.16), mats.support);
    base.position.set(lx, 0.01, lz);
    g.add(base);
  }
  return g;
}

function buildSeparatorPiping(mats) {
  const groups = [];
  const cx = SEP.x, cz = SEP.z;

  // Yankee condensate (end of Condensate_C1) → separator side inlet.
  const inletFace = new THREE.Vector3(cx - SEP.r - 0.10, SEP.inletY, cz);
  const a = pipeRun([
    new THREE.Vector3(SEP.c1End + FLANGE_T, SEP.lineY, 0),
    new THREE.Vector3(10.20, SEP.lineY, 0),
    new THREE.Vector3(10.20, SEP.inletY, 0),
    inletFace.clone().add(new THREE.Vector3(-FLANGE_T, 0, 0)),
  ], PIPE_R, 0.10, mats.pipe, 'Cond_Yankee_to_Separator');
  a.add(flange(new THREE.Vector3(SEP.c1End, SEP.lineY, 0), AXIS.x, mats.flange));        // mates Condensate_C1
  a.add(flange(inletFace.clone().add(new THREE.Vector3(-FLANGE_T, 0, 0)), AXIS.x, mats.flange)); // mates tank nozzle
  groups.push(a);

  // Separator bottom outlet → steam trap inlet (condensate path).
  const b = pipeRun([
    new THREE.Vector3(cx, SEP.shellY0 - SEP.headH - 0.04 - FLANGE_T, cz),
    new THREE.Vector3(cx, SEP.lineY, cz),
    new THREE.Vector3(SEP.trapInlet, SEP.lineY, 0),
  ], PIPE_R, 0.10, mats.pipe, 'Cond_Separator_to_Trap');
  b.add(flange(new THREE.Vector3(cx, SEP.shellY0 - SEP.headH - 0.04 - FLANGE_T, cz), AXIS.y.clone().negate(), mats.flange));
  b.add(flange(new THREE.Vector3(SEP.trapInlet, SEP.lineY, 0), AXIS.x.clone().negate(), mats.flange));
  groups.push(b);

  // Separator top outlet → blow-through / steam return (leaves the process toward −Z).
  const topFace = new THREE.Vector3(cx, SEP.shellY1 + SEP.headH + 0.10 + FLANGE_T, cz);
  const c = pipeRun([
    topFace,
    new THREE.Vector3(cx, 2.35, cz),
    new THREE.Vector3(cx, 2.35, cz - 1.0),
    new THREE.Vector3(cx, 1.30, cz - 1.0),
  ], PIPE_R, 0.12, mats.pipe, 'Separator_BlowThrough_Return');
  c.add(flange(topFace, AXIS.y, mats.flange));
  c.add(flange(new THREE.Vector3(cx, 1.30, cz - 1.0), AXIS.y.clone().negate(), mats.flange));
  c.add(staticTag('Blow-through → steam return', new THREE.Vector3(cx, 1.24, cz - 1.0), 0));
  groups.push(c);

  return groups;
}
