// Removes the scan artefacts sitting ON the road — the vehicles and people that
// were moving when Google flew over, reconstructed as lumps of geometry.
//
// flatten-roads.mjs cannot touch these. It treats the road as a height field and
// smooths noise on its surface; these are objects standing several metres proud
// of it, which is exactly what its tolerance is designed to leave alone. That is
// why its p90/p99 roughness never moved.
//
// This tool works on connected components instead:
//
//   1. Rasterise DATA_ROAD to an XZ mask and fit a road height field, the same
//      way flatten-roads.mjs does (deliberately duplicated — these two want to
//      stay independently runnable).
//   2. Union-find every city primitive's triangles into connected islands.
//   3. An island is a scan artefact if it stands on the road, is roughly car or
//      person sized, and does not reach up into the buildings. A kerb fails that
//      test because it is continuous with the pavement, so it is one enormous
//      island rather than a small one.
//   4. Collapse those islands onto the road surface.
//
// Collapsing rather than deleting is deliberate: photogrammetry has no data for
// the tarmac underneath a parked car, so deleting one leaves a hole through to
// the skybox. Flattened, it becomes a car-shaped stain on the road — wrong if
// you look for it, invisible at speed, and no longer something to trip over.
//
// Scale note: the knight is 1.12 model units tall for a ~1.8m man, so one model
// unit is roughly 1.6m. The size limits below are in model units.
//
// Analyse (writes nothing):
//   cd tools && node flatten-road-blobs.mjs ../shoreditch-orig.glb
//
// Apply:
//   cd tools && node flatten-road-blobs.mjs ../shoreditch-orig.glb --write ../shoreditch.glb
//
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3d';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--')) || '../shoreditch-orig.glb';
const flag = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const OUT = args.includes('--write') ? flag('write', null) : null;

const CELL       = parseFloat(flag('cell', 1.5));   // height field resolution
const MEDIAN_R   = 2;
const FLOOR_PCT  = 0.25;
// An artefact stands on the road, so its base is near the surface...
const BASE_TOL   = parseFloat(flag('base', 1.0));
// ...is between ankle height and something taller than a van...
const MIN_H      = parseFloat(flag('minh', 0.15));
const MAX_H      = parseFloat(flag('maxh', 2.5));
// ...and has a footprint somewhere between a person and a bus.
const MIN_FOOT   = parseFloat(flag('minfoot', 0.3));
const MAX_FOOT   = parseFloat(flag('maxfoot', 8.0));
const MAX_VERTS  = parseInt(flag('maxverts', 4000), 10);

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
    });

console.log(`reading ${file} ...`);
const doc = await io.read(file);
const root = doc.getRoot();

// --- primitives with world matrices -----------------------------------------
const prims = [];
const I4 = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
                     + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
}
const tx = (m, v) => m[0]*v[0] + m[4]*v[1] + m[8]*v[2]  + m[12];
const ty = (m, v) => m[1]*v[0] + m[5]*v[1] + m[9]*v[2]  + m[13];
const tz = (m, v) => m[2]*v[0] + m[6]*v[1] + m[10]*v[2] + m[14];

const walk = (node, parent) => {
    const m = mul(parent, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) for (const prim of mesh.listPrimitives()) prims.push({ prim, matrix: m, name: mesh.getName() || '' });
    for (const child of node.listChildren()) walk(child, m);
};
for (const scene of root.listScenes()) for (const node of scene.listChildren()) walk(node, I4());

const roadPrims = prims.filter(p => /road/i.test(p.name));
const cityPrims = prims.filter(p => !/road|border/i.test(p.name));
if (!roadPrims.length) { console.error('No DATA_ROAD primitive — aborting.'); process.exit(1); }

