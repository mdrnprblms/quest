// Inspects the city GLB: what the meshes are called, how big they are, and how
// rough the road surface actually is. Run before flatten-roads.mjs to see what
// you are dealing with:
//
//   cd tools && node inspect-roads.mjs ../shoreditch.glb
//
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3d';

const file = process.argv[2] || '../shoreditch.glb';

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
    });

console.log('reading', file, '...');
const doc = await io.read(file);
const root = doc.getRoot();

let totalVerts = 0, totalTris = 0;
const rows = [];

for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        const verts = pos ? pos.getCount() : 0;
        const tris = idx ? idx.getCount() / 3 : verts / 3;
        totalVerts += verts;
        totalTris += tris;
        const min = pos ? pos.getMin([]) : [0, 0, 0];
        const max = pos ? pos.getMax([]) : [0, 0, 0];
        rows.push({
            name: mesh.getName() || '(unnamed)',
            verts,
            tris: Math.round(tris),
            y: `${min[1].toFixed(1)}..${max[1].toFixed(1)}`,
            xz: `${(max[0] - min[0]).toFixed(0)} x ${(max[2] - min[2]).toFixed(0)}`
        });
    }
}

rows.sort((a, b) => b.verts - a.verts);
console.log('\nmeshes:', rows.length,
            ' verts:', totalVerts.toLocaleString(),
            ' tris:', totalTris.toLocaleString(), '\n');
console.log('largest 25 primitives:');
for (const r of rows.slice(0, 25)) {
    console.log(`  ${String(r.tris).padStart(9)} tris  y ${r.y.padEnd(18)} ${r.xz.padEnd(14)} ${r.name}`);
}

const roads = rows.filter(r => /road/i.test(r.name));
console.log('\nDATA_ROAD primitives:', roads.length);
for (const r of roads.slice(0, 10)) {
    console.log(`  ${String(r.tris).padStart(9)} tris  y ${r.y.padEnd(18)} ${r.xz.padEnd(14)} ${r.name}`);
}

// Roughness sample: for the biggest ground-level primitive, bucket vertices into
// 1-unit XZ cells and report how far apart the highest and lowest vertex in a
// cell are. A clean road is a few centimetres; photogrammetry noise is metres.
const groundPrims = [];
for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
        const name = mesh.getName() || '';
        if (/road|border/i.test(name)) continue;
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        groundPrims.push({ name, pos, count: pos.getCount() });
    }
}
groundPrims.sort((a, b) => b.count - a.count);

if (groundPrims.length) {
    const { name, pos } = groundPrims[0];
    const cells = new Map();
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const key = `${Math.floor(v[0])},${Math.floor(v[2])}`;
        const c = cells.get(key);
        if (!c) cells.set(key, [v[1], v[1]]);
        else { if (v[1] < c[0]) c[0] = v[1]; if (v[1] > c[1]) c[1] = v[1]; }
    }
    const spreads = [...cells.values()].map(c => c[1] - c[0]).sort((a, b) => a - b);
    const pct = (p) => spreads[Math.floor(spreads.length * p)].toFixed(3);
    console.log(`\nvertical spread within 1-unit cells of "${name}" (${cells.size} cells):`);
    console.log(`  median ${pct(0.5)}   p90 ${pct(0.9)}   p99 ${pct(0.99)}   max ${spreads[spreads.length - 1].toFixed(3)}`);
    console.log('  (model units, before the 3.5x scale the game applies)');
}
