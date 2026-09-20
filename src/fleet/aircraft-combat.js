/** Original combat aircraft for Island Flight Simulator. Metres; -Z forward. */
import * as THREE from '../vendor/three.module.js';
import { buildAircraft } from './aircraft-core.js';

function namedGroup(ctx,id,label,mass,parentID) {
  return ctx.group(id,label,mass,parentID,parentID ? ctx.parts[parentID] : undefined);
}
function localPoint(ctx,parent,point) {
  ctx.model.updateWorldMatrix(true,false);parent.updateWorldMatrix(true,false);
  return parent.worldToLocal(ctx.model.localToWorld(new THREE.Vector3(...point))).toArray();
}
function intakePair(ctx,{z=-1.9,y=-.11,x=.74,width=.48,height=.67,length=1.65}) {
  const {box,panel,materials:m}=ctx;
  for(const sign of [-1,1]) {
    const side=sign<0?'left':'right';
    const g=namedGroup(ctx,`${side}Intake`,`${side} side intake and splitter`,48,'fuselage');
    const cx=sign*x;
    // A recessed opening, four sloping duct faces and a thin forward splitter.
    // The intake follows the fuselage; no bright solid cube at its mouth.
    panel(`${side} intake shadow`,[[cx-sign*width*.43,y-height*.46,z+.04],[cx+sign*width*.43,y-height*.46,z+.04],[cx+sign*width*.43,y+height*.46,z+.04],[cx-sign*width*.43,y+height*.46,z+.04]],m.dark,g);
    const x1=cx-sign*width*.5, x2=cx+sign*width*.5, xr=cx-sign*width*.35;
    panel(`${side} intake outer wall`,[[x2,y-height*.5,z],[x2,y+height*.5,z],[xr+sign*width*.54,y+height*.33,z+length],[xr+sign*width*.54,y-height*.35,z+length]],m.skin,g);
    panel(`${side} intake upper lip`,[[x1,y+height*.5,z],[x2,y+height*.5,z],[xr+sign*width*.54,y+height*.33,z+length],[xr-sign*width*.4,y+height*.3,z+length]],m.skin,g);
    panel(`${side} intake lower lip`,[[x2,y-height*.5,z],[x1,y-height*.5,z],[xr-sign*width*.4,y-height*.3,z+length],[xr+sign*width*.54,y-height*.35,z+length]],m.skin,g);
    box(`${side} inlet splitter`,[.035,height*1.06,.4],[x1,y,z+.08],m.metal,g);
    box(`${side} inlet upper rim`,[width,.035,.05],[cx,y+height*.5,z-.01],m.metal,g);
    box(`${side} inlet lower rim`,[width,.035,.05],[cx,y-height*.5,z-.01],m.metal,g);
  }
}

/**
 * A ring of faceted petals at the nozzle exit, for an engine flagged
 * afterburner:true. Purely additive geometry — it changes nothing the flight
 * model or damage system reads (gear, body stations, wing, engine spec are
 * all untouched), so it carries none of the risk a planform change would.
 *
 * Placed and sized against the real fuselage taper (measured, see the
 * comment block above this file) so the ring sits just inside the tailcone's
 * own radius at its forward edge and tapers to a smaller ring that pokes
 * slightly proud of the tail cap — which is where a real variable nozzle
 * exit sits: past the airframe, not flush inside it.
 */
function afterburnerPetals(ctx, engine, { petals = 10, outerR, innerR, z0, length, parent }) {
  const { panel, materials: m } = ctx;
  const target = parent || ctx.parts[engine.id] || ctx.parts.tail;
  for (let i = 0; i < petals; i++) {
    // Petals overlap slightly at the root (like a real iris nozzle) and
    // narrow toward the tip, so each one reads as a tapered fin rather than
    // a flat slice of a cone.
    const a0 = (i / petals) * Math.PI * 2;
    const a1 = ((i + 0.82) / petals) * Math.PI * 2;
    const inset = (a1 - a0) * 0.22;
    const b0 = a0 + inset;
    const b1 = a1 - inset;
    const o0 = [engine.x + Math.cos(a0) * outerR, engine.y + Math.sin(a0) * outerR, z0];
    const o1 = [engine.x + Math.cos(a1) * outerR, engine.y + Math.sin(a1) * outerR, z0];
    const i1 = [engine.x + Math.cos(b1) * innerR, engine.y + Math.sin(b1) * innerR, z0 + length];
    const i0 = [engine.x + Math.cos(b0) * innerR, engine.y + Math.sin(b0) * innerR, z0 + length];
    panel(`afterburner petal ${i + 1}`, [o0, o1, i1, i0], m.metal, target);
  }
}

