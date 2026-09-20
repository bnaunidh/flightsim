/** Cockpit details, 2026-09-20: displays, control sticks and headrests.
 * Adapter triangles: Vanguard 1526 -> 1570, Osprey 1698 -> 1742.
 * Span:length remains .707 and 1.037. No animation/physics changes.
 * Final suite: 146/146. Device frame rates not measured. */
/** Full-size, type-specific procedural aircraft. All surfaces derive from stock Three geometries. */
import * as THREE from '../vendor/three.module.js';
import {makeModel,finishModel,addBox,addCylinder,addSphere,addInstanced,tubeBetween,makeMaterial} from './common.js';
import {createAircraftDamageAdapter} from './aircraft-upgrades.js';
import {createAircraftMaterials,aircraftDecalTexture} from './aircraft-textures.js';
import {attachAircraftImpact} from './aircraft-impact.js';
const clamp=THREE.MathUtils.clamp, V=(p)=>new THREE.Vector3(...p);
const mix=(a,b,t)=>a+(b-a)*t;
export function buildAircraft(config,options={}) {
 const c={...config,paint:options.livery||options.paint||config.paint,accent:options.accent||config.accent};
 if(!c.id||!Array.isArray(c.body)||c.body.length<4)throw new TypeError('Aircraft needs an id and ordered body stations.');
 for(let i=0;i<c.body.length;i++)if(!c.body[i].every(Number.isFinite)||(i&&c.body[i][0]<=c.body[i-1][0]))throw new RangeError('Body stations must be finite and increasing in Z.');
 const model=makeModel(c.name),materials=createAircraftMaterials(model,c),parts={},definitions={},animations=[],restTransforms=new Map(),wheels=[],controlNodes={},engines=[];
 materials.accent||=makeMaterial(model,{color:c.accent,roughness:.48,metalness:.24});
 const own=geo=>model.userData.ownGeometry(geo);
 function mesh(name,geo,mat=materials.skin,parent=model){const m=new THREE.Mesh(own(geo),mat);m.name=name;m.castShadow=!mat.transparent;m.receiveShadow=true;parent.add(m);return m;}
 function group(id,label,massKg=10,dependsOn=null,parent=model){if(parts[id])throw new Error('Duplicate aircraft section '+id);const g=new THREE.Group();g.name=label;parent.add(g);parts[id]=g;definitions[id]={label,nodes:[g],massKg,dependsOn};return g;}
 function box(name,size,pos,mat=materials.skin,parent=model){return addBox(model,parent,name,size,pos,mat);}
 function tube(name,a,b,r,mat=materials.metal,parent=model,segments=6){return tubeBetween(model,parent,name,a,b,r,mat,segments);}
 function panel(name,points,mat=materials.skin,parent=model){if(points.length!==4)throw new Error('Panel needs four corners around its perimeter.');const geo=new THREE.PlaneGeometry(1,1),p=geo.attributes.position;const order=[3,2,0,1];for(let i=0;i<4;i++)p.setXYZ(i,...points[order[i]]);geo.computeVertexNormals();return mesh(name,geo,mat,parent);}
 function skin(stations,mat=materials.skin,parent=model,radial=12){const geo=new THREE.CylinderGeometry(1,1,1,radial,stations.length-1,false),p=geo.attributes.position;
  for(let i=0;i<p.count;i++){const j=Math.round((.5-p.getY(i))*(stations.length-1));const[z,rx,ry,cy=0]=stations[clamp(j,0,stations.length-1)];p.setXYZ(i,p.getX(i)*rx,p.getZ(i)*ry+cy,z);}geo.computeVertexNormals();return mesh('Lofted aircraft skin',geo,mat,parent);}
 function profile(z){let k=0;while(k<c.body.length-2&&c.body[k+1][0]<z)k++;const a=c.body[k],b=c.body[k+1],t=clamp((z-a[0])/(b[0]-a[0]),0,1);return[mix(a[1],b[1],t),mix(a[2],b[2],t),mix(a[3]||0,b[3]||0,t)];}
 function conformingPatch(name,z0,z1,phi0,phi1,mat,parent,offset=.012){const geo=new THREE.PlaneGeometry(1,1,4,2),p=geo.attributes.position,uv=geo.attributes.uv;
  for(let i=0;i<p.count;i++){const z=mix(z0,z1,uv.getY(i)),phi=mix(phi0,phi1,uv.getX(i)),[rx,ry,cy]=profile(z);p.setXYZ(i,(rx+offset)*Math.sin(phi),cy+(ry+offset)*Math.cos(phi),z);}geo.computeVertexNormals();return mesh(name,geo,mat,parent);}
 const n=c.body.length,a=Math.max(1,Math.min(n-3,Math.round(n*.2))),b=Math.max(a+1,n-3);
 const nose=group('nose','Nose and forward structure',c.massKg*.12),fuselage=group('fuselage','Cabin and centre fuselage',c.massKg*.38),tail=group('tail','Aft structure and tailplane',c.massKg*.065);
 skin(c.body.slice(0,a+1),materials.skin,nose,c.bodySegments||12).name='Tapered nose';skin(c.body.slice(a,b+1),materials.skin,fuselage,c.bodySegments||12).name='Shaped cabin fuselage';skin(c.body.slice(b),materials.skin,tail,c.bodySegments||12).name='Tapered aft fuselage';
 function segment(name,w,side,t0,t1,e0,e1,mat,parent,pivot=null){const geo=new THREE.BoxGeometry(1,1,1,1,1,e0===0?3:1),p=geo.attributes.position,uv=geo.attributes.uv;
  for(let i=0;i<p.count;i++){const t=mix(t0,t1,p.getX(i)+.5),ch=mix(w.rootChord,w.tipChord,t),edge=mix(e0,e1,p.getZ(i)+.5);let x=side*(w.rootX+w.span*t),y=w.rootY+(w.dihedral||0)*t+p.getY(i)*mix(w.thickness||.12,w.tipThickness||.045,t)*Math.max(.045,10*(.2969*Math.sqrt(edge)-.126*edge-.3516*edge**2+.2843*edge**3-.1015*edge**4)),z=w.rootZ+(w.sweep||0)*t+ch*edge;if(pivot){x-=pivot[0];y-=pivot[1];z-=pivot[2];}p.setXYZ(i,x,y,z);uv.setXY(i,t,edge);}geo.computeVertexNormals();return mesh(name,geo,mat,parent);}
 function control(name,id,w,side,t0,t1,parent,dependsOn,kind){const t=(t0+t1)*.5,ch=mix(w.rootChord,w.tipChord,t),pivot=[side*(w.rootX+w.span*t),w.rootY+(w.dihedral||0)*t,w.rootZ+(w.sweep||0)*t+ch*.765];const g=group(id,name,c.massKg*.008,dependsOn,parent);g.position.set(...pivot);segment(name,w,side,t0,t1,.77,1,materials.wing,g,pivot);controlNodes[id]={node:g,kind,side};return g;}
 if(c.wing){for(const side of[-1,1]){const prefix=side<0?'left':'right',id=prefix+'Wing',g=group(id,(side<0?'Port':'Starboard')+' main wing',c.massKg*.075);const w=c.wing;
  segment('Main wing airfoil',w,side,0,1,0,.77,materials.wing,g);segment('Root trailing fairing',w,side,0,.12,.77,1,materials.wing,g);segment('Control separator',w,side,.58,.63,.77,1,materials.wing,g);segment('Wingtip trailing cap',w,side,.97,1,.77,1,materials.wing,g);
  control('Outboard aileron',prefix+'Aileron',w,side,.63,.97,g,id,'aileron');if(w.flaps!==false)control('Inboard flap',prefix+'Flap',w,side,.12,.58,g,id,'flap');else segment('Fixed inboard trailing edge',w,side,.12,.58,.77,1,materials.wing,g);
  if(w.struts){tube('Lift strut',[side*.42,-.32,w.rootZ+.35],[side*(w.rootX+w.span*.53),w.rootY+(w.dihedral||0)*.53-.035,w.rootZ+(w.sweep||0)*.53+w.rootChord*.48],.033,materials.skin,g);}
 }}
 if(c.tail){for(const side of[-1,1]){const w=c.tail;segment('Horizontal stabilizer',w,side,0,1,0,.73,materials.tail,tail);control('Elevator',side<0?'leftElevator':'rightElevator',w,side,0,1,tail,'tail','elevator');}}
 function finShape(fc,parent,label='Vertical stabilizer'){const geo=new THREE.BoxGeometry(1,1,1),p=geo.attributes.position;for(let i=0;i<p.count;i++){const t=p.getY(i)+.5,ch=mix(fc.rootChord,fc.tipChord,t);p.setXYZ(i,(fc.x||0)+p.getX(i)*mix(fc.thickness||.14,.045,t),fc.rootY+fc.height*t,fc.rootZ+fc.sweep*t+(p.getZ(i)+.5)*ch*.76);}geo.computeVertexNormals();mesh(label,geo,materials.tail,parent);
  const pivot=[fc.x||0,fc.rootY+fc.height*.5,fc.rootZ+fc.sweep*.5+mix(fc.rootChord,fc.tipChord,.5)*.77];const rudder=new THREE.Group();rudder.name='Rudder';rudder.position.set(...pivot);parent.add(rudder);const rg=new THREE.BoxGeometry(1,1,1),rp=rg.attributes.position;for(let i=0;i<rp.count;i++){const t=rp.getY(i)+.5,ch=mix(fc.rootChord,fc.tipChord,t);rp.setXYZ(i,(fc.x||0)+rp.getX(i)*mix(.1,.025,t)-pivot[0],fc.rootY+fc.height*t-pivot[1],fc.rootZ+fc.sweep*t+(.77+(rp.getZ(i)+.5)*.23)*ch-pivot[2]);}rg.computeVertexNormals();mesh('Hinged rudder',rg,materials.tail,rudder);controlNodes['rudder'+(fc.x||0)]={node:rudder,kind:'rudder',side:1};}
 if(c.fin){const f=group('verticalFin','Fin and rudder',c.massKg*.02,'tail',tail);finShape(c.fin,f);if(c.fin.mirror)finShape({...c.fin,x:-(c.fin.x||0),mirror:false},f,'Port stabilizer');}
 // One appropriate cockpit per aircraft. No universal windscreen layered over a bubble.
 if(c.canopy){const q=c.canopy,g=group('canopy','Cockpit glazing and frames',c.massKg*.013,'fuselage',fuselage);const len=q.z1-q.z0,mid=(q.z0+q.z1)/2,w=q.width,base=q.baseY,h=q.height;
  const seatGeo=new THREE.BoxGeometry(.34,.5,.31),seatMatrices=[];for(const side of(q.kind==='bubble'?[0]:[-1,1]))seatMatrices.push(new THREE.Matrix4().makeTranslation(side*w*.4,base-.14,mid+.1));addInstanced(model,g,'Unoccupied cockpit seats',seatGeo,materials.interior,seatMatrices);
  if(q.kind==='airliner'){
   for(const side of[-1,1]){conformingPatch('Forward flight-deck pane',q.z0,q.z0+len*.56,side*.09,side*.76,materials.glass,g,.025);conformingPatch('Side flight-deck pane',q.z0+len*.58,q.z1,side*.65,side*1.22,materials.glass,g,.025);conformingPatch('Window frame',q.z0+len*.54,q.z0+len*.59,side*.07,side*1.25,materials.dark,g,.026);}
  }else if(q.kind==='bubble'||q.kind==='panorama'){
   const geo=new THREE.SphereGeometry(1,12,6,0,Math.PI*2,0,Math.PI/2),p=geo.attributes.position;for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)*w,p.getY(i)*h+base,p.getZ(i)*len*.5+mid);geo.computeVertexNormals();mesh('Single-piece reflective canopy',geo,materials.glass,g);
   for(let k=0;k<12;k++){const a=k*Math.PI/6,b=(k+1)*Math.PI/6;tube('Fitted canopy rim',[Math.sin(a)*w,base,mid+Math.cos(a)*len*.5],[Math.sin(b)*w,base,mid+Math.cos(b)*len*.5],.018,materials.dark,g,4);}
  }else{
   const zf=q.z0+len*.24,zr=q.z1-len*.17,yt=base+h;
   const bl=[-w*.91,base,q.z0],br=[w*.91,base,q.z0],tl=[-w,yt,zf],tr=[w,yt,zf],rl=[-w*.88,yt*.98,zr],rr=[w*.88,yt*.98,zr],bkl=[-w*.76,base,q.z1],bkr=[w*.76,base,q.z1];
   panel('Port windscreen',[bl,[0,base,q.z0],[0,yt,zf],tl],materials.glass,g);panel('Starboard windscreen',[[0,base,q.z0],br,tr,[0,yt,zf]],materials.glass,g);
   for(const side of[-1,1]){const front=side<0?bl:br,top=side<0?tl:tr,rear=side<0?rl:rr,bottom=side<0?bkl:bkr;const zsplit=mix(zf,zr,.58),low=[side*w*.91,base,zsplit],high=[side*w*.96,yt*.99,zsplit];panel('Front side window',[front,top,high,low],materials.glass,g);panel('Rear quarter window',[low,high,rear,bottom],materials.glass,g);tube('Door pillar',low,high,.021,materials.skin,g);panel('Cabin sill infill',[[side*.42,base-.52,q.z0+.04],front,bottom,[side*.40,base-.46,q.z1]],materials.skin,g);}
   panel('Cabin roof',[rl,rr,tr,tl],materials.skin,g);panel('Rear cabin window',[bkl,rl,rr,bkr],materials.glass,g);
   for(const[a,b]of[[bl,tl],[br,tr],[tl,tr],[tl,rl],[tr,rr],[rl,bkl],[rr,bkr],[bkl,bkr],[bl,br],[[0,base,q.z0],[0,yt,zf]]])tube('Cockpit frame',a,b,.024,materials.skin,g);
  }
  box('Instrument coaming',[w*1.55,.11,.26],[0,base-.07,q.z0+len*.3],materials.dark,g);
  for(const side of(q.kind==='bubble'?[0]:[-1,1])){
   box('Instrument display',[w*.36,.12,.025],[side*w*.4,base+.035,q.z0+len*.3+.14],materials.metal,g);
   tube('Control stick',[side*w*.4,base-.25,mid],[side*w*.4,base+.04,mid-.12],.024,materials.dark,g,5);
   box('Seat headrest',[.23,.15,.09],[side*w*.4,base+.18,mid+.24],materials.interior,g);
  }
 }
 if(c.passengerWindows){const p=c.passengerWindows;for(const side of[-1,1]){const mats=[];for(let i=0;i<p.count;i++){const z=mix(p.z0,p.z1,p.count===1?.5:i/(p.count-1)),[rx,ry,cy]=profile(z),dy=clamp((p.y-cy)/ry,-.8,.8),x=(rx*Math.sqrt(1-dy*dy)+.018)*side;const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,side*Math.PI/2,0));mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x,p.y,z),q,new THREE.Vector3(p.width,p.height,1)));}const glass=addInstanced(model,fuselage,side<0?'Port cabin window row':'Starboard cabin window row',new THREE.PlaneGeometry(1,1),materials.glass,mats);glass.castShadow=false;}}
 // Landing gear pivots, shock travel and true rolling radius.
 const gearSpec=c.gear;const contactPoints=[];
 if(gearSpec){for(const [id,center,r,side]of[['noseGear',gearSpec.nose,gearSpec.noseRadius,0],['leftGear',[-gearSpec.main[0],gearSpec.main[1],gearSpec.main[2]],gearSpec.mainRadius,-1],['rightGear',gearSpec.main,gearSpec.mainRadius,1]]){
  const g=group(id,id==='noseGear'?'Nose landing gear':side<0?'Port main landing gear':'Starboard main landing gear',c.massKg*.018),attach=(side&&gearSpec.mainAttach)?[side*gearSpec.mainAttach[0],gearSpec.mainAttach[1],gearSpec.mainAttach[2]]:(!side&&gearSpec.noseAttach)?gearSpec.noseAttach:[Math.sign(center[0])*Math.min(Math.abs(center[0])*.65,profile(center[2])[0]*.72),Math.min(-.12,profile(center[2])[2]-profile(center[2])[1]*.65),center[2]+(side?.15:.2)];g.position.set(...attach);const axle=new THREE.Group();axle.name='Suspending axle';g.add(axle);const rel=[center[0]-attach[0],center[1]-attach[1],center[2]-attach[2]];const suspension=new THREE.Group();suspension.name='Moving oleo';g.add(suspension);const strut=tube('Oleo strut',[0,0,0],rel,Math.max(.033,r*.17),materials.metal,suspension,6);strut.userData.dynamic=true;const strutLength=V(rel).length();
  const steering=new THREE.Group();steering.name='Wheel steering';steering.position.set(...rel);axle.add(steering);const wheel=new THREE.Group();wheel.name='Rolling wheels';steering.add(wheel);const matrices=[];const dual=side&&gearSpec.dualMain;for(const x of dual?[-r*.42,r*.42]:[0]){const mat=new THREE.Matrix4().compose(new THREE.Vector3(x,0,0),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,Math.PI/2)),new THREE.Vector3(1,1,1));matrices.push(mat);}const wg=new THREE.CylinderGeometry(r,r,r*.48,12);addInstanced(model,wheel,'Tyres and hubs',wg,[materials.rubber,materials.metal,materials.metal],matrices);
  if(gearSpec.retractable&&gearSpec.doors!==false)box('Landing gear door',[r*.5,Math.abs(rel[1])*.67,r*1.65],[rel[0]+(side||1)*r*.33,rel[1]*.42,rel[2]],materials.skin,g);
  wheels.push({id,node:g,axle,steering,wheel,strut,strutLength,rel,radius:r,side,travel:gearSpec.travel??r*.55});contactPoints.push({name:side<0?'left':side>0?'right':'nose',pos:[...center.slice(0,1),center[1]-r,center[2]],steer:side===0,brake:side!==0,travel:gearSpec.travel??r*.55});
 }}
 // Nose propellers and wing nacelles have distinct shapes, correctly oriented intakes.
 for(let i=0;i<(c.engines||[]).length;i++){const e=c.engines[i],id=e.id||((c.engines.length===1)?'engine':(e.x<0?'leftEngine':'rightEngine')),side=e.x<0?-1:1,depend=e.dependsOn||(Math.abs(e.x)>.5&&parts[side<0?'leftWing':'rightWing']?(side<0?'leftWing':'rightWing'):'fuselage'),g=group(id,e.kind==='prop'?'Propulsion unit':'Jet propulsion unit',c.massKg*(e.kind==='jet'?.1:.07),depend,parts[depend]||model);let spinner=null,disc=null,blades=null,hot=null,fanRotor=null;
  if(e.kind==='prop'){
   const z=e.z,r=e.radius||.42,L=e.length||1.2;skin([[z+.05,r*.7,r*.75,e.y],[z+L*.28,r,r*.94,e.y],[z+L*.7,r*.9,r*.85,e.y],[z+L,r*.38,r*.44,e.y]],materials.skin,g,10).position.x=e.x;
   const hub=addCylinder(model,g,'Spinner',.035,r*.45,r*.7,10,[e.x,e.y,z-r*.22],materials.metal);hub.rotation.x=-Math.PI/2;
   const prop=group(id+'Propeller','Propeller blades',c.massKg*.004,id,g);prop.position.set(e.x,e.y,z-.05);blades=new THREE.Group();blades.name='Spinning propeller';prop.add(blades);const geom=new THREE.BoxGeometry(1,1,1),bp=geom.attributes.position;for(let k=0;k<bp.count;k++){const t=bp.getY(k)+.5;bp.setXYZ(k,bp.getX(k)*mix(e.propRadius*.12,e.propRadius*.065,t)+Math.sin(t*Math.PI)*e.propRadius*.07,e.propRadius*(.12+t*.88),bp.getZ(k)*.022+(t-.4)*.035);}geom.computeVertexNormals();const matrices=[];for(let k=0;k<(e.blades||3);k++)matrices.push(new THREE.Matrix4().makeRotationZ(k*Math.PI*2/(e.blades||3)));addInstanced(model,blades,'Airfoil propeller blades',geom,materials.dark,matrices);
   const blurMat=model.userData.ownMaterial(new THREE.MeshBasicMaterial({color:'#9ca4a7',transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));disc=mesh('Propeller motion disc',new THREE.CircleGeometry(e.propRadius,24),blurMat,prop);disc.rotation.y=Math.PI;disc.castShadow=false;spinner=prop;
  }else if(e.buried){
   const r=e.radius||.5,z=e.z,L=e.length||1.5;const nozzle=addCylinder(model,g,'Single recessed exhaust',r*.85,r*.94,L*.18,12,[e.x,e.y,z+L*.4],materials.metal,true);nozzle.rotation.x=Math.PI/2;
   const throat=mesh('Exhaust dark throat',new THREE.CircleGeometry(r*.8,12),materials.dark,g);throat.position.set(e.x,e.y,z+L*.47);
   hot=makeMaterial(model,{color:'#453b32',emissive:'#e8863e',emissiveIntensity:0,roughness:.62});const core=mesh('Hot exhaust core',new THREE.CircleGeometry(r*.6,10),hot,g);core.position.set(e.x,e.y,z+L*.475);
   if(e.intake){for(const si of(e.intake.single?[1]:[-1,1])){const it=e.intake,ix=si*it.x,iy=it.y,iz=it.z,wi=it.width||.5,hi=it.height||.65,il=it.length||1.2;const duct=box('Shaped side intake duct',[wi,hi,il],[ix,iy,iz+il*.5],materials.skin,g);const dp=duct.geometry.attributes.position;for(let k=0;k<dp.count;k++){const t=(dp.getZ(k)+il*.5)/il;dp.setX(k,dp.getX(k)*(1-.35*t)-si*.12*t);}duct.geometry.computeVertexNormals();panel('Recessed forward-facing intake',[[ix-wi*.44,iy-hi*.42,iz-.006],[ix-wi*.44,iy+hi*.42,iz-.006],[ix+wi*.44,iy+hi*.42,iz-.006],[ix+wi*.44,iy-hi*.42,iz-.006]],materials.dark,g);tube('Intake splitter',[ix-si*wi*.51,iy-hi*.52,iz-.08],[ix-si*wi*.51,iy+hi*.52,iz-.08],.018,materials.metal,g);}}
  }else{
   const r=e.radius||.65,L=e.length||2,z=e.z;skin([[z-L*.5,r*.9,r*.9,e.y],[z-L*.36,r,r,e.y],[z+L*.2,r*.91,r*.91,e.y],[z+L*.5,r*.55,r*.58,e.y]],materials.skin,g,12).position.x=e.x;
   const intake=addCylinder(model,g,'Polished intake lip',r*.88,r*.92,L*.07,12,[e.x,e.y,z-L*.52],materials.metal,true);intake.rotation.x=Math.PI/2;
   const fan=mesh('Recessed front fan',new THREE.CircleGeometry(r*.79,12),materials.dark,g);fan.rotation.y=Math.PI;fan.position.set(e.x,e.y,z-L*.515);
   fanRotor=new THREE.Group();fanRotor.name='Spinning jet fan';fanRotor.position.set(e.x,e.y,z-L*.523);g.add(fanRotor);const bladeGeo=new THREE.BoxGeometry(r*.075,r*.63,.012),matrices=[];for(let k=0;k<12;k++){const ang=k*Math.PI/6,mat=new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(ang)*r*.41,Math.cos(ang)*r*.41,0),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,-ang-.25)),new THREE.Vector3(1,1,1));matrices.push(mat);}addInstanced(model,fanRotor,'Fan blades',bladeGeo,materials.metal,matrices);
   const plug=addSphere(model,g,'Fan spinner',r*.19,8,4,[e.x,e.y,z-L*.54],materials.metal);plug.scale.z=.6;
   const end=mesh('Exhaust throat',new THREE.CircleGeometry(r*.51,10),materials.dark,g);end.position.set(e.x,e.y,z+L*.505);hot=null;
   if(c.wing){const t=clamp((Math.abs(e.x)-c.wing.rootX)/c.wing.span,0,1),wy=c.wing.rootY+(c.wing.dihedral||0)*t;box('Engine support pylon',[r*.22,Math.max(.15,wy-(e.y+r*.8)),L*.46],[e.x,(wy+e.y+r*.8)/2,z+.2],materials.skin,g);}
  }
  engines.push({id,config:e,node:g,spinner,blades,disc,hot,fanRotor});
 }
 if(gearSpec?.mainAttach)for(const side of[-1,1]){const id=side<0?'leftGear':'rightGear',engineId=engines.find(e=>Math.sign(e.config.x)===side)?.id;if(engineId){parts[engineId].add(parts[id]);definitions[id].dependsOn=engineId;}}
 // Navigational lamps and strobes share instanced geometry, correctly coloured.
 const lampGeo=new THREE.SphereGeometry(1,6,3),lampMaterials={port:model.userData.ownMaterial(new THREE.MeshBasicMaterial({color:'#b7241d'})),starboard:model.userData.ownMaterial(new THREE.MeshBasicMaterial({color:'#39ac70'})),white:model.userData.ownMaterial(new THREE.MeshBasicMaterial({color:'#eff5ed'}))},lamps=[];
 if(c.wing){const w=c.wing;for(const side of[-1,1]){const parent=parts[side<0?'leftWing':'rightWing'],pos=[side*(w.rootX+w.span),w.rootY+(w.dihedral||0)+.015,w.rootZ+(w.sweep||0)+w.tipChord*.3],mat=side<0?lampMaterials.port:lampMaterials.starboard;const geo=lampGeo.clone(),matrix=new THREE.Matrix4().compose(V(pos),new THREE.Quaternion(),new THREE.Vector3(.045,.04,.055));const lamp=addInstanced(model,parent,'Navigation lamp',geo,mat,[matrix]);lamp.castShadow=false;lamps.push(lamp);}}
 lampGeo.dispose();
 if(c.hook){const hook=group('arrestorHook','Arrestor hook',c.massKg*.009,'tail',tail);hook.position.set(0,-.42,c.body.at(-2)[0]-.6);tube('Arresting hook shank',[0,0,0],[0,-1.25,1.7],.048,materials.metal,hook);tube('Hook shoe',[0,-1.25,1.7],[0,-1.34,1.93],.073,materials.dark,hook);controlNodes.hook={node:hook,kind:'hook',side:1};}
 // Legible aircraft-specific registration, with separate correctly facing decals.
 if(c.registration&&c.kind!=='flying-wing'){const decalMat=model.userData.ownMaterial(new THREE.MeshBasicMaterial({map:aircraftDecalTexture(c.registration,{color:c.accent,background:'transparent',width:512,height:128}),transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2}));const z=c.body[Math.max(1,c.body.length-4)][0],pr=profile(z),width=Math.min(2.4,(c.body.at(-1)[0]-c.body[0][0])*.18);for(const side of[-1,1]){const decalHeight=Math.max(.16,width*.15),phi=Math.PI*.455,dphi=decalHeight/Math.max(.15,pr[1])* .5;const p=conformingPatch('Airframe registration',z-width*.5,z+width*.5,side*(phi-dphi),side*(phi+dphi),decalMat,tail,.028);const uv=p.geometry.attributes.uv;for(let i=0;i<uv.count;i++){const u=uv.getX(i),v=uv.getY(i);uv.setXY(i,side>0?1-v:v,1-u);}p.castShadow=false;}}
 const ctx={model,config:c,materials,parts,group,box,tube,panel,skin,registerAnimation:fn=>animations.push(fn),THREE};c.decorate?.(ctx);
 // Merge primitive buffers within each named assembly without merging across hinges/strike roots.
 function batchStatic(parent){
  for(const child of [...parent.children])if(child.isGroup)batchStatic(child);
  const buckets=new Map();for(const child of parent.children){if(!child.isMesh||child.isInstancedMesh||Array.isArray(child.material)||child.material.transparent||child.userData.dynamic||!child.visible)continue;const list=buckets.get(child.material)||[];list.push(child);buckets.set(child.material,list);}
  for(const[material,list]of buckets){if(list.length<2)continue;const positions=[],normals=[],uvs=[],indices=[];let base=0;
   for(const child of list){child.updateMatrix();const g=child.geometry,p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,normalMatrix=new THREE.Matrix3().getNormalMatrix(child.matrix),v=new THREE.Vector3();
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(child.matrix);positions.push(v.x,v.y,v.z);v.fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize();normals.push(v.x,v.y,v.z);uvs.push(uv?.getX(i)||0,uv?.getY(i)||0);}
    const ids=g.index?.array||Array.from({length:p.count},(_,i)=>i);for(const i of ids)indices.push(base+i);base+=p.count;child.removeFromParent();}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);mesh(parent.name+' surface assembly',g,material,parent);
  }
 }
 batchStatic(model);
 // Normalize component masses: a dependent group's assigned mass excludes its children.
 const weight=Object.values(definitions).reduce((s,d)=>s+d.massKg,0);for(const d of Object.values(definitions))d.massKg*=c.massKg/weight;
 model.traverse(n=>{if(n.isGroup)restTransforms.set(n,{position:n.position.clone(),quaternion:n.quaternion.clone(),scale:n.scale.clone(),visible:n.visible});});
 finishModel(model);
 const aircraft=createAircraftDamageAdapter({airframe:model,sections:definitions,massKg:c.massKg,centerOfMass:{x:0,y:0,z:0},disposeAirframe:true});aircraft.name=c.name;const damageUpdate=aircraft.userData.update,damageReset=aircraft.userData.resetDamage,damageDispose=aircraft.userData.dispose;let time=0,disposed=false;
 function animate(dt,state){time+=dt;const rpm=clamp(state.rpm??0,0,1),gear=c.gear?.retractable?clamp(state.gear??1,0,1):1;
  for(const[id,s]of Object.entries(controlNodes)){if(aircraft.userData.strikePoints[id]?.detached)continue;let angle=0;if(s.kind==='aileron')angle=(state.roll||0)*.36*(s.side<0?1:-1);if(s.kind==='flap')angle=(state.flaps||0)*.6;if(s.kind==='elevator')angle=-(state.pitch||0)*.4;if(s.kind==='rudder'){s.node.rotation.y=-(state.yaw||0)*.42;continue;}if(s.kind==='hook')angle=(state.hook??gear)?0:-1.1;s.node.rotation.x=mix(s.node.rotation.x,angle,1-Math.exp(-dt*12));}
  for(const w of wheels){if(aircraft.userData.strikePoints[w.id].detached)continue;w.node.visible=gear>.025;w.node.rotation.z=w.side?(1-gear)*w.side*-1.4:0;w.node.rotation.x=w.side?0:(1-gear)*-1.52;const compression=Array.isArray(state.suspension)?state.suspension[w.side<0?1:w.side>0?2:0]:(state.suspension||0);w.axle.position.y=clamp(compression||0,0,w.travel);const end=V(w.rel);end.y+=w.axle.position.y;w.strut.position.copy(end).multiplyScalar(.5);w.strut.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),end.clone().normalize());w.strut.scale.y=end.length()/w.strutLength;w.steering.rotation.y=w.side?0:-(state.yaw||0)*.45;if(state.onGround)w.wheel.rotation.x+=(state.groundSpeed||0)/w.radius*dt;}
  for(const e of engines){if(aircraft.userData.strikePoints[e.id].detached)continue;if(e.blades&&!aircraft.userData.strikePoints[e.id+'Propeller'].detached){e.blades.rotation.z+=rpm*42*Math.PI*2*dt*(e.config.counterRotate?-1:1);const blur=clamp((rpm-.2)/.6,0,1);e.disc.material.opacity=blur*.32;e.blades.visible=blur<.98;e.disc.visible=blur>.01;}if(e.fanRotor)e.fanRotor.rotation.z+=rpm*130*dt;if(e.hot)e.hot.emissiveIntensity=Math.max(0,(rpm-.4)/.6)*(e.config.afterburner?3:1.2);}
  for(const lamp of lamps)lamp.visible=state.lights!==false;for(const fn of animations)fn(dt,{...state,time,gear,rpm});
 }
 const bounds=new THREE.Box3().setFromObject(model),front=bounds.min.z,back=bounds.max.z;const hardPoints=[{pos:[0,c.body[0][3]||0,front],what:'The nose struck the ground',partId:'nose'},{pos:[0,c.body.at(-1)[3]||0,back],what:'The tail struck the ground',partId:'tail'},{pos:[0,-profile(0)[1]+profile(0)[2],0],what:'The belly hit the ground',partId:'fuselage'}];
 if(c.wing)for(const side of[-1,1])hardPoints.push({pos:[side*(c.wing.rootX+c.wing.span),c.wing.rootY+(c.wing.dihedral||0),c.wing.rootZ+(c.wing.sweep||0)+c.wing.tipChord*.45],what:side<0?'The left wing tip hit the ground':'The right wing tip hit the ground',partId:side<0?'leftWing':'rightWing'});
 else for(const side of[-1,1])if(parts[side<0?'leftWing':'rightWing']){const root=parts[side<0?'leftWing':'rightWing'];model.updateMatrixWorld(true);const vertices=[];root.traverse(n=>{if(n.isMesh&&!n.isInstancedMesh){const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++)vertices.push(new THREE.Vector3().fromBufferAttribute(a,i).applyMatrix4(n.matrixWorld));}});vertices.sort((a,b)=>side*(b.x-a.x)||a.y-b.y);const p=vertices[0];hardPoints.push({pos:p.toArray(),what:'The wing tip hit the ground',partId:side<0?'leftWing':'rightWing'});}
 for(const e of engines)if(e.config.kind==='prop')hardPoints.push({pos:[e.config.x,e.config.y-e.config.propRadius,e.config.z-.05],what:'The propeller struck the ground',partId:e.id+'Propeller'});
 Object.assign(aircraft.userData,{aircraftId:c.id,config:c,controls:controlNodes,parts:{...parts,surfaces:controlNodes,gear:wheels,engines,glassMat:materials.glass,type:options.type||{id:c.id},shape:{scale:1,eye:c.eye}},flightGeometry:{units:'metres',scale:1,gearPoints:contactPoints,hardPoints,eye:c.eye||[0,.5,-1],wingSpan:c.wing?2*(c.wing.rootX+c.wing.span):bounds.max.x-bounds.min.x,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}},materials});
 attachAircraftImpact(aircraft,c);
 aircraft.userData.update=(dt,state={})=>{if(disposed)return;if(!Number.isFinite(dt)||dt<0)throw new RangeError('Aircraft dt must be nonnegative seconds.');if(!aircraft.userData.crashBody&&!aircraft.userData.crashRetired)animate(dt,state);damageUpdate(dt,state);aircraft.userData.updateImpact?.(dt);};
 aircraft.userData.resetDamage=()=>{if(disposed)return;aircraft.userData.resetImpact?.();damageReset();for(const[n,s]of restTransforms){n.position.copy(s.position);n.quaternion.copy(s.quaternion);n.scale.copy(s.scale);n.visible=s.visible;}time=0;animate(0,{rpm:0,gear:1});};
 aircraft.userData.dispose=()=>{if(disposed)return;aircraft.userData.disposeImpact?.();damageDispose();disposed=true;};
 animate(0,{rpm:0,gear:1});return aircraft;
}
