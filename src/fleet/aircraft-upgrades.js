import * as THREE from '../vendor/three.module.js';
import {makeModel,makeMaterial,addBox,addCylinder,addSphere,addInstanced,registerPart,finishModel,paintTexture} from './common.js';
import {helicopterSurfaceTexture,helicopterSurfaceNormal,helicopterCabinTexture,helicopterReflectionEnvironment} from './helicopter.js';

// Replace the fighter's external barrel with this assembly. At trainer-space
// scale its .42 m engine radius fits within the brief's .56 m fuselage radius.
// The ducts sit on the sides; their mouths face -Z, exhaust faces +Z.
export function createFighterEngineAssembly({color=0x737e83,showCutaway=false}={}) {
  const m=makeModel('Fighter engine and side intakes');
  const skin=makeMaterial(m,{map:helicopterSurfaceTexture('cowling',color),normalMap:helicopterSurfaceNormal('cowling'),roughness:.43,metalness:.5});
  const metal=makeMaterial(m,{color:0x6d777b,metalness:.8,roughness:.32});
  const black=makeMaterial(m,{color:0x11181b,roughness:.87});
  const hot=makeMaterial(m,{color:0x31281f,emissive:0xff762b,emissiveIntensity:0,roughness:.44});
  const buried=addCylinder(m,m,'Buried engine',.42,.37,1.75,10,[0,-.05,2.1],skin);buried.rotation.x=Math.PI/2;
  buried.visible=showCutaway; // The fuselage encloses it; cutaway explicitly reveals the internal engine.
  const intakes=[];
  for(const side of[-1,1]){
    const group=new THREE.Group();group.name=side<0?'Port intake':'Starboard intake';group.position.set(side*.61,-.08,.15);m.add(group);
    const duct=addBox(m,group,'Tapered intake duct',[.34,.46,1.15],[0,0,.35],skin);
    const p=duct.geometry.attributes.position;
    for(let i=0;i<p.count;i++){const rear=(p.getZ(i)+.575)/1.15;p.setX(i,p.getX(i)*(1-.25*rear)-side*.10*rear);}
    duct.geometry.computeVertexNormals();
    const lip=addCylinder(m,group,'Intake rim',.235,.235,.065,8,[0,0,-.25],metal,true);lip.rotation.x=Math.PI/2;lip.scale.x=.75;
    const throat=addCylinder(m,group,'Recessed dark throat',.205,.205,.025,8,[0,0,-.215],black);throat.rotation.x=Math.PI/2;throat.scale.x=.76;
    const splitter=addBox(m,group,'Boundary-layer splitter',[.025,.47,.51],[-side*.205,0,-.06],metal);
    intakes.push(group);registerPart(m,side<0?'leftIntake':'rightIntake',group.name,[group],{massKg:42});
  }
  const tailpipe=new THREE.Group();tailpipe.name='Single tailpipe';m.add(tailpipe);
  const tube=addCylinder(m,tailpipe,'Exhaust shroud',.36,.32,.65,10,[0,-.05,3.2],metal,true);tube.rotation.x=Math.PI/2;
  const nozzle=addCylinder(m,tailpipe,'Nozzle petals',.3,.25,.24,10,[0,-.05,3.56],hot,true);nozzle.rotation.x=Math.PI/2;
  const throat=addCylinder(m,tailpipe,'Nozzle throat',.245,.245,.02,10,[0,-.05,3.48],black);throat.rotation.x=Math.PI/2;
  const flameMaterial=m.userData.ownMaterial(new THREE.MeshBasicMaterial({color:0xe59655,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));
  const flame=addCylinder(m,tailpipe,'Afterburner plume',.01,.23,1.2,6,[0,-.05,4.25],flameMaterial,true);flame.rotation.x=Math.PI/2;flame.visible=false;
  registerPart(m,'engine','Internal engine',[buried],{massKg:370});registerPart(m,'tailpipe','Tailpipe and nozzle',[tailpipe],{massKg:80,dependsOn:'engine'});
  Object.assign(m.userData,{intakes,buriedEngine:buried,nozzle,dimensions:{intakeSeparation:1.22,engineRadius:.42,engineLength:1.75,tailpipeRadius:.36},
    setCutaway(value){buried.visible=!!value&&!m.userData.strikePoints.engine.detached;}});
  return finishModel(m,{update(dt,state={}){
    const rpm=THREE.MathUtils.clamp(state.rpm??.5,0,1);hot.emissiveIntensity=Math.max(0,(rpm-.3)/.7)*1.25;
    flame.visible=rpm>.86;flameMaterial.opacity=Math.max(0,(rpm-.86)/.14)*.38;
  },reset(){buried.visible=showCutaway;flame.visible=false;flameMaterial.opacity=0;hot.emissiveIntensity=0;}});
}

/** Wrap an existing aircraft with explicit section references. No guessed mesh
 * names: the game supplies its wing/tail/engine/fuselage groups. Existing flight
 * animation still belongs to the game while damage owns transforms after crash. */
export function createAircraftDamageAdapter({airframe,sections,massKg=1100,centerOfMass={x:0,y:0,z:0},disposeAirframe=false}={}) {
  if(!airframe?.isObject3D||!sections||!Object.keys(sections).length)throw new TypeError('Pass an airframe and named section nodes.');
  const m=makeModel('Aircraft damage adapter');m.add(airframe);const rest=new Map(),severity={},wingHinges=new Map();
  const finiteVector=v=>v&&['x','y','z'].every(key=>Number.isFinite(v[key]));
  const vector=v=>new THREE.Vector3(v.x,v.y,v.z);
  for(const[id,entry]of Object.entries(sections)){
    const definition=Array.isArray(entry)?{nodes:entry}:entry?.isObject3D?{nodes:[entry]}:entry;
    registerPart(m,id,definition.label||id,definition.nodes,{massKg:definition.massKg||40,dependsOn:definition.dependsOn||null});
    severity[id]=0;
  }
  function deformedMeshes(id){const nodes=m.userData.strikePoints[id]?.nodes;if(!nodes)throw new RangeError(`Unknown damage section ${id}`);
    const meshes=new Set();for(const node of nodes)node.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh)meshes.add(o);});return [...meshes];}
  function damagePart(id,amount=1,mode=id.toLowerCase().includes('prop')?'bendProp':id.toLowerCase().includes('wing')?'bendWing':'crush') {
    if(!Number.isFinite(amount)||amount<0||amount>1)throw new RangeError('Damage severity is 0..1.');
    if(!m.userData.strikePoints[id])throw new RangeError(`Unknown damage section ${id}`);
    if(m.userData.strikePoints[id].detached)return false;
    for(const mesh of deformedMeshes(id)){
      if(!rest.has(mesh)){
        const original=mesh.geometry;mesh.geometry=m.userData.ownGeometry(original.clone());mesh.geometry.computeBoundingBox();
        rest.set(mesh,{original,array:mesh.geometry.attributes.position.array.slice(),bounds:mesh.geometry.boundingBox.clone()});
      }
      const saved=rest.get(mesh),p=mesh.geometry.attributes.position,b=saved.bounds,size=b.getSize(new THREE.Vector3()),center=b.getCenter(new THREE.Vector3());
      for(let i=0;i<p.count;i++){
        let x=saved.array[i*3],y=saved.array[i*3+1],z=saved.array[i*3+2];
        if(mode==='bendProp'){
          const span=size.x>size.y?(x-center.x)/(size.x||1):(y-center.y)/(size.y||1);
          z+=amount*Math.abs(span)**1.8*Math.max(size.x,size.y)*.34;
        }else if(mode==='bendWing'){
          const span=Math.abs(x-center.x)/Math.max(.01,size.x*.5);y-=amount*span**2*size.x*.20;
          z+=amount*span**2*size.z*.12;
        }else{
          const front=1-(z-b.min.z)/Math.max(.01,size.z);z+=amount*.4*size.z*front**2;
          y=center.y+(y-center.y)*(1-amount*.34)-amount*front*.10*size.y;
          x+=amount*.06*size.x*Math.sin(y*8+z*5)*front;
        }
        p.setXYZ(i,x,y,z);
      }
      p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
    }
    severity[id]=amount;m.userData.refreshStrikeGeometry();return true;
  }
  // One scalar rotational degree of freedom. The whole wing remains attached
  // at its measured root; caller-supplied aerodynamic loads drive the hinge.
  function setWingHinge(id,options={}) {
    const part=m.userData.strikePoints[id];
    if(!part)throw new RangeError(`Unknown wing section ${id}`);
    if(part.detached)return null;
    if(wingHinges.has(id))return wingHinges.get(id);
    if(part.nodes.length!==1)throw new RangeError('A hinged wing section must contain one assembly Group or Mesh.');
    const node=part.nodes[0],parent=node.parent,pivot=options.pivot,axis=options.axis||{x:0,y:0,z:1};
    if(!parent||!finiteVector(pivot)||!finiteVector(axis)||vector(axis).lengthSq()<1e-10)throw new RangeError('Supply a root pivot and nonzero axis in the wing parent coordinates.');
    const wingMass=options.massKg??part.massKg,stiffness=options.stiffness??180,damping=options.damping??65;
    const area=options.areaM2??3.5,dragCoefficient=options.dragCoefficient??.035,damage=options.damage??.7;
    const minAngle=options.minAngle??-1.45,maxAngle=options.maxAngle??1.45,initialAngle=options.angle??0,initialVelocity=options.angularVelocity??0;
    if(![wingMass,area].every(v=>Number.isFinite(v)&&v>0)||![stiffness,damping,dragCoefficient].every(v=>Number.isFinite(v)&&v>=0)||
      ![minAngle,maxAngle,initialAngle,initialVelocity,damage].every(Number.isFinite)||minAngle>=maxAngle||minAngle< -Math.PI||maxAngle>Math.PI||damage<0||damage>1)
      throw new RangeError('Invalid wing hinge mass, spring, area, angle or damage settings.');
    node.updateWorldMatrix(true,true);
    const com=options.centerOfMass?vector(options.centerOfMass):node.worldToLocal(new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()));
    if(!finiteVector(com))throw new RangeError('Wing centre of mass must be a finite node-local vector.');
    const pivotWorld=parent.localToWorld(vector(pivot)),comWorld=node.localToWorld(com.clone());
    const arm=comWorld.distanceTo(pivotWorld);
    const inertia=options.inertia??Math.max(.01,wingMass*arm*arm*4/3);
    if(!Number.isFinite(inertia)||inertia<=0)throw new RangeError('Wing rotational inertia must be positive.');
    const saved={parent,index:parent.children.indexOf(node),matrix:node.matrix.clone(),auto:node.matrixAutoUpdate};
    const hinge=new THREE.Group();hinge.name=`Hanging ${part.label}`;hinge.position.copy(pivot);parent.add(hinge);hinge.add(node);
    node.matrix.copy(new THREE.Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z).multiply(saved.matrix));
    node.matrix.decompose(node.position,node.quaternion,node.scale);node.matrixAutoUpdate=false;
    const state={id,node,hinge,saved,axis:vector(axis).normalize(),centerOfMass:com,massKg:wingMass,inertia,
      stiffness,damping,areaM2:area,dragCoefficient,damage,minAngle,maxAngle,
      angle:THREE.MathUtils.clamp(initialAngle,minAngle,maxAngle),contactAngle:THREE.MathUtils.clamp(initialAngle,minAngle,maxAngle),angularVelocity:initialVelocity,active:true,
      liftScale:1,dragScale:1,extraDragForce:new THREE.Vector3(),aerodynamicForce:new THREE.Vector3(),
      attachmentWorld:new THREE.Vector3(),centerOfMassWorld:new THREE.Vector3(),gravityTorque:0,aerodynamicTorque:0};
    hinge.quaternion.setFromAxisAngle(state.axis,state.angle);wingHinges.set(id,state);
    severity[id]=Math.max(severity[id],damage);m.userData.refreshStrikeGeometry();return state;
  }
  function updateHinges(dt,inputs={}) {
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('Wing hinge dt must be finite seconds >= 0.');
    const velocity=inputs.worldVelocity||{x:0,y:0,z:0},wind=inputs.windVelocity||{x:0,y:0,z:0},density=inputs.airDensity??1.225,loads=inputs.wingLoads||{};
    if(!finiteVector(velocity)||!finiteVector(wind)||!Number.isFinite(density)||density<0)throw new RangeError('Invalid wing airflow inputs.');
    const relative=vector(velocity).sub(wind),speedSquared=relative.lengthSq(),dragDirection=relative.clone().normalize().negate();
    let changed=false;
    for(const state of wingHinges.values()) {
      if(m.userData.strikePoints[state.id].detached||!state.node.visible){state.active=false;state.liftScale=0;state.dragScale=0;state.extraDragForce.set(0,0,0);continue;}
      const load=loads[state.id];
      if(load&&(!finiteVector(load.force)||(load.point&&!finiteVector(load.point))))throw new RangeError('Wing loads require a world force and optional world application point.');
      let left=Math.min(dt,.1);
      do {
        const h=Math.min(left,1/240);left-=h;
        state.hinge.quaternion.setFromAxisAngle(state.axis,state.angle);state.hinge.updateWorldMatrix(true,true);
        state.hinge.getWorldPosition(state.attachmentWorld);
        state.centerOfMassWorld.copy(state.centerOfMass).applyMatrix4(state.node.matrixWorld);
        const parentQ=state.hinge.parent.getWorldQuaternion(new THREE.Quaternion()),worldAxis=state.axis.clone().applyQuaternion(parentQ);
        const lever=state.centerOfMassWorld.clone().sub(state.attachmentWorld);
        const gravityForce=new THREE.Vector3(0,-state.massKg*9.81,0);
        state.gravityTorque=lever.clone().cross(gravityForce).dot(worldAxis);
        // Per-wing modifiers are offered to the host flight model. Only extra
        // drag acts here by default; a supplied full load replaces that force.
        state.liftScale=(1-state.damage*.45)*Math.cos(state.angle)**2;
        state.dragScale=1+state.damage*.8+3*Math.sin(state.angle)**2;
        const extraDrag=.5*density*speedSquared*state.areaM2*state.dragCoefficient*(state.dragScale-1);
        state.extraDragForce.copy(dragDirection).multiplyScalar(extraDrag);
        state.aerodynamicForce.copy(load?load.force:state.extraDragForce);
        const forceLever=load?.point?vector(load.point).sub(state.attachmentWorld):lever;
        state.aerodynamicTorque=forceLever.clone().cross(state.aerodynamicForce).dot(worldAxis);
        const torque=state.gravityTorque+state.aerodynamicTorque-state.stiffness*state.angle-state.damping*state.angularVelocity;
        state.angularVelocity+=torque/state.inertia*h;state.angle+=state.angularVelocity*h;
        if(state.angle<state.minAngle){state.angle=state.minAngle;state.angularVelocity=Math.max(0,state.angularVelocity)*.05;}
        if(state.angle>state.maxAngle){state.angle=state.maxAngle;state.angularVelocity=Math.min(0,state.angularVelocity)*.05;}
      }while(left>1e-9);
      state.hinge.quaternion.setFromAxisAngle(state.axis,state.angle);
      state.liftScale=(1-state.damage*.45)*Math.cos(state.angle)**2;
      state.dragScale=1+state.damage*.8+3*Math.sin(state.angle)**2;
      state.extraDragForce.copy(dragDirection).multiplyScalar(.5*density*speedSquared*state.areaM2*state.dragCoefficient*(state.dragScale-1));
      if(Math.abs(state.angle-state.contactAngle)>.0005){state.contactAngle=state.angle;changed=true;}
    }
    if(changed)m.userData.refreshStrikeGeometry();return wingHinges;
  }
  function resetHinges() {
    for(const state of wingHinges.values()) {
      const {node,saved}=state;saved.parent.add(node);node.matrix.copy(saved.matrix);node.matrix.decompose(node.position,node.quaternion,node.scale);node.matrixAutoUpdate=saved.auto;node.matrixWorldNeedsUpdate=true;
      // Restore sibling order so caller traversal/indexing does not drift.
      saved.parent.children.splice(saved.parent.children.indexOf(node),1);saved.parent.children.splice(saved.index,0,node);
      state.hinge.removeFromParent();state.active=false;state.angle=state.angularVelocity=0;state.liftScale=state.dragScale=1;
    }wingHinges.clear();
  }
  function reset(){resetHinges();for(const[mesh,saved]of rest){mesh.geometry.attributes.position.array.set(saved.array);mesh.geometry.attributes.position.needsUpdate=true;
    mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}for(const id in severity)severity[id]=0;}
  finishModel(m,{update:updateHinges,reset,dispose(){for(const[mesh,saved]of rest)mesh.geometry=saved.original;if(disposeAirframe)airframe.userData.dispose?.();}});
  // Common freezes normal animation during crashes. A hanging wing remains an
  // articulated approximation, so advance it before the crash contact rebuild.
  const updateModel=m.userData.update;
  m.userData.update=(dt,state={})=>{if(m.userData.crashBody)updateHinges(dt,{worldVelocity:m.userData.crashBody.velocity,...state});updateModel(dt,state);};
  Object.assign(m.userData,{airframe,deformation:severity,damagePart,wingHinges,setWingHinge,updateHinges,
    wingtipStrike(id,{worldVelocity={x:0,y:0,z:0},worldAngularVelocity={x:0,y:0,z:0},groundHeight=0,impulse=null,impactPoint=null,...options}={}){
      damagePart(id,.55,'bendWing');const body=m.userData.beginCrash({massKg,centerOfMass,groundHeight,worldVelocity,worldAngularVelocity,...options});
      if(impulse&&impactPoint)m.userData.applyCrashImpulse(impulse,impactPoint);return body;
    },
    rampStrike(options={}){if(sections.nose)damagePart('nose',.9);return m.userData.beginCrash({massKg,centerOfMass,...options});}
  });return m;
}

