/** Added civil detail library, 2026-09-20. Adapter triangle/mesh counts:
 * Courier 3912/38 -> 3360/32; Meridian 5018/42 -> 4596/44;
 * Tempest 4080/43 -> 3512/34; Skyhook 4356/45 -> 3648/36.
 * Span:length: 1.608, 1.600, 1.756 respectively; Skyhook rotor diameter
 * 10.50 m and static overall length 10.566 m. Original gameplay envelope
 * retained. Browser views checked; school-device frame rates not checked. */
/**
 * Type-specific civil airframes and open, framed cabins. Measured counts are
 * recorded in the delivery report; gear, scale, eye points and wing span are
 * unchanged. Chromebook/iPad frame rate needs a device check.
 * Original designs using light-tourer, regional-jet, survey-twin and utility-
 * helicopter proportions; these are not licensed replicas.
 * No imports: geometry and materials come from the caller's Three instance.
 */
const PROFILES = {
  courier: [[.05,-2.55],[.3,-2.42],[.5,-2.15],[.62,-1.7],[.7,-1.1],[.76,-.3],[.78,.45],[.75,1.15],[.66,1.95],[.52,2.7],[.34,3.35],[.18,3.85],[.05,3.95]],
  meridian: [[.05,-2.55],[.27,-2.42],[.5,-2.15],[.69,-1.7],[.76,-1.1],[.76,-.3],[.76,.45],[.76,1.15],[.72,1.95],[.55,2.7],[.3,3.35],[.12,3.85],[.05,3.95]],
  tempest: [[.05,-2.55],[.3,-2.42],[.52,-2.15],[.68,-1.7],[.73,-1.1],[.77,-.3],[.78,.45],[.74,1.15],[.63,1.95],[.48,2.7],[.3,3.35],[.14,3.85],[.05,3.95]],
  harrier: [[.05,-2.55],[.29,-2.42],[.56,-2.15],[.74,-1.7],[.8,-1.1],[.8,-.3],[.72,.45],[.52,1.15],[.28,1.95],[.19,2.7],[.13,3.35],[.08,3.85],[.05,3.95]],
};
export function civilProfile(id) { return PROFILES[id] || null; }

/**
 * The lathe's own radius at a station, interpolated off the same table the
 * fuselage is turned from.
 *
 * The cabin's glazing used to be given fixed widths — .62 at the front and
 * .75 (or .52) at the back — which happen to be right for the Courier and
 * wrong for the other three, because each of them has its own profile now.
 * Where the glass was narrower than the skin it was cut into, the result was
 * an open sliver down each side of the opening: measured at 0.24 m on the
 * Skyhook, which is a hole in the side of the helicopter. Reading the radius
 * off the profile makes it exact for all four by construction.
 */
function radiusAt(id, z) {
  const P = PROFILES[id];
  if (!P) return 0;
  if (z <= P[0][1]) return P[0][0];
  for (let i = 1; i < P.length; i++) {
    if (z <= P[i][1]) {
      const t = (z - P[i-1][1]) / (P[i][1] - P[i-1][1]);
      return P[i-1][0] + (P[i][0] - P[i-1][0]) * t;
    }
  }
  return P[P.length-1][0];
}

export function civilCabin(id, S) {
  if (!PROFILES[id]) return null;
  const z0 = -1.7, z1 = id === 'meridian' ? -.3 : 1.15;
  return { z0: z0*S.bodyLength, z1: z1*S.bodyLength,
    roofY: id==='harrier'?.98:id==='meridian'?.94:.9, baseY:0,
    frontW: radiusAt(id, z0)*S.bodyRadius, rearW: radiusAt(id, z1)*S.bodyRadius };
}
/** Remove upper skin triangles between complete lathe stations, so the glass
 * has an interior behind it instead of a second painted shell. */
