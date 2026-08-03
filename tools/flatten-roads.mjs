// Flattens photogrammetry noise out of the road surface.
//
// The bumps and pale shards on the street are reconstruction error: cars and
// people that moved during capture, and stretched slivers where the solver had
// too little parallax. They are real geometry, so no renderer setting removes
// them — the mesh has to be fixed.
//
// How it works:
//   1. DATA_ROAD ("None_roads_trunk") is a flat plane covering the road network.
//      It carries no height, but projected to XZ it is an exact mask of where
//      the roads are — that is what keeps this off the pavements and buildings.
//   2. Every city vertex inside that mask is bucketed into a grid cell, and each
//      cell takes a low percentile of the heights in it. A low percentile, not
//      the mean: the road is the lowest thing in a road corridor, so this locks
//      onto the tarmac and ignores whatever is floating above it.
//   3. That height field is median-filtered. A median filter is the right tool
//      here because it removes spikes outright rather than averaging them into
//      their neighbours, while leaving genuine slope intact.
//   4. Vertices within TOLERANCE of the filtered height are pulled onto it.
//      Anything further away is left alone, so kerbs, steps and street furniture
//      survive — the tolerance is the one number worth tuning.
//
// Dry run (writes nothing, prints what it would do):
//   cd tools && node flatten-roads.mjs ../shoreditch.glb
//
// Write the result:
//   cd tools && node flatten-roads.mjs ../shoreditch.glb --write ../shoreditch-flat.glb
//
// Options:
//   --tolerance N   how far from the road surface a vertex can be and still be
//                   treated as road, in MODEL units (default 0.35; the game
//                   scales the map 3.5x, so 0.35 here is ~1.2 world units)
//   --cell N        height field resolution in model units (default 0.6)
//   --strength N    0..1, how far each vertex moves toward the surface (1 = all)
//
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3d';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--')) || '../shoreditch.glb';
const flag = (name, def) => {
    const i = args.indexOf('--' + name);
    return i === -1 ? def : args[i + 1];
};
const OUT       = args.includes('--write') ? flag('write', null) : null;
const TOLERANCE = parseFloat(flag('tolerance', 0.35));
const CELL      = parseFloat(flag('cell', 0.6));
const STRENGTH  = parseFloat(flag('strength', 1.0));
const MEDIAN_R  = 2;          // median filter radius, in cells
const FLOOR_PCT = 0.25;       // percentile of heights taken as "the tarmac"

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
    });

console.log(`reading ${file} ...`);
const doc = await io.read(file);
const root = doc.getRoot();

// --- gather every primitive with its node's world matrix ---------------------
const prims = [];
const walk = (node, parentMatrix) => {
    const m = mul(parentMatrix, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) for (const prim of mesh.listPrimitives()) {
        prims.push({ prim, matrix: m, name: mesh.getName() || '' });
    }
    for (const child of node.listChildren()) walk(child, m);
};
for (const scene of root.listScenes()) {
    for (const node of scene.listChildren()) walk(node, IDENTITY());
}

function IDENTITY() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mul(a, b) {                       // column-major, as glTF stores them
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
                     + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
}
const tx = (m, v) => m[0] * v[0] + m[4] * v[1] + m[8]  * v[2] + m[12];
const ty = (m, v) => m[1] * v[0] + m[5] * v[1] + m[9]  * v[2] + m[13];
const tz = (m, v) => m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];

const roadPrims = prims.filter(p => /road/i.test(p.name));
const cityPrims = prims.filter(p => !/road|border/i.test(p.name));
if (!roadPrims.length) {
    console.error('No DATA_ROAD primitive found — nothing to mask against. Aborting.');
    process.exit(1);
}
console.log(`  ${prims.length} primitives (${roadPrims.length} road, ${cityPrims.length} city)`);

// --- 1. rasterise the road plane into an XZ mask ------------------------------
let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
const roadTris = [];
for (const { prim, matrix } of roadPrims) {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const v = [0, 0, 0];
    const pt = (i) => {
        pos.getElement(idx ? idx.getScalar(i) : i, v);
        return [tx(matrix, v), tz(matrix, v)];
    };
    for (let i = 0; i < n; i += 3) {
        const t = [pt(i), pt(i + 1), pt(i + 2)];
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
    // Scanline fill of the triangle's XZ footprint.
    const lo = (i) => Math.max(0, Math.floor((Math.min(a[i], b[i], c[i]) - (i ? minZ : minX)) / CELL));
    const hi = (i, lim) => Math.min(lim - 1, Math.ceil((Math.max(a[i], b[i], c[i]) - (i ? minZ : minX)) / CELL));
    const d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(d) < 1e-12) continue;
    for (let cz = lo(1); cz <= hi(1, GH); cz++) {
        for (let cx = lo(0); cx <= hi(0, GW); cx++) {
            const px = minX + (cx + 0.5) * CELL, pz = minZ + (cz + 0.5) * CELL;
            const w0 = ((b[0] - px) * (c[1] - pz) - (c[0] - px) * (b[1] - pz)) / d;
            const w1 = ((c[0] - px) * (a[1] - pz) - (a[0] - px) * (c[1] - pz)) / d;
            const w2 = 1 - w0 - w1;
            if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) {
                const k = cz * GW + cx;
                if (!mask[k]) { mask[k] = 1; maskCells++; }
            }
        }
    }
}
console.log(`  road mask: ${GW} x ${GH} cells @ ${CELL}u, ${maskCells.toLocaleString()} road cells ` +
            `(${(maskCells * CELL * CELL).toFixed(0)} sq units of street)`);

