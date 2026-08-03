import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3d';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
const MAT4_I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function trs(t,r,s){const[x,y,z,w]=r;const x2=x+x,y2=y+y,z2=z+z,xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
 return [(1-(yy+zz))*s[0],(xy+wz)*s[0],(xz-wy)*s[0],0,(xy-wz)*s[1],(1-(xx+zz))*s[1],(yz+wx)*s[1],0,(xz+wy)*s[2],(yz-wx)*s[2],(1-(xx+yy))*s[2],0,t[0],t[1],t[2],1];}
function mul(a,b){const o=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let v=0;for(let k=0;k<4;k++)v+=a[k*4+r]*b[c*4+k];o[c*4+r]=v;}return o;}
const xf=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];

for (const f of ['../honda_jazz_ps1.glb','../volkswagen_golf_ps1.glb']) {
  const doc = await io.read(f);
  const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  let tris=0;
  for (const scene of doc.getRoot().listScenes()) {
    const walk=(n,par)=>{ const w=mul(par,trs(n.getTranslation(),n.getRotation(),n.getScale()));
      const mesh=n.getMesh();
      if(mesh) for(const p of mesh.listPrimitives()){
        tris += p.getIndices()? p.getIndices().getCount()/3 : p.getAttribute('POSITION').getCount()/3;
        const P=p.getAttribute('POSITION');
        for(let i=0;i<P.getCount();i++){const q=xf(w,P.getElement(i,[]));for(let k=0;k<3;k++){if(q[k]<mn[k])mn[k]=q[k];if(q[k]>mx[k])mx[k]=q[k];}}}
      for(const c of n.listChildren()) walk(c,w); };
    for(const n of scene.listChildren()) walk(n,MAT4_I);
  }
  const size = mx.map((v,i)=>v-mn[i]);
  const longest = Math.max(size[0], size[2]);
  const scale = 8.0 / longest;
  console.log(f.replace('../',''));
  console.log(`  tris ${tris}  bbox min=[${mn.map(v=>v.toFixed(3))}] max=[${mx.map(v=>v.toFixed(3))}]`);
  console.log(`  size ${size.map(v=>v.toFixed(2)).join(' x ')}  -> scale ${scale.toFixed(3)}`);
  console.log(`  origin sits ${(-mn[1]).toFixed(3)} above the lowest point (scaled: ${(-mn[1]*scale).toFixed(3)})`);
}