export function openCivilCabin(geometry, cabin) {
  if (!cabin) return;
  const p=geometry.attributes.position,idx=geometry.index.array,kept=[];
  for(let i=0;i<idx.length;i+=3){
    const a=idx[i],b=idx[i+1],c=idx[i+2];
    const z=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3;
    const y=(p.getY(a)+p.getY(b)+p.getY(c))/3;
    if(z>cabin.z0 && z<cabin.z1 && y>0) continue;
    kept.push(a,b,c);
  }
  geometry.setIndex(kept);geometry.computeVertexNormals();
}
export function installCivilDetails(ctx) {
  const {THREE,root,S,type,bodyMat,matteMat,glassMat,strutMat,rubber,cabin}=ctx;
  if (!cabin) return null;
  const group=new THREE.Group(); group.name=type.id+' details';root.add(group);
  const mesh=(name,geo,mat,pos)=>{const m=new THREE.Mesh(geo,mat);m.name=name;if(pos)m.position.set(...pos);m.castShadow=!mat.transparent;group.add(m);return m;};
  const box=(name,size,pos,mat=matteMat)=>mesh(name,new THREE.BoxGeometry(...size),mat,pos);
  const panel=(name,pts,mat)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts.flat(),3));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();return mesh(name,g,mat);};
  const tube=(name,a,b,r,mat=matteMat)=>{const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b),dir=vb.clone().sub(va);const m=mesh(name,new THREE.CylinderGeometry(r,r,dir.length(),5),mat);m.position.copy(va).add(vb).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());return m;};
  const {z0,z1,roofY,frontW,rearW}=cabin;
  const zFront=z0+(z1-z0)*.24,zRear=z1-(z1-z0)*.18;
  const bl=[-frontW,0,z0],br=[frontW,0,z0],tl=[-frontW*.88,roofY,zFront],tr=[frontW*.88,roofY,zFront];
  const rl=[-rearW*.88,roofY*.94,zRear],rr=[rearW*.88,roofY*.94,zRear],el=[-rearW,0,z1],er=[rearW,0,z1];
  panel('Port windscreen',[bl,[0,0,z0],[0,roofY,zFront],tl],glassMat);
  panel('Starboard windscreen',[[0,0,z0],br,tr,[0,roofY,zFront]],glassMat);
  panel('Port cabin glazing',[bl,tl,rl,el],glassMat);
  panel('Starboard cabin glazing',[br,er,rr,tr],glassMat);
  panel('Cabin roof',[tl,rl,rr,tr],bodyMat);
  panel('Rear cabin closure',[el,er,rr,rl],bodyMat);
  for(const[a,b]of[[bl,tl],[br,tr],[tl,rl],[tr,rr],[rl,el],[rr,er],[[0,0,z0],[0,roofY,zFront]]])tube('Cabin frame',a,b,.025,bodyMat);
  // A dark floor makes the opening legible. Seats and controls are below the
  // unchanged eye point, and the camera's own instrument panel remains intact.
  box('Cabin floor',[Math.min(frontW,rearW)*1.8,.06,z1-z0],[0,-.16,(z0+z1)/2],rubber);
  const seatZ=Math.min(zRear-.2,S.eye[2]+.3);
  for(const side of[-1,1]){
    box('Pilot seat cushion',[.34,.12,.38],[side*.28,-.07,seatZ],rubber);
    box('Pilot seat back',[.34,.43,.09],[side*.28,.12,seatZ+.2],rubber);
    tube('Control column',[side*.28,-.04,seatZ-.18],[side*.28,.2,seatZ-.25],.025,strutMat);
    box('Control grip',[.17,.035,.05],[side*.28,.2,seatZ-.25],rubber);
  }
  const dashZ=zFront+.04;
  box('Instrument coaming',[frontW*1.55,.11,.16],[0,.24,dashZ],rubber);
  // Two inset displays face aft towards the pilots, visible through the sides.
  for(const side of[-1,1])box('Instrument display',[.22,.12,.015],[side*.24,.25,dashZ+.086],strutMat);
  if(type.id!=='harrier')for(const side of[-1,1]){
    const f=mesh('Wing root fairing',new THREE.SphereGeometry(1,8,4),bodyMat,[side*(S.wingRootX+.06),S.wingY-.035,S.wingZ+S.rootChord*.42]);
    f.scale.set(.3,.11,S.rootChord*.65);
    // Rounded caps stay within the existing wing-strike envelope.
    const tip=mesh('Rounded wingtip',new THREE.SphereGeometry(1,8,4),bodyMat,[side*(S.wingRootX+S.halfSpan-.055),S.wingY+S.dihedral,S.wingZ+S.sweep+S.tipChord*.49]);
    tip.scale.set(.055,S.tipChord*(S.sweep>1.4?.04:.07),S.tipChord*.5);
  }
  if(type.id==='courier'){
    for(const side of[-1,1])box('Cabin door handle',[.03,.035,.15],[side*(frontW+rearW)/2,.08,.35],strutMat);
  } else if(type.id==='tempest'){
    // Weather radar and wing-root equipment distinguish the research twin.
    const radar=mesh('Weather radar nose',new THREE.SphereGeometry(1,10,6),rubber,[0,-.03,-2.35*S.bodyLength]);radar.scale.set(.26,.27,.23);
    box('Survey antenna',[.06,.27,.15],[0,.85,.9],strutMat);
  } else if(type.id==='harrier'){
    const housing=mesh('Turbine housing',new THREE.SphereGeometry(1,10,6),bodyMat,[0,.87,.8]);housing.scale.set(.48,.4,.8);
    for(const side of[-1,1]){
      box('Cabin step',[.25,.06,.7],[side*.9,-.65,.1],strutMat);
      tube('Turbine exhaust',[side*.38,1.02,1.05],[side*.5,1.02,1.42],.12,rubber);
    }
  }
  mergeDetails(THREE, group);
  root.userData.inspiration='Original '+type.class.toLowerCase()+' proportions; not a licensed replica.';
  return group;
}

/** Static details share four materials, so batch them into four draw calls. */
function mergeDetails(THREE, group) {
  const batches=new Map();
  for(const child of group.children){
    child.updateMatrix();
    const geo=child.geometry.clone().applyMatrix4(child.matrix);
    let b=batches.get(child.material);
    if(!b){b={positions:[],normals:[],uvs:[],indices:[],names:[]};batches.set(child.material,b);}
    const offset=b.positions.length/3,p=geo.attributes.position,n=geo.attributes.normal,uv=geo.attributes.uv;
    b.positions.push(...p.array);b.normals.push(...n.array);
    for(let i=0;i<p.count;i++)b.uvs.push(uv?uv.getX(i):0,uv?uv.getY(i):0);
    for(const i of geo.index?geo.index.array:Array.from({length:p.count},(_,i)=>i))b.indices.push(offset+i);
    b.names.push(child.name);geo.dispose();child.geometry.dispose();
  }
  group.clear();
  for(const[material,b]of batches){
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(b.positions,3));
    geo.setAttribute('normal',new THREE.Float32BufferAttribute(b.normals,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(b.uvs,2));geo.setIndex(b.indices);
    const m=new THREE.Mesh(geo,material);m.name='Civil details: '+b.names.join(', ');m.castShadow=!material.transparent;group.add(m);
  }
}