// --- 1. road mask ------------------------------------------------------------
let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
const roadTris = [];
for (const { prim, matrix } of roadPrims) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount(), v = [0,0,0];
    const pt = (i) => { pos.getElement(idx ? idx.getScalar(i) : i, v); return [tx(matrix,v), tz(matrix,v)]; };
    for (let i = 0; i < n; i += 3) {
        const t = [pt(i), pt(i+1), pt(i+2)];
        roadTris.push(t);
        for (const p of t) {
            if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
            if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1];
        }
    }
}
const GW = Math.ceil((maxX - minX) / CELL) + 1;
const GH = Math.ceil((maxZ - minZ) / CELL) + 1;
const cellOf = (x, z) => {
    const cx = Math.floor((x - minX) / CELL), cz = Math.floor((z - minZ) / CELL);
    return (cx < 0 || cz < 0 || cx >= GW || cz >= GH) ? -1 : cz * GW + cx;
};
const mask = new Uint8Array(GW * GH);
let maskCells = 0;
for (const [a, b, c] of roadTris) {
    const d = (b[0]-a[0])*(c[1]-a[1]) - (c[0]-a[0])*(b[1]-a[1]);
    if (Math.abs(d) < 1e-12) continue;
    const lo0 = Math.max(0, Math.floor((Math.min(a[0],b[0],c[0]) - minX) / CELL));
    const hi0 = Math.min(GW-1, Math.ceil((Math.max(a[0],b[0],c[0]) - minX) / CELL));
    const lo1 = Math.max(0, Math.floor((Math.min(a[1],b[1],c[1]) - minZ) / CELL));
    const hi1 = Math.min(GH-1, Math.ceil((Math.max(a[1],b[1],c[1]) - minZ) / CELL));
    for (let cz = lo1; cz <= hi1; cz++) for (let cx = lo0; cx <= hi0; cx++) {
        const px = minX + (cx+0.5)*CELL, pz = minZ + (cz+0.5)*CELL;
        const w0 = ((b[0]-px)*(c[1]-pz) - (c[0]-px)*(b[1]-pz)) / d;
        const w1 = ((c[0]-px)*(a[1]-pz) - (a[0]-px)*(c[1]-pz)) / d;
        if (w0 >= -1e-6 && w1 >= -1e-6 && (1-w0-w1) >= -1e-6) {
            const k = cz*GW + cx; if (!mask[k]) { mask[k] = 1; maskCells++; }
        }
    }
}
console.log(`  road mask: ${GW} x ${GH} @ ${CELL}u, ${maskCells.toLocaleString()} cells`);

// --- 2. road height field ----------------------------------------------------
const buckets = new Map();
for (const { prim, matrix } of cityPrims) {
    const pos = prim.getAttribute('POSITION'); if (!pos) continue;
    const v = [0,0,0];
    for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const k = cellOf(tx(matrix,v), tz(matrix,v));
        if (k < 0 || !mask[k]) continue;
        let a = buckets.get(k); if (!a) buckets.set(k, a = []);
        a.push(ty(matrix, v));
    }
}
const raw = new Float32Array(GW*GH).fill(NaN);
for (const [k, a] of buckets) { a.sort((x,y)=>x-y); raw[k] = a[Math.floor(a.length*FLOOR_PCT)]; }
const height = new Float32Array(GW*GH).fill(NaN);
const win = [];
for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    const k = cz*GW+cx; if (!mask[k]) continue;
    win.length = 0;
    for (let dz = -MEDIAN_R; dz <= MEDIAN_R; dz++) for (let dx = -MEDIAN_R; dx <= MEDIAN_R; dx++) {
        const nx = cx+dx, nz = cz+dz;
        if (nx<0||nz<0||nx>=GW||nz>=GH) continue;
        const h = raw[nz*GW+nx]; if (!Number.isNaN(h)) win.push(h);
    }
    if (win.length) { win.sort((a,b)=>a-b); height[k] = win[win.length>>1]; }
}

// --- 3. connected components -------------------------------------------------
let totalComponents = 0, blobs = 0, blobVerts = 0, blobTris = 0;
const sizes = [];
const targets = [];   // { prim, matrix, verts:Set }