const vanguard = {
  id:'vanguard',name:'Vanguard F-1',kind:'fighter',massKg:7200,
  paint:'#737b83',accent:'#344454',registration:'VF-101',bodySegments:12,
  body:[[-7.1,.025,.035,-.02],[-6.55,.19,.22,-.01],[-5.5,.41,.38,0],[-4.25,.56,.47,0],[-2.4,.67,.56,0],[-.3,.72,.60,-.025],[1.6,.67,.57,-.04],[3.7,.59,.51,-.05],[5.7,.48,.46,-.05],[6.4,.43,.43,-.05]],
  wing:{rootX:.62,span:4.33,rootZ:-1.8,rootY:-.12,rootChord:4.8,tipChord:1.2,sweep:3.6,dihedral:-.10,thickness:.17,tipThickness:.045,flaps:true,struts:false},
  tail:{rootX:.42,span:1.9,rootZ:4.0,rootY:.02,rootChord:1.7,tipChord:.65,sweep:1.3,dihedral:-.11,thickness:.095},
  fin:{rootZ:2.55,rootY:.4,height:2.45,rootChord:3.35,tipChord:.9,sweep:2.0},
  canopy:{kind:'bubble',z0:-4.55,z1:-1.28,width:.56,height:.59,baseY:.21},
  gear:{nose:[0,-1.62,-3.48],main:[1.27,-1.65,.91],noseRadius:.25,mainRadius:.32,retractable:true,dualMain:false,doors:true},
  engines:[{id:'engine',kind:'jet',x:0,y:-.05,z:5.1,radius:.435,length:2.5,buried:true,afterburner:true}],
  eye:[0,.65,-3.1],hook:false,
  decorate(ctx) {
    const {parts,materials:m,panel,tube,box}=ctx;
    intakePair(ctx,{z:-2.28,y:-.19,x:.77,width:.44,height:.58,length:1.7});
    for(const s of [-1,1]) {
      const wing=parts[s<0?'leftWing':'rightWing'];
      // Thin leading-edge root extension broadens naturally into the wing.
      panel('leading edge root extension',[[s*.53,.08,-3.30],[s*.61,.08,-1.5],[s*1.83,-.02,-.80],[s*1.01,.05,-2.20]],m.wing,wing);
      tube('wingtip antenna',[s*4.88,-.2,1.98],[s*4.88,-.2,3.4],.032,m.dark,wing,5);
      const fin=parts.verticalFin || parts.fuselage;
      panel('ventral stability fin',[[s*.4,-.46,3.3],[s*.49,-.48,4.9],[s*.69,-1.05,5.15],[s*.66,-.93,4.20]],m.tail,fin);
      box('rescue panel',[.014,.16,.26],[s*.582,.30,-3.54],m.accent,parts.fuselage);
    }
    tube('nose pitot',[0,-.02,-7.02],[0,-.02,-7.62],.012,m.metal,parts.nose,5);
    box('dorsal avionics rail',[.24,.095,2.6],[0,.54,.25],m.skin,parts.fuselage);
    tube('angle sensor',[-.35,.11,-5.4],[-.45,.12,-5.77],.014,m.metal,parts.nose,5);
    /*
     * Afterburner nozzle petals.
     *
     * Sized against the real tail contour rather than guessed: the body
     * stations run [5.7,.48,.46] to [6.4,.43,.43], so an outer ring at
     * .400 sits just inside the fuselage radius at z=6.25 and right on the
     * existing recessed-nozzle rim, and an inner ring at .218 finishes 9 cm
     * proud of the tail cap — which is where a variable nozzle's exit sits,
     * past the airframe rather than flush inside it.
     */
    const eng = ctx.config.engines[0];
    afterburnerPetals(ctx, eng, {
      petals: 10,
      outerR: eng.radius * 0.92,
      innerR: eng.radius * 0.50,
      z0: eng.z + eng.length * 0.46,
      length: eng.radius * 0.55,
    });
  },
  description:'A slender single-engine fighter with a pointed radome, framed bubble canopy, recessed side intakes, swept wing, leading-edge root extensions and a petalled afterburner nozzle.',
  inspiration:'Original aircraft using coherent single-engine fighter proportions; not a licensed replica.'
};

