/** Cockpit glazing, 2026-09-20: opacity .94 -> .42, keeping the existing
 * reflection, lighting and depth-write settings. No added geometry; Nightjar
 * stays at 1128 instance-aware triangles and span:length 2.563.
 * Final suite: 146/146. Target-device transparency performance not checked. */
import * as THREE from '../vendor/three.module.js';
import { helicopterReflectionEnvironment } from './helicopter.js';

// All artwork is generated here. Shared texture/environment cache is deliberately
// not owned by individual aircraft; the caller disposes only returned materials.
const cache = new Map();
const clamp = (x, a=0, b=1) => Math.max(a,Math.min(b,x));
const militaryFinish = config => config.matte === true || ['fighter','naval','flying-wing','military','stealth','bomber','jet-fighter'].includes(config.kind);
const minimalLivery = config => config.minimalLivery === true || militaryFinish(config);
const hash = text => { let value=2166136261; for(const c of String(text)) value=Math.imul(value^c.charCodeAt(0),16777619); return value>>>0; };
function random(seed) { let n=seed>>>0; return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;}; }
function color(value, fallback='#e7e9e5') { return new THREE.Color(value??fallback).getStyle(); }
function rgba(value,alpha) { const c=new THREE.Color(value).getStyle().match(/[\d.]+/g);return `rgba(${c.slice(0,3).join(',')},${alpha})`; }
function canvasTexture(key,width,height,paint,{data=false}={}) {
  if(cache.has(key)) return cache.get(key);
  const canvas=document.createElement('canvas'); canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:data});
  if(!ctx)throw new Error('Aircraft textures require Canvas 2D.');
  paint(ctx,width,height);
  const map=new THREE.CanvasTexture(canvas); map.name=key;
  map.colorSpace=data?THREE.NoColorSpace:THREE.SRGBColorSpace;
  map.anisotropy=8;
  cache.set(key,map);return map;
}
function line(ctx,x0,y0,x1,y1,stroke,width=1) {
  ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
}
function rectPanel(ctx,x,y,w,h,stroke,lineWidth=1) {
  ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.strokeRect(x,y,w,h);
}
function rivetLine(ctx,x0,y0,x1,y1,count,radius,alpha=.3) {
  for(let i=0;i<=count;i++){
    const t=i/count,x=x0+(x1-x0)*t,y=y0+(y1-y0)*t;
    ctx.fillStyle=`rgba(35,40,41,${alpha})`;ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=`rgba(252,250,243,${alpha*.75})`;ctx.fillRect(x-radius*.7,y-radius*.75,radius,.65);
  }
}
// The same normalized seam plan drives the albedo, roughness, and normal maps.
function panelLines(kind) {
  if(kind==='skin')return [
    ...[.12,.3,.46,.64,.8,.92].map(y=>[0,y,1,y]),
    ...[.1,.39,.61,.9].map(x=>[x,.12,x,.92]),
    [.2,.135,.32,.135],[.2,.135,.2,.255],[.32,.135,.32,.255],[.2,.255,.32,.255],
    [.68,.135,.8,.135],[.68,.135,.68,.255],[.8,.135,.8,.255],[.68,.255,.8,.255],
    [.43,.76,.57,.76],[.43,.76,.43,.88],[.57,.76,.57,.88],[.43,.88,.57,.88]
  ];
  return [
    ...[.18,.4,.63,.82,.95].map(x=>[x,.05,x,.95]),
    [0,.18,1,.18],[0,.73,1,.73],
    [.28,.29,.36,.29],[.28,.29,.28,.48],[.36,.29,.36,.48],[.28,.48,.36,.48]
  ];
}
function paintSeams(ctx,w,h,kind,stroke,thickness=1) {
  for(const [x0,y0,x1,y1]of panelLines(kind))line(ctx,x0*w,y0*h,x1*w,y1*h,stroke,thickness);
}
function normalTexture(kind) {
  const w=kind==='skin'?256:512,h=kind==='skin'?512:256;
  return canvasTexture(`Aircraft_${kind}_panelNormal`,w,h,(ctx,width,height)=>{
    ctx.fillStyle='rgb(128,128,128)';ctx.fillRect(0,0,width,height);
    paintSeams(ctx,width,height,kind,'rgb(111,111,111)',1.3);
    const source=ctx.getImageData(0,0,width,height),output=ctx.createImageData(width,height);
    const at=(x,y)=>source.data[(clamp(y,0,height-1)*width+clamp(x,0,width-1))*4]/255;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const dx=(at(x-1,y)-at(x+1,y))*2.8,dy=(at(x,y+1)-at(x,y-1))*2.8;
      const inv=1/Math.sqrt(dx*dx+dy*dy+1),i=(y*width+x)*4;
      output.data[i]=(dx*inv*.5+.5)*255;output.data[i+1]=(dy*inv*.5+.5)*255;
      output.data[i+2]=(inv*.5+.5)*255;output.data[i+3]=255;
    }
    ctx.putImageData(output,0,0);
  },{data:true});
}
function roughnessTexture(kind,matte=false,damaged=false) {
  const w=kind==='skin'?256:512,h=kind==='skin'?512:256;
  return canvasTexture(`Aircraft_${kind}_roughness_${matte}_${damaged}`,w,h,(ctx,width,height)=>{
    ctx.fillStyle=damaged?'#cccccc':matte?'#b2b2b2':'#888888';ctx.fillRect(0,0,width,height);
    paintSeams(ctx,width,height,kind,damaged?'#eeeeee':'#b4b4b4',1.5);
    const rand=random(hash(`${kind}|${matte}|${damaged}`));
    for(let i=0;i<1400;i++){
      ctx.fillStyle=`rgba(${rand()>.4?'255,255,255':'0,0,0'},${.012+rand()*.036})`;
      ctx.fillRect(rand()*width,rand()*height,1+rand()*4,1+rand()*2);
    }
    if(kind==='skin')for(const x of[.42,.56]){
      const streak=ctx.createLinearGradient(x*width,.21*height,x*width,.66*height);
      streak.addColorStop(0,'rgba(235,235,235,.5)');streak.addColorStop(1,'rgba(235,235,235,0)');
      ctx.fillStyle=streak;ctx.fillRect((x-.025)*width,.21*height,width*.05,height*.45);
    }
  },{data:true});
}
function addMottle(ctx,w,h,seed,count=3200) {
  const rand=random(seed);
  for(let i=0;i<count;i++) {
    const dark=rand()>.4;
    ctx.fillStyle=`rgba(${dark?'17,24,26':'255,252,245'},${.014+rand()*.03})`;
    ctx.fillRect(rand()*w,rand()*h,1+rand()*3,1+rand()*3);
  }
}
function paintAircraftSkin(config) {
  const base=color(config.paint),accent=color(config.accent,'#465866');
  const key=`Aircraft_skin_${base}_${accent}_${config.kind||'general'}_${minimalLivery(config)}_${config.id||''}`;
  return canvasTexture(key,512,1024,(ctx,w,h)=>{
    ctx.fillStyle=base;ctx.fillRect(0,0,w,h);
    // A quiet underside tone makes the round section readable without baking light.
    ctx.fillStyle='rgba(45,50,48,.075)';ctx.fillRect(w*.39,0,w*.22,h);
    // Aircraft paint stripes are longitudinal; no repeated labels are wrapped here.
    for(const u of(minimalLivery(config)?[]:[.25,.75])) {
      ctx.fillStyle=accent;ctx.fillRect((u-.022)*w,h*.15,w*.044,h*.78);
      ctx.fillStyle='rgba(238,239,229,.6)';ctx.fillRect((u-.038)*w,h*.15,w*.008,h*.78);
      ctx.fillStyle=rgba(config.accent??'#465866',.4);ctx.fillRect((u+.032)*w,h*.18,w*.009,h*.73);
    }
    // Matte anti-glare patch sits across the UV seam on the U=0 upper nose.
    for(const mirror of[false,true]){
      ctx.save();if(mirror){ctx.translate(w,0);ctx.scale(-1,1);}
      ctx.fillStyle='rgba(23,31,34,.85)';ctx.beginPath();ctx.moveTo(0,0);
      ctx.lineTo(w*.052,h*.035);ctx.lineTo(w*.095,h*.125);ctx.lineTo(w*.077,h*.275);ctx.lineTo(0,h*.3);ctx.closePath();ctx.fill();ctx.restore();
    }
    // Barely varied individual skin sheets, panel seams and recessed service doors.
    const rand=random(hash(key));
    for(let i=0;i<11;i++){
      ctx.fillStyle=`rgba(${i%3?'28,36,36':'255,253,242'},${.02+rand()*.025})`;
      ctx.fillRect((.1+rand()*.78)*w,(.31+rand()*.53)*h,(.035+rand()*.08)*w,(.035+rand()*.07)*h);
    }
    paintSeams(ctx,w,h,'skin','rgba(27,39,40,.26)',.75);
    // Rivets follow panel joins rather than becoming a decorative dot pattern.
    for(const y of[.12,.3,.46,.64,.8,.92])rivetLine(ctx,1,(y+.004)*h,w-1,(y+.004)*h,64,.72,.26);
    for(const x of[.1,.39,.61,.9])rivetLine(ctx,(x+.007)*w,.13*h,(x+.007)*w,.9*h,67,.66,.21);
    // Fasteners/slots are an inspection-distance detail, never huge signage.
    for(const x of[.2,.68]){
      rectPanel(ctx,x*w,.135*h,.12*w,.12*h,'rgba(255,255,244,.35)',.65);
      ctx.fillStyle='rgba(29,35,34,.64)';ctx.fillRect((x+.075)*w,.193*h,.025*w,.003*h);
      for(let i=0;i<4;i++)ctx.fillRect((x+.022)*w,(.158+i*.012)*h,.053*w,.003*h);
    }
    // Slim exhaust/oil trails toward the tail, with a clean nose and cockpit.
    for(const x of[.415,.57]){
      const grad=ctx.createLinearGradient(x*w,h*.22,x*w,h*.59);
      grad.addColorStop(0,'rgba(41,34,25,.22)');grad.addColorStop(.18,'rgba(47,41,32,.13)');grad.addColorStop(1,'rgba(47,41,32,0)');
      ctx.fillStyle=grad;ctx.beginPath();ctx.moveTo((x-.013)*w,.22*h);ctx.lineTo((x+.018)*w,.22*h);ctx.lineTo((x+.005)*w,.63*h);ctx.lineTo((x-.026)*w,.5*h);ctx.closePath();ctx.fill();
    }
    if(config.passengerWindows && Array.isArray(config.body) && config.body.length>1) {
      const nose=config.body[0][0],tail=config.body[config.body.length-1][0],length=tail-nose;
      const radius=Math.max(...config.body.map(s=>s[2]));
      const doorArc=Math.asin(Math.min(.78,.82/radius))/(Math.PI*2);
      // Entry doors are painted in physical proportions on the two side surfaces.
      // Horizontal canvas distance wraps vertically around the fuselage here.
      for(const z of[config.passengerWindows.z0-.85,config.passengerWindows.z1+.85]) {
        const cy=(z-nose)/length*h,dh=.84/length*h;
        for(const u of[.25,.75]) {
          const dx=(u-doorArc)*w,dw=doorArc*2*w;
          ctx.strokeStyle='rgba(22,30,31,.53)';ctx.lineWidth=1.15;
          ctx.beginPath();ctx.roundRect(dx,cy-dh/2,dw,dh,Math.min(3,dh*.18));ctx.stroke();
          ctx.strokeStyle='rgba(240,243,231,.30)';ctx.lineWidth=.65;
          ctx.strokeRect(dx+2,cy-dh/2+2,dw-4,Math.max(1,dh-4));
          ctx.fillStyle='rgba(24,33,36,.78)';ctx.fillRect(u*w-1,cy+dh*.15,2,Math.max(2,dh*.17));
          // One small inspection window near the top of each actual door.
          const windowX=(u+(u<.5?-1:1)*doorArc*.6)*w;
          ctx.fillStyle='rgba(45,69,78,.68)';ctx.fillRect(windowX-5,cy-dh*.22,10,Math.max(2,dh*.34));
        }
      }
    }
    addMottle(ctx,w,h,hash(key));
  });
}
function paintFlyingSurface(config,tail=false) {
  const base=color(config.paint),accent=color(config.accent,'#465866'),kind=tail?'tail':'wing';
  return canvasTexture(`Aircraft_${kind}_${base}_${accent}_${minimalLivery(config)}`,1024,512,(ctx,w,h)=>{
    ctx.fillStyle=base;ctx.fillRect(0,0,w,h);
    ctx.fillStyle='rgba(28,36,34,.065)';ctx.fillRect(0,.73*h,w,.27*h);
    // One colored tip and a fine inset line; original registrations are separate decals.
    if(!minimalLivery(config)){
      ctx.fillStyle=accent;ctx.fillRect(w*(tail?.71:.895),0,w*(tail?.29:.105),h);
      ctx.fillStyle=rgba(config.accent??'#465866',.6);ctx.fillRect(w*(tail?.674:.875),0,w*.007,h);
    } else {
      // Repaired access sheets show subtle tone changes on subdued military paint.
      ctx.fillStyle='rgba(182,192,192,.045)';ctx.fillRect(w*.4,h*.18,w*.23,h*.55);
      ctx.fillStyle='rgba(13,20,22,.07)';ctx.fillRect(w*.18,h*.18,w*.22,h*.55);
    }
    paintSeams(ctx,w,h,'wing','rgba(24,36,37,.3)',.8);
    for(const x of[.18,.4,.63,.82])rivetLine(ctx,(x+.005)*w,.07*h,(x+.005)*w,.94*h,35,.72,.26);
    for(const y of[.18,.73])rivetLine(ctx,0,(y+.013)*h,w,(y+.013)*h,96,.68,.23);
    // Small root-side anti-slip pad, service cover and a single subtle NO STEP warning.
    if(!tail){
      ctx.fillStyle='rgba(35,43,42,.52)';ctx.fillRect(w*.015,h*.35,w*.055,h*.49);
      ctx.strokeStyle='rgba(47,51,44,.55)';ctx.lineWidth=1.2;ctx.strokeRect(w*.28,h*.29,w*.08,h*.19);
      ctx.fillStyle='rgba(54,54,47,.78)';ctx.font='bold 9px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('NO STEP',w*.31,h*.66);
      ctx.fillStyle='rgba(62,69,65,.48)';ctx.beginPath();ctx.arc(w*.322,h*.38,8,0,Math.PI*2);ctx.fill();
      line(ctx,w*.316,h*.38,w*.328,h*.38,'rgba(213,213,199,.75)',1.6);
    }
    const grad=ctx.createLinearGradient(0,h*.75,0,h);
    grad.addColorStop(0,'rgba(48,42,29,0)');grad.addColorStop(1,'rgba(48,42,29,.085)');ctx.fillStyle=grad;ctx.fillRect(0,h*.75,w,h*.25);
    addMottle(ctx,w,h,hash(`${base}|${accent}|${tail}`),2100);
  });
}
function glazingRoughness(damaged=false) {
  return canvasTexture(`Aircraft_glass_roughness_${damaged}`,256,256,(ctx,w,h)=>{
    ctx.fillStyle=damaged?'#949494':'#dfdfdf';ctx.fillRect(0,0,w,h);
    // Multiplication with material roughness 0.08 gives ~0.07; border dust increases it slightly.
    ctx.strokeStyle=damaged?'#eeeeee':'#ffffff';ctx.lineWidth=damaged?14:4;ctx.strokeRect(0,0,w,h);
    if(damaged){const rand=random(742);for(let i=0;i<22;i++){const x=rand()*w,y=rand()*h;line(ctx,x,y,x+(rand()-.5)*45,y+rand()*26,'rgba(248,248,248,.8)',.8);}}
  },{data:true});
}