for (const entry of cityPrims) {
    const { prim, matrix } = entry;
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    if (!pos || !idx) continue;
    const n = pos.getCount();

    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

    const ic = idx.getCount();
    for (let i = 0; i < ic; i += 3) {
        const a = idx.getScalar(i), b = idx.getScalar(i+1), c = idx.getScalar(i+2);
        union(a, b); union(b, c);
    }

    // bounds per component
    const comp = new Map();
    const v = [0,0,0];
    for (let i = 0; i < n; i++) {
        const r = find(i);
        pos.getElement(i, v);
        const x = tx(matrix,v), y = ty(matrix,v), z = tz(matrix,v);
        let c = comp.get(r);
        if (!c) comp.set(r, c = { n:0, minX:x, maxX:x, minY:y, maxY:y, minZ:z, maxZ:z, verts:[] });
        c.n++;
        c.verts.push(i);
        if (x<c.minX)c.minX=x; if (x>c.maxX)c.maxX=x;
        if (y<c.minY)c.minY=y; if (y>c.maxY)c.maxY=y;
        if (z<c.minZ)c.minZ=z; if (z>c.maxZ)c.maxZ=z;
    }
    totalComponents += comp.size;

    for (const c of comp.values()) {
        sizes.push(c.n);
        if (c.n > MAX_VERTS) continue;
        const h = c.maxY - c.minY;
        const foot = Math.max(c.maxX - c.minX, c.maxZ - c.minZ);
        if (h < MIN_H || h > MAX_H) continue;
        if (foot < MIN_FOOT || foot > MAX_FOOT) continue;

        const k = cellOf((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2);
        if (k < 0 || !mask[k] || Number.isNaN(height[k])) continue;
        // Standing ON the road: its base sits near the surface, not floating
        // above it (a first-floor sign) or buried below it.
        if (Math.abs(c.minY - height[k]) > BASE_TOL) continue;

        blobs++; blobVerts += c.n; blobTris += Math.round(c.n / 2);
        targets.push({ prim, matrix, comp: c });
    }
}

sizes.sort((a,b)=>a-b);
const pct = (p) => sizes.length ? sizes[Math.floor(sizes.length*p)] : 0;
console.log(`\nconnected islands: ${totalComponents.toLocaleString()} across ${cityPrims.length} primitives`);
console.log(`  island size (verts): median ${pct(0.5)}  p90 ${pct(0.9)}  p99 ${pct(0.99)}  max ${sizes[sizes.length-1] || 0}`);
console.log(`\nscan artefacts matched: ${blobs.toLocaleString()}`);
console.log(`  ~${blobVerts.toLocaleString()} vertices / ~${blobTris.toLocaleString()} triangles`);
console.log(`  filter: base within ${BASE_TOL}u of the road, height ${MIN_H}-${MAX_H}u, footprint ${MIN_FOOT}-${MAX_FOOT}u, <=${MAX_VERTS} verts`);

if (!OUT) {
    console.log('\nDRY RUN — nothing written. Add --write ../shoreditch.glb to collapse them.');
} else {
    let moved = 0;
    for (const { prim, matrix, comp } of targets) {
        const pos = prim.getAttribute('POSITION');
        const scaleY = matrix[5] || 1;
        const v = [0,0,0];
        for (const i of comp.verts) {
            pos.getElement(i, v);
            const k = cellOf(tx(matrix,v), tz(matrix,v));
            const target = (k >= 0 && !Number.isNaN(height[k])) ? height[k] : comp.minY;
            v[1] += (target - ty(matrix, v)) / scaleY;
            pos.setElement(i, v);
            moved++;
        }
        pos.setArray(pos.getArray());
    }
    console.log(`\ncollapsed ${moved.toLocaleString()} vertices onto the road surface`);
    console.log(`writing ${OUT} ...`);
    await io.write(OUT, doc);
    console.log('done.');
}