const osprey = {
  id:'osprey',name:'Osprey CV',kind:'naval',massKg:8800,
  paint:'#667780',accent:'#d1d0c5',registration:'CV-221',bodySegments:12,
  body:[[-6.35,.035,.065,-.03],[-5.85,.24,.26,-.02],[-4.85,.46,.43,0],[-3.55,.64,.59,0],[-1.9,.75,.68,0],[.2,.77,.66,-.05],[2.35,.69,.57,-.07],[4.55,.58,.5,-.08],[5.77,.47,.445,-.08]],
  wing:{rootX:.68,span:5.92,rootZ:-1.45,rootY:.44,rootChord:4.1,tipChord:1.8,sweep:1.8,dihedral:.18,thickness:.2,tipThickness:.065,flaps:true,struts:false},
  tail:{rootX:.54,span:2.60,rootZ:4.10,rootY:.3,rootChord:1.65,tipChord:.8,sweep:.8,dihedral:.12,thickness:.09},
  fin:{rootZ:2.48,rootY:.48,height:2.25,rootChord:3.0,tipChord:.82,sweep:1.35},
  canopy:{kind:'bubble',z0:-4.26,z1:-1.42,width:.64,height:.62,baseY:.25},
  gear:{nose:[0,-1.65,-3.35],main:[1.47,-1.68,.78],noseRadius:.31,mainRadius:.39,retractable:true,dualMain:false,doors:true},
  engines:[{id:'engine',kind:'jet',x:0,y:-.08,z:4.75,radius:.475,length:2.12,buried:true,afterburner:false}],
  eye:[0,.73,-2.85],hook:true,
  decorate(ctx) {
    const {parts,materials:m,tube,panel,box}=ctx;
    intakePair(ctx,{z:-2.20,y:-.2,x:.86,width:.45,height:.62,length:1.8});
    for(const s of [-1,1]) {
      const wing=parts[s<0?'leftWing':'rightWing'];
      // Fold joint and actuator fairing identify the broad deck-handling wing.
      const foldX=4.35*s, foldZ=-.33;
      box('wing fold hinge cover',[.09,.085,2.5],[foldX,.60,foldZ+1.35],m.metal,wing);
      tube('fold actuator',[s*3.95,.62,1.15],[s*4.56,.66,1.18],.055,m.metal,wing,6);
      for(const x of [1.9,3.0,4.1]) {
        box('flap actuator fairing',[.11,.15,.59],[s*x,.28,2.45],m.skin,wing);
      }
      panel('inboard wing glove',[[s*.65,.45,-2.3],[s*1.65,.46,-1.1],[s*1.5,.46,.2],[s*.69,.44,.1]],m.wing,wing);
      const gear=parts[s<0?'leftGear':'rightGear'];
      if(gear) {
        tube('oleo side brace',localPoint(ctx,gear,[s*.69,-.56,.61]),localPoint(ctx,gear,[s*1.38,-1.22,.78]),.068,m.metal,gear,6);
        tube('scissor torque link',localPoint(ctx,gear,[s*1.46,-.95,.8]),localPoint(ctx,gear,[s*1.55,-1.2,.95]),.029,m.dark,gear,5);
      }
    }
    const ng=parts.noseGear;
    if(ng) tube('catapult launch bar',localPoint(ctx,ng,[0,-1.2,-3.37]),localPoint(ctx,ng,[0,-1.8,-3.93]),.052,m.metal,ng,6);
    box('dorsal electronic fairing',[.32,.12,2.5],[0,.59,.8],m.skin,parts.fuselage);
    tube('nose air data probe',[0,-.03,-6.31],[0,-.03,-6.90],.014,m.metal,parts.nose,5);
  },
  description:'A single-engine naval jet with a substantial shoulder wing, large flaps, visible wing fold joints, reinforced landing gear and an arrestor hook.',
  inspiration:'Original carrier aircraft; Osprey is the game aircraft name and this model is a jet, not a tiltrotor.'
};

