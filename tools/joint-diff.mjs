import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const lists = [];
for (const f of process.argv.slice(2)) {
  const root = (await io.read(f)).getRoot();
  const skin = root.listSkins()[0];
  lists.push({ f, joints: skin ? skin.listJoints().map(j => j.getName()) : [] });
}
const [a, b] = lists;
console.log(`${a.f}: ${a.joints.length} joints`);
console.log(`${b.f}: ${b.joints.length} joints`);
let same = a.joints.length === b.joints.length;
for (let i = 0; i < Math.max(a.joints.length, b.joints.length); i++) {
  if (a.joints[i] !== b.joints[i]) { same = false; console.log(`  [${i}] ${a.joints[i]} != ${b.joints[i]}`); }
}
console.log(same ? 'IDENTICAL ORDER - safe to share one skeleton' : 'ORDER DIFFERS - cannot rebind directly');