/** PBR material set for one model. Paint uses neutral white material modulation.
 * Config accepts paint/accent/kind, environmentMap and glassReflectionIntensity.
 * Fuselage UV: U=.0 upper seam, .25 starboard, .5 belly, .75 port; V=1 nose.
 * Wing/fin UV: U root to tip; V chord. All canvases include their complete UV tile.
 */
export function createAircraftMaterials(model,config={}) {
  if(typeof model?.userData?.ownMaterial!=='function')throw new TypeError('createAircraftMaterials needs a model with userData.ownMaterial.');
  const own=m=>model.userData.ownMaterial(m);
  const matte=militaryFinish(config);
  const environment=config.environmentMap??helicopterReflectionEnvironment();
  const surface=(kind,map)=>own(new THREE.MeshPhysicalMaterial({name:`Aircraft_${kind}`,color:0xffffff,map,
    normalMap:normalTexture(kind==='skin'?'skin':'wing'),normalScale:new THREE.Vector2(.3,.3),
    roughnessMap:roughnessTexture(kind==='skin'?'skin':'wing',matte),roughness:matte?.85:.77,
    metalness:matte?.08:.17,clearcoat:matte?.08:.22,clearcoatRoughness:.28,envMap:environment,envMapIntensity:matte?.32:.56}));
  const materials={
    skin:surface('skin',paintAircraftSkin(config)),
    wing:surface('wing',paintFlyingSurface(config,false)),
    tail:surface('tail',paintFlyingSurface(config,true)),
    accent:own(new THREE.MeshStandardMaterial({name:'Aircraft_livery_accent',color:config.accent??'#465866',roughness:matte?.62:.43,metalness:.12,envMap:environment,envMapIntensity:.4})),
    metal:own(new THREE.MeshStandardMaterial({name:'Aircraft_bare_metal',color:0x929c9f,metalness:.82,roughness:.32,envMap:environment,envMapIntensity:.8})),
    dark:own(new THREE.MeshStandardMaterial({name:'Aircraft_dark_hardware',color:0x222a2d,metalness:.3,roughness:.57})),
    rubber:own(new THREE.MeshStandardMaterial({name:'Aircraft_tire_rubber',color:0x191d1d,metalness:0,roughness:.92})),
    glass:own(new THREE.MeshPhysicalMaterial({name:'Aircraft_reflective_glazing',color:0x173340,metalness:.13,roughness:.09,
      roughnessMap:glazingRoughness(false),clearcoat:1,clearcoatRoughness:.06,ior:1.48,reflectivity:.5,
      transparent:true,opacity:.42,depthWrite:false,envMap:environment,envMapIntensity:config.glassReflectionIntensity??1.3,
      side:THREE.DoubleSide,forceSinglePass:true})),
    interior:own(new THREE.MeshStandardMaterial({name:'Aircraft_cockpit_interior',color:0x333b3a,metalness:.04,roughness:.88})),
    light:own(new THREE.MeshStandardMaterial({name:'Aircraft_navigation_lamp',color:0xf9edc7,emissive:0xffefbd,emissiveIntensity:1.2,roughness:.2})),
    hot:own(new THREE.MeshBasicMaterial({name:'Aircraft_afterburner',color:0xe99355,transparent:true,opacity:.78,depthWrite:false,toneMapped:false}))
  };
  return materials;
}

