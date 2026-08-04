import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const root = (await io.read(f)).getRoot();
  const skin = root.listSkins()[0];
  const ibm = skin.getInverseBindMatrices();
  const m = [];
  if (ibm) for (let k = 0; k < 16; k++) m.push(+ibm.getElement(1, [])[k].toFixed(4));
  // node transform of the first skinned mesh node
  let nodeInfo = 'none';
  for (const n of root.listNodes()) {
    if (n.getMesh()) {
      nodeInfo = `t=[${n.getTranslation().map(v=>+v.toFixed(3))}] r=[${n.getRotation().map(v=>+v.toFixed(3))}] s=[${n.getScale().map(v=>+v.toFixed(3))}] parent=${n.getParentNode()?n.getParentNode().getName():'(scene)'}`;
      break;
    }
  }
  const pos = root.listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');
  console.log(`\n=== ${f}`);
  console.log(`  meshNode: ${nodeInfo}`);
  console.log(`  POSITION bounds: min=[${pos.getMin([]).map(v=>+v.toFixed(3))}] max=[${pos.getMax([]).map(v=>+v.toFixed(3))}]`);
  console.log(`  inverseBindMatrix[joint 1] = ${m.join(', ')}`);
}