// Compression responds to supplied per-leg loads. This does not replace the
// aircraft's ground reaction solver; it animates wheel/oleo nodes from that load.
export function createSuspensionController(legs,{travel=.22,stiffness=48000,damping=1700,unsprungMass=22}={}) {
  if(!Array.isArray(legs)||!legs.length||legs.some(node=>!node?.isObject3D)||
    ![travel,stiffness,damping,unsprungMass].every(value=>Number.isFinite(value)&&value>0))throw new RangeError('Supply Object3D legs and finite positive spring settings.');
  const states=legs.map(node=>({node,rest:node.position.clone(),compression:0,velocity:0}));
  return {states,update(dt,{loads=[],grounded=false}={}){
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('Invalid suspension dt.');
    if(!Array.isArray(loads)||loads.some(load=>!Number.isFinite(load)))throw new RangeError('Suspension loads must be finite forces in newtons.');
    let left=Math.min(dt,.1);while(left>0){const h=Math.min(left,1/240);left-=h;
      states.forEach((s,i)=>{const force=grounded?Math.max(0,loads[i]||0):0;
        s.velocity+=(force-stiffness*s.compression-damping*s.velocity)/unsprungMass*h;
        s.compression+=s.velocity*h;
        if(s.compression<0){s.compression=0;s.velocity=Math.max(0,s.velocity);}
        if(s.compression>travel){s.compression=travel;s.velocity=Math.min(0,s.velocity);}
      });}
    for(const s of states)s.node.position.copy(s.rest).add(new THREE.Vector3(0,s.compression,0));
  },reset(){for(const s of states){s.compression=s.velocity=0;s.node.position.copy(s.rest);}}};
}