function stealthWing(ctx,sign) {
  const side=sign<0?'left':'right', m=ctx.materials;
  const parent=ctx.group(`${side}Wing`,`${side} blended wing`,1420,'fuselage',ctx.parts.fuselage);
  /*
   * Six spanwise stations: [x, leadingEdgeZ, trailingEdgeZ, thickness].
   *
   * Four things read as "B-2" at three hundred metres: a huge span with no
   * fuselage, one unbroken knife leading edge, no vertical surface anywhere,
   * and the SAWTOOTH trailing edge. This model had three of the four. The
   * trailing edge measured 3.50, 3.50, 1.86, 3.13, 3.13, 6.65 — one shallow
   * step with two flat pairs either side of it, which from above is a bevel,
   * not a saw. That is why it did not look like the aeroplane.
   *
   * Now: forward, aft, forward, aft, aft — two real notches inboard and a
   * clean run to the tip. Chords stay 9.20, 6.05, 6.94, 4.65, 4.66, 1.85 m,
   * never near zero, so no quad inverts. The leading edge is untouched: its
   * slope was already 0.6875 across all five segments, one straight line.
   * Same station count, same topology — 1128 triangles before and after.
   */
  const stations=[
    [1.45,-5.70,3.50,.68],[3.85,-4.05,1.995,.56],
    [6.15,-2.469,4.475,.40],[8.0,-1.197,3.457,.27],
    [10.9,.797,5.455,.19],[16.75,4.819,6.669,.07]
  ];
  const makeShell=(name,chordStart,chordEnd,a=0,b=stations.length-1,parentNode=parent)=>{
    const slices=b-a;
    const g=new THREE.BoxGeometry(1,1,1,slices,1,2);
    const p=g.attributes.position, uv=g.attributes.uv;
    for(let i=0;i<p.count;i++) {
      const t=(p.getX(i)+.5)*slices+a, k=Math.min(stations.length-2,Math.floor(t)),f=t-k;
      const A=stations[k],B=stations[k+1];
      const x=A[0]+(B[0]-A[0])*f, le=A[1]+(B[1]-A[1])*f,te=A[2]+(B[2]-A[2])*f,th=A[3]+(B[3]-A[3])*f;
      const chord=chordStart+(p.getZ(i)+.5)*(chordEnd-chordStart);
      const section=Math.sin(Math.PI*chord)*.78+.22;
      const y=.02 + p.getY(i)*th*section + (x-1.45)*.005;
      const z=le+(te-le)*chord;
      p.setXYZ(i,sign*x,y,z); uv.setXY(i,(x-1.45)/15.3,chord);
    }
    if(sign<0) { const index=g.index; for(let i=0;i<index.count;i+=3) {const a=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,a);} }
    g.computeVertexNormals();g.computeBoundingBox();ctx.model.userData.ownGeometry(g);
    const mesh=new THREE.Mesh(g,m.wing);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;parentNode.add(mesh);return mesh;
  };
  makeShell(`${side} swept blended wing`,0,.77);
  // Each trailing segment has its own hinge axis following that segment's sweep.
  for(let i=0;i<stations.length-1;i++) {
    const A=stations[i],B=stations[i+1];
    const hingeA=new THREE.Vector3(sign*A[0],.02+(A[0]-1.45)*.005,A[1]+(A[2]-A[1])*.77);
    const hingeB=new THREE.Vector3(sign*B[0],.02+(B[0]-1.45)*.005,B[1]+(B[2]-B[1])*.77);
    const pivot=new THREE.Group();pivot.name=`${side} elevon ${i+1}`;pivot.position.copy(hingeA);parent.add(pivot);
    const mesh=makeShell(pivot.name,.78,1,i,i+1,pivot);
    mesh.geometry.translate(-hingeA.x,-hingeA.y,-hingeA.z);
    const axis=hingeB.clone().sub(hingeA).normalize();
    ctx.registerAnimation((dt,state)=>{
      if(!parent.visible)return;
      const pitch=THREE.MathUtils.clamp(state.pitch||0,-1,1),roll=THREE.MathUtils.clamp(state.roll||0,-1,1);
      // Positive model pitch command moves the elevon upward; ailerons oppose.
      const angle=THREE.MathUtils.clamp((pitch*.28+roll*sign*.24)*(i===0?.7:1),-.42,.42);
      pivot.quaternion.setFromAxisAngle(axis,angle*sign);
    });
  }
  return parent;
}

