import {planeDefinitions as light,previewModels as lightPreviews} from './aircraft-light.js';
import {planeDefinitions as transport,previewModels as transportPreviews} from './aircraft-transport.js';
import {planeDefinitions as combat,previewModels as combatPreviews} from './aircraft-combat.js';
import {buildAircraft} from './aircraft-core.js';
export const aircraftDefinitions=[...light,...transport,...combat];
export const aircraftIds=aircraftDefinitions.map(c=>c.id);
export function createFleetAircraft(id='skylark',options={}){const config=aircraftDefinitions.find(c=>c.id===id);if(!config)throw new RangeError('Unknown fleet aircraft: '+id);return buildAircraft(config,options);}
export {createSkylark172,createKestrelCourier} from './aircraft-light.js';
export {createMeridian220,createTempestWR4} from './aircraft-transport.js';
export {createVanguardF1,createOspreyCV,createNightjarB2} from './aircraft-combat.js';
export const previewModels=[...lightPreviews,...transportPreviews,...combatPreviews];