// A small inspection fixture shows progressive and separated airframe damage;
// it is not intended to replace the game's already-good aircraft renderers.
export function createDamageTestAirframe() {
  const aircraft=makeModel('Airframe inspection fixture'),paint=makeMaterial(aircraft,{map:helicopterSurfaceTexture('cowling',0xa6acaa),roughness:.5});
  const glass=makeMaterial(aircraft,{map:helicopterCabinTexture(0xa6acaa,0x58666f),roughness:.16,metalness:.28,envMap:helicopterReflectionEnvironment()});
  const body=addSphere(aircraft,aircraft,'Nose and cabin',1,10,6,[0,1.05,-.2],glass);body.scale.set(.58,.6,2.2);
  const wingGroups=[];for(const side of[-1,1]){
    const group=new THREE.Group();group.position.set(side*2.05,.95,.25);aircraft.add(group);
    addBox(aircraft,group,side<0?'Left wing':'Right wing',[3.1,.09,1.15],[0,0,0],paint);wingGroups.push(group);
  }
  const tail=new THREE.Group();aircraft.add(tail);
  addBox(aircraft,tail,'Horizontal tail',[2,.07,.65],[0,1.1,1.8],paint);
  const fin=addBox(aircraft,tail,'Tail fin',[.08,.95,.75],[0,1.52,1.82],paint);fin.rotation.x=.2;
  const prop=new THREE.Group();prop.position.set(0,1.05,-2.4);aircraft.add(prop);
  const blades=addBox(aircraft,prop,'Propeller',[.13,1.9,.04],[0,0,0],makeMaterial(aircraft,{color:0x2b3335}));
  const engine=addCylinder(aircraft,aircraft,'Engine cowling',.36,.42,.6,8,[0,1.05,-1.8],paint);engine.rotation.x=Math.PI/2;
  const gear=new THREE.Group();aircraft.add(gear);
  const wheelGeo=new THREE.CylinderGeometry(.22,.22,.15,6);wheelGeo.rotateZ(Math.PI/2);
  const wheelMat=makeMaterial(aircraft,{color:0x252b2d,roughness:.9});
  addInstanced(aircraft,gear,'Wheels',wheelGeo,wheelMat,[[-.65,.22,.3],[.65,.22,.3],[0,.22,-1.6]].map(p=>new THREE.Matrix4().makeTranslation(...p)));
  finishModel(aircraft);
  const adapter=createAircraftDamageAdapter({airframe:aircraft,disposeAirframe:true,sections:{nose:{nodes:[body],massKg:210,label:'Cabin and nose'},
    leftWing:{nodes:[wingGroups[0]],massKg:65,label:'Left wing'},rightWing:{nodes:[wingGroups[1]],massKg:65,label:'Right wing'},
    tail:{nodes:[tail],massKg:50,label:'Tail assembly'},engine:{nodes:[engine],massKg:160,label:'Engine'},
    propeller:{nodes:[prop],massKg:12,label:'Propeller',dependsOn:'engine'},landingGear:{nodes:[gear],massKg:30,label:'Landing gear'}},centerOfMass:{x:0,y:1,z:0}});
  return adapter;
}
export const previewModels=[
  {id:'fighter-intakes',label:'Fighter intakes and single tailpipe',create:()=>createFighterEngineAssembly({showCutaway:true}),updateState:{rpm:.6},damagePart:'leftIntake'},
  {id:'airframe-damage',label:'Progressive airframe damage',create:()=>createDamageTestAirframe(),damagePart:'leftWing'},
  {id:'hanging-wing',label:'Torn wing on a flexible attachment',create:()=>{
    const model=createDamageTestAirframe();model.userData.damagePart('leftWing',.5,'bendWing');
    model.userData.setWingHinge('leftWing',{pivot:{x:-.5,y:.905,z:.25},massKg:65});return model;
  },updateState:{worldVelocity:{x:0,y:0,z:-30}},damagePart:'leftWing',preview:{warmup:2}}
];
