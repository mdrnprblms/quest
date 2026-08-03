/**
 * build-worn-tee.mjs — bind the CLO3D t-shirt to the knight's skeleton.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Blender "Data Transfer" route for copying vertex weights from the knight's
 * body onto the garment produced nothing usable. In `knight with tee test.glb`
 * 100% of the garment's vertices are weighted to `neutral_bone` — the dummy
 * joint Blender's glTF exporter invents for a skinned mesh that has no valid
 * weights at all. On top of that the garment sits Y-up in a file whose knight
 * rig had been re-baked Z-up, so it renders lying on its side and a metre away:
 * the "explosion".
 *
 * Doing it here instead is tractable because both spaces are known exactly
 * rather than guessed at by viewport proximity:
 *
 *   `ps1_psx_knight.glb` -> mesh `Object_1` is the knight's body: 344 vertices,
 *   weighted across 22 joints by the original artist. For a skinned primitive
 *   POSITION is already in bind space (by definition jointWorld * inverseBind
 *   == identity at bind time), so those vertices are directly comparable to
 *   anything else placed in that space. It is Y-up, feet at y=0, head at 1.771.
 *
 *   The garment's raw POSITION data is also Y-up, in metres, sized for a
 *   standard ~1.8m CLO3D avatar, and faces +Z like the knight does. So it needs
 *   only a uniform scale and a translation to sit on him — no rotation, and
 *   nothing at all from the test file's broken placement, which is discarded.
 *
 *   Each garment vertex then takes an inverse-distance blend of the skin weights
 *   of its nearest body vertices. That is what "Nearest Face Interpolated" was
 *   meant to do, minus the space confusion that defeated it.
 *
 * Output is written against the knight's OWN skin, so joint ordering and
 * inverse-bind matrices match exactly. That matters: game.js rebinds the garment
 * with `mesh.bind(playerSkin.skeleton, playerSkin.bindMatrix)`, which maps joints
 * by array index, not by name.
 *
 * Usage:  node build-worn-tee.mjs [--report-only]
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { copyToDocument, prune } from '@gltf-transform/functions';
import draco3d from 'draco3d';
import sharp from 'sharp';
import path from 'node:path';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KNIGHT_FILE = path.join(ROOT, 'ps1_psx_knight.glb');
const TEE_FILE    = path.join(ROOT, 'knight with tee test.glb');
const OUT_FILE    = path.join(ROOT, 'liontee_worn.glb');

const BODY_MESH = 'Object_1';        // the knight's body, in both files
const TEE_MESH  = 'Cloth_mesh.001';  // the garment, in the test file

// --- fit, in the knight's own units (he is 1.771 tall) ----------------------
const HEM_DROP    = 0.07;   // how far the hem falls below the hip joint
const COLLAR_LIFT = 0.02;   // how far the collar rises above the neck joint
const SHELL       = 0.012;  // push along vertex normals so it sits proud of the body

const TEX_CAP = 512;        // px; a character never fills more than this on screen
const KNN     = 4;          // body vertices blended per garment vertex

const REPORT_ONLY = process.argv.includes('--report-only');

// ---------------------------------------------------------------- utilities

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

const bounds = (pts) => {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of pts) for (let k = 0; k < 3; k++) {
    if (p[k] < mn[k]) mn[k] = p[k];
    if (p[k] > mx[k]) mx[k] = p[k];
  }
  return { mn, mx, size: mx.map((v, i) => v - mn[i]), mid: mx.map((v, i) => (v + mn[i]) / 2) };
};
const fmt = (a) => '[' + a.map(v => v.toFixed(3).padStart(7)).join(', ') + ']';

// world matrices, so we can read bone positions out of the knight's rig
const MAT4_I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function trsToMat4(t, r, s) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function mat4mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = v;
  }
  return o;
}
function worldMatrices(doc) {
  const out = new Map();
  const walk = (n, p) => {
    const w = mat4mul(p, trsToMat4(n.getTranslation(), n.getRotation(), n.getScale()));
    out.set(n, w);
    for (const c of n.listChildren()) walk(c, w);
  };
  for (const scene of doc.getRoot().listScenes())
    for (const n of scene.listChildren()) walk(n, MAT4_I);
  return out;
}

// --------------------------------------------------------------------- load

const knightDoc = await io.read(KNIGHT_FILE);
const teeDoc    = await io.read(TEE_FILE);

const findMesh = (doc, name) => doc.getRoot().listMeshes().find(m => m.getName() === name);
const knightBody = findMesh(knightDoc, BODY_MESH);
const teeMesh    = findMesh(teeDoc, TEE_MESH);
if (!knightBody) throw new Error(`"${BODY_MESH}" not found in ${path.basename(KNIGHT_FILE)}`);
if (!teeMesh)    throw new Error(`"${TEE_MESH}" not found in ${path.basename(TEE_FILE)}`);

// ------------------------------------------- 1. read the knight's weighted body

const bodySkin = [];   // { p, j, w } in bind space
for (const prim of knightBody.listPrimitives()) {
  const P = prim.getAttribute('POSITION');
  const J = prim.getAttribute('JOINTS_0');
  const W = prim.getAttribute('WEIGHTS_0');
  if (!J || !W) throw new Error('the knight body is not skinned; nothing to transfer from');
  for (let i = 0; i < P.getCount(); i++)
    bodySkin.push({ p: P.getElement(i, []), j: J.getElement(i, []), w: W.getElement(i, []) });
}

const knightNode = knightDoc.getRoot().listNodes().find(n => n.getMesh() === knightBody);
const knightSkin = knightNode.getSkin();
const jointNames = knightSkin.listJoints().map(j => j.getName());

const knightWorlds = worldMatrices(knightDoc);
const bonePos = new Map();
for (const j of knightSkin.listJoints()) {
  const w = knightWorlds.get(j);
  if (w) bonePos.set(j.getName().replace(/_\d+$/, '').replace(/^mixamorig:/, '').toLowerCase(), [w[12], w[13], w[14]]);
}
const bone = (n) => {
  const p = bonePos.get(n);
  if (!p) throw new Error(`bone "${n}" not found on the knight`);
  return p;
};

const bodyBox = bounds(bodySkin.map(v => v.p));
console.log('--- knight ---');
console.log(`  ${bodySkin.length} body vertices, ${jointNames.length} joints`);
console.log(`  bbox min=${fmt(bodyBox.mn)} max=${fmt(bodyBox.mx)}  height ${bodyBox.size[1].toFixed(3)}`);
console.log(`  hips y ${bone('hips')[1].toFixed(3)}   neck y ${bone('neck')[1].toFixed(3)}`);

// The torso is what the shirt has to fit, and it is far narrower than the
// full bbox, which is dominated by the outstretched arms and the sword.
const TORSO_BONES = new Set(['hips', 'spine', 'spine1', 'spine2', 'leftshoulder', 'rightshoulder']);
const torso = bodySkin.filter(v => {
  let t = 0;
  for (let k = 0; k < 4; k++) {
    if (v.w[k] <= 0) continue;
    const n = jointNames[v.j[k]].replace(/_\d+$/, '').replace(/^mixamorig:/, '').toLowerCase();
    if (TORSO_BONES.has(n)) t += v.w[k];
  }
  return t > 0.5;
}).map(v => v.p);
const torsoBox = bounds(torso);
console.log(`  torso: ${torso.length} verts  min=${fmt(torsoBox.mn)} max=${fmt(torsoBox.mx)}`);

// ------------------------------------------- 2. read the garment, sanity-check it

const teeSrcPts = [];
for (const prim of teeMesh.listPrimitives()) {
  const P = prim.getAttribute('POSITION');
  for (let i = 0; i < P.getCount(); i++) teeSrcPts.push(P.getElement(i, []));
}
const teeBox = bounds(teeSrcPts);
console.log('\n--- garment (raw, as authored) ---');
console.log(`  ${teeSrcPts.length} verts  min=${fmt(teeBox.mn)} max=${fmt(teeBox.mx)}  size=${fmt(teeBox.size)}`);
// A t-shirt is a touch wider across the sleeves than it is tall, so X may
// legitimately edge out Y; anything much flatter than that means it is lying
// down, and this script assumes a Y-up garment facing +Z.
if (teeBox.size[1] < 0.8 * Math.max(...teeBox.size)) {
  console.warn('  WARNING: the garment looks like it is lying down rather than standing upright');
}

// ------------------------------------------- 3. fit it onto the knight

// Anchor the collar just above the neck joint and the hem just below the hips,
// then scale uniformly off that so the printed lion is not distorted.
const targetTop = bone('neck')[1] + COLLAR_LIFT;
const targetBot = bone('hips')[1] - HEM_DROP;
const scale = (targetTop - targetBot) / teeBox.size[1];

// Centre horizontally on the torso, not on the skeleton: this rig has a lean
// baked into its bind pose (hips sit at x 0.028, spine drifts to 0.047), so the
// bones are a worse guide to where the body actually is than the mesh is.
const offset = [
  torsoBox.mid[0] - teeBox.mid[0] * scale,
  targetBot - teeBox.mn[1] * scale,
  torsoBox.mid[2] - teeBox.mid[2] * scale,
];

console.log('\n--- fit ---');
console.log(`  uniform scale ${scale.toFixed(4)}   offset ${fmt(offset)}`);
console.log(`  garment will span y ${targetBot.toFixed(3)}..${targetTop.toFixed(3)}, ` +
            `width ${(teeBox.size[0] * scale).toFixed(3)} (torso is ${torsoBox.size[0].toFixed(3)}), ` +
            `depth ${(teeBox.size[2] * scale).toFixed(3)} (torso is ${torsoBox.size[2].toFixed(3)})`);

// ------------------------------------------- 4. copy it into the knight's document

const copied = copyToDocument(knightDoc, teeDoc, [teeMesh]);
const newTeeMesh = copied.get(teeMesh);
newTeeMesh.setName('LIONTEE');

// CLO3D exports the garment as triangle soup — exactly three vertices per
// triangle, nothing shared — so each triangle carries its own flat normal. Any
// offset applied along those normals pushes neighbouring triangles apart and
// opens gaps all over the shirt. Average the normals of coincident vertices
// first, so a shared corner moves one way rather than three.
const normalKey = (p) => p.map(v => Math.round(v * 1e5)).join(',');
const sharedNormal = new Map();
for (const prim of newTeeMesh.listPrimitives()) {
  const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL');
  if (!N) continue;
  for (let i = 0; i < P.getCount(); i++) {
    const k = normalKey(P.getElement(i, []));
    const n = N.getElement(i, []);
    const a = sharedNormal.get(k);
    if (a) { a[0] += n[0]; a[1] += n[1]; a[2] += n[2]; }
    else sharedNormal.set(k, [n[0], n[1], n[2]]);
  }
}
for (const n of sharedNormal.values()) {
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  n[0] /= len; n[1] /= len; n[2] /= len;
}
console.log(`\n--- garment topology: ${sharedNormal.size} distinct positions ---`);

let teeVerts = 0, teeTris = 0;
const placed = [];

for (const prim of newTeeMesh.listPrimitives()) {
  const P = prim.getAttribute('POSITION');
  const N = prim.getAttribute('NORMAL');
  const n = P.getCount();
  teeVerts += n;
  teeTris += prim.getIndices() ? prim.getIndices().getCount() / 3 : n / 3;

  for (let i = 0; i < n; i++) {
    const src = P.getElement(i, []);
    const p = [
      src[0] * scale + offset[0],
      src[1] * scale + offset[1],
      src[2] * scale + offset[2],
    ];
    // Nudge outward so the cloth sits on the body rather than inside it, using
    // the averaged normal so coincident vertices stay coincident.
    if (N && SHELL) {
      const v = sharedNormal.get(normalKey(src)) || N.getElement(i, []);
      for (let k = 0; k < 3; k++) p[k] += v[k] * SHELL;
    }
    P.setElement(i, p);
    placed.push(p);
  }

  // The garment's own skinning is all on `neutral_bone` and carries no
  // information; it is rebuilt against the knight's real joints below.
  prim.setAttribute('JOINTS_0', null);
  prim.setAttribute('WEIGHTS_0', null);
}

const placedBox = bounds(placed);
console.log(`\n--- garment placed: ${teeVerts} verts, ${teeTris} tris, ${newTeeMesh.listPrimitives().length} primitives ---`);
console.log(`  min=${fmt(placedBox.mn)} max=${fmt(placedBox.mx)}`);

// ------------------------------------------- 5. transfer the weights

const buffer = knightDoc.getRoot().listBuffers()[0];
const usedJoints = new Map();
const distances = [];

for (const prim of newTeeMesh.listPrimitives()) {
  const P = prim.getAttribute('POSITION');
  const n = P.getCount();
  const jointData = new Uint16Array(n * 4);
  const weightData = new Float32Array(n * 4);

  for (let i = 0; i < n; i++) {
    const p = P.getElement(i, []);

    // k nearest body vertices — only 344 of them, so a linear scan is fine
    const near = [];
    for (const bv of bodySkin) {
      const dx = p[0] - bv.p[0], dy = p[1] - bv.p[1], dz = p[2] - bv.p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (near.length < KNN) {
        near.push({ d2, bv });
        if (near.length === KNN) near.sort((a, b) => a.d2 - b.d2);
      } else if (d2 < near[KNN - 1].d2) {
        near[KNN - 1] = { d2, bv };
        near.sort((a, b) => a.d2 - b.d2);
      }
    }
    distances.push(Math.sqrt(near[0].d2));

    // inverse-distance-squared blend of the neighbours' weights
    const acc = new Map();
    for (const { d2, bv } of near) {
      const infl = 1 / (d2 + 1e-6);
      for (let k = 0; k < 4; k++) {
        if (bv.w[k] > 0) acc.set(bv.j[k], (acc.get(bv.j[k]) || 0) + bv.w[k] * infl);
      }
    }

    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((s, e) => s + e[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      jointData[i * 4 + k] = top[k] ? top[k][0] : 0;
      weightData[i * 4 + k] = top[k] ? top[k][1] / total : 0;
      if (top[k]) usedJoints.set(top[k][0], (usedJoints.get(top[k][0]) || 0) + top[k][1] / total);
    }
  }

  prim.setAttribute('JOINTS_0',
    knightDoc.createAccessor().setType('VEC4').setArray(jointData).setBuffer(buffer));
  prim.setAttribute('WEIGHTS_0',
    knightDoc.createAccessor().setType('VEC4').setArray(weightData).setBuffer(buffer));
}

distances.sort((a, b) => a - b);
const pct = (q) => distances[Math.min(distances.length - 1, Math.floor(distances.length * q))];
console.log('\n--- weight transfer ---');
console.log(`  distance to nearest body vertex: median ${pct(0.5).toFixed(3)}, ` +
            `90th ${pct(0.9).toFixed(3)}, max ${distances[distances.length - 1].toFixed(3)} ` +
            `(knight is ${bodyBox.size[1].toFixed(3)} tall)`);
console.log(`  distinct joints used: ${usedJoints.size}`);
for (const [ji, tot] of [...usedJoints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(`    ${(tot / teeVerts * 100).toFixed(1).padStart(5)}%  ${jointNames[ji]}`);
if (pct(0.9) > 0.25)
  console.warn('  WARNING: many garment vertices are far from the body; check the fit constants');

// ------------------------------------------- 6. assemble the output

// Drop the knight's own meshes. The output carries the garment plus the
// skeleton it is bound to and nothing else — game.js rebinds it to the live
// player skeleton on pickup, so these bones exist only to make the file valid.
for (const node of knightDoc.getRoot().listNodes()) {
  const m = node.getMesh();
  if (m && m !== newTeeMesh) { node.setMesh(null); node.dispose(); }
}
for (const m of knightDoc.getRoot().listMeshes()) if (m !== newTeeMesh) m.dispose();
for (const a of knightDoc.getRoot().listAnimations()) a.dispose();

// CLO3D exports garment panels single-sided. A t-shirt is an open surface — you
// see the inside of the sleeves, the hem and the neck opening — so with back
// faces culled it renders as a set of disconnected slabs with the body showing
// through the gaps. That, not the topstitching, is what made the old tee look
// shredded in game.
for (const mat of knightDoc.getRoot().listMaterials()) {
  if (!mat.getDoubleSided()) { mat.setDoubleSided(true); console.log(`  double-sided: ${mat.getName()}`); }
}

const skeletonRoot = knightSkin.getSkeleton();
const teeNode = knightDoc.createNode('LIONTEE').setMesh(newTeeMesh).setSkin(knightSkin);
const parent = knightDoc.getRoot().listNodes().find(n => n.listChildren().includes(skeletonRoot));
if (parent) parent.addChild(teeNode);
else knightDoc.getRoot().listScenes()[0].addChild(teeNode);

// ------------------------------------------- 7. shrink the textures

for (const tex of knightDoc.getRoot().listTextures()) {
  const img = tex.getImage();
  const size = tex.getSize();
  if (!img || !size || (size[0] <= TEX_CAP && size[1] <= TEX_CAP)) continue;
  const before = img.byteLength;
  const out = await sharp(Buffer.from(img))
    .resize(Math.min(size[0], TEX_CAP), Math.min(size[1], TEX_CAP), { fit: 'inside' })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType('image/png');
  console.log(`  texture ${size.join('x')} -> ${TEX_CAP} cap  (${(before / 1e6).toFixed(2)}MB -> ${(out.length / 1e6).toFixed(2)}MB)`);
}

await knightDoc.transform(prune());

// copyToDocument brings the source file's buffer across with it, and a GLB may
// only have one. Move every accessor onto the first and drop the rest.
const buffers = knightDoc.getRoot().listBuffers();
if (buffers.length > 1) {
  for (const acc of knightDoc.getRoot().listAccessors()) acc.setBuffer(buffers[0]);
  for (const b of buffers.slice(1)) b.dispose();
  console.log(`  consolidated ${buffers.length} buffers into 1`);
}

if (REPORT_ONLY) {
  console.log('\n--report-only: nothing written');
} else {
  await io.write(OUT_FILE, knightDoc);
  console.log(`\nWrote ${path.basename(OUT_FILE)} — ${(statSync(OUT_FILE).size / 1e6).toFixed(2)}MB`);
}
