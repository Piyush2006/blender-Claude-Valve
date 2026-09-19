import * as THREE from 'three';
import { simulationState as S } from '../simulation/simulationState.js';

/**
 * Yankee cylinder rotation and paper-web motion.
 *
 * The Paper_Web mesh is a single static strip wrapped around the cylinder, so
 * its geometry cannot rotate. Its UV "u" coordinate runs along the web path
 * (0 at the ingoing tangent, 1 at the outgoing one), which lets us convey
 * motion by scrolling a subtle fibre texture along the sheet at the Yankee's
 * surface speed. No geometry is rebuilt or modified.
 */

const X_AXIS = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();

export function createYankeeAnimator(map) {
  const yankee = map.components.yankee;
  const rotor = map.components.rotaryJoint?.parts.rotor || null;   // rotary-joint collar
  const paper = map.piping.paper?.[0] || null;

  let paperMaterial = null;
  let paperTexture = null;
  let pathLength = 1;
  let disposeFns = [];

  if (paper) {
    const mesh = paper.isMesh ? paper : paper.children.find((c) => c.isMesh);
    if (mesh && mesh.geometry.attributes.uv) {
      pathLength = estimatePathLength(mesh.geometry);
      paperTexture = makePaperTexture();
      paperMaterial = mesh.material.clone();
      paperMaterial.map = paperTexture;
      paperMaterial.map.repeat.set(Math.max(1, Math.round(pathLength / 0.35)), 1);
      paperMaterial.needsUpdate = true;
      mesh.material = paperMaterial;
      S.paper.available = true;
      disposeFns.push(() => { paperTexture.dispose(); paperMaterial.dispose(); });
    }
  }

  function update() {
    if (yankee.root) {
      yankee.root.quaternion.copy(yankee.rest.root.quaternion).multiply(_q.setFromAxisAngle(X_AXIS, S.yankee.angle));
    }
    if (rotor) rotor.rotation.x = S.yankee.angle;   // stationary housing, rotating collar
    if (paperTexture) {
      // u increases in the direction of travel, so shift the texture backwards.
      const repeat = paperTexture.repeat.x;
      paperTexture.offset.x = -((S.paper.travel / pathLength) * repeat) % 1;
    }
  }

  function dispose() {
    disposeFns.forEach((f) => f());
    disposeFns = [];
  }

  return { update, dispose, paperAvailable: !!paperTexture, pathLength };
}

/** Length of the web path, measured along one edge of the strip sorted by u. */
function estimatePathLength(geometry) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  let xMin = Infinity;
  for (let i = 0; i < pos.count; i++) xMin = Math.min(xMin, pos.getX(i));
  const edge = [];
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i) - xMin) < 1e-4) edge.push({ u: uv.getX(i), y: pos.getY(i), z: pos.getZ(i) });
  }
  edge.sort((a, b) => a.u - b.u);
  let len = 0;
  for (let i = 1; i < edge.length; i++) len += Math.hypot(edge[i].y - edge[i - 1].y, edge[i].z - edge[i - 1].z);
  return len > 0.1 ? len : 4.0;
}

/** Subtle tissue-fibre texture (tileable in u) so motion is perceptible without being loud. */
function makePaperTexture() {
  const w = 256, h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ece9e1';
  ctx.fillRect(0, 0, w, h);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 900; i++) {
    const x = rnd() * w, y = rnd() * h, l = 3 + rnd() * 14, a = rnd() * 0.18;
    ctx.strokeStyle = `rgba(90,80,60,${a})`;
    ctx.lineWidth = 0.6 + rnd() * 0.8;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y + (rnd() - 0.5) * 3); ctx.stroke();
    // wrap horizontally so the tile is seamless
    if (x + l > w) { ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x - w + l, y + (rnd() - 0.5) * 3); ctx.stroke(); }
  }
  // faint crepe ridges across the web (perpendicular to travel)
  for (let x = 0; x < w; x += 6) {
    ctx.fillStyle = `rgba(60,50,40,${0.04 + rnd() * 0.05})`;
    ctx.fillRect(x, 0, 1, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
