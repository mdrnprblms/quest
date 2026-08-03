import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3d';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  const skins = root.listSkins();
  const meshes = root.listMeshes();
  let verts = 0, skinned = 0;
  for (const m of meshes) for (const p of m.listPrimitives()) {
    verts += p.getAttribute('POSITION')?.getCount() || 0;
    if (p.getAttribute('JOINTS_0')) skinned++;
  }
  const joints = skins.length ? skins[0].listJoints().map(j => j.getName()) : [];
  console.log(`\n=== ${f}`);
  console.log(`  meshes=${meshes.length} verts=${verts.toLocaleString()} skinnedPrims=${skinned} skins=${skins.length} joints=${joints.length}`);
  console.log(`  animations: ${root.listAnimations().map(a=>a.getName()).join(', ') || '(none)'}`);
  console.log(`  textures: ${root.listTextures().length}`);
  console.log(`  first 12 joints: ${joints.slice(0,12).join(', ')}`);
}