// --- 2. per-cell road height, from a low percentile of the vertices in it -----
const buckets = new Map();
let vertsInMask = 0;
for (const { prim, matrix } of cityPrims) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const k = cellOf(tx(matrix, v), tz(matrix, v));
        if (k < 0 || !mask[k]) continue;
        vertsInMask++;
        let arr = buckets.get(k);
        if (!arr) buckets.set(k, arr = []);
        arr.push(ty(matrix, v));
    }
}
const heights = new Float32Array(GW * GH).fill(NaN);
for (const [k, arr] of buckets) {
    arr.sort((a, b) => a - b);
    heights[k] = arr[Math.floor(arr.length * FLOOR_PCT)];
}
console.log(`  ${vertsInMask.toLocaleString()} city vertices sit over the road mask, ` +
            `${buckets.size.toLocaleString()} cells have data`);

// --- 3. median filter: kills spikes, keeps slope ------------------------------
const smooth = new Float32Array(GW * GH).fill(NaN);
const window = [];
for (let cz = 0; cz < GH; cz++) {
    for (let cx = 0; cx < GW; cx++) {
        const k = cz * GW + cx;
        if (!mask[k]) continue;
        window.length = 0;
        for (let dz = -MEDIAN_R; dz <= MEDIAN_R; dz++) {
            for (let dx = -MEDIAN_R; dx <= MEDIAN_R; dx++) {
                const nx = cx + dx, nz = cz + dz;
                if (nx < 0 || nz < 0 || nx >= GW || nz >= GH) continue;
                const h = heights[nz * GW + nx];
                if (!Number.isNaN(h)) window.push(h);
            }
        }
        if (!window.length) continue;
        window.sort((a, b) => a - b);
        smooth[k] = window[window.length >> 1];
    }
}

// How rough was it? The difference between raw and filtered height IS the noise.
const noise = [];
for (let k = 0; k < smooth.length; k++) {
    if (!Number.isNaN(smooth[k]) && !Number.isNaN(heights[k])) noise.push(Math.abs(heights[k] - smooth[k]));
}
noise.sort((a, b) => a - b);
const q = (p) => (noise.length ? noise[Math.floor(noise.length * p)] : 0);
console.log(`  road roughness (model units): median ${q(0.5).toFixed(3)}  ` +
            `p90 ${q(0.9).toFixed(3)}  p99 ${q(0.99).toFixed(3)}  max ${(noise.at(-1) || 0).toFixed(3)}`);
console.log(`  in world units (x3.5):        median ${(q(0.5) * 3.5).toFixed(2)}  ` +
            `p90 ${(q(0.9) * 3.5).toFixed(2)}  p99 ${(q(0.99) * 3.5).toFixed(2)}  max ${((noise.at(-1) || 0) * 3.5).toFixed(2)}`);

// --- 4. pull road vertices onto the filtered surface --------------------------
let moved = 0, skippedFar = 0, totalShift = 0, maxShift = 0;
for (const { prim, matrix } of cityPrims) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    // Only uniform-scale/translate nodes are handled by writing back in local
    // space; check the matrix has no rotation or shear before touching it.
    const rotated = Math.abs(matrix[1]) + Math.abs(matrix[2]) + Math.abs(matrix[4])
                  + Math.abs(matrix[6]) + Math.abs(matrix[8]) + Math.abs(matrix[9]);
    const scaleY = matrix[5];
    if (rotated > 1e-6 || Math.abs(scaleY) < 1e-9) continue;

    const v = [0, 0, 0];
    let dirty = false;
    for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const wx = tx(matrix, v), wy = ty(matrix, v), wz = tz(matrix, v);
        const k = cellOf(wx, wz);
        if (k < 0 || !mask[k]) continue;
        const target = smooth[k];
        if (Number.isNaN(target)) continue;
        const delta = target - wy;
        if (Math.abs(delta) > TOLERANCE) { skippedFar++; continue; }
        if (Math.abs(delta) < 1e-5) continue;
        const shift = delta * STRENGTH;
        v[1] += shift / scaleY;              // back into the node's local space
        if (OUT) { pos.setElement(i, v); dirty = true; }
        moved++;
        totalShift += Math.abs(shift);
        if (Math.abs(shift) > maxShift) maxShift = Math.abs(shift);
    }
    if (dirty) pos.setArray(pos.getArray());
}

console.log('\n--- result ---');
console.log(`  vertices flattened : ${moved.toLocaleString()}`);
console.log(`  left alone (kerbs, steps, anything > ${TOLERANCE}u off the surface): ${skippedFar.toLocaleString()}`);
console.log(`  average correction : ${(moved ? totalShift / moved : 0).toFixed(4)} model units ` +
            `(${(moved ? (totalShift / moved) * 3.5 : 0).toFixed(3)} world)`);
console.log(`  largest correction : ${maxShift.toFixed(4)} model units (${(maxShift * 3.5).toFixed(3)} world)`);

if (OUT) {
    console.log(`\nwriting ${OUT} ...`);
    await io.write(OUT, doc);
    console.log('done. Point currentMapName at it and compare before committing.');
} else {
    console.log('\nDRY RUN — nothing written. Re-run with --write ../shoreditch-flat.glb to apply.');
}