const nightjar = {
  id:'nightjar',name:'Nightjar B-2',kind:'flying-wing',massKg:9800,
  paint:'#383f45',accent:'#79838b',registration:'NJ-002',bodySegments:12,
  // Broad, flattened center volume melds into the wing root. No tube fuselage.
  body:[[-6.4,.025,.035,-.02],[-5.72,1.42,.23,0],[-4.3,2.30,.47,-.015],[-2.5,2.95,.57,-.035],[-.3,3.12,.53,-.045],[1.85,2.70,.39,-.04],[3.45,1.72,.14,-.02]],
  wing:null,tail:null,fin:null,canopy:null,
  gear:{nose:[0,-1.34,-3.57],main:[2.05,-1.37,.9],noseRadius:.29,mainRadius:.38,retractable:true,dualMain:true,doors:true},
  engines:[],eye:[-.37,.54,-4.53],hook:false,
  decorate(ctx) {
    const {materials:m,parts,panel,box,tube}=ctx;
    const left=stealthWing(ctx,-1),right=stealthWing(ctx,1);
    const cockpit=ctx.group('cockpit','recessed cockpit and glazing',280,'fuselage',parts.fuselage);
    // Angular six-pane cockpit follows the center section's upper skin.
    panel('windshield left',[[-.76,.40,-5.37],[0,.44,-5.56],[0,.79,-4.67],[-.91,.64,-4.55]],m.glass,cockpit);
    panel('windshield right',[[0,.44,-5.56],[.76,.40,-5.37],[.91,.64,-4.55],[0,.79,-4.67]],m.glass,cockpit);
    panel('left side glass',[[-.76,.40,-5.37],[-.91,.64,-4.55],[-.82,.62,-3.96],[-.86,.43,-4.26]],m.glass,cockpit);
    panel('right side glass',[[.76,.40,-5.37],[.86,.43,-4.26],[.82,.62,-3.96],[.91,.64,-4.55]],m.glass,cockpit);
    panel('cockpit roof',[[-.91,.64,-4.55],[0,.79,-4.67],[.91,.64,-4.55],[.82,.62,-3.96]],m.skin,cockpit);
    panel('roof left closure',[[-.91,.64,-4.55],[.82,.62,-3.96],[0,.58,-3.67],[-.82,.62,-3.96]],m.skin,cockpit);
    tube('windshield centre frame',[0,.44,-5.56],[0,.79,-4.67],.025,m.dark,cockpit,5);
    for(const s of [-1,1]) {
      const wing=s<0?left:right,side=s<0?'left':'right';
      tube(`${side} windscreen frame`,[s*.76,.40,-5.37],[s*.91,.64,-4.55],.023,m.dark,cockpit,5);
      const engine=ctx.group(`${side}Engine`,`${side} buried engine intake and exhaust`,720,'fuselage',parts.fuselage);
      // These shallow slots sit flush over the blended body. No visible nacelles.
      const x=s*1.93;
      panel(`${side} recessed inlet`,[[x-.54,.405,-2.43],[x+.54,.405,-2.43],[x+.54,.59,-2.43],[x-.54,.59,-2.43]],m.dark,engine);
      panel(`${side} intake upper fairing`,[[x-.54,.615,-2.43],[x+.54,.615,-2.43],[x+.46,.54,-.92],[x-.46,.54,-.92]],m.skin,engine);
      for(const edge of [-1,1]) panel(`${side} intake cheek`,[[x+edge*.54,.405,-2.43],[x+edge*.54,.615,-2.43],[x+edge*.46,.54,-.92],[x+edge*.46,.38,-.92]],m.skin,engine);
      box(`${side} intake lip`,[1.08,.045,.095],[x,.617,-2.45],m.metal,engine);
      panel(`${side} flush exhaust`,[[x-.45,.215,2.38],[x+.45,.215,2.38],[x+.56,.14,3.08],[x-.56,.14,3.08]],m.dark,engine);
      box(`${side} exhaust heat strip`,[1.08,.025,.20],[x,.14,3.05],m.metal,engine);
      tube(`${side} wingtip light rail`,[s*16.50,.11,5.3],[s*16.50,.11,6.15],.025,m.dark,wing,5);
      // Large service/bay outlines use geometry only where silhouette demands it.
      box(`${side} underwing bay seam`,[.02,.022,2.62],[s*.68,-.553,-.17],m.dark,parts.fuselage);
    }
    box('bomb bay rear seam',[1.37,.023,.02],[0,-.535,1.15],m.dark,parts.fuselage);
    box('bomb bay front seam',[1.37,.023,.02],[0,-.535,-1.47],m.dark,parts.fuselage);
  },
  description:'A true tailless flying wing with a broad blended center body, long swept wings, stepped trailing edges, separate elevons, recessed cockpit and buried engines with flush exhausts.',
  inspiration:'Original flying-wing planform; no external engine pods, tail surfaces or capsule body.'
};

export const planeDefinitions=[vanguard,osprey,nightjar];
export function createVanguardF1(options={}) {return buildAircraft(vanguard,options);}
export function createOspreyCV(options={}) {return buildAircraft(osprey,options);}
export function createNightjarB2(options={}) {return buildAircraft(nightjar,options);}
export const previewModels=[
  {id:'plane-vanguard',label:'Vanguard F-1',create:createVanguardF1,updateState:{rpm:0,gear:1},damagePart:'leftWing',preview:{warmup:.2,elevation:.35}},
  {id:'plane-osprey',label:'Osprey CV',create:createOspreyCV,updateState:{rpm:0,gear:1},damagePart:'leftWing',preview:{warmup:.2,elevation:.35}},
  {id:'plane-nightjar',label:'Nightjar B-2',create:createNightjarB2,updateState:{rpm:0,gear:1},damagePart:'leftWing',preview:{warmup:.2,elevation:.46}}
];
