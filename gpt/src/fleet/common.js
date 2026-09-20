import * as THREE from '../vendor/three.module.js';
import { createGroundBody } from './physics.js';
import { helicopterReflectionEnvironment } from './helicopter.js';

// Shared construction and breakaway contract. All masses are game-design values,
// not measured engineering data. Ground response is the tested 120 Hz terrain
// solver used by the helicopter; walls/body-body/continuous collision need the game.
const textureCache = new Map();
const data = new WeakMap();
const finiteV = v => v && ['x','y','z'].every(k => Number.isFinite(v[k]));
const vec = v => Array.isArray(v) ? new THREE.Vector3(...v) : new THREE.Vector3().copy(v);

export function seedRandom(seed = 1) {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n,1664525)+1013904223)>>>0; return n / 4294967296; };
}
export function paintTexture(key,w,h,paint,{srgb=true,repeat=[1,1]}={}) {
  const cacheKey = `${key}|${w}|${h}|${srgb}|${repeat.join(',')}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h;
  const context=canvas.getContext('2d'); if(!context)throw new Error('Canvas 2D is required.');
  paint(context,w,h);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;
  texture.anisotropy=4;
  if(repeat[0]!==1||repeat[1]!==1){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(...repeat);}
  textureCache.set(cacheKey,texture);return texture;
}
export function makeModel(name) {
  const model=new THREE.Group(); model.name=name;
  const state={geometries:new Set(),materials:new Set(),instances:new Set(),parts:{},lost:new Set(),
    bodies:[],disposed:false,crash:null,crashRetired:false,restore:null,crashOptions:null,dirty:false};data.set(model,state);
  model.userData.ownGeometry=g=>{state.geometries.add(g);return g;};
  model.userData.ownMaterial=m=>{state.materials.add(m);return m;};
  return model;
}
export function makeMaterial(model,options={}) {
  const reflection=options.transparent&&options.roughness<.2&&!options.envMap?{envMap:helicopterReflectionEnvironment()}:{};
  return model.userData.ownMaterial(new THREE.MeshStandardMaterial({roughness:.55,metalness:.18,...options,...reflection}));
}
function attach(model,parent,name,geometry,position,material) {
  const mesh=new THREE.Mesh(model.userData.ownGeometry(geometry),material||makeMaterial(model));
  mesh.name=name;mesh.position.set(...position);mesh.castShadow=!mesh.material.transparent;mesh.receiveShadow=true;
  parent.add(mesh);return mesh;
}
export function addBox(model,parent,name,size=[1,1,1],position=[0,0,0],material) {
  return attach(model,parent,name,new THREE.BoxGeometry(...size),position,material);
}
export function addCylinder(model,parent,name,rt,rb,height,segments=8,position=[0,0,0],material,open=false) {
  return attach(model,parent,name,new THREE.CylinderGeometry(rt,rb,height,segments,1,open),position,material);
}
export function addSphere(model,parent,name,radius=1,ws=8,hs=5,position=[0,0,0],material) {
  return attach(model,parent,name,new THREE.SphereGeometry(radius,ws,hs),position,material);
}
export function addPlane(model,parent,name,width,height,position=[0,0,0],material) {
  return attach(model,parent,name,new THREE.PlaneGeometry(width,height),position,material);
}
export function addInstanced(model,parent,name,geometry,material,matrices) {
  const mesh=new THREE.InstancedMesh(model.userData.ownGeometry(geometry),material,Math.max(1,matrices.length));
  mesh.name=name;mesh.count=matrices.length;mesh.userData.instanceCapacity=matrices.length;
  matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.instanceMatrix.needsUpdate=true;
  mesh.castShadow=!material.transparent;mesh.receiveShadow=true;mesh.frustumCulled=false;
  data.get(model).instances.add(mesh);parent.add(mesh);return mesh;
}
export function tubeBetween(model,parent,name,start,end,radius=.04,material,segments=6) {
  const a=vec(start),b=vec(end),delta=b.clone().sub(a);
  const mesh=addCylinder(model,parent,name,radius,radius,delta.length(),segments,[0,0,0],material);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return mesh;
}
export function registerPart(model,id,label,nodes,{massKg=10,dependsOn=null}={}) {
  const s=data.get(model);if(s.parts[id])throw new Error(`Duplicate part ${id}`);
  if(!Array.isArray(nodes))nodes=[nodes];
  if(!nodes.length||nodes.some(n=>!n?.isObject3D)||!Number.isFinite(massKg)||massKg<=0)throw new Error(`Invalid part ${id}`);
  const descriptor={id,label,nodes,massKg,dependsOn,get detached(){return s.lost.has(id);}};
  s.parts[id]=descriptor;
  for(const node of nodes)node.traverse(n=>{if(n.isMesh)n.userData.strikeId=id;});
  return descriptor;
}

function isVisible(node,stop) {
  for(let n=node;n&&n!==stop;n=n.parent)if(!n.visible)return false;return true;
}
function geometryPoints(model,nodes,relative=new THREE.Matrix4(),opaque=false) {
  model.updateWorldMatrix(true,true);
  const points=[],seen=new Set(),instance=new THREE.Matrix4(),transform=new THREE.Matrix4();
  const visited=new Set();
  for(const root of nodes)root.traverse(node=>{
    if(visited.has(node)||!node.isMesh||!isVisible(node,model))return;visited.add(node);
    const materials=Array.isArray(node.material)?node.material:[node.material];
    if(opaque&&materials.every(m=>m.transparent))return;
    const attr=node.geometry.attributes.position;
    for(let k=0;k<(node.isInstancedMesh?node.count:1);k++){
      transform.multiplyMatrices(relative,node.matrixWorld);
      if(node.isInstancedMesh){node.getMatrixAt(k,instance);transform.multiply(instance);}
      for(let i=0;i<attr.count;i++){
        const p=new THREE.Vector3().fromBufferAttribute(attr,i).applyMatrix4(transform);
        const key=`${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
        if(!seen.has(key)){seen.add(key);points.push(p);}
      }
    }
  });return points;
}
function worldPose(model) {
  model.updateWorldMatrix(true,true);const e=model.matrixWorld.elements;
  const x=new THREE.Vector3(e[0],e[1],e[2]),y=new THREE.Vector3(e[4],e[5],e[6]),z=new THREE.Vector3(e[8],e[9],e[10]);
  const scale=x.length();
  if(scale<1e-8||model.matrixWorld.determinant()<=0||Math.abs(y.length()-scale)>scale*1e-5||Math.abs(z.length()-scale)>scale*1e-5||
    Math.abs(x.dot(y))>scale*scale*1e-5||Math.abs(y.dot(z))>scale*scale*1e-5||Math.abs(x.dot(z))>scale*scale*1e-5)
    throw new RangeError('Damage physics requires positive uniform world scale.');
  const position=new THREE.Vector3(),quaternion=new THREE.Quaternion();model.matrixWorld.decompose(position,quaternion,new THREE.Vector3());
  return {position,quaternion,scale};
}
function defaultParent(model,requested) {
  let parent=requested;
  if(!parent)for(let n=model.parent;n;n=n.parent)if(n.isScene){parent=n;break;}
  if(!parent?.isObject3D)throw new Error('Attach the model to a Scene or provide debrisParent.');
  for(let n=parent;n;n=n.parent)if(n===model)throw new Error('Debris parent must be outside the model.');
  parent.updateWorldMatrix(true,false);if(Math.abs(parent.matrixWorld.determinant())<1e-12)throw new RangeError('Debris parent must be invertible.');
  return parent;
}
function cloneNode(source,instances) {
  let copy;
  if(source.isInstancedMesh){
    copy=new THREE.InstancedMesh(source.geometry,source.material,Math.max(1,source.count));copy.count=source.count;
    const matrix=new THREE.Matrix4();for(let i=0;i<source.count;i++){source.getMatrixAt(i,matrix);copy.setMatrixAt(i,matrix);}
    if(source.instanceColor){copy.instanceColor=source.instanceColor.clone();copy.instanceColor.needsUpdate=true;}
    copy.instanceMatrix.needsUpdate=true;copy.frustumCulled=false;instances.push(copy);
  }else if(source.isMesh)copy=new THREE.Mesh(source.geometry,source.material);
  else if(source.isLight){copy=source.clone(false);}
  else copy=new THREE.Group();
  copy.name=source.name;copy.visible=source.visible;copy.castShadow=source.castShadow;copy.receiveShadow=source.receiveShadow;
  copy.renderOrder=source.renderOrder;copy.matrixAutoUpdate=false;copy.matrix.copy(source.matrix);
  for(const child of source.children)copy.add(cloneNode(child,instances));return copy;
}
function boxInertia(points,mass) {
  const size=new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3());
  return new THREE.Vector3(size.y**2+size.z**2,size.x**2+size.z**2,size.x**2+size.y**2).multiplyScalar(mass/12).max(new THREE.Vector3(.001,.001,.001));
}
function syncWorld(node,position,quaternion,scale=1) {
  const matrix=new THREE.Matrix4().compose(position,quaternion,new THREE.Vector3().setScalar(scale));
  if(node.parent){node.parent.updateWorldMatrix(true,false);if(Math.abs(node.parent.matrixWorld.determinant())<1e-12)throw new RangeError('Physics parent must remain invertible.');
    matrix.premultiply(node.parent.matrixWorld.clone().invert());}
  node.matrix.copy(matrix);node.matrix.decompose(node.position,node.quaternion,node.scale);node.matrixAutoUpdate=false;node.matrixWorldNeedsUpdate=true;
}