/** Transparent Canvas label for a dedicated, outward-facing registration mesh.
 * Texture itself is shared and survives model disposal. This never paints labels
 * over a fuselage UV wrap or stamps a registration on every unrelated component.
 */
export function aircraftDecalTexture(text,{color:ink='#252f34',background='transparent',width=512,height=128}={}) {
  if(typeof text!=='string'||!text.trim())throw new TypeError('Aircraft decal text must be nonempty.');
  width=Math.max(32,Math.min(2048,Math.round(width)));height=Math.max(16,Math.min(1024,Math.round(height)));
  return canvasTexture(`Aircraft_decal_${text}_${ink}_${background}_${width}_${height}`,width,height,(ctx,w,h)=>{
    ctx.clearRect(0,0,w,h);if(background!=='transparent'){ctx.fillStyle=background;ctx.fillRect(0,0,w,h);}
    ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';
    const size=Math.min(h*.68,w/(Math.max(text.length,1)*.66));ctx.font=`600 ${size}px Arial, sans-serif`;
    ctx.fillText(text,w*.5,h*.52,w*.93);
  });
}

/** Replacement materials for detached/crumpled sections. No injury imagery.
 * Application and reset policy belong to the crash controller; damage is not
 * inferred by the material factory. Maps remain shared like the intact textures.
 */
export function createDamageMaterials(model) {
  if(typeof model?.userData?.ownMaterial!=='function')throw new TypeError('createDamageMaterials needs userData.ownMaterial.');
  const own=m=>model.userData.ownMaterial(m),environment=helicopterReflectionEnvironment();
  const scorchMap=canvasTexture('Aircraft_mechanical_scorch',256,256,(ctx,w,h)=>{
    ctx.fillStyle='#494640';ctx.fillRect(0,0,w,h);const rand=random(5942);
    for(let i=0;i<330;i++){
      const x=rand()*w,y=rand()*h,r=2+rand()*18,grad=ctx.createRadialGradient(x,y,0,x,y,r);
      grad.addColorStop(0,rand()>.25?'rgba(7,10,10,.28)':'rgba(122,112,90,.24)');grad.addColorStop(1,'rgba(10,10,10,0)');
      ctx.fillStyle=grad;ctx.fillRect(x-r,y-r,r*2,r*2);
    }
    const noise=random(117);for(let i=0;i<130;i++)line(ctx,noise()*w,noise()*h,noise()*w,noise()*h,'rgba(183,185,175,.1)',.4);
  });
  return {
    burnedMetal:own(new THREE.MeshStandardMaterial({name:'Aircraft_heat_stained_metal',map:scorchMap,color:0xa9a598,roughness:.83,metalness:.36,side:THREE.DoubleSide})),
    scuffedGlass:own(new THREE.MeshPhysicalMaterial({name:'Aircraft_scuffed_glazing',color:0x97a8ab,transparent:true,opacity:.82,
      roughness:.38,roughnessMap:glazingRoughness(true),clearcoat:.5,clearcoatRoughness:.28,envMap:environment,envMapIntensity:.6,
      depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true})),
    exposedMetal:own(new THREE.MeshStandardMaterial({name:'Aircraft_exposed_fracture',color:0xa4acaa,metalness:.7,roughness:.43,
      envMap:environment,envMapIntensity:.7,side:THREE.DoubleSide})),
    scorch:own(new THREE.MeshBasicMaterial({name:'Aircraft_scorch_decal',map:scorchMap,color:0x242625,transparent:true,opacity:.68,
      depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,side:THREE.DoubleSide,forceSinglePass:true}))
  };
}