export function finishModel(model,{update=()=>{},reset=()=>{},dispose=()=>{}}={}) {
  const s=data.get(model);if(!s)throw new Error('Call makeModel first.');
  function getStrikeBounds(id,target=new THREE.Box3()) {
    const p=s.parts[id];if(!p)throw new RangeError(`Unknown strike point ${id}`);
    if(s.lost.has(id))return null;
    return target.setFromPoints(geometryPoints(model,p.nodes));
  }
  function strike(id,options={}) {
    if(s.disposed)return null;const part=s.parts[id];if(!part)throw new RangeError(`Unknown strike point ${id}`);
    if(s.lost.has(id))return null;
    const velocity=options.worldVelocity||s.crash?.velocity||{x:0,y:0,z:0};
    const angular=options.worldAngularVelocity||s.crash?.angularVelocity||{x:0,y:0,z:0};
    const impulse=options.impulse||{x:0,y:0,z:0},kick=options.velocityKick||{x:0,y:0,z:0};
    const life=options.lifetime??10,terrain=options.groundHeight??null;
    if(![velocity,angular,impulse,kick].every(finiteV)||!Number.isFinite(life)||life<.5||life>30||
      (terrain!==null&&typeof terrain!=='function'&&!Number.isFinite(terrain))||
      (options.impactPoint&&!finiteV(options.impactPoint))||(options.velocityOrigin&&!finiteV(options.velocityOrigin)))throw new RangeError('Invalid strike vectors, lifetime or terrain.');
    const pose=worldPose(model),parent=defaultParent(model,options.debrisParent);
    const members=[id];let changed=true;
    while(changed){changed=false;for(const p of Object.values(s.parts))if(p.dependsOn&&members.includes(p.dependsOn)&&!members.includes(p.id)&&!s.lost.has(p.id)){members.push(p.id);changed=true;}}
    const massKg=options.massKg??members.reduce((n,key)=>n+s.parts[key].massKg,0);
    if(!Number.isFinite(massKg)||massKg<=0)throw new RangeError('massKg must be positive.');
    const sources=[...new Set(members.flatMap(key=>s.parts[key].nodes))].filter(node=>{
      for(let p=node.parent;p&&p!==model;p=p.parent)if(members.some(key=>s.parts[key].nodes.includes(p)))return false;return true;});
    const bodyVisual=new THREE.Group(),ownedInstances=[],inverse=model.matrixWorld.clone().invert();
    bodyVisual.name=`Detached_${id}`;
    for(const source of sources){const copy=cloneNode(source,ownedInstances);copy.matrix.multiplyMatrices(inverse,source.matrixWorld);bodyVisual.add(copy);}
    bodyVisual.updateMatrixWorld(true);
    let points=geometryPoints(bodyVisual,[bodyVisual]);
    if(!points.length){for(const instance of ownedInstances)instance.dispose();return null;}
    const center=new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    const shift=new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z);
    for(const copy of bodyVisual.children){copy.matrix.premultiply(shift);copy.matrixWorldNeedsUpdate=true;}
    points=points.map(p=>p.sub(center).multiplyScalar(pose.scale));
    const position=center.clone().applyMatrix4(model.matrixWorld),inertia=boxInertia(points,massKg);
    const linear=vec(velocity).add(kick).addScaledVector(impulse,1/massKg);
    const origin=options.velocityOrigin||s.crash?.position||pose.position;
    linear.add(vec(angular).cross(position.clone().sub(origin)));
    const omega=vec(angular);
    if(options.impactPoint){const torque=vec(options.impactPoint).sub(position).cross(impulse).applyQuaternion(pose.quaternion.clone().invert());
      torque.divide(inertia).applyQuaternion(pose.quaternion);omega.add(torque);}
    const ground=createGroundBody({position,quaternion:pose.quaternion,velocity:linear,angularVelocity:omega,massKg,inertia,points,
      groundHeight:terrain??(()=>NaN),friction:options.friction??.65,restitution:options.restitution??.08});
    const body={...ground,id,visual:bodyVisual,massKg,inertia,points,members,age:0,lifetime:life,active:true,
      externalPhysics:!!options.externalPhysics,scale:pose.scale,ownedInstances,physics:ground};
    for(const key of members){s.lost.add(key);for(const node of s.parts[key].nodes)node.visible=false;}
    parent.add(bodyVisual);syncWorld(bodyVisual,body.position,body.quaternion,pose.scale);s.bodies.push(body);s.dirty=true;
    model.userData.onPartDetached?.(id,body);return{id,body,rotorFragments:0};
  }
  function updateDebris(dt) {
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('dt must be finite seconds >=0.');if(s.disposed)return;
    for(const body of s.bodies){if(!body.active)continue;body.age+=dt;
      if(body.age>=body.lifetime){body.active=false;body.visual.removeFromParent();for(const instance of body.ownedInstances)instance.dispose();continue;}
      if(!body.externalPhysics){body.physics.update(dt);body.sleeping=body.physics.sleeping;body.contacts=body.physics.contacts;}
      syncWorld(body.visual,body.position,body.quaternion,body.scale*Math.min(1,(body.lifetime-body.age)/.6));
    }
    model.userData.airframeDamage.activeParts=s.bodies.filter(b=>b.active).length;
  }
  function rebuildCrash(poseState=null) {
    const opts=s.crashOptions,pose=worldPose(model),inv=model.matrixWorld.clone().invert();
    let points=geometryPoints(model,[model],inv,true);if(!points.length)points=geometryPoints(model,[model],inv,false);
    if(!points.length){
      // The last section may have detached during a crash. Its independent body
      // owns that geometry now; keep the saved reset pose but retire this solver.
      if(poseState){s.crash=null;s.crashOptions=null;s.crashRetired=true;s.dirty=false;
        model.userData.crashBody=null;model.userData.crashRetired=true;return;}
      throw new Error('No visible geometry can support a crash body.');
    }
    const center=opts.centerOfMass?vec(opts.centerOfMass):new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    if(!finiteV(center))throw new RangeError('Invalid local centre of mass.');
    points=points.map(p=>p.sub(center).multiplyScalar(opts.scale));
    const inertia=opts.inertia?vec(opts.inertia):boxInertia(points,opts.massKg);
    const ground=createGroundBody({...opts,points,inertia,position:poseState?.position||center.clone().applyMatrix4(model.matrixWorld),
      quaternion:poseState?.quaternion||pose.quaternion,velocity:poseState?.velocity||vec(opts.worldVelocity),
      angularVelocity:poseState?.angularVelocity||vec(opts.worldAngularVelocity)});
    Object.assign(ground,{massKg:opts.massKg,inertia,points,centerOfMass:center});s.crash=ground;s.dirty=false;model.userData.crashBody=ground;
  }
  function beginCrash(options={}) {
    if(s.disposed||s.crashRetired)return null;if(s.crash)return s.crash;
    const pose=worldPose(model),{groundHeight=0,massKg=1000,worldVelocity={x:0,y:0,z:0},worldAngularVelocity={x:0,y:0,z:0},friction=.65,restitution=.08}=options;
    if(![worldVelocity,worldAngularVelocity].every(finiteV)||!Number.isFinite(massKg)||massKg<=0||
      !(typeof groundHeight==='function'||Number.isFinite(groundHeight))||(options.centerOfMass&&!finiteV(vec(options.centerOfMass)))||
      !Number.isFinite(friction)||friction<0||!Number.isFinite(restitution)||restitution<0||restitution>1||
      (options.inertia&&(!finiteV(vec(options.inertia))||Math.min(...vec(options.inertia).toArray())<=0)))throw new RangeError('Invalid crash options.');
    s.restore={matrix:model.matrix.clone(),auto:model.matrixAutoUpdate};
    s.crashOptions={...options,groundHeight,massKg,worldVelocity,worldAngularVelocity,friction,restitution,scale:pose.scale};
    rebuildCrash();model.matrixAutoUpdate=false;return s.crash;
  }
  function updateCrash(dt) {
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('Invalid dt.');if(!s.crash)return null;
    if(s.dirty){const previous=s.crash;s.crashOptions.centerOfMass=previous.centerOfMass;rebuildCrash(previous);}
    if(!s.crash)return null;
    s.crash.update(dt);
    const origin=s.crash.centerOfMass.clone().multiplyScalar(s.crashOptions.scale).applyQuaternion(s.crash.quaternion).negate().add(s.crash.position);
    syncWorld(model,origin,s.crash.quaternion,s.crashOptions.scale);return s.crash;
  }
  function resetDamage() {
    if(s.disposed)return;
    for(const body of s.bodies){body.active=false;body.visual.removeFromParent();for(const instance of body.ownedInstances)instance.dispose();}
    s.bodies.length=0;s.lost.clear();for(const part of Object.values(s.parts))for(const node of part.nodes)node.visible=true;
    s.crash=null;model.userData.crashBody=null;s.crashRetired=false;model.userData.crashRetired=false;s.crashOptions=null;s.dirty=false;
    if(s.restore){model.matrix.copy(s.restore.matrix);model.matrix.decompose(model.position,model.quaternion,model.scale);model.matrixAutoUpdate=s.restore.auto;model.matrixWorldNeedsUpdate=true;s.restore=null;}
    model.userData.airframeDamage.activeParts=0;reset();
  }
  const stats={triangles:0,meshes:0,maxDrawCalls:0};
  model.traverse(n=>{if(!n.isMesh)return;stats.triangles+=(n.geometry.index?.count||n.geometry.attributes.position.count)/3*
    (n.isInstancedMesh?Math.max(n.count,n.userData.instanceCapacity||0):1);stats.meshes++;
    const mats=Array.isArray(n.material)?n.material:[n.material];
    stats.maxDrawCalls+=mats.reduce((sum,m)=>sum+(m.transparent&&m.side===THREE.DoubleSide&&!m.forceSinglePass?2:1),0);});
  Object.assign(model.userData,{stats,damageContractVersion:1,strikePoints:s.parts,getStrikeBounds,strike,partBodies:s.bodies,
    refreshStrikeGeometry(){s.dirty=true;if(s.crash)s.crash.wake();},
    setCrashMass(massKg,inertia=null){
      if(!s.crash)throw new Error('Call beginCrash before changing crash mass.');
      if(!Number.isFinite(massKg)||massKg<=0||(inertia&&(!finiteV(inertia)||Math.min(inertia.x,inertia.y,inertia.z)<=0)))throw new RangeError('Crash mass and inertia must be positive and finite.');
      const previous=s.crash;s.crashOptions.massKg=massKg;s.crashOptions.centerOfMass=previous.centerOfMass;
      if(inertia)s.crashOptions.inertia=vec(inertia);else delete s.crashOptions.inertia;
      s.dirty=true;rebuildCrash(previous);return s.crash;
    },
    applyCrashImpulse(impulse,worldPoint){if(!s.crash)throw new Error('Call beginCrash before applying a crash impulse.');
      if(!finiteV(impulse)||!finiteV(worldPoint))throw new RangeError('Impulse and point must be world vectors.');
      const body=s.crash;body.velocity.addScaledVector(impulse,1/body.massKg);
      const torque=vec(worldPoint).sub(body.position).cross(impulse).applyQuaternion(body.quaternion.clone().invert());
      torque.divide(body.inertia).applyQuaternion(body.quaternion);body.angularVelocity.add(torque);body.wake();},
    airframeDamage:{activeParts:0},crashBody:null,crashRetired:false,beginCrash,updateCrash,updateDebris,resetDamage,
    update(dt,state={}){if(s.disposed)return;if(!Number.isFinite(dt)||dt<0)throw new RangeError('dt must be finite seconds >=0.');
      if(s.crash)updateCrash(dt);else if(!s.crashRetired)update(dt,state||{});updateDebris(dt);},
    dispose(){if(s.disposed)return;resetDamage();dispose();s.disposed=true;
      for(const instance of s.instances)instance.dispose();for(const geometry of s.geometries)geometry.dispose();for(const material of s.materials)material.dispose();}
  });return model;
}
