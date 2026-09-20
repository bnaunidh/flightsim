/**
 * Island Flight Simulator — entry point.
 *
 * Owns the renderer, the world, the game state machine and the frame loop.
 * Physics runs at a fixed 120 Hz in sub-steps so the flight model behaves the
 * same on a 60 Hz laptop and a 144 Hz monitor.
 */

import * as THREE from './vendor/three.module.js';

import { warmTextures, setTextureAnisotropy, asphaltTexture, asphaltNormal } from './render/textures.js';
import { Weather } from './world/weather.js';
import { SkyDome } from './world/sky.js';
import { createTerrain, heightAt, AIRPORT, applyMap, MAP, clearObstacles, clearPlatforms, harbourBerth, harbourMouth, flatSurfaceAt } from './world/terrain.js';
import { SeaMarks } from './world/seamarks.js';
import { MAPS, getMap, mapsForGame } from './world/maps.js';
import { clearPads, nearestPad, PADS } from './world/pads.js';
import { buildRoads, onRoad, roadRibbon, roadSurfaceProbe, nearestRoadPoint } from './world/roads.js';
import { Carrier } from './world/carrier.js';
import { SurfaceVehicle, VEHICLES, setTerrainProbes } from './vehicles/surface.js';
import { DriveInput, DriveCamera, DRIVE_VIEW_LABELS, installDriveTouch } from './vehicles/driving.js';
import { createBoat, createCar, updateVehicleModel } from './vehicles/models.js';
import { Ocean } from './world/water.js';
import { Airport, RUNWAY, refreshRunways } from './world/airport.js';
import { Scenery, DELIVERY_PAD } from './world/scenery.js';
import { MapFeatures } from './world/features.js';
import { Apron, refreshApronElevation } from './world/apron.js';
import { CloudField } from './world/clouds.js';
import { Rain } from './world/precip.js';

import { Aircraft, EVENTS, UNITS, SPEC, applyAircraft } from './aircraft/physics.js';
import { getAircraft, specFor } from './aircraft/types.js';
import { createAircraftModel, syncAircraftModel, crashAircraftModel, clampSinking, eyeFor, groundOffsetFor, setFleetModels } from './aircraft/model-adapter.js';
import { createCockpit } from './aircraft/cockpit.js';
import { TouchControls, isTouchDevice } from './ui/touch.js';

import { Input, ACTIONS, keyLabel } from './flight/input.js';
import { CameraRig, VIEW_LABELS } from './flight/camera.js';

import { GameAudio } from './audio/index.js';

import { Hud } from './ui/hud.js';
import { BoatHud } from './ui/hud-boat.js';
import { DriveHud } from './ui/hud-drive.js';
import { installRotorHud } from './ui/hud-rotor.js';
import { Menus } from './ui/menus.js';
import { installGameUi } from './ui/game-ui.js';

/** The four games, in the order the switcher shows them. */
const GAME_IDS = ['flight', 'boat', 'car', 'heli'];

import { MissionRunner, STATUS } from './game/runner.js';
import { MISSIONS, findMission, FREE_FLIGHT, RUNWAY_START, missionsFor, gameOf, FREE_FOR } from './game/missions.js';
import { BOAT_MISSIONS, BOAT_PATROL, findBoatMission, boatSpawnFor, clearBoatProps } from './game/missions-boat.js';
import { CAR_JOBS, findJob, jobsFor, lengthNote, ISLAND_ROADS, IslandRoads, resolveSpawn } from './game/jobs.js';
import { clearHeliProps } from './game/missions-heli.js';
import { TUTORIAL } from './game/tutorial.js';
import { AtcDirector } from './game/atc-director.js';
import { CargoCrate, PracticeBomb } from './game/markers.js';
import { NavGuide } from './game/navguide.js';
import { Beacon } from './game/beacon.js';
import { Minimap } from './ui/minimap.js';
import { Pursuer } from './game/pursuer.js';
import * as Prog from './game/progression.js';
import { schemeFor, findLivery } from './aircraft/liveries.js';
import { TaxiRun } from './game/taxi.js';
import { Wreck } from './game/wreck.js';
import { Tornado } from './world/tornado.js';
import { NATURAL_EVENTS, findEvent, poolForMap, severityForMap } from './game/disasters.js';
import { Autopilot } from './flight/autopilot.js';

import {
  loadSettings,
  saveSettings,
  loadProgress,
  saveProgress,
  recordLanding,
  recordMission,
  resetAll,
} from './core/storage.js';
import { clamp } from './core/noise.js';

const KTS = UNITS.KTS;
const FT = UNITS.FT;
const FPM = UNITS.FPM;

/** Bumped whenever the game changes. Printed on boot so you can tell at a
 *  glance whether a browser is running a stale cached copy. */
export const BUILD = 'v26 — trim, autopilot heading and speed, the Tempest is a twin at last';

const loadEl = document.getElementById('loading');
const loadBar = document.getElementById('load-bar');
const loadMsg = document.getElementById('load-msg');
const loadTip = document.getElementById('load-tip');

const TIPS = [
  'Shift adds power, Ctrl takes it away.',
  'Two white and two red PAPI lights means you are on the perfect glide path.',
  'A slow, gentle pull on S lifts you off — never yank it.',
  'In a crosswind, point the nose slightly into the wind to stay lined up.',
  'Press C to look at your aeroplane from outside.',
  'Runway 09 means you land heading 090 degrees — east.',
  'If the stall warning sounds, lower the nose and add power.',
];

function setLoad(pct, msg) {
  if (loadBar) loadBar.style.width = `${Math.round(pct * 100)}%`;
  if (msg && loadMsg) loadMsg.textContent = msg;
}

function fatal(message, detail) {
  const box = document.getElementById('fatal');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<h2>Something went wrong</h2><p>${message}</p>${
    detail ? `<pre>${String(detail).slice(0, 900)}</pre>` : ''
  }<p class="tiny">Try reloading the page. If it keeps happening, your browser may not support WebGL 2 —
  Chrome, Edge, Firefox and Safari 16+ all do.</p>`;
  if (loadEl) loadEl.hidden = true;
}

class Game {
  constructor() {
    this.settings = loadSettings();
    // Before anything builds an aeroplane, say which set of models to use.
    setFleetModels(this.settings.fleetModels);
    this.progress = loadProgress();
    this.state = 'loading';
    this.mode = null;
    this.clock = new THREE.Clock();
    this._tmpV = new THREE.Vector3();
    this.acc = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.papiHint = null;
    this.cloudImmersion = 0;
    this.activeTarget = null;
    this._armed = false;
    this._storesLeft = 0;
    this.hasCargo = false;
    this.crate = null;
    this.qualityBuilt = null;
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async boot() {
    if (loadTip) loadTip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];

    const canvas = document.getElementById('view');
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: this.settings.quality !== 'low',
        powerPreference: 'high-performance',
        stencil: false,
      });
    } catch (err) {
      fatal('This browser could not start WebGL, which the simulator needs to draw 3D graphics.', err);
      return;
    }
    /*
     * Ultra.
     *
     * Everything that was capped for the sake of a school laptop, uncapped:
     * the full device pixel ratio rather than two, four-thousand-pixel
     * shadows, denser terrain, more trees, more cloud, more rain, and the
     * highest anisotropy the card will give — which is what actually stops a
     * runway turning to mush at a shallow angle, and is free on anything made
     * this decade.
     *
     * It is not the default and never will be: the class flies this on iPads.
     */
    const q = this.settings.quality;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, q === 'ultra' ? 3 : q === 'high' ? 2 : 1.25)
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = this.settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Only the renderer knows what the card will give. See setTextureAnisotropy.
    try {
      setTextureAnisotropy(q === 'ultra' ? this.renderer.capabilities.getMaxAnisotropy() : 4);
    } catch (e) {
      /* a card that will not answer keeps the safe default */
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 60000);

    setLoad(0.04, 'Painting textures…');
    await warmTextures((p, label) => setLoad(0.04 + p * 0.5, `Painting ${label.toLowerCase()}…`));

    setLoad(0.56, 'Raising the islands…');
    await this.frame();
    this.weather = new Weather();
    this.weather.load(this.settings.weather);
    this.weather.setRandomWinds(!!this.settings.randomWinds);
    // A gust is worth calling out — it is the difference between a good
    // landing and a bounce, and you cannot see wind.
    this.weather.onGust = (kts, dirDeg) => {
      if (this.state !== 'flying' || !this.hud) return;
      const rel = ((dirDeg - (this.aircraft.readouts().heading || 0) + 540) % 360) - 180;
      const side =
        Math.abs(rel) < 35 ? 'head-on' : Math.abs(rel) > 145 ? 'from behind' : rel < 0 ? 'from the left' : 'from the right';
      this.hud.notify(`Gust ${side} — ${kts} knots`, 'warn', 2.6);
    };
    // Pick the saved map before anything reads the height field.
    applyMap(this.settings.map || 'kestrel');
    this.layRoads();
    // The field moved. Tell the modules that cached its height.
    refreshRunways();
    refreshApronElevation();
    this.buildWorld(this.settings.quality);

    setLoad(0.82, 'Rolling out the aeroplane…');
    await this.frame();
    this.aircraft = new Aircraft();
    this.aircraft.mode = this.settings.flightMode;
    this.aircraft.difficulty = this.settings.difficulty || 'normal';
    this.aircraft.realisticFuel = !!this.settings.realisticFuel;
    // Built with no options at all before, so it silently wore the skylark's
    // colours whatever was saved. setAircraft rebuilds it a moment later, but
    // one frame in the wrong paint is still one frame in the wrong paint.
    this.model = createAircraftModel({
      type: this.aircraftType,
      livery: schemeFor(this.aircraftType, this.settings.livery),
    });
    this.scene.add(this.model);
    this.cockpit = createCockpit({ highContrast: this.settings.highContrast, type: this.aircraftType });
    this.model.add(this.cockpit);
    this.cockpit.visible = false;

    this.rig = new CameraRig(this.camera, this.aircraft);
    this.rig.reducedMotion = this.settings.reducedMotion;

    this.navGuide = new NavGuide(this.scene);
    this.beacon = new Beacon(this.scene);
    this.minimap = new Minimap(document.getElementById('ui'));
    this.minimap.toggle(this.settings.minimap !== false);
    // The class is applied once the HUD exists — it is built a few lines down.
    this.prog = Prog.load();
    this.autopilot = new Autopilot();
    this.taxi = new TaxiRun(this);
    this.wreck = new Wreck(this.scene);
    this.tornado = new Tornado(this.scene);
    this.weather.vortex = this.tornado;
    this.navGuide.setEnabled(this.settings.guidance !== false);

    setLoad(0.9, 'Warming up the radio…');
    await this.frame();
    this.audio = new GameAudio();
    this.audio.radio.onSubtitle = ({ text, voice, duration }) => this.hud.setSubtitle(text, voice, duration);

    this.input = new Input(canvas);
    this.hud = new Hud(document.getElementById('ui'), { onAction: (a) => this.hudAction(a) });
    this.syncMinimapClass();
    // On-screen controls, only where there is no keyboard to speak of.
    if (isTouchDevice()) {
      this.touch = new TouchControls(this.hud.wrap, {
        input: this.input,
        onAction: (a) => this.hudAction(a),
      });
      this.hud.wrap.classList.add('is-touch');
      /*
       * Also on the root, so the MENUS can size their touch targets.
       * `is-touch` lives on the HUD wrapper, which is not an ancestor of the
       * menu layer, and `@media (pointer: coarse)` is not a reliable stand-in:
       * it is false on plenty of machines that have a touchscreen.
       */
      document.documentElement.classList.add('is-touch-device');
    }
    this.hud.setSubtitlesEnabled(this.settings.subtitles);
    this.hud.setHighContrast(this.settings.highContrast);
    this.hud.setLargeText(this.settings.largeText);
    this.hud.setMuted(this.settings.muted);
    this.hud.setVisible(false);

    this.runner = new MissionRunner(this);
    this.runner.onStep = (step, i, total) => this.onMissionStep(step, i, total);
    this.runner.onComplete = (r) => this.onMissionComplete(r);
    this.runner.onFail = (f) => this.onMissionFail(f);
    this.runner.onEvent = (e) => this.onMissionEvent(e);

    this.atc = new AtcDirector(this);
    this.bindAircraftEvents();

    /** Which of the four games the menus are showing. */
    this.game = 'flight';
    /*
     * The map each game was last played on.
     *
     * Four games with different places: the lifeboat's island is not the
     * courier's and neither is the aeroplane's. One shared `settings.map` sent
     * you back to whichever you used last, whatever you were about to do.
     */
    this.gameMap = {};
    this.menus = new Menus(document.getElementById('ui'), {
      startTutorial: () => this.startMode('tutorial'),
      /*
       * One door for all four games.
       *
       * The mission cards call this hook, and it sent everything to
       * startMode() — which flies an aeroplane. A boat mission or a car job
       * clicked from the grid would have started an aeroplane on the boat's
       * map with the boat's objective on the HUD.
       */
      startMission: (id) => this.startAnyMission(id),
      startFree: (opts) => this.startMode('free', opts),
      onSetting: (path, value) => this.applySetting(path, value),
      onPauseAction: (a) => this.pauseAction(a),
      onTrigger: (kind) => this.toggleFailure(kind),
      onNatural: (id) => this.triggerNatural(id),
      onLocked: (msg) => this.hud.notify(msg, 'warn', 5),
      startDrive: (kind) => this.startDrive(kind),
      switchGame: (id) => this.switchGame(id),
      onAutopilotAlt: (ft) => {
        // Tell it to climb or descend. Used by "hold" and by the level change —
        // returning to the field and lining up both set their own heights.
        this.autopilot.setSelectedAlt(ft);
        if (this.autopilot.engaged) {
          this.hud.setAutopilot(true, this.autopilot.status(this.activeTarget));
          this.hud.notify(`Autopilot to ${ft.toLocaleString()} ft`, 'info', 2.4);
        }
      },
      onAutopilotHeading: (deg) => {
        const r = this.autopilot.setSelectedHeading(deg);
        if (this.autopilot.engaged) {
          this.hud.setAutopilot(true, this.autopilot.status(this.activeTarget));
          this.hud.notify(
            r.applied
              ? `Autopilot turning to ${String(r.heading).padStart(3, '0')}°`
              : `Heading saved — it works out its own while ${r.why === 'field' ? 'returning to the field' : 'lining up'}`,
            'info',
            2.6
          );
        }
      },
      onAutopilotSpeed: (kt) => {
        this.autopilot.setSelectedSpeed(kt);
        if (this.autopilot.engaged) this.hud.notify(`Autopilot holding ${kt} kt`, 'info', 2.4);
      },
      onAutopilotVs: (fpm) => {
        this.autopilot.setSelectedVs(fpm);
        if (this.autopilot.engaged) this.hud.notify(`Climb and descent at ${fpm.toLocaleString()} ft/min`, 'info', 2.4);
      },
      onAutopilotMode: (id) => {
        this.autopilot.setMode(id);
        // Choosing a job for it is also asking it to do the job.
        if (!this.autopilot.engaged) this.toggleAutopilot(true);
        else this.hud.setAutopilot(true, this.autopilot.status(this.activeTarget));
        const m = {
          hold: 'holding heading and height',
          level: `on its way to ${Math.round(this.autopilot.selectedAltFt).toLocaleString()} ft`,
          field: 'returning to the airfield',
          approach: 'lining up with runway 09',
        }[id];
        this.hud.notify(`Autopilot ${m}`, 'info', 3.5);
      },
      getBindings: () => this.input.bindings,
      captureKey: (action, done) => this.input.capture(action, done),
      resetKeys: () => this.input.resetBindings(),
      resetAll: () => {
        resetAll();
        location.reload();
      },
      onScreen: (name) => {
        if (name === 'missions' && this.game === 'car' && this.refreshJobBoard) this.refreshJobBoard();
      },
      chooseMap: (id) => {
        // Remembered per game. The four games have different places and a child
        // who picks Sennen for the lifeboat should not find the aeroplane there
        // next time, nor the van sent back to Kestrel when they take a job.
        this.gameMap[this.game || 'flight'] = id;
        return this.setMap(id);
      },
      install: () => this.promptInstall(),
      toggleSound: () => {
        this.hudAction('mute');
        this.menus.syncSound(this.settings.muted);
        if (!this.settings.muted) this.unlockAudio();
      },
      onClick: () => this.audio.available && this.audio.alerts.uiClick(),
    });

    /*
     * Four games, one menu.
     *
     * Every screen in here was written for an aeroplane: the map cards say how
     * long the runway is, the mission grid is twelve aeroplane missions and the
     * hangar picks aircraft. This fits the same screens to whichever game is
     * selected — its own missions, its own maps, its own words — rather than
     * building four menus that would drift apart by the end of the week.
     *
     * `mapQualifies` is injected rather than decided inside the menu because
     * only the thing that builds the world knows the answer: the car's test is
     * "has this map got roads", and that is a question for the map data.
     */
    installGameUi(this.menus, {
      onFreeDrive: (gameId) => {
        if (gameId === 'boat' || gameId === 'car') return this.startDrive(gameId);
        return this.switchGame(gameId);
      },
      startMission: (id) => this.startAnyMission(id),
      mapQualifies: (gameId, m) => {
        if (!m) return false;
        if (m.game) return m.game === gameId;
        if (gameId === 'boat') return !!(m.waters && m.waters.harbour);
        if (gameId === 'car') return !!(m.waters && m.waters.roads && m.waters.roads.length);
        return true;
      },
    });
    for (const g of ['flight', 'boat', 'car', 'heli']) {
      this.menus.registerMissions(g, missionsFor(g));
    }
    /*
     * And the courier's board tells the truth about this island.
     *
     * jobs.js works out, per map, which of the six can actually be done — the
     * lighthouse job needs a lighthouse you can drive to, the summit job needs
     * a hill with a road up it — and hands back a reason for each refusal. None
     * of that ever reached a player: the board built a clickable card for all
     * six on every map, so a child could take Coast Road on an island whose
     * lighthouse is across open water and drive until the clock ran out.
     */
    this.refreshJobBoard = () => {
      const screen = this.menus.screens.missions;
      if (!screen) return;
      let entries;
      try {
        entries = jobsFor(this);
      } catch (err) {
        return; // a board that cannot be graded is better than no board
      }
      for (const e of entries) {
        const card = screen.querySelector(`[data-mission="${e.job.id}"]`);
        if (!card) continue;
        card.classList.toggle('is-unavailable', !e.available);
        const btn = card.querySelector('[data-start]');
        if (btn) btn.disabled = !e.available;
        let why = card.querySelector('[data-job-why]');
        if (!why) {
          why = document.createElement('p');
          why.className = 'mission-why';
          why.setAttribute('data-job-why', '');
          card.appendChild(why);
        }
        why.textContent = e.available ? e.note || '' : e.why || 'Not on this island';
        why.hidden = !why.textContent;
      }
    };

    /*
     * ONE progression object, shared with the menus.
     *
     * Menus reads its own copy at construction so the hangar can paint itself,
     * and the hangar's buttons mutate that copy in place. If main.js kept a
     * separate one, entering the passcode would unlock the menus' copy and
     * leave main.js's at false for the rest of the session — which is exactly
     * what happened. This has to run AFTER `new Menus(...)`; an earlier
     * attempt sat above it and was dead code, because `this.menus` did not
     * exist yet and the `if` simply never fired.
     */
    /*
     * The menus read live settings for the things they paint: the fleet card
     * liveries, and the dev-mode switches. This was never assigned, so
     * `settingsRef` was permanently undefined and the fleet art always painted
     * house colours however the aeroplane was actually painted.
     */
    this.menus.settingsRef = this.settings;
    this.prog = this.menus.prog;
    this.menus.syncProgression && this.menus.syncProgression(this.prog);
    this.menus.syncFleetLocks && this.menus.syncFleetLocks();
    this.menus.syncMissionLocks && this.menus.syncMissionLocks();
    this.menus.syncSettings(this.settings);
    this.menus.syncProgress(this.progress);
    this.menus.syncSound(this.settings.muted);
    this.menus.syncMap(this.settings.map || 'kestrel');
    this.input.freeLook = !!this.settings.freeLook;
    this.menus.syncFreeLook(this.input.freeLook);

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('pointerdown', () => this.unlockAudio(), { once: false });
    window.addEventListener('keydown', () => this.unlockAudio(), { once: false });
    // Pause when the player switches tabs — nobody wants to come back to a
    // smoking crater. The flag exists so the automated self-test can opt out.
    this.autoPauseOnHide = true;
    document.addEventListener('visibilitychange', () => {
      if (this.autoPauseOnHide && document.hidden && this.state === 'flying') this.pause();
    });

    setLoad(1, 'Ready for take-off');
    await this.frame();
    if (loadEl) {
      // Take it out of the document entirely rather than just hiding it. It
      // sits above the interface, so if anything ever leaves it on screen — a
      // stalled transition, a stale stylesheet — you get a black sheet over
      // the whole game and no way to dismiss it. An element that is gone
      // cannot do that.
      loadEl.classList.add('is-done');
      loadEl.hidden = true;
      setTimeout(() => loadEl.remove(), 600);
    }

    this.state = 'menu';
    this.menus.show('main');
    this.setupPwa();
    this.aircraft.reset({ ...RUNWAY_START, engineOn: true });
    this.loop();

    console.info(`[island-flight] build ${BUILD}`);
    this.checkForStuckOverlays();
    // Small headless API so the flight model can be driven in tests.
    window.__sim = this;
    window.__build = BUILD;
  }

  /**
   * Yield one frame so the loading bar can paint. Browsers pause
   * requestAnimationFrame entirely in a background tab, so race it against a
   * timer — otherwise loading would stall until the tab was brought forward.
   */
  frame() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 80);
    });
  }

  /**
   * Run something after the next paint, whether or not the browser feels like
   * giving us a frame. Same race as `frame()`: requestAnimationFrame stops in
   * a background tab and while a native <select> dropdown is open, and work
   * that never runs is indistinguishable from a crash.
   */
  afterPaint(fn) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      fn();
    };
    requestAnimationFrame(go);
    setTimeout(go, 120);
  }

  /**
   * What the tyres are told they are on.
   *
   * The road wins where there is a road, and where there is not, the map's own
   * authored ground does — a quay is tarmac, a causeway is gravel, a village
   * green is grass. `flatSurfaceAt` has read that field since the flats landed
   * and was never once passed to the vehicle, so a stretch a map's own blurb
   * calls gravel drove as tarmac where a road crossed it and as grass
   * everywhere else. Measured on the Sands Causeway: eleven samples, six
   * tarmac, five grass, gravel at none of them.
   */
  surfaceProbe(roads) {
    const onRoads = roadSurfaceProbe(roads);
    return (x, z) => {
      const r = onRoads(x, z);
      if (r) return r;
      const kind = flatSurfaceAt(x, z);
      return kind ? { kind } : null;
    };
  }

  /**
   * The map this game should be played on.
   *
   * A car job with no map of its own used to start wherever you happened to be
   * — which after one flight is Kestrel, an island with one road along its
   * waist and nothing for a courier to do. The boat had the same problem in
   * reverse. So: the map you last chose for THIS game, or the first one built
   * for it, and only fall back to where you are if the game has nowhere of its
   * own.
   */
  mapForGame(game) {
    const chosen = this.gameMap[game];
    if (chosen && getMap(chosen).id === chosen) return chosen;
    const own = MAPS.filter((m) => m.game === game);
    if (own.length) return own[0].id;
    const offered = mapsForGame(game);
    return offered.length ? offered[0].id : this.settings.map;
  }

  /**
   * Lay the roads, once per map.
   *
   * A road is a cut through the terrain, so it has to exist before the terrain
   * mesh is built or the mesh and the ground the car drives on disagree. And
   * it has to be worked out AFTER applyMap, because the router reads the
   * height field it is about to change.
   *
   * Only maps that name places get roads. The nine flight maps have no road
   * network and are not supposed to: driving there is the free drive it has
   * always been, on the apron and the grass.
   */
  layRoads() {
    const map = MAP;
    this.roads = null;
    /*
     * And publish the harbour, which is the boat's equivalent of the runway.
     *
     * missions-boat.js asks for `sim.harbour` and, not finding one, falls back
     * to walking out from the origin until it reaches open water — and then
     * CACHES that answer on the sim for the rest of the session. So every boat
     * mission started at the same invented anchorage two kilometres out,
     * whatever map it had just loaded and wherever that map's quay actually
     * was. terrain.js has known the answer since the harbours landed; nothing
     * was handing it over.
     */
    /*
     * The tyres hear about the ground on EVERY map, not only the ones with
     * roads. The probe used to be installed inside the road branches, so on a
     * map with no network the quay, the causeway and the village green all
     * came back as whatever the height-based guess said.
     */
    setTerrainProbes({ surfaceAt: this.surfaceProbe(null) });

    const berth = harbourBerth();
    const mouth = harbourMouth();
    this.harbour = berth && mouth
      ? {
          berth: new THREE.Vector3(berth.x, 0, berth.z),
          mouth: new THREE.Vector3(mouth.x, 0, mouth.z),
          name: (map && map.waters && map.waters.harbour && map.waters.harbour.name) || 'the harbour',
        }
      : null;
    // And drop the stale fallback, or the cache outlives the map it was for.
    this._boatFallbackHarbour = null;
    if (!map || !map.courier) {
      /*
       * A map may have authored its own network — several of the driving maps
       * did, a street grid among them — and an authored road is better than a
       * generated one because somebody decided where it should go. Publish it
       * so the tyres and the chart can see it, and generate nothing.
       */
      const authored = map && map.waters && map.waters.roads;
      if (authored && authored.length) {
        this.roads = { list: authored, roads: authored, notes: [], place: () => null, places: [] };
        setTerrainProbes({ surfaceAt: this.surfaceProbe(authored) });
      }
      return;
    }
    try {
      const t0 = performance.now();
      /*
       * Generate only where nothing was authored. Two of the driving maps
       * carry both a place list and their own roads; regenerating over the top
       * of those would throw away a network somebody drew on purpose.
       */
      const authored = map.waters && map.waters.roads;
      const already = authored && authored.length && !map.waters._generated;
      const { roads, notes } = already ? { roads: authored, notes: ['authored'] } : buildRoads(map);
      map.waters = map.waters || {};
      map.waters.roads = roads;
      if (!already) map.waters._generated = true;
      // The bounding boxes and the harbour siting are resolved once and cached
      // on the waters block; a new road list has to invalidate that.
      delete map.waters._ready;
      applyMap(map);
      /*
       * The shape jobs.js asks for.
       *
       * It looks for `sim.roads.place(name)` and falls back to "the apron is
       * the depot" when there is not one — a placeholder its own comment says
       * to replace the day a road network exists. This is that day: the places
       * come from the map, and every delivery now has a real address on a real
       * road instead of six jobs that all start and end on the same apron.
       */
      /*
       * And tell the car. surface.js deliberately takes its road knowledge by
       * injection rather than importing world/ — a vehicle that imports the
       * terrain is a vehicle that cannot be tested without one. Without this
       * the van drives on a tarmac road that reads as grass, at 40 km/h.
       */
      setTerrainProbes({ surfaceAt: this.surfaceProbe(roads) });
      const places = (map.courier && map.courier.places) || [];
      this.roads = {
        list: roads,
        // The chart asks for `.roads`; the jobs ask for `.place()`; the tyres
        // ask for a plain list. One object, three names, no copies.
        roads,
        notes,
        place(name) {
          const p = places.find((q) => q.id === name || q.kind === name);
          return p ? { x: p.x, z: p.z } : null;
        },
        places,
      };
      const km = roads.reduce((a, r) => {
        let l = 0;
        for (let i = 1; i < r.path.length; i++) {
          l += Math.hypot(r.path[i][0] - r.path[i - 1][0], r.path[i][1] - r.path[i - 1][1]);
        }
        return a + l;
      }, 0) / 1000;
      console.debug(
        `[roads] ${map.id}: ${roads.length} roads, ${km.toFixed(1)} km in ` +
          `${(performance.now() - t0).toFixed(0)} ms`,
        notes.length ? notes : ''
      );
    } catch (err) {
      // A map with no drivable ground is a map with no roads, not a black
      // screen. The car can still be driven on it; it just has nowhere to go.
      console.warn('Could not lay the roads on this map:', err);
      this.roads = null;
    }
  }

  /** Is this point on made road? What the tyres and the chart ask. */
  onRoad(x, z, margin = 0) {
    return onRoad(this.roads && this.roads.list, x, z, margin);
  }

  /**
   * Tear the old world down properly. Removing a group from the scene only
   * unhooks it — the geometry, materials and textures stay resident on the
   * GPU. That is fine once, but the world is rebuilt every time the graphics
   * quality or the map changes, and leaked render targets are exactly what
   * used to make the sea flicker after a long session.
   */
  disposeWorld() {
    if (!this.worldGroups) return;
    const seen = new Set();
    const killTex = (m) => {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap', 'aoMap', 'bumpMap']) {
        const t = m[k];
        if (t && t.isTexture && !seen.has(t)) {
          seen.add(t);
          t.dispose();
        }
      }
      m.dispose();
    };
    for (const g of this.worldGroups) {
      if (!g) continue;
      g.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) {
          seen.add(o.geometry);
          o.geometry.dispose();
        }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          killTex(m);
        }
      });
      this.scene.remove(g);
    }
    if (this.sky && this.sky.dispose) this.sky.dispose();
    this.worldGroups = null;
  }

  buildWorld(quality) {
    this.disposeWorld();
    // Timing each piece makes it obvious which part of the world is
    // expensive if someone changes the detail settings later.
    const t = (label, fn) => {
      const t0 = performance.now();
      const r = fn();
      console.debug(`[world] ${label} ${Math.round(performance.now() - t0)} ms`);
      return r;
    };

    console.debug('[world] build start', quality);
    // Solid structures are registered as each piece builds itself, so the list
    // has to start empty or a rebuild would leave ghost buildings behind to
    // crash into.
    clearObstacles();
    // Decks you can land on are registered the same way, and for the same
    // reason: a stale one would be a steel floor hanging over empty sea.
    clearPlatforms();
    // Pads are cleared by buildPads itself, but a map with no pads at all
    // would otherwise inherit the previous map's list if Scenery ever failed
    // to construct. One line, and the failure mode it removes is "a pad
    // hanging in the air over a different island".
    clearPads();
    this.sky = t('sky', () =>
      new SkyDome(this.scene, {
        shadows: quality !== 'low',
        shadowMapSize: quality === 'ultra' ? 4096 : quality === 'high' ? 2048 : 1024,
      })
    );
    this.ocean = t('ocean', () => new Ocean(this.scene));
    this.airport = t('airport', () => new Airport(this.scene));
    // The terminal, the air bridges, the parked aeroplanes and the vehicles.
    this.apron = t('apron', () => new Apron(this.scene, quality));
    /*
     * The roads, here, between the airfield and the ground it stands on.
     *
     * They used to be laid before buildWorld ran at all, which meant the
     * router was routing over an obstacle list that had just been emptied:
     * it knew the shape of the island and nothing about what was built on
     * it. On Drover's Flat the depot–airfield road went straight through the
     * terminal, and the van — driven by the test harness's own pure pursuit,
     * and by any child who follows the tarmac — stopped dead against the
     * wall at waypoint 20 of 23. Laid here, the tower and the terminal are
     * already registered and the road goes round them.
     *
     * And before `createTerrain`, which is the other half of it: roadHeight
     * is part of heightAt, so the mesh has to be built after the paths exist
     * or the graded corridor under the tarmac is the one from last time.
     * Nothing between here and there reads this.terrain — the height
     * function is analytic and owes the mesh nothing.
     */
    this.layRoads();
    this.terrain = t('terrain', () => createTerrain(this.scene, quality));
    this.scenery = t('scenery', () => {
      const sc = new Scenery(this.scene, quality);
      // Something on the apron to measure the base against — see parkJets().
      sc.parkJets(createAircraftModel, getAircraft('nightjar'), schemeFor(getAircraft('nightjar'), 'house'));
      return sc;
    });
    /*
     * The carrier, parked off the coast.
     *
     * Placed on a cardinal heading on purpose — the landing surface is an
     * axis-aligned box, so an angled ship would have a deck that did not match
     * the picture, and falling through a deck you were aiming at is far worse
     * than a ship that happens to point north.
     */
    this.carrier = t('carrier', () => {
      const at = this.carrierBerth();
      const c = new Carrier(this.scene, {
        x: at.x, z: at.z, headingDeg: 0, name: 'CV-11 Resolute',
      });
      // Something on the deck to measure the ship against.
      c.parkAircraft(createAircraftModel, getAircraft('osprey'), schemeFor(getAircraft('osprey'), 'house'));
      return c;
    });
    // Whatever makes this particular map the place it says it is: lava, reef,
    // farmland, waterfalls, the aurora.
    /*
     * The tarmac. The corridor under it was cut at map load; this is the
     * surface on top. One mesh for the whole network.
     */
    if (this.roadMesh) {
      this.scene.remove(this.roadMesh);
      this.roadMesh.geometry.dispose();
      this.roadMesh = null;
    }
    if (this.roads && this.roads.list.length) {
      this.roadMesh = t('roads', () =>
        roadRibbon(THREE, this.roads.list, { tex: asphaltTexture(), nrm: asphaltNormal() })
      );
      if (this.roadMesh) this.scene.add(this.roadMesh);
    }
    this.features = t('features', () => new MapFeatures(this.scene, quality));
    // Broken water over the drying shoals. Builds nothing on a map with none,
    // which is every map that has not been given shoals of its own.
    this.seamarks = t('seamarks', () => new SeaMarks(this.scene, quality));
    this.clouds = t('clouds', () => new CloudField(this.scene, quality));
    this.rain = t('rain', () => new Rain(this.scene, quality));
    // Image-based lighting from the sky. Do this after the world exists so the
    // aeroplane, sea and buildings all pick it up.
    try {
      this.sky.buildEnvironment(this.renderer, this.scene);
    } catch (err) {
      console.warn('Could not build the environment map:', err);
    }

    this.worldGroups = [
      this.sky.mesh,
      this.terrain,
      this.ocean.group,
      this.airport.group,
      this.apron.group,
      this.scenery.group,
      this.carrier.group,
      this.features.group,
      this.seamarks.group,
      this.clouds.group,
      this.rain.mesh,
    ];
    if (this.roadMesh) this.worldGroups.push(this.roadMesh);
    this.qualityBuilt = quality;
    console.debug('[world] build complete');
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  bindAircraftEvents() {
    const ac = this.aircraft;
    ac.on(EVENTS.TOUCHDOWN, (g) => {
      const impact = clamp(Math.abs(g.vsFpm) / 700, 0.05, 1);
      this.audio.available && this.audio.ambience.playTouchdown(impact, g.paved ? 'paved' : 'grass');
      this.rig.kick(0.25 + impact * 0.6);
      if (g.crashed) return;
      this.progress = recordLanding(this.progress, g);
      this.menus.syncProgress(this.progress);
      const words = {
        perfect: ['Perfect landing!', 'You barely felt that. Textbook.'],
        good: ['Good landing', 'Smooth and on the centreline.'],
        firm: ['Firm landing', 'A bit of a bump, but perfectly safe.'],
        rough: ['Rough landing', 'That was heavy — try to arrive more slowly next time.'],
      };
      const [title, sub] = words[g.quality] || words.good;
      this.hud.showBanner(
        `${title} · ${g.score}/100`,
        `${sub} Descent rate ${Math.abs(g.vsFpm)} ft/min${g.onRunway ? '' : ' · not on the runway'}`,
        g.quality === 'rough' ? 'warn' : 'good'
      );
      this.audio.available && (g.quality === 'rough' ? this.audio.alerts.uiBack() : this.audio.alerts.checkpoint());
      this.atc.onTouchdown(g);
    });

    ac.on(EVENTS.LIFTOFF, (d) => {
      this.progress.takeoffs++;
      saveProgress(this.progress);
      this.hud.showBanner('Airborne!', `Lift-off at ${Math.round(d.speedKts)} knots — well flown.`, 'good', 3);
      this.audio.available && this.audio.alerts.checkpoint();
    });

    ac.on(EVENTS.CRASH, (c) => {
      /*
       * Did the brace work?
       *
       * If you shut everything down and then flew it properly — wings level,
       * slow, and settling rather than diving — the aeroplane is wrecked and
       * everybody is fine. That is what the procedure is FOR, and it is what
       * actually happens in the real ditchings people remember.
       *
       * Judged on the state at the moment of impact, not on where you ended
       * up, because holding it off to the last second is the skill.
       */
      // A mayday owns its own ending — see resolveBrace().
      if (this.bracing || this.braceRescueT) this.braceOwnsEnding = true;
      this.progress.crashes++;
      saveProgress(this.progress);
      if (this.audio.available) {
        if (this.aircraft.pos.y < 3 && heightAt(this.aircraft.pos.x, this.aircraft.pos.z) < 0)
          this.audio.ambience.playSplash();
        else this.audio.ambience.playCrash();
        this.audio.engine.playStop();
      }
      this.rig.kick(1.4);
      // Something to look at. A crash used to leave the aeroplane sitting
      // there in one piece, which read as the game having frozen rather than
      // as having gone badly wrong.
      const inWater = heightAt(ac.pos.x, ac.pos.z) < 0 && ac.pos.y < 4;
      this.wreck.start(ac.pos, ac.vel, inWater);
      // And, if this aeroplane is one that can come apart, let it.
      crashAircraftModel(
        this.model,
        ac,
        {
          reason: c.reason,
          // The part that actually touched, and how fast it was going before
          // the physics damped the wreck to stop it sliding.
          worldPoint: c.contact && c.contact.worldPoint,
          partId: c.contact && c.contact.part,
          worldVelocity: c.impactVel,
          worldAngularVelocity: c.impactOmega,
          surfaceKind: (c.contact && c.contact.surfaceKind) || (inWater ? 'water' : undefined),
        },
        { groundHeight: heightAt, camera: this.camera }
      );
      // A mayday writes its own words. "Crashed" is not one of them: you
      // declared an emergency, the aeroplane came down and people came for
      // you, and calling that a crash reads as being told off for it.
      if (!this.bracing && !this.braceRescueT) {
        this.hud.showBanner('Crashed', c.reason, 'bad', 6);
      }
      /*
       * The debrief is deliberately late, so the wreck is worth watching
       * first. But restarting inside those 2.2 seconds used to drop the crash
       * debrief on top of the new flight — the timer had no idea it had been
       * overtaken. It is tracked and cancelled now, and it checks that the
       * flight it fires into is still the crashed one.
       */
      clearTimeout(this._crashDebriefT);
      const crashedFlight = this.progress.flights;
      this._crashDebriefT = setTimeout(() => {
        if (this.state === 'flying' && this.aircraft.crashed && this.progress.flights === crashedFlight) {
          this.showCrashDebrief(c.reason);
        }
      }, 2200);
    });

    ac.on(EVENTS.DAMAGE, (d) => {
      if (!d.worsened) return;
      const WORDS = {
        leftWing: 'Left wing',
        rightWing: 'Right wing',
        nose: 'Nose',
        tail: 'Tail',
        fuselage: 'Fuselage',
        gear: 'Undercarriage',
      };
      const how = d.level > 0.7 ? 'badly damaged' : d.level > 0.35 ? 'damaged' : 'scraped';
      this.hud.notify(`${WORDS[d.part] || d.part} ${how} — keep flying`, 'warn', 4.5);
      this.hud.setDamage(ac.damage);
      this.rig.kick(0.5 + d.severity);
      this.audio.available && this.audio.alerts.caution && this.audio.alerts.caution();
    });

    ac.on(EVENTS.ARRESTED, (d) => {
      this.hud.showBanner('Trapped!', `Caught a wire at ${Math.round(d.speedKts)} knots.`, 'good', 3);
      this.rig.kick(0.9);
      this.audio.available && this.audio.ambience.playGear(true);
    });

    ac.on(EVENTS.GEAR, (d) => {
      this.audio.available && this.audio.ambience.playGear(d.down);
      this.hud.notify(d.down ? 'Landing gear coming down' : 'Landing gear coming up', 'info', 2.6);
    });
    ac.on(EVENTS.ENGINE_START, () => {
      this.audio.available && this.audio.engine.playStart();
      this.hud.notify('Starting the engine…', 'info', 2.4);
    });
    ac.on(EVENTS.ENGINE_STOP, (d) => {
      this.audio.available && this.audio.engine.playStop();
      this.hud.notify(d.reason === 'fuel' ? 'The engine stopped — out of fuel!' : 'Engine off', 'warn', 5);
    });
    ac.on(EVENTS.STALL, () => this.hud.notify('Stall! Lower the nose and add power', 'bad', 3.5));
    ac.on(EVENTS.OVERSPEED, () => {
      this.audio.available && this.audio.alerts.overspeed();
      this.hud.notify('Too fast! Reduce power and level off', 'bad', 3.5);
    });
    ac.on(EVENTS.FUEL_LOW, () => {
      this.audio.available && this.audio.alerts.lowFuel();
      this.hud.notify('Low fuel — head back to the airfield', 'warn', 6);
    });
  }

  onMissionStep(step, i, total) {
    // Every mission gets an intensity curve for free: the music is told which
    // step began and shapes itself from the scene's own table. See music.js.
    if (this.audio.available && this.settings.music && step && step.id) {
      this.audio.music.setPhase(step.id);
    }
    const title = this.runner.def.name + (total > 1 ? ` · step ${i + 1} of ${total}` : '');
    this.hud.setObjective(title, step.text);
    if (i > 0) this.audio.available && this.audio.alerts.checkpoint();
  }

  onMissionEvent(e) {
    if (e.type === 'checkpoint') {
      this.audio.available && this.audio.alerts.checkpoint();
      this.hud.notify(
        e.remaining > 0 ? `Ring passed! ${e.remaining} to go` : 'Last ring — nicely flown!',
        'good',
        2.6
      );
    } else if (e.type === 'hint') {
      this.hud.notify(`Hint: ${e.text}`, 'info', 6);
    }
  }

  onMissionComplete(result) {
    const isTutorial = result.id === 'tutorial';
    if (isTutorial) {
      this.progress.tutorialComplete = true;
      saveProgress(this.progress);
    } else if (result.id !== 'free') {
      this.progress = recordMission(this.progress, result.id, { score: result.score, time: result.time });
    }
    /*
     * Pay for the flight. Missions pay most, a free flight pays a little, and
     * a crash pays nothing — but never takes anything away, because charging
     * someone for crashing punishes exactly the person who most needs to keep
     * trying.
     */
    const before = Prog.rankFor(this.prog).id;
    const paid = Prog.award(this.prog, {
      kind: result.id === 'free' ? 'free' : result.id === 'tutorial' ? 'tutorial' : 'mission',
      score: result.score || 0,
      crashed: !!result.crashed,
      difficulty: this.settings.difficulty || 'normal',
      label: result.name || result.id,
    });
    const after = Prog.rankFor(this.prog);
    if (paid.credits > 0) this.hud.notify(`+${paid.credits} credits · ${paid.total} total`, 'good', 4);
    if (after.id !== before) this.hud.notify(`Promoted — you are now a ${after.name}`, 'good', 6);
    this.menus.syncProgression && this.menus.syncProgression(this.prog);

    this.menus.syncProgress(this.progress);
    this.audio.available && this.audio.alerts.success();
    const mins = Math.floor(result.time / 60);
    const secs = Math.round(result.time % 60);
    const l = result.landing;
    const body = `
      <div class="debrief-score">${result.score}<span>/100</span></div>
      <ul class="debrief-list">
        <li>Time <b>${mins}m ${String(secs).padStart(2, '0')}s</b></li>
        ${l ? `<li>Touchdown <b>${Math.abs(l.vsFpm)} ft/min</b> (${l.quality})</li>` : ''}
        ${l ? `<li>Landing score <b>${l.score}/100</b></li>` : ''}
        ${l && l.onRunway ? `<li>Distance from centreline <b>${l.centreline} m</b></li>` : ''}
      </ul>
      <p>${isTutorial ? 'You have finished flight school — you are cleared for solo flight!' : 'Mission complete. Try it again for a better score, or take on another one.'}</p>
    `;
    const actions = [
      { label: 'Fly again', onClick: () => this.restart(), primary: true },
      { label: 'Missions', onClick: () => this.quitToMenu('missions') },
      { label: 'Main menu', onClick: () => this.quitToMenu('main') },
    ];
    this.state = 'debrief';
    this.hud.setVisible(false);
    this.menus.showDebrief({
      title: isTutorial ? 'Flight school complete!' : 'Mission complete!',
      kind: 'good',
      body,
      actions,
    });
  }

  onMissionFail(f) {
    this.audio.available && this.audio.alerts.failure();
    this.state = 'debrief';
    this.hud.setVisible(false);
    this.menus.showDebrief({
      title: 'Mission not completed',
      kind: 'bad',
      body: `<p class="debrief-reason">${f.reason}</p><p>Everybody walks away in this simulator. Have another go — you get better every time.</p>`,
      actions: [
        { label: 'Try again', onClick: () => this.restart(), primary: true },
        { label: 'Missions', onClick: () => this.quitToMenu('missions') },
        { label: 'Main menu', onClick: () => this.quitToMenu('main') },
      ],
    });
  }

  showCrashDebrief(reason) {
    // The mayday sequence is already writing an ending; do not talk over it.
    if (this.braceOwnsEnding) {
      this.braceOwnsEnding = false;
      return;
    }
    if (this.braceSaved) {
      this.braceSaved = false;
      this.bracing = false;
      this.state = 'debrief';
      this.hud.setVisible(false);
      this.menus.showDebrief({
        title: 'Everyone walked away',
        kind: 'good',
        body:
          '<p class="debrief-reason">You shut it down, kept the wings level and held it off.</p>'
          + '<p>The aeroplane is a write-off. Nobody is hurt. That is the whole job.</p>',
        actions: [
          { label: 'Reset on the runway', onClick: () => this.restart(), primary: true },
          { label: 'Main menu', onClick: () => this.quitToMenu('main') },
        ],
      });
      return;
    }
    if (this.runner.status === STATUS.RUNNING || this.runner.status === STATUS.FAILED) return;
    this.state = 'debrief';
    this.hud.setVisible(false);
    this.menus.showDebrief({
      title: 'Crashed',
      kind: 'bad',
      body: `<p class="debrief-reason">${reason}</p><p>No harm done — this is a simulator. Reset and try again.</p>`,
      actions: [
        { label: 'Reset on the runway', onClick: () => this.restart(), primary: true },
        { label: 'Main menu', onClick: () => this.quitToMenu('main') },
      ],
    });
  }

  /* ------------------------------------------------------------------ */
  /* Mode control                                                        */
  /* ------------------------------------------------------------------ */

  async startMode(mode, opts = {}) {
    await this.unlockAudio();
    this.wakeAudio();
    // Whatever you were driving, you are not driving it now. This is here
    // rather than in the switcher because quitting the boat to the menu and
    // picking Free Flight is the other way back, and it left the hull behind.
    this.stopDrive();
    this.mode = mode;
    this.modeOpts = opts;
    this.menus.hide();
    this.hud.setVisible(true);
    this.hud.hideControls();
    this.hud.clearTransient();
    this.autopilot.setEngaged(false, this.aircraft);
    this.hud.setAutopilot(false);
    this.taxi.stop();
    this.wreck.clear();
    this.tornado.clear();
    this.hud.setGuideActive(this.navGuide.enabled);
    this.atc.reset();
    this.removeCrate();
    this.hasCargo = false;
    this.progress.flights++;
    saveProgress(this.progress);
    // The flight model has to be told before the first frame, and told again
    // each flight — reset() clears the damage but not the rule.
    this.aircraft.survivableStrikes = !!this.settings.damageModel;
    this.hud.setDamage(null);
    this.bracing = false;
    this.braceOwnsEnding = false;
    this.abandonedMission = null;
    clearTimeout(this.braceRescueT);
    this.braceRescueT = null;
    this.braceRescue = [];
    this.braceChoice = null;
    this.hud.setEmergencyChoice(null);
    this.clearRescue();
    this.clearChute();
    this.clearPursuer();
    // Nothing from the last flight is allowed to arrive during this one.
    clearTimeout(this._crashDebriefT);

    let def = FREE_FLIGHT;
    if (mode === 'tutorial') def = TUTORIAL;
    else if (mode === 'mission') def = findMission(opts.id) || FREE_FLIGHT;

    // Failures armed on the Free Flight screen. They wait until you are
    // actually flying and then the clock starts, so you get to be somewhere
    // interesting before anything happens.
    this.armed = mode === 'free' && opts.failures ? { ...opts.failures } : {};
    this.armedEvents = mode === 'free' && opts.events ? { ...opts.events } : {};
    this._groundT = 0;
    /** Natural events currently running, with the seconds left on each. */
    this.activeEvents = {};
    this.lightningStorm = null;
    /*
     * Clear the panel failure, and tell the HUD.
     *
     * Setting the counter to 0 was not enough: the tick below only calls
     * setBlackout when the counter is ABOVE zero, so the class stayed on the
     * HUD and every flight after a blackout — or after a mayday — started
     * with dead instruments for no reason anybody could see.
     */
    this.instrumentBlackout = 0;
    this.hud.setBlackout(false);
    this._armedT = 0;
    this._hasFlown = false;
    // Randomised disasters: things break on their own, and worse weather makes
    // that more likely — which is true of real aeroplanes as well.
    this.randomDisasters = mode === 'free' && !!opts.randomDisasters;
    // The Enhanced Fujita rating the player asked for, or null for "its own".
    this.tornadoEF = mode === 'free' && opts.tornadoEF != null ? opts.tornadoEF : null;
    this._disasterT = 0;
    // First one is a long way off: the point is to be caught out once,
    // somewhere awkward, not to be pecked to death on the climb-out.
    this._nextDisaster = 180 + Math.random() * 240;

    // Which aeroplane. Only Free Flight offers the choice — the tutorial and
    // the missions are written around the trainer's numbers.
    this.setAircraft(mode === 'free' ? opts.aircraft || 'skylark' : 'skylark');
    // setAircraft returns early when the type has not changed, so the name is
    // set here as well — otherwise flying the same aeroplane twice in a row
    // leaves the panel blank the second time.
    this.hud.setAircraftName(this.aircraftType.name);

    /*
     * A mission may demand a particular place and a particular aeroplane.
     *
     * Some of them only make sense somewhere specific — you cannot fly a
     * volcano run without a volcano — and some are about what a given airframe
     * is good at. Both are set before the spawn so the world underneath the
     * aeroplane is the right one by the time it is put down on it.
     */
    if (def.map && this.settings.map !== def.map) {
      /*
       * A mission borrows the map; it does not get to keep it.
       *
       * This used to write the mission's map into settings and save it, so
       * flying one military mission moved your saved map to the air base
       * permanently — every Free Flight afterwards started there, and so did
       * every other mission that does not name a map of its own. Nobody chose
       * that and nothing told them it had happened.
       *
       * The choice you made is remembered here and put back when the flight
       * ends.
       */
      this.mapBeforeMission = this.settings.map;
      applyMap(def.map);
      this.layRoads();
      // The field moved. Tell the modules that cached its height.
      refreshRunways();
      refreshApronElevation();
      this.settings.map = def.map;
      this.menus.syncMap(def.map);
      this.buildWorld(this.settings.quality);
    }
    /*
     * Which aeroplane, in order of who has the strongest claim: the mission
     * names one, or the caller asked for one, or the switcher left the
     * helicopter selected, or you keep what you had.
     *
     * `aircraftType` is undefined until the first flight of the session — the
     * front page has not chosen an aeroplane — so every read of it here has to
     * allow for that. It did not, and pressing Heli from a cold start threw
     * before a single frame was drawn.
     */
    const wantAc =
      def.aircraft
      || opts.aircraft
      || (this.game === 'heli' ? 'harrier' : null)
      || (this.aircraftType && this.aircraftType.id);
    if (wantAc && (!this.aircraftType || this.aircraftType.id !== wantAc)) {
      this.setAircraft(wantAc);
      this.hud.setAircraftName(this.aircraftType.name);
    }

    // Light the right half of the switcher. The helicopter is an aircraft
    // type rather than a mode, so the bar has to be told which one you are in.
    this.menus.setGame(this.aircraftType && this.aircraftType.id === 'harrier' ? 'heli' : 'flight');

    // Weather.
    if (mode === 'free') {
      this.weather.load(opts);
      this.settings.weather = this.weather.serialize();
      saveSettings(this.settings);
    } else if (def.weather) {
      this.weather.load(def.weather);
    }

    // Spawn.
    // Starting on the stand is opt-in, so the tutorial, the missions and every
    // existing test still begin lined up on the runway.
    const wantsTaxi = mode === 'free' && (opts.taxi ?? this.settings.startAtGate);
    const spawn = def.spawn || RUNWAY_START;
    const airborne = mode === 'free' ? !!opts.airborne : spawn.altAGL != null;
    if (mode === 'free' && airborne) {
      this.aircraft.reset({
        pos: new THREE.Vector3(-3400, 0, 300),
        headingDeg: 90,
        speed: 60,
        altAGL: 610,
        engineOn: true,
        fuel: opts.fuel != null ? Math.max(0.05, Math.min(1, opts.fuel)) : 1,
      });
      this.aircraft.controls.throttle = 0.7;
      this.input.throttleTarget = 0.7;
    } else {
      this.aircraft.reset({
        pos: spawn.pos ? spawn.pos.clone() : RUNWAY_START.pos.clone(),
        headingDeg: spawn.headingDeg ?? 90,
        speed: spawn.speed || 0,
        altAGL: spawn.altAGL ?? null,
        engineOn: spawn.engineOn !== false,
        // How much fuel you asked for. Free Flight only; the tutorial and the
        // missions always start with full tanks.
        fuel: mode === 'free' && opts.fuel != null ? Math.max(0.05, Math.min(1, opts.fuel)) : 1,
      });
      if (spawn.speed) {
        this.aircraft.controls.throttle = 0.65;
        this.input.throttleTarget = 0.65;
      } else {
        this.input.throttleTarget = 0;
      }
    }
    this.aircraft.mode = this.settings.flightMode;
    this.aircraft.difficulty = this.settings.difficulty || 'normal';
    this.input.out.throttle = this.aircraft.controls.throttle;

    // Camera: cockpit for the tutorial (you learn the instruments), chase otherwise.
    this.rig.setMode(mode === 'tutorial' ? 'chase' : 'chase');
    this.rig.reducedMotion = this.settings.reducedMotion;

    /*
     * The music follows the flight now, instead of stopping when one starts.
     *
     * It used to be a menu-only pad: this line killed it the moment anybody
     * flew anywhere, so the twenty minutes a child actually spends in the
     * game had no music at all. music.js has a scene for every mission, the
     * tutorial, free flight and each of the other vehicles; all this has to
     * do is name the one we are about to fly and keep it playing.
     */
    if (this.audio.available && this.settings.music) {
      const scene = mode === 'mission' ? (def && def.id) || 'free' : mode === 'tutorial' ? 'tutorial' : 'free';
      this.audio.music.setScene(scene);
      this.audio.music.start();
    }

    if (def.steps && def.steps.length) {
      this.runner.start(def);
    } else {
      this.runner.status = STATUS.IDLE;
      this.runner.def = null;
      this.runner.clearGates();
      this.hud.setObjective(
        'Free Flight',
        airborne
          ? 'You are already flying. Explore the islands, then land back on runway 09 when you like.'
          : 'Take off from runway 09, explore the islands, and land whenever you like.'
      );
    }

    this.state = 'flying';
    if (wantsTaxi) this.taxi.start();
    this.clock.getDelta();
  }

  restart() {
    if (this.mode) this.startMode(this.mode, this.modeOpts);
    else this.quitToMenu('main');
  }

  returnToAirport() {
    this.aircraft.reset({ ...RUNWAY_START, engineOn: true });
    this.input.throttleTarget = 0;
    this.atc.reset();
    this.removeCrate();
    this.hud.clearTransient();
    this.hud.notify('Back on runway 09, ready to go again.', 'info', 3.4);
    if (this.runner.status === STATUS.RUNNING) {
      // Restart the current mission from the top: fairer than resuming mid-step.
      this.runner.start(this.runner.def);
    }
    this.state = 'flying';
    this.menus.hide();
    this.hud.setVisible(true);
  }

  quitToMenu(screen = 'main') {
    this.clearPursuer();
    this.restoreChosenMap();
    this.state = 'menu';
    this.mode = null;
    this.runner.status = STATUS.IDLE;
    this.runner.clearGates();
    this.removeCrate();
    this.hud.setVisible(false);
    this.hud.hideControls();
    this.menus.syncProgress(this.progress);
    this.menus.show(screen);
    if (this.audio.available && this.settings.music) this.audio.music.start();
    this.aircraft.reset({ ...RUNWAY_START, engineOn: true });
  }

  pause() {
    if (this.state !== 'flying') return;
    this.state = 'paused';
    // Always a way out. If the interface is hidden for a clean shot, pausing
    // brings it back — otherwise a player who forgets the key is stuck looking
    // at a game with no controls and no menu.
    if (this.hud.hidden) {
      this.hud.setHidden(false);
      this.hud.notify('Interface restored — press U to hide it again', 'info', 3);
    }
    this.menus.syncTriggers(this.mode === 'free', this.aircraft.failures);
    this.menus.syncNatural(this.activeEvents);
    this.menus.syncAutopilot(this.autopilot.engaged, this.autopilot.mode);
    this.menus.syncRealisticCockpit(!!this.settings.realisticCockpit);
    // From the setting itself, so the label can never drift out of step with
    // what the input layer is actually doing.
    this.input.freeLook = !!this.settings.freeLook;
    this.menus.syncFreeLook(this.input.freeLook);
    const r = this.aircraft.readouts();
    this.menus.setPauseInfo(`
      <div class="pause-grid">
        <span>Speed<b>${Math.round(r.iasKts)} kt</b></span>
        <span>Height<b>${Math.round(r.altFt).toLocaleString('en-GB')} ft</b></span>
        <span>Heading<b>${String(Math.round(r.heading)).padStart(3, '0')}°</b></span>
        <span>Fuel<b>${Math.round(r.fuelPct * 100)}%</b></span>
        <span>Wind<b>${Math.round(this.weather.windSpeedKts)} kt</b></span>
        <span>View<b>${VIEW_LABELS[this.rig.mode]}</b></span>
      </div>
    `);
    this.menus.show('pause');
    this.audio.available && this.audio.mixer.suspend();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.menus.hide();
    this.hud.setVisible(true);
    this.state = 'flying';
    this.clock.getDelta();
    this.wakeAudio();
  }

  /**
   * Un-suspend the mixer.
   *
   * pause() suspends it and only resume() ever brought it back, so leaving the
   * pause screen by Restart, Return to airport or Quit left the game silent
   * for the rest of the session — including every flight after it, with no way
   * back short of reloading the page.
   */
  wakeAudio() {
    if (this.audio.available) this.audio.mixer.resume();
  }

  pauseAction(a) {
    if (a === 'freelook') {
      const on = !this.settings.freeLook;
      this.applySetting('freeLook', on);
      this.menus.syncFreeLook(on);
      return;
    }
    if (a === 'realistic') {
      const on = !this.settings.realisticCockpit;
      this.applySetting('realisticCockpit', on);
      this.menus.syncRealisticCockpit(on);
      return;
    }
    // Every way out of the pause screen, not just Resume.
    this.wakeAudio();
    if (a === 'resume') this.resume();
    else if (a === 'restart') {
      this.menus.hide();
      this.restart();
    } else if (a === 'airport') this.returnToAirport();
    else if (a === 'quit') this.quitToMenu('main');
  }

  hudAction(a) {
    switch (a) {
      case 'pause':
        this.state === 'paused' ? this.resume() : this.pause();
        break;
      case 'camera':
        this.hud.notify(`View: ${VIEW_LABELS[this.rig.cycle()]}`, 'info', 1.8);
        break;
      case 'restart':
        this.restart();
        break;
      case 'airport':
        this.returnToAirport();
        break;
      case 'mute':
        this.settings.muted = !this.settings.muted;
        this.audio.setMuted(this.settings.muted);
        this.hud.setMuted(this.settings.muted);
        this.menus.syncSound(this.settings.muted);
        saveSettings(this.settings);
        break;
      case 'guide':
        this.toggleGuide();
        break;
      case 'autopilot':
        this.toggleAutopilot();
        break;
      case 'skipTaxi':
        this.taxi.skip();
        break;
      /*
       * Starting the engine and letting go of a store had no on-screen route
       * at all — both were bound to a key and nothing else. That made the
       * tutorial's second step unreachable on an iPad, and Mango Cay Delivery
       * and the Weapons Range unfinishable. Same behaviour as the keys, so
       * there is one rule for what these do and not two.
       */
      case 'starter':
        if (this.aircraft.engineOn) this.aircraft.stopEngine('shutdown');
        else this.aircraft.startEngine();
        break;
      case 'drop':
        if (!this.dropCargo()) this.hud.notify('Nothing to drop right now', 'info', 2);
        break;
      case 'gear':
        if (!this.aircraft.toggleGear()) {
          this.hud.notify('Too fast for the landing gear — slow down first', 'warn', 3);
        }
        break;
      case 'flaps': {
        // One button, so it walks down through the settings and wraps around.
        const ac = this.aircraft;
        const next = ac.flapStep() >= 3 ? 0 : ac.flapStep() + 1;
        const set = ac.setFlaps(next);
        this.audio.available && this.audio.ambience.playFlaps();
        this.hud.notify(`Flaps ${set * 10}°`, 'info', 2);
        break;
      }
      case 'hideUi':
        // Cinematic view. The button disappears along with everything else, so
        // the keyboard is the only way back — say so before it goes.
        this.toggleHideUi();
        break;
      case 'help':
        this.hud.toggleControls(this.input.bindings, keyLabel, ACTIONS);
        break;
      case 'brace':
        this.braceForImpact();
        break;
      case 'minimap': {
        const on = this.minimap.toggle();
        // Remember it, so turning it off stays off and turning it on stays on.
        this.settings.minimap = on;
        saveSettings(this.settings);
        this.syncMinimapClass();
        // So the box in Settings matches what the J key just did.
        this.menus.syncSettings(this.settings);
        this.hud.notify(on ? 'Minimap on — K changes the range' : 'Minimap off', 'info', 2.2);
        break;
      }
      case 'minimapRange': {
        const span = this.minimap.cycleRange();
        this.hud.notify(`Minimap range ${span >= 1000 ? span / 1000 + ' km' : span + ' m'}`, 'info', 1.8);
        break;
      }
      case 'keys': {
        const on = this.hud.toggleKeyMonitor();
        this.hud.notify(
          on ? 'Key monitor on — it shows what you are pressing' : 'Key monitor off',
          'info',
          2.4
        );
        break;
      }
    }
  }

  /** Hide the whole interface for a clean shot. U is the way back. */
  /** The minimap follows the interface: hidden with it, faulty with it. */
  syncMinimapChrome() {
    if (!this.minimap) return;
    this.minimap.setSuppressed(!!this.hud.hidden);
    this.minimap.setFaulty(this.instrumentBlackout > 0);
  }

  toggleHideUi() {
    const hidden = this.hud.toggleHidden();
    if (!hidden) this.hud.notify('Interface back on', 'info', 1.6);
    // Before the return. The minimap is not inside the HUD wrapper, so hiding
    // the interface left it sitting on screen on its own.
    this.syncMinimapChrome();
    return hidden;
  }

  toggleGuide() {
    const on = this.navGuide.toggle();
    this.settings.guidance = on;
    saveSettings(this.settings);
    this.hud.setGuideActive(on);
    this.hud.notify(
      on ? 'Guidance lines on — fly between them' : 'Guidance lines off',
      'info',
      2.4
    );
    return on;
  }

  /**
   * Autopilot. Holds the wings level and the height steady, and steers towards
   * whatever you are supposed to be heading for. Touching the stick switches it
   * off, exactly like the real thing — you should never have to fight it.
   */
  toggleAutopilot(force) {
    // Nothing to fly on while the instruments are out.
    if (this.instrumentBlackout > 0 && force !== false && !this.autopilot.engaged) {
      this.hud.notify('Autopilot unavailable — instruments are out', 'warn', 3);
      return false;
    }
    const want = force === undefined ? !this.autopilot.engaged : !!force;
    if (want && this.aircraft.onGround) {
      this.hud.notify('Autopilot needs you to be flying first', 'warn', 2.6);
      return false;
    }
    const on = this.autopilot.setEngaged(want, this.aircraft);
    this.hud.setAutopilot(on);
    if (on) {
      this.hud.notify(
        `Autopilot on — holding ${Math.round(this.autopilot.targetAltFt)} ft. Move the stick to take over.`,
        'good',
        4
      );
    } else {
      this.hud.notify('Autopilot off — you have control', 'info', 2.4);
    }
    this.audio.available && this.audio.alerts.uiClick();
    // Before the return, not after it. This line sat below `return on;` where
    // it could never run, so pressing an autopilot button in the pause menu
    // changed the autopilot and left every button in the menu looking exactly
    // as it had — no FLYING tag, no highlight, nothing.
    this.menus.syncAutopilot(this.autopilot.engaged, this.autopilot.mode);
    return on;
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  applySetting(path, value) {
    const parts = path.split('.');
    let obj = this.settings;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    saveSettings(this.settings);

    if (path.startsWith('volumes.')) {
      this.audio.setVolume(parts[1], value);
    } else if (path === 'muted') {
      this.audio.setMuted(value);
      this.hud.setMuted(value);
    } else if (path.startsWith('soundOn.')) {
      // A source switched on or off. The volume it had is remembered, so
      // switching it back on returns it to where you left it.
      const bus = path.slice('soundOn.'.length);
      this.audio.mixer.setBusEnabled(bus, !!value);
      if (bus === 'music') {
        this.audio.setMusicEnabled(!!value && this.settings.music !== false);
        if (!value) this.audio.music.stop();
        else if (this.state === 'menu') this.audio.music.start();
      }
    } else if (path === 'music') {
      this.audio.setMusicEnabled(value);
      if (value && this.state === 'menu') this.audio.music.start();
    } else if (path === 'atcVoice') {
      this.audio.radio.setMode(value);
      this.hud.notify(
        value === 'speech'
          ? "ATC now uses your device's speech voice"
          : value === 'recordings'
            ? 'ATC will play your own clips from assets/atc/ where you have them'
            : 'ATC back to the synthesised radio',
        'info',
        3.2
      );
    } else if (path === 'atcChatter') {
      this.audio.radio.backgroundChatter = value;
    } else if (path === 'flightMode') {
      this.aircraft.mode = value;
      this.hud.notify(
        value === 'simplified'
          ? 'Easy mode: the aeroplane helps keep the wings level.'
          : 'Real mode: full control — it can stall now.',
        'info',
        4
      );
    } else if (path === 'quality') {
      this.rebuildQuality(value);
    } else if (path === 'subtitles') {
      this.hud.setSubtitlesEnabled(value);
    } else if (path === 'highContrast') {
      this.hud.setHighContrast(value);
      document.body.classList.toggle('is-contrast', !!value);
    } else if (path === 'largeText') {
      this.hud.setLargeText(value);
      document.body.classList.toggle('is-large', !!value);
    } else if (path === 'guidance') {
      this.navGuide.setEnabled(value);
      this.hud.setGuideActive(value);
    } else if (path === 'freeLook') {
      this.input.freeLook = value;
      this.hud.notify(
        value
          ? 'Free look on — move the mouse or use the arrow keys to look around'
          : 'Free look off — the arrow keys are the throttle again',
        'info',
        3.4
      );
    } else if (path === 'damageModel') {
      this.aircraft.survivableStrikes = !!value;
      if (!value) for (const k in this.aircraft.damage) this.aircraft.damage[k] = 0;
      this.hud.setDamage(value ? this.aircraft.damage : null);
      this.hud.notify(
        value
          ? 'Damage on — a knock may not end the flight now'
          : 'Damage off — any contact ends the flight again',
        'info',
        3.4
      );
    } else if (path === 'minimap') {
      this.minimap.toggle(!!value);
      this.syncMinimapClass();
    } else if (path === 'fleetModels') {
      // Rebuild the aeroplane so the change is visible now rather than at the
      // next flight — a model option that does not change the model is broken
      // in exactly the way the cockpit option used to be.
      setFleetModels(value);
      // Only rebuild if there is something to rebuild: the switch lives in the
      // menus, and from the main screen no aeroplane has been chosen yet.
      if (this.aircraftType) {
        const id = this.aircraftType.id;
        this.aircraftType = null;
        this.setAircraft(id);
      }
      this.hud.notify(
        value ? 'Using the new aeroplane models' : 'Back to the original aeroplane models',
        'info',
        3
      );
    } else if (path === 'realisticCockpit') {
      if (this.rig) this.rig.realisticCockpit = !!value;
      /*
       * Switching it on puts you in the cockpit.
       *
       * It set a flag on the camera rig and nothing else, so from the chase
       * view — which is where everyone is — turning on "realistic cockpit"
       * appeared to do absolutely nothing, and you had to know to press C
       * afterwards. A view option that does not change the view is broken,
       * whatever the flag says.
       */
      if (value && this.rig && this.rig.mode !== 'cockpit') {
        this.rig.setMode('cockpit');
        this.hud.notify('Cockpit view — press C to look from outside again', 'info', 3);
      }
      if (this.hud) this.hud.setMinimal(!!value && this.rig && this.rig.mode === 'cockpit');
    } else if (path === 'livery') {
      /*
       * Repainting means rebuilding the model.
       *
       * setAircraft early-returns when the id is unchanged, so it cannot do
       * this job — choosing a new scheme for the aeroplane you are already in
       * would silently do nothing. Forcing the type to null makes the rebuild
       * run for real.
       */
      const id = this.aircraftType.id;
      this.aircraftType = null;
      this.setAircraft(id);
      this.menus.repaintFleetArt && this.menus.repaintFleetArt(value);
      this.hud.notify(`Repainted — ${findLivery(value).name}`, 'info', 3);
    } else if (path === 'difficulty') {
      this.applyDifficulty(value);
    } else if (path === 'realisticFuel') {
      this.aircraft.realisticFuel = value;
      this.hud.notify(
        value
          ? 'Realistic fuel on — a full tank lasts about 50 minutes. Watch the gauge.'
          : 'Realistic fuel off',
        'info',
        3.5
      );
    } else if (path === 'randomWinds') {
      this.weather.setRandomWinds(value);
      this.hud.notify(
        value
          ? 'Random winds on — expect gusts. Watch the wind arrow.'
          : 'Random winds off — steady wind again',
        'info',
        3.5
      );
    } else if (path === 'reducedMotion') {
      this.rig.reducedMotion = value;
    } else if (path === 'mouseFlying') {
      this.input.requestMouseFlying(value);
    } else if (path === 'invertMouse') {
      this.input.invertMouse = value;
    } else if (path === 'sensitivity') {
      this.input.sensitivity = value;
    } else if (path === 'gamepad') {
      this.input.gamepadEnabled = value;
    }
  }

  rebuildQuality(quality) {
    if (quality === this.qualityBuilt) return;
    this.hud.notify('Rebuilding the island…', 'info', 2.5);
    // Give the message a frame to paint before the (blocking) rebuild — but
    // race it against a timer. This is triggered straight from a <select>, and
    // while a native dropdown is open the browser stops servicing
    // requestAnimationFrame, so the callback never ran and the world was never
    // rebuilt. From the outside that looks exactly like the game freezing the
    // moment you choose something. `frame()` already does this for loading.
    this.afterPaint(() => {
      this.buildWorld(quality);
      this.renderer.shadowMap.enabled = quality !== 'low';
      this.renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, quality === 'ultra' ? 3 : quality === 'high' ? 2 : 1.25)
      );
      /*
       * And the textures with it.
       *
       * Switching to Ultra from inside the game used to drop the pixel ratio
       * to 1.25 — 'ultra' is not 'high', so the old test took the low branch
       * and the best setting in the game rendered at less than half the
       * resolution of the one below it.
       */
      try {
        setTextureAnisotropy(quality === 'ultra' ? this.renderer.capabilities.getMaxAnisotropy() : 4);
      } catch (e) {
        /* a card that will not answer keeps the safe default */
      }
      this.sky.update(this.weather);
    });
  }

  /**
   * Fly somewhere else. The runway is identical on every map, so the tutorial,
   * every mission and the landing scoring all carry over untouched — only the
   * land around the field changes.
   */
  /**
   * Choose which aeroplane to fly.
   *
   * A different aeroplane is a different flight model *and* a different model
   * on screen, so both are replaced. The old one is disposed rather than just
   * detached — leaked geometry is what used to make the sea flicker after a
   * long session, and there is no reason to relearn that lesson here.
   */
  setAircraft(id) {
    const want = getAircraft(id);
    if (this.aircraftType && this.aircraftType.id === want.id) return this.aircraftType;
    this.aircraftType = applyAircraft(want.id);
    const S = this.aircraftType.shape;

    if (this.model) {
      this.scene.remove(this.model);
      const seen = new Set();
      this.model.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) {
          seen.add(o.geometry);
          o.geometry.dispose();
        }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          m.dispose();
        }
      });
    }

    this.model = createAircraftModel({
      type: this.aircraftType,
      livery: schemeFor(this.aircraftType, this.settings.livery),
    });
    this.scene.add(this.model);
    this.cockpit = createCockpit({ highContrast: this.settings.highContrast, type: this.aircraftType });
    // The airframe is scaled to size; the cockpit is not. There is one
    // instrument panel and the pilot is the same size in all five aeroplanes,
    // so it is counter-scaled back to life size.
    this.cockpit.scale.setScalar(1 / S.scale);
    /*
     * ...and then moved so its own eye point lands where *this* aeroplane's
     * pilot actually sits. Without this the panel stays bolted to the centre
     * of gravity: fine in the trainer, where the two coincide, and three
     * metres behind your head in the airliner.
     *
     * `eye` here is in FINAL metres. types.js stores it pre-scale, so the old
     * figure is scaled up; a fleet model measures its own and needs no
     * scaling. That distinction matters: the fleet aeroplanes are longer, and
     * reusing the old eye put the pilot eight metres back in the Meridian's
     * cabin, staring at the inside of the flight-deck wall.
     */
    const eye = eyeFor(this.model, [S.eye[0] * S.scale, S.eye[1] * S.scale, S.eye[2] * S.scale]);
    const TRAINER_EYE = [-0.24, 0.46, 0.06];
    this.cockpit.position.set(
      eye[0] / S.scale - TRAINER_EYE[0] / S.scale,
      eye[1] / S.scale - TRAINER_EYE[1] / S.scale,
      eye[2] / S.scale - TRAINER_EYE[2] / S.scale
    );
    this.model.add(this.cockpit);
    this.cockpit.visible = false;

    // How far the picture has to drop so the wheels meet the tarmac.
    // specFor rebuilds the flight spec from the same shape the physics uses,
    // so the gear points compared here are exactly the ones it lands on.
    this.model.userData.groundOffsetY = groundOffsetFor(this.model, specFor(this.aircraftType.id));

    if (this.rig) {
      this.rig.eye.set(eye[0], eye[1], eye[2]);
      this.rig.realisticCockpit = !!this.settings.realisticCockpit;
    }
    if (this.hud) this.hud.setAircraftName(this.aircraftType.name);
    // A rotor is not a piston engine. Without this the helicopter keeps the
    // four-cylinder synth and the blade slap is never reached.
    if (this.audio) this.audio.setEngineKind(S.power.rotor ? 'rotor' : S.power.kind);

    /*
     * Re-seat the aeroplane if it is sitting on the ground.
     *
     * Swapping to a taller aeroplane left it at the previous one's spawn
     * height with the new one's undercarriage, which drove the nose straight
     * into the tarmac — an instant "The nose struck the ground" before you had
     * touched anything. Nothing a player can reach today does this, because
     * the fleet is chosen before the flight starts, but it is a loaded gun
     * lying around for the next mission that changes aeroplane mid-flight.
     */
    if (this.aircraft && this.aircraft.onGround && !this.aircraft.crashed) {
      /*
       * reset() clears every failure and fills the tank, which is right when a
       * flight begins and quite wrong here: repainting the aeroplane on the
       * stand silently refuelled you and cancelled the engine failure you had
       * armed. So both are carried across.
       */
      const keptFailures = { ...this.aircraft.failures };
      const keptFuel = this.aircraft.fuelFraction();
      this.aircraft.reset({
        pos: this.aircraft.pos.clone(),
        headingDeg: this.aircraft.readouts().heading,
        speed: this.aircraft.groundSpeed,
        engineOn: this.aircraft.engineOn,
        fuel: keptFuel,
      });
      Object.assign(this.aircraft.failures, keptFailures);
    }
    return this.aircraftType;
  }

  /**
   * Fire any failure that was armed before the flight and whose time has come.
   * The clock only runs once you are airborne — "after five minutes" should
   * not tick away while you are still on the stand.
   */
  /**
   * Set how much the aeroplane helps.
   *
   * Easy and normal both fly the simplified model — the difference is how much
   * it does for you. Realistic is the assists off entirely, which is what the
   * old 'realistic' flight mode always was, so the two settings are folded
   * into one dial rather than being two overlapping switches.
   */
  applyDifficulty(level) {
    const lv = ['easy', 'normal', 'realistic'].includes(level) ? level : 'normal';
    this.settings.difficulty = lv;
    this.settings.flightMode = lv === 'realistic' ? 'realistic' : 'simplified';
    this.aircraft.mode = this.settings.flightMode;
    this.aircraft.difficulty = this.settings.difficulty || 'normal';
    this.aircraft.difficulty = lv;
    saveSettings(this.settings);
    if (this.hud) {
      this.hud.notify(
        lv === 'easy'
          ? 'Easy — the aeroplane helps you rotate, flare and stay out of a stall'
          : lv === 'realistic'
            ? 'Realistic — no assistance at all. It can stall and it will drift.'
            : 'Normal — gentle help, the way the game has always flown',
        'info',
        4
      );
    }
    return lv;
  }

  updateArmedFailures(dt) {
    const ac = this.aircraft;
    // Two clocks. The flight clock only runs once you are actually airborne,
    // because "after five minutes of flight" should not tick away while you
    // are still taxiing. But anything armed for *straight away* used to wait
    // on that same clock, so it sat there doing nothing until you took off —
    // which reads as broken rather than as waiting. Zero now means zero.
    this._groundT = (this._groundT || 0) + dt;
    if (!this._hasFlown && ac.agl > 8) this._hasFlown = true;
    if (this._hasFlown) this._armedT += dt;
    const due = (a) => (a.afterMin > 0 ? this._hasFlown && this._armedT >= a.afterMin * 60 : this._groundT >= 2.5);

    for (const id of Object.keys(this.armedEvents || {})) {
      const a = this.armedEvents[id];
      if (!due(a)) continue;
      delete this.armedEvents[id];
      this.triggerNatural(id);
    }
    const armed = this.armed;
    if (!armed) return;
    for (const kind of Object.keys(armed)) {
      const a = armed[kind];
      if (!due(a)) continue;
      delete armed[kind];
      if (kind === 'fuelLeak' && a.amountMin) ac.fuelLeakSeconds = a.amountMin * 60;
      if (!ac.failures[kind]) this.toggleFailure(kind);
    }
  }

  /**
   * Roll the dice. Only when you have asked for it, only while airborne, and
   * never twice for the same thing.
   */
  /**
   * The mountain's own business, which runs whether or not you asked for
   * random disasters — an active volcano does not wait to be switched on.
   *
   * Two rules: it erupts every few minutes on a map that has one, and flying
   * near the crater always puts you in ash. The second is not a dice roll. If
   * you fly through the column over a live vent, your engine eats it; the game
   * should not sometimes let you get away with that.
   */
  updateVolcano(dt) {
    if (!MAP.features || !MAP.features.volcano || !this._hasFlown) return;
    const ac = this.aircraft;
    if (ac.crashed || this.state !== 'flying') return;

    // The cone itself — the first volcano in the list is the big one.
    const isl = (MAP.islands || []).find((i) => i.name === MAP.features.volcano[0].island) || MAP.islands[0];
    if (!isl) return;
    const dist = Math.hypot(ac.pos.x - isl.cx, ac.pos.z - isl.cz);

    // Near the core: always ash, every time, for as long as you stay there.
    const inPlume = dist < isl.radius * 0.55 && ac.pos.y < isl.peak + 1400;
    if (inPlume) {
      this._ashDwell = (this._ashDwell || 0) + dt;
      if (this._ashDwell > 2.5 && !this.activeEvents?.ashCloud) {
        this.triggerNatural('ashCloud');
        this.hud.notify('You are in the ash column — the engine is eating it', 'warn', 5);
      }
    } else {
      this._ashDwell = 0;
    }

    // And every so often, it goes up.
    this._eruptT = (this._eruptT || 0) + dt;
    if (this._eruptT > (this._nextErupt || 300)) {
      this._eruptT = 0;
      this._nextErupt = 260 + Math.random() * 320;
      this.triggerNatural('eruption');
    }

    // While it is erupting the air over the cone is a chimney: a huge
    // updraught in the middle, and the ash reaches much further out.
    if (this.erupting > 0) {
      this.erupting -= dt;
      const reach = isl.radius * 1.25;
      if (dist < reach && ac.pos.y < isl.peak + 2600) {
        const f = 1 - dist / reach;
        ac.vel.y += 12 * f * dt;
        this.rig.kick(f * 0.5 * dt * 6);
        if (dist < isl.radius * 0.75) this._ashDwell = (this._ashDwell || 0) + dt * 2;
      }
    }
  }

  updateRandomDisasters(dt) {
    if (!this.randomDisasters || !this._hasFlown) return;
    const ac = this.aircraft;
    // A storm roughly halves the time between events; clear air stretches it.
    // Worse weather and a harder map both make things happen more often —
    // which is what choosing Ember Isle over Harrier Flats ought to mean.
    const severity =
      (1 + (this.weather.cond.turb || 0) * 0.9 + (this.weather.cond.cloud || 0) * 0.35) *
      severityForMap(MAP);
    this._disasterT += dt * severity;
    if (this._disasterT < this._nextDisaster) return;
    this._disasterT = 0;
    this._nextDisaster = 240 + Math.random() * 300;

    // Roughly half mechanical, half meteorological.
    const spare = Object.keys(ac.failures).filter((k) => !ac.failures[k]);
    const events = poolForMap(MAP);
    const useWeather = events.length && (!spare.length || Math.random() < 0.5);
    if (useWeather) {
      this.triggerNatural(events[Math.floor(Math.random() * events.length)].id);
      return;
    }
    if (!spare.length) return;
    const pick = spare[Math.floor(Math.random() * spare.length)];
    if (pick === 'fuelLeak') ac.fuelLeakSeconds = 180 + Math.random() * 240;
    this.toggleFailure(pick);
  }

  /**
   * Set a natural disaster going. Unlike the mechanical failures these are not
   * toggles — weather happens to you and then it is over.
   */
  triggerNatural(id) {
    const ev = findEvent(id);
    if (!ev) return;
    ev.apply(this);
    // Remember it is running so the pause menu can show which ones are live.
    this.activeEvents = this.activeEvents || {};
    this.activeEvents[id] = ev.duration || 8;
    this.menus.syncNatural(this.activeEvents);
    this.hud.notify(ev.warn, ev.kind === 'bad' ? 'warn' : 'warn', 5);
    if (this.audio.available) this.audio.alerts.caution && this.audio.alerts.caution();
  }

  /**
   * Break something on purpose, or put it back. Free Flight only — an engine
   * failure in the middle of a lesson is not a lesson.
   */
  toggleFailure(kind) {
    const f = this.aircraft.failures;
    if (!(kind in f)) return;
    f[kind] = !f[kind];
    const on = f[kind];
    const words = {
      engine: ['Engine failure — trim for best glide and pick a field', 'Engine restored'],
      fuelLeak: ['Fuel leak — watch the gauge, you have minutes', 'Leak stopped'],
      elevator: ['Elevator jammed — fly it on power and trim', 'Elevator freed'],
      icing: ['Picking up ice — it will stall earlier than usual', 'Ice gone'],
      gear: ['Undercarriage jammed', 'Undercarriage freed'],
      brakes: ['Brakes have failed — plan a long roll-out', 'Brakes restored'],
      roughEngine: ['Engine running rough — part power only, pick somewhere close', 'Engine smooth again'],
      tyre: ['Burst tyre — it will pull hard to the left on the ground', 'Tyre changed'],
    };
    if (on && kind === 'engine') this.aircraft.stopEngine('failure');
    this.hud.notify(words[kind][on ? 0 : 1], on ? 'warn' : 'good', 4);
    this.menus.syncTriggers(this.mode === 'free', f);
  }

  setMap(id) {
    const def = applyMap(id);
    this.layRoads();
    // The field moved. Tell the modules that cached its height.
    refreshRunways();
    refreshApronElevation();
    this.settings.map = def.id;
    saveSettings(this.settings);
    this.menus.syncMap(def.id);
    if (this.state === 'flying') this.quitToMenu();
    this.hud.notify(`Flying to ${def.name}…`, 'info', 3);
    // One frame so the message paints before the (blocking) rebuild, raced
    // against a timer for the same reason as above.
    this.afterPaint(() => {
      this.buildWorld(this.settings.quality);
      // Each map has weather that suits it; the player can still change it in
      // Free Flight afterwards.
      this.weather.load({
        time: def.weather.time,
        condition: def.weather.cond,
        windSpeedKts: def.weather.windSpeedKts,
        windDirDeg: def.weather.windDirDeg,
      });
      this.settings.weather = this.weather.serialize();
      saveSettings(this.settings);
      this.menus.syncSettings(this.settings);
      this.sky.update(this.weather);
      this.aircraft.reset({ ...RUNWAY_START, engineOn: true });
      this.hud.clearTransient();
      this.hud.notify(`${def.name} — ${def.subtitle}`, 'good', 5);
    });
    return def;
  }

  async unlockAudio() {
    if (this.audio.started || this._unlocking) return;
    this._unlocking = true;
    const ok = await this.audio.start();
    this._unlocking = false;
    if (!ok) {
      this.hud && this.hud.notify('Sound is unavailable in this browser — everything else still works.', 'warn', 6);
      return;
    }
    for (const bus in this.settings.volumes) this.audio.setVolume(bus, this.settings.volumes[bus]);
    this.audio.setMuted(this.settings.muted);
    this.audio.setMusicEnabled(this.settings.music);
    // Restore each source's on/off switch.
    const on = this.settings.soundOn || {};
    for (const bus of ['engine', 'environment', 'atc', 'alerts', 'music']) {
      this.audio.mixer.setBusEnabled(bus, on[bus] !== false);
    }
    this.audio.radio.backgroundChatter = this.settings.atcChatter;
    this.audio.radio.setMode(this.settings.atcVoice || 'radio');
    if (this.settings.music && this.state === 'menu') this.audio.music.start();
  }

  /* ------------------------------------------------------------------ */
  /* PWA                                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Catch a whole class of bug that has now bitten this project twice: a
   * full-screen panel carrying the `hidden` attribute, whose class also sets
   * `display`, which beats `[hidden]` and leaves an invisible — or worse, a
   * near-opaque black — sheet over the entire game swallowing every click.
   *
   * Cheap, runs once, and says exactly which element is at fault.
   */
  checkForStuckOverlays() {
    try {
      for (const el of document.querySelectorAll('[hidden]')) {
        if (getComputedStyle(el).display !== 'none') {
          console.error(
            `[island-flight] "${el.id || el.className}" has the hidden attribute but is still ` +
              `displayed (display: ${getComputedStyle(el).display}). Add a ` +
              `"${el.id ? '#' + el.id : '.' + el.className.split(' ')[0]}[hidden] { display: none; }" rule.`
          );
        }
      }
      // And confirm nothing is sitting on top of the middle of the screen.
      const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      if (top && top.id === 'fatal') {
        console.error('[island-flight] the error panel is covering the game — see above.');
      }
    } catch {
      /* diagnostics must never break the game */
    }
  }

  setupPwa() {
    /*
     * Disabled in this copy, 2026-09-20, and it is the only edit to the
     * delivered tree.
     *
     * This build is served from /gpt/ beside the game it is being compared
     * with, on the same origin. Registering a second worker here would put
     * two of them on one origin, and the ?dev branch below calls
     * caches.delete on EVERY cache key it finds — including the real game's
     * — so opening the comparison build to look at it would have emptied
     * the offline cache of the build the class plays. Nothing else in this
     * tree is changed; see ../DELIVERY-GPT.md.
     */
    return;
    // eslint-disable-next-line no-unreachable
    // ?dev=1 skips (and clears) the service worker. Cache-first offline support
    // is exactly what you want for players and exactly what you do not want
    // while editing the game, because reloads keep serving the old files.
    const params = new URLSearchParams(location.search);
    const devMode = params.has('dev');
    // Inside the native macOS app the game is served over a private URL
    // scheme, where service workers neither work nor are needed — the whole
    // thing is already on disk. Registering would only throw.
    if (!/^https?:$/.test(location.protocol)) return;
    if ('serviceWorker' in navigator && devMode) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
      console.info('[dev] service worker disabled for this session');
    } else if ('serviceWorker' in navigator) {
      // A new version has to be able to replace an old one even if the old one
      // is misbehaving. Check on every load, and reload once as soon as a new
      // worker takes over — otherwise the page you are looking at keeps the
      // files it was given, and an update can appear to do nothing at all.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (this._reloadingForUpdate) return;
        this._reloadingForUpdate = true;
        console.info('[sw] new version installed — reloading');
        location.reload();
      });
      // Boot is async and takes a second or two, so the window 'load' event has
      // usually already fired by the time we get here — registering on that
      // event alone means it never happens and offline play silently breaks.
      const register = () =>
        navigator.serviceWorker
          .register('sw.js')
          .then((reg) => reg.update())
          .catch((err) => {
            console.warn('Offline support unavailable:', err);
          });
      if (document.readyState === 'complete') register();
      else window.addEventListener('load', register, { once: true });
    }

    // Escape hatch. If a cached copy ever goes wrong, ?reset=1 throws away
    // every service worker and cache and reloads clean.
    if (params.has('reset')) {
      const wipe = async () => {
        if ('serviceWorker' in navigator) {
          const rs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(rs.map((r) => r.unregister()));
        }
        if (window.caches) {
          const ks = await caches.keys();
          await Promise.all(ks.map((k) => caches.delete(k)));
        }
        location.replace(location.pathname);
      };
      wipe();
      return;
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e;
      this.menus.showInstall(true);
    });
    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.menus.setInstalled();
    });
    if (window.matchMedia('(display-mode: standalone)').matches) this.menus.setInstalled();
  }

  async promptInstall() {
    if (!this.installPrompt) {
      alert(
        'Your browser has not offered an install prompt yet.\n\n' +
          'In Chrome or Edge, use the ⊕ / install icon in the address bar.\n' +
          'On iPhone or iPad, tap Share then "Add to Home Screen".\n\n' +
          'The game caches itself as soon as it loads, so it already works offline.'
      );
      return;
    }
    this.installPrompt.prompt();
    const choice = await this.installPrompt.userChoice;
    if (choice.outcome === 'accepted') this.menus.setInstalled();
    this.installPrompt = null;
  }

  /* ------------------------------------------------------------------ */
  /* Radio + notifications used by missions                              */
  /* ------------------------------------------------------------------ */

  speak(text, voice = 'tower', urgency = 0) {
    if (this.audio.available) this.audio.radio.transmit(text, { voice, urgency });
    else this.hud.setSubtitle(text, voice, 4);
  }

  notify(text, kind = 'info') {
    this.hud.notify(text, kind);
  }

  /**
   * What is aboard, and how much of it.
   *
   * `hasCargo` used to be one boolean: you were given one store, you dropped
   * it, and that was the sortie. One run at the range means one chance to
   * judge a release, which is not how anybody learns to judge a release — and
   * a supply run that ends after a single crate is a strange kind of supply
   * run.
   *
   * So the aeroplane carries what its type says it carries, and the next one
   * comes off the rack once the last has arrived. `hasCargo` still means
   * exactly what it meant — is there one ready right now — so every mission
   * that sets it keeps working, and setting it loads the aeroplane up.
   */
  get hasCargo() {
    return this._armed;
  }

  set hasCargo(v) {
    this._armed = !!v;
    // Loading arms a full rack; unloading empties it. Dropping one is neither,
    // and goes through dropCargo() rather than through here.
    if (v) {
      if (this._storesLeft <= 0) this._storesLeft = this.storeCapacity();
    } else {
      this._storesLeft = 0;
    }
  }

  /** How many an aeroplane of this type carries. */
  storeCapacity() {
    return (this.aircraftType && this.aircraftType.stores) || 1;
  }

  /** How many are left, the one already gone not counted. */
  get storesLeft() {
    return Math.max(0, this._storesLeft);
  }

  /**
   * X: let go of whatever is aboard.
   *
   * On a transport that is a crate under a parachute. On a military aeroplane
   * it is a bomb, which is a different problem entirely: it keeps all of the
   * aeroplane's forward speed, so you have to release well before the target
   * and judge how far ahead. The range mission was dropping a supply crate,
   * which is why it never felt like a bombing run.
   */
  dropCargo() {
    if (!this.hasCargo || this.crate) return false;
    const military = !!(this.aircraftType && this.aircraftType.military);
    // Out of the bay on a bomber, off the belly on everything else.
    const offset = new THREE.Vector3(0, military ? -1.1 : -1.6, military ? 0.4 : 0)
      .applyQuaternion(this.aircraft.quat)
      .add(this.aircraft.pos);
    this.crate = military
      ? new PracticeBomb(this.scene, offset, this.aircraft.vel)
      : new CargoCrate(this.scene, offset, this.aircraft.vel);
    this._armed = false;
    this._storesLeft = Math.max(0, this._storesLeft - 1);
    const left = this._storesLeft;
    this.hud.notify(
      (military ? 'Store away — watch it run on ahead of you' : 'Crate released — parachute out!')
        + (left > 0 ? ` · ${left} left` : ' · last one'),
      'good',
      3
    );
    this.audio.available && this.audio.ambience.playFlaps();
    return true;
  }

  removeCrate() {
    this.crateClear = 0;
    if (this.crate) {
      this.crate.dispose();
      this.crate = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Frame loop                                                          */
  /* ------------------------------------------------------------------ */

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  handleDiscreteInput() {
    const input = this.input;
    const ac = this.aircraft;
    const pad = input.padEdges;

    if (input.pressed('pause') || (pad && pad.pause)) {
      if (this.state === 'flying') this.pause();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'menu' && this.menus.current !== 'main') this.menus.show('main');
    }
    if (this.state !== 'flying') return;

    if (input.pressed('camera') || (pad && pad.camera)) {
      this.hud.notify(`View: ${VIEW_LABELS[this.rig.cycle()]}`, 'info', 1.8);
      this.runner.data.cameraChanged = true;
    }
    if (input.pressed('gear') || (pad && pad.gear)) {
      if (!ac.toggleGear()) this.hud.notify('Too fast for the landing gear — slow down first', 'warn', 3);
    }
    if (input.pressed('flapsDown')) {
      const s = ac.setFlaps(ac.flapStep() + 1);
      this.audio.available && this.audio.ambience.playFlaps();
      this.hud.notify(`Flaps ${s * 10}° — more lift, more drag`, 'info', 2.4);
    }
    if (input.pressed('flapsUp')) {
      const s = ac.setFlaps(ac.flapStep() - 1);
      this.audio.available && this.audio.ambience.playFlaps();
      this.hud.notify(`Flaps ${s * 10}°`, 'info', 2);
    }
    if (input.pressed('starter')) {
      if (ac.engineOn) ac.stopEngine('shutdown');
      else ac.startEngine();
    }
    if (input.pressed('brace')) this.braceForImpact();
    if (this.bracing && !this.braceChoice) {
      if (input.pressed('emergencyLand')) this.chooseBrace('land');
      else if (input.pressed('emergencyCircle')) this.chooseBrace('circle');
    }
    if (input.pressed('drop') || (pad && pad.drop)) {
      if (!this.dropCargo()) this.hud.notify('Nothing to drop right now', 'info', 2);
    }
    if (input.pressed('help')) this.hud.toggleControls(this.input.bindings, keyLabel, ACTIONS);
    if (input.pressed('guide')) this.toggleGuide();
    if (input.pressed('autopilot')) this.toggleAutopilot();
    if (input.pressed('minimap')) this.hudAction('minimap');
    if (input.pressed('minimapRange')) this.hudAction('minimapRange');
    if (input.pressed('hideUi')) this.toggleHideUi();
    if (input.pressed('mute')) this.hudAction('mute');
  }

  /**
   * Take the boat or the car out.
   *
   * The world is already here — the island, the sea, the runway, the town —
   * so a boat sim and a car sim are not separate games needing separate
   * worlds. They are a different thing to be, in the same place, which is a
   * far better answer than three shallow copies of one engine.
   */
  /**
   * Somewhere to put the ship.
   *
   * It was hardcoded at (-5200, 3400) on every map, which is open sea on six
   * of the nine and dry land on the other three: 43 m up a field on the
   * grassland, 25 m up the peninsula at San Francisco, and 632 m up a
   * mountain at the air base. A carrier aground on a hillside is not a thing
   * anyone should have to see, let alone try to land on.
   *
   * A map may name its own berth. Otherwise the default is tried first and, if
   * that is not water, a ring is walked outward until somewhere deep enough
   * for the whole deck footprint turns up.
   */
  carrierBerth() {
    const wetEnough = (x, z) => {
      // Sampled across the deck, not at one point — a ship needs all of it wet.
      for (const [dx, dz] of [[0, 0], [0, -160], [0, 160], [-40, 0], [40, 0]]) {
        if (heightAt(x + dx, z + dz) > -12) return false;
      }
      return true;
    };
    if (MAP.carrier && wetEnough(MAP.carrier.x, MAP.carrier.z)) return MAP.carrier;
    if (wetEnough(-5200, 3400)) return { x: -5200, z: 3400 };

    for (let r = 4000; r <= 14000; r += 1200) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (wetEnough(x, z)) return { x: Math.round(x), z: Math.round(z) };
      }
    }
    // Nowhere wet enough. Put it where it always was and say so, rather than
    // silently beaching it.
    console.warn('No water deep enough for the carrier on this map.');
    return { x: -5200, z: 3400 };
  }

  /**
   * Put back the map the player actually chose.
   *
   * Called when a flight ends. Silent when no mission borrowed one.
   */
  restoreChosenMap() {
    const want = this.mapBeforeMission;
    this.mapBeforeMission = null;
    if (!want || want === this.settings.map) return;
    applyMap(want);
    this.layRoads();
    refreshRunways();
    refreshApronElevation();
    this.settings.map = want;
    saveSettings(this.settings);
    this.menus.syncMap(want);
    this.buildWorld(this.settings.quality);
  }

  /**
   * Put a jet on the player's tail.
   *
   * Owned by the game rather than by the mission, so it is disposed on every
   * path that ends a flight — a pursuer left in the scene would carry on
   * hunting somebody who has gone back to the menu.
   */
  /**
   * A flight of three, close enough to see.
   *
   * One aeroplane at 2,200 m was the whole problem: at that range a jet is a
   * few pixels, so "there is a jet on your tail" was a line of text about
   * something you could not make out. Three of them, starting inside a
   * kilometre and spread across your tail, is the difference between being
   * told you are being chased and being chased.
   *
   * The leader is the bomber and the wingmen are fighters, which is also why
   * the fighters sit wider — they are the ones who will cut you off.
   */
  spawnPursuer() {
    this.clearPursuer();
    /*
     * Close. Much closer than feels reasonable on paper.
     *
     * Photographed at a kilometre in clear air: a fifteen-metre jet is about
     * a pixel and a half, and three of them are three pixels. "There is a jet
     * on your tail" was a caption over an empty sky. At two to three hundred
     * metres they read as aeroplanes, you can tell a bomber from a fighter,
     * and looking back actually means something.
     */
    const flight = [
      { id: 'nightjar', at: 240, side: 0, name: 'Ironhead One' },
      { id: 'vanguard', at: 330, side: -1, name: 'Ironhead Two' },
      { id: 'vanguard', at: 330, side: 1, name: 'Ironhead Three' },
    ];
    this.pursuers = [];
    for (const f of flight) {
      const type = getAircraft(f.id);
      if (!type) continue;
      const p = new Pursuer(this.scene, createAircraftModel, type, { name: f.name });
      p.placeBehind(this.aircraft, f.at);
      // Spread them across your tail rather than stacking them in a line.
      const across = new THREE.Vector3(f.side * 90, f.side === 0 ? 18 : -14, 0)
        .applyQuaternion(this.aircraft.quat);
      p.pos.add(across);
      this.pursuers.push(p);
    }
    // The leader is the one the mission talks about and scores against.
    this.pursuer = this.pursuers[0] || null;
    this.traffic = this.pursuers;
    return this.pursuer;
  }

  clearPursuer() {
    for (const p of this.pursuers || []) p.dispose();
    this.pursuers = [];
    this.pursuer = null;
    this.traffic = [];
  }

  /**
   * Was that a survivable arrival?
   *
   * Three things, and all three are the ones a pilot is taught: wings level,
   * coming down gently, and not too fast. Over water counts as flat ground —
   * a ditching into calm sea is the textbook case.
   */
  braceSurvivable() {
    const ac = this.aircraft;
    const wingsLevel = Math.abs(ac.bankAngleDeg()) < 14;
    // vel.y, not `vs` — `vs` is a copy taken once per physics step, so at the
    // moment the crash fires it can still be last frame's number.
    const gentle = -ac.vel.y < 6.5;
    const notDiving = ac.pitchAngleDeg() > -12;
    return wingsLevel && gentle && notDiving;
  }

  /**
   * Mayday.
   *
   * Not a shutdown-and-hit-the-ground drill — that version was wrong. You
   * hand the aeroplane to the autopilot, it flies a circuit over the field,
   * two aircraft come up to be with you, and the tower talks to you the whole
   * way. Then the weather decides.
   *
   * The interface stays on screen. Taking it all away made the one moment
   * where you most want to see what is happening the one moment you could
   * not.
   */
  braceForImpact() {
    if (this.state !== 'flying' || this.bracing) return;
    const ac = this.aircraft;
    if (ac.crashed) return;
    if (ac.onGround && ac.groundSpeed < 4) {
      this.hud.notify('You are already on the ground', 'info', 2.4);
      return;
    }

    /*
     * Ask twice. It takes the aeroplane out of your hands and cannot be
     * undone, so one stray keypress should not do it.
     */
    /*
     * Two presses normally. One when you are already in trouble.
     *
     * The confirm is there so a stray key cannot take the aeroplane off you —
     * but "I mostly crash first, then brace" is the whole problem with it:
     * by the time you have decided, pressed, read the prompt and pressed
     * again, the ground has arrived. So when the aeroplane is visibly in an
     * emergency already — low, coming down fast, engine dead, or something
     * broken — the first press is the decision, because at that point there
     * is nothing to protect you from.
     */
    const ac2 = this.aircraft;
    const anyFailure = Object.values(ac2.failures || {}).some(Boolean);
    const inTrouble =
      ac2.agl < 400 || -ac2.vel.y > 12 || !ac2.engineOn || anyFailure || ac2.worstDamage > 0.3;

    if (!inTrouble && !(this._braceArm > 0)) {
      this._braceArm = 4;
      this.hud.showBanner(
        'Declare an emergency?',
        'Press it again to commit. In a real emergency one press is enough.',
        'warn',
        4
      );
      return;
    }
    this._braceArm = 0;

    this.bracing = true;
    this.braceT = 0;
    this.braceLine = 0;
    this.braceOdds = this.survivalOdds();
    this.braceRescue = [];

    /*
     * A mayday ends the mission — quietly.
     *
     * Two scripts were driving the same aeroplane: the mission still counting
     * down, still moving the marker, still advancing its steps and still
     * talking on the radio, across sixty seconds of emergency you do not
     * control. Whatever you were sent to do, you are not doing it now.
     *
     * It is stood down rather than failed, because `fail()` puts a "mission
     * not completed" screen in front of you on the spot — in the middle of
     * the mayday, before the aeroplane is anywhere. The mayday owns the
     * ending and says so in its own debrief.
     */
    this.abandonedMission = this.runner.standDown();
    if (this.abandonedMission) {
      this.activeTarget = null;
      this.hud.setMissionClock(null);
      this.hud.setObjective('Emergency', 'The mission is over. Fly the aeroplane.');
      this.hud.notify(`${this.abandonedMission} is over — fly the aeroplane`, 'warn', 4);
    }

    /*
     * Most of the instruments go.
     *
     * The panel is dead but the interface is still there — that is the
     * difference between "the aeroplane is broken" and "the game has taken
     * the screen away from you", and the first version got it wrong by doing
     * the second. The autopilot keeps flying regardless, which is why it is
     * engaged before this.
     */
    /*
     * Order matters: the autopilot first, THEN the panel goes dark.
     *
     * The game refuses to engage the autopilot while the instruments are out —
     * sensible, and exactly backwards here, where the aeroplane flying itself
     * is the entire point. Blacking the panel out first meant it quietly never
     * engaged and the aeroplane just carried on wherever it was pointed.
     */
    this.autopilot.setMode('field');
    this.autopilot.setEngaged(true, ac);
    this.instrumentBlackout = 70;
    this.hud.setBlackout(true);
    this.hud.setAutopilot(true, this.autopilot.status(this.activeTarget));
    this.braceChoice = null;
    this.hud.setEmergencyChoice([
      { key: '1', label: 'Attempt to land', hint: 'Line up with the runway and fly it down' },
      { key: '2', label: 'Circle the airport', hint: 'Hold overhead and wait for help' },
    ]);
    this.hud.showBanner('Mayday declared', 'Choose: 1 to attempt a landing, 2 to circle.', 'bad', 6);
    this.audio.available && this.audio.alerts.caution && this.audio.alerts.caution();
  }

  /**
   * Land it, or go round and wait.
   *
   * Asked rather than decided, because it is the one decision left and it is
   * a real one: an approach gets you down sooner and needs the aeroplane to
   * still be flyable, holding overhead buys time for the people coming to
   * you. Both are correct answers to different situations.
   */
  chooseBrace(which) {
    if (!this.bracing || this.braceChoice) return;
    this.braceChoice = which;
    this.hud.setEmergencyChoice(null);
    if (which === 'land') {
      this.autopilot.setMode('approach');
      this.speak('We are going to try for the runway.', 'pilot', 1);
      this.hud.showBanner('Attempting a landing', 'Lined up for the runway.', 'warn', 4);
    } else {
      this.autopilot.setMode('field');
      this.speak('We will hold overhead and wait for you.', 'pilot', 1);
      this.hud.showBanner('Holding overhead', 'Circling the field until help arrives.', 'warn', 4);
    }
    this.autopilot.setEngaged(true, this.aircraft);
  }

  /**
   * How likely this ends well, from the weather you are in.
   *
   * Half of it is luck, and the rest is what you are flying through: clear
   * and calm is survivable, a storm at night is much less so. Rolled once,
   * when the mayday is declared, so nothing you do afterwards silently moves
   * it and the number the tower is working with never changes underneath you.
   */
  survivalOdds() {
    const w = this.weather;
    const cond = w.effectiveCondition || w.condition;
    let odds = 0.5;
    if (cond === 'clear') odds += 0.2;
    else if (cond === 'rainy') odds -= 0.1;
    else if (cond === 'stormy') odds -= 0.2;
    if (w.isNight) odds -= 0.1;
    if (w.windSpeedKts > 22) odds -= 0.1;
    return Math.max(0.15, Math.min(0.85, odds));
  }

  /**
   * The recovery parachute.
   *
   * A real thing on real light aircraft — a canopy for the whole aeroplane,
   * fired before it reaches the ground — and the reason the bad ending is
   * survivable at all. It is also the part that makes the sequence make
   * sense to watch: something visibly happens instead of the aeroplane
   * simply running out of sky.
   */
  deployChute() {
    if (this.chute) return;
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(9, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({
        color: 0xff7a3c,
        roughness: 0.85,
        side: THREE.DoubleSide,
      })
    );
    canopy.castShadow = true;
    const rig = new THREE.Group();
    rig.add(canopy);
    canopy.position.y = 13;
    // Four lines back down to the aeroplane.
    const lineMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.7 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 13, 4), lineMat);
      l.position.set(Math.cos(a) * 2.2, 6.5, Math.sin(a) * 2.2);
      rig.add(l);
    }
    rig.scale.setScalar(0.01);
    this.scene.add(rig);
    this.chute = { rig, t: 0 };
    // Under a canopy it stops flying and starts descending.
    this.autopilot.setEngaged(false, this.aircraft);
    this.aircraft.stopEngine('chute');
    this.audio.available && this.audio.ambience.playFlaps && this.audio.ambience.playFlaps();
  }

  clearChute() {
    if (this.chute) this.scene.remove(this.chute.rig);
    this.chute = null;
  }

  /** The aircraft that come up to sit with you. */
  spawnRescue() {
    const type = getAircraft('courier') || this.aircraftType;
    for (const side of [-1, 1]) {
      let m = null;
      try {
        m = createAircraftModel({ type });
      } catch (e) {
        return;
      }
      this.scene.add(m);
      this.braceRescue.push({ model: m, side, t: 0 });
    }
    this.traffic = this.braceRescue.map((r) => ({ pos: r.model.position }));
  }

  /**
   * The whole sequence: what is said, when, and how it ends.
   *
   * Written as a list of times rather than nested timers so the order is
   * readable in one go and nothing can fire out of sequence.
   */
  updateBrace(dt) {
    if (this._braceArm > 0) this._braceArm -= dt;
    if (!this.bracing) return;
    const ac = this.aircraft;

    /*
     * If the ground got there first, the sequence is over.
     *
     * It kept playing across a crash it had not caused — so you hit
     * something, and then the tower carried on calmly telling you help was
     * coming while the wreck sat there. The ending belongs to whichever
     * happened first, and here that is the crash.
     */
    if (ac.crashed && !this.braceRescueT) {
      this.bracing = false;
      this.braceOwnsEnding = false;
      this.clearRescue();
      this.clearChute();
      this.autopilot.setEngaged(false, ac);
      return;
    }
    this.braceT += dt;
    const t = this.braceT;
    const call = this.atc ? this.atc.callsign : 'Skylark one seven two';
    const field = this.atc ? this.atc.field : 'Kestrel';

    const SCRIPT = [
      [0.5, () => this.speak(`Mayday, mayday, mayday. ${call}. I need help.`, 'pilot', 1)],
      [4.5, () => this.speak(`${call}, ${field} Tower. We have you. We are staying with you.`, 'tower', 1)],
      [11, () => this.speak('Everything else on the field is holding. The sky is yours.', 'tower')],
      [18, () => {
        this.spawnRescue();
        this.speak('Two aircraft are coming up to you now. You will not be on your own.', 'tower');
      }],
      [27, () => this.speak(`${call}, Rescue One. I have you in sight. Keep the turn going — we will go round with you.`, 'approach')],
      [36, () => this.speak('Everything down here is ready. We have been ready since you called.', 'tower')],
      [45, () => this.speak('Whatever happens next — you flew it well. All of us saw it.', 'tower', 1)],
      [49, () => {
        this.deployChute();
        this.speak('Parachute out. Hands off, let it come down.', 'approach', 1);
        this.hud.showBanner('Parachute out', 'Nothing left to do but hold on.', 'warn', 5);
      }],
      [58, () => this.resolveBrace()],
    ];
    while (this.braceLine < SCRIPT.length && t >= SCRIPT[this.braceLine][0]) {
      SCRIPT[this.braceLine][1]();
      this.braceLine++;
    }

    /*
     * Under the canopy: it blossoms over a second, sits above the aeroplane,
     * and the descent settles to about five metres a second — which is what a
     * recovery parachute actually gives you, and slow enough to be survivable.
     */
    if (this.chute) {
      this.chute.t += dt;
      const open = Math.min(1, this.chute.t * 1.4);
      this.chute.rig.scale.setScalar(open);
      this.chute.rig.position.copy(ac.pos);
      ac.vel.y += (-5 - ac.vel.y) * Math.min(1, dt * 1.6 * open);
      ac.vel.x *= 1 - Math.min(1, dt * 0.8 * open);
      ac.vel.z *= 1 - Math.min(1, dt * 0.8 * open);
      // Wings level under the canopy, because the canopy is holding it.
      ac.omega.multiplyScalar(1 - Math.min(1, dt * 3));
    }

    // The rescue pair, tucked in either side of you.
    for (const r of this.braceRescue) {
      const off = new THREE.Vector3(r.side * 34, -4, 26).applyQuaternion(ac.quat);
      r.model.position.lerp(this._tmpV.copy(ac.pos).add(off), Math.min(1, dt * 1.4));
      r.model.quaternion.slerp(ac.quat, Math.min(1, dt * 2));
      if (r.model.userData.update) {
        r.model.userData.update(dt, {
          controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.7, brakes: 0 },
          rpm: 0.7, flaps: 0, gearPos: 0, gearDown: false, onGround: false,
          groundSpeed: 0, engineOn: true, agl: 500, alt: r.model.position.y,
          vel: ac.vel, pos: r.model.position, quat: r.model.quaternion,
        }, { isNight: !!this.weather.isNight, cond: { cloud: 0 } });
      }
    }
  }

  /**
   * The moment it is decided.
   *
   * Nobody is ever lost. The weather decides whether it goes well or badly,
   * and badly means the aeroplane is wrecked and the emergency services get
   * you out of it — which is what actually happens, and is a far better thing
   * for a ten-year-old to take away than a coin flip on whether they died.
   *
   * What is at stake is the aeroplane and how hard it was, not the crew.
   */
  resolveBrace() {
    const made = Math.random() < this.braceOdds;
    const call = this.atc ? this.atc.callsign : 'Skylark one seven two';
    const field = this.atc ? this.atc.field : 'Kestrel';
    const pct = Math.round(this.braceOdds * 100);
    this.bracing = false;
    this.autopilot.setEngaged(false, this.aircraft);

    if (made) {
      this.clearRescue();
      this.clearChute();
      this.speak(`${call}, you are down. Everybody is out and everybody is fine.`, 'tower', 1);
      this.showBraceDebrief({
        title: 'Everyone walked away',
        kind: 'good',
        lead: 'You called it early, you let the aeroplane fly itself, and the two who came up brought you home.',
        body: 'The aeroplane is a write-off. Nobody is hurt. That is the whole job.',
        pct,
      });
      return;
    }

    /*
     * It went badly — and then the fire crews reach you.
     *
     * The aeroplane is put down hard rather than the flight simply being
     * declared over, so what you see matches what you are told.
     */
    this.speak(`${call}, ${field} Tower. Brace, brace, brace.`, 'tower', 1);
    this.aircraft.crash('The aeroplane came down short', {
      worldPoint: this.aircraft.pos.clone(),
      part: 'fuselage',
    });
    this.hud.showBanner('It is down — help is already moving', 'Stay with it.', 'warn', 4);
    this.braceRescueT = setTimeout(() => {
      this.speak('They have reached you. You are out and you are safe.', 'tower', 1);
      this.clearRescue();
      this.clearChute();
      this.showBraceDebrief({
        title: 'They got you out',
        kind: 'warn',
        lead: 'It came down hard and the emergency services were there inside a minute.',
        body:
          'The aeroplane is gone. You are not. Clear weather and daylight give you a far better '
          + 'chance of the other ending — that is why the weather is the first thing a pilot looks at.',
        pct,
      });
    }, 4200);
  }

  /** One debrief for both endings, so they cannot drift apart. */
  showBraceDebrief({ title, kind, lead, body, pct }) {
    this.state = 'debrief';
    this.hud.setVisible(false);
    // If a mayday ended a mission, the debrief is the place that says so —
    // nothing interrupts the emergency itself to announce it.
    const abandoned = this.abandonedMission
      ? `<p class="hint tiny">${this.abandonedMission} was abandoned when you declared the emergency. `
        + 'Declaring one is never the wrong call; the mission will still be there.</p>'
      : '';
    this.abandonedMission = null;
    this.menus.showDebrief({
      title,
      kind,
      body:
        `<p class="debrief-reason">${lead}</p><p>${body}</p>`
        + `<p class="hint tiny">Today's weather gave you about a ${pct}% chance of walking away from it.</p>`
        + abandoned,
      actions: [
        { label: 'Fly again', onClick: () => this.restart(), primary: true },
        { label: 'Main menu', onClick: () => this.quitToMenu('main') },
      ],
    });
  }

  clearRescue() {
    for (const r of this.braceRescue || []) this.scene.remove(r.model);
    this.braceRescue = [];
    this.traffic = [];
  }

  /**
   * Tell the HUD the minimap is there.
   *
   * On a narrow screen the minimap sits in the top-left corner, and the
   * objective panel is centred and wide enough to run straight under it — the
   * instrument strip had already been moved out of the way, the objective had
   * not. The class is what lets the panel step aside only when there is
   * something to step aside for.
   */
  syncMinimapClass() {
    if (this.hud && this.hud.wrap) {
      this.hud.wrap.classList.toggle('has-minimap', !!(this.minimap && this.minimap.visible));
    }
  }

  startDrive(kind = 'boat', opts = {}) {
    const spec = VEHICLES[kind] || VEHICLES.boat;
    this.wakeAudio();
    this.menus.hide();
    this.hud.setVisible(true);
    this.hud.clearTransient();
    this.taxi.stop();
    this.wreck.clear();
    /*
     * Leave the aeroplane properly, not just stop drawing it.
     *
     * Taking the boat out used to leave the autopilot engaged, a tornado on
     * the map and the mission runner's objective still on the HUD, because
     * nothing here undid them — you got in a boat and the game carried on
     * telling you to fly through a ring. Anything armed for the flight has to
     * be stood down, or it is waiting for you when you come back.
     */
    this.autopilot.setEngaged(false, this.aircraft);
    this.hud.setAutopilot(false);
    this.hud.hideControls();
    this.tornado.clear();
    this.atc.reset();
    this.removeCrate();
    this.hasCargo = false;
    this.armed = {};
    this.armedEvents = {};
    this.activeEvents = {};
    this.randomDisasters = false;
    // Rings belong to the flight you left. Setting the runner idle is not the
    // same as taking them down, so they used to hang in the sky over the boat.
    this.runner.clearGates && this.runner.clearGates();
    this.mode = 'drive';
    this.modeOpts = { kind, ...opts };
    this.game = kind;
    this.state = 'flying';
    this.runner.status = 'idle';
    this.menus.setGame(kind);

    if (this.vehicleModel) {
      this.scene.remove(this.vehicleModel);
      this.vehicleModel = null;
    }
    this.vehicle = new SurfaceVehicle(kind);
    this.vehicleModel = kind === 'boat' ? createBoat() : createCar();
    this.scene.add(this.vehicleModel);

    /*
     * Driving gets its own pedals and its own camera.
     *
     * Both are rebuilt per trip rather than kept on the sim, so that stepping
     * out of the van and back in never leaves a latched pedal, a camera half
     * way across the island or a reverse gear you did not select.
     */
    this.driveInput = kind === 'car' ? new DriveInput(this.input) : null;
    this.driveCam = kind === 'car' ? new DriveCamera() : null;
    if (this.touch) {
      installDriveTouch(this.touch);
      if (this.touch.setMode) this.touch.setMode(kind === 'car' ? 'drive' : 'fly');
      if (this.touch.setBoatMode) this.touch.setBoatMode(kind === 'boat');
    }
    // The two things the boat says once per outing, not once per frame.
    this._slamSaid = false;
    this._waySaid = false;
    this._swampSaid = false;
    this._droveInto = false;

    /*
     * Where the trip starts.
     *
     * It used to be two hard-coded points that were right for Kestrel and
     * wrong everywhere else: the boat spawned in open water off a beach that
     * on Longbank Sands is two kilometres out on a drying bank, and the car on
     * an apron that only exists because every map happens to have one. Now a
     * mission says where it begins; failing that the boat starts at the quay
     * and the van at the depot, both of which the map itself declares.
     */
    const def = opts.mission ? findBoatMission(opts.mission) : opts.job ? findJob(opts.job) : null;

    /*
     * A mission's own map, loaded before the vehicle is put down on it.
     *
     * startMode has done this for the aeroplane since the beginning; startDrive
     * never did. A boat mission that says `map: 'sennen'` started on whatever
     * map you happened to be on, and boatSpawnFor read THAT map's harbour — so
     * the first shout began two kilometres out in the wrong bay, and the quay
     * it was about to send you back to was on a different island.
     *
     * Borrowed, not kept: the map you chose is put back when you step out of
     * the boat, exactly as it is for a flight.
     */
    const wantMap = (def && def.map) || this.mapForGame(kind);
    if (wantMap && this.settings.map !== wantMap) {
      this.mapBeforeMission = this.settings.map;
      applyMap(wantMap);
      this.layRoads();
      refreshRunways();
      refreshApronElevation();
      this.settings.map = wantMap;
      this.menus.syncMap(wantMap);
      this.buildWorld(this.settings.quality);
    }

    let start = null;
    let headingDeg = kind === 'boat' ? 250 : 90;
    if (kind === 'boat') {
      /*
       * boatSpawnFor takes the SIM, not the mission.
       *
       * It reads the harbour out of the loaded map and puts her alongside the
       * quay pointing at the mouth. Handing it a mission definition instead
       * silently gave the wrong answer rather than throwing: the launch started
       * 557 m out in the bay, which for a game whose first lesson is leaving a
       * berth is most of the lesson gone.
       */
      const sp = boatSpawnFor(this);
      if (sp && sp.pos) {
        start = sp.pos;
        headingDeg = sp.headingDeg ?? headingDeg;
      } else {
        const berth = harbourBerth();
        start = berth ? new THREE.Vector3(berth.x, 0, berth.z) : new THREE.Vector3(-3400, 0, 900);
        const mouth = harbourMouth();
        if (berth && mouth) {
          headingDeg = (Math.atan2(mouth.x - berth.x, -(mouth.z - berth.z)) * 180) / Math.PI;
        }
      }
    } else {
      const sp = resolveSpawn(this, def || ISLAND_ROADS);
      if (sp && sp.pos) {
        start = sp.pos;
        headingDeg = sp.headingDeg ?? headingDeg;
      } else {
        start = new THREE.Vector3(-430, 0, -95);
      }
      /*
       * And on the road, not beside it.
       *
       * An address that is not itself on tarmac starts the van on grass, at
       * half the speed, with no explanation. On the two maps that authored a
       * road network but named no places the depot falls back to the airfield
       * apron, which is such a spot. Measured on Fenwick and Cormorant Coast:
       * "surf grass" at the start of every job. Snapping parks it on the road
       * outside the address rather than moving the address.
       */
      if (this.roads && this.roads.list.length && !this.onRoad(start.x, start.z)) {
        /*
         * A map that authored its own roads and named no places has no depot
         * to fall back to, so `resolveSpawn` hands back the airfield apron —
         * which on Saddleback Pass is nearly four kilometres from the nearest
         * tarmac. On those maps the road IS the map, so the van starts on it,
         * in the middle of the longest one, however far that is. Where the map
         * does name places the depot is real and the snap is only a short hop
         * onto the road outside it.
         */
        const named = !!(MAP.courier && MAP.courier.places && MAP.courier.places.length);
        let near = nearestRoadPoint(this.roads.list, start.x, start.z);
        if (!named) {
          const longest = this.roads.list.reduce((a, b) => (b.path.length > a.path.length ? b : a));
          const mid = longest.path[Math.floor(longest.path.length / 2)];
          near = nearestRoadPoint(this.roads.list, mid[0], mid[1]);
        }
        if (near && (!named || near.dist < 900)) {
          start = new THREE.Vector3(near.x, 0, near.z);
          headingDeg = near.headingDeg;
        }
      }
    }
    this.vehicle.reset({ pos: start, headingDeg });
    this.model.visible = false;
    this.hud.setAircraftName(spec.name);
    this.hud.setObjective(spec.name, spec.blurb);

    // The panel for whichever of the two this is. Built lazily and shown here;
    // the aeroplane's rows are hidden rather than relabelled, which is what the
    // altimeter-reading-kilometres bug was.
    /*
     * And take the other game's panel down first.
     *
     * Switching straight from the boat to the van never goes through
     * stopDrive — switchGame calls startDrive again — so without this the HUD
     * ends up wearing `is-boat` and `is-drive-car` at once, with a depth
     * sounder over the top of a delivery clock. Measured, not imagined: that
     * is exactly what the classList read after one switch.
     */
    if (kind === 'boat') {
      if (this.driveHud) this.driveHud.exit();
      this.boatHud = this.boatHud || new BoatHud(this.hud);
      this.boatHud.enter(spec);
    } else {
      if (this.boatHud) this.boatHud.leave();
      this.driveHud = this.driveHud || new DriveHud(this.hud);
      this.driveHud.enter(spec, { audio: this.audio });
    }

    // A mission or a job rides the same runner the aeroplane's do.
    if (def) {
      this.runner.start(def);
      /*
       * And the turn arrow gets its route.
       *
       * First Run's own text says "Follow the arrow to the town" and its hint
       * says "The big arrow at the bottom of the screen is the next turn". The
       * tracker that draws that arrow was built and never given a route, so
       * there was no arrow — the game told a ten-year-old to follow something
       * that was not there, on the first job of the first game they play.
       */
      if (this.driveHud && this.driveHud.tracker && typeof def.route === 'function') {
        try {
          this.driveHud.tracker.setRoute(def.route(this));
        } catch (err) {
          console.warn('This job could not work out its route:', err);
        }
      }
      this.islandRoads = null;
    } else if (kind === 'car') {
      this.islandRoads = new IslandRoads(this);
    } else {
      this.islandRoads = null;
      this.runner.start(BOAT_PATROL);
    }

    this.hud.notify(
      kind === 'boat'
        ? 'Shift and Ctrl move the engine lever: Astern, Stop, Slow, Half, Full. A and D steer. Space is a crash stop. She does not stop when you do — watch the depth.'
        : 'Shift to go, Ctrl to brake — hold Ctrl once you have stopped and it reverses. A and D steer, Space is the handbrake, C changes the view.',
      'info',
      8
    );
    return this.vehicle;
  }

  /**
   * Back to the aeroplane.
   *
   * This existed and was never called, which is why an abandoned boat sat off
   * the beach for the rest of the session once you had taken it out: startMode
   * made the aeroplane visible again but nothing ever removed the hull.
   */
  stopDrive() {
    if (this.vehicleModel) {
      this.scene.remove(this.vehicleModel);
      this.vehicleModel = null;
    }
    this.vehicle = null;
    this.model.visible = true;
    this.hud.clearVehicle();
    if (this.boatHud) this.boatHud.leave();
    if (this.driveHud) this.driveHud.exit();
    clearBoatProps(this);
    this.islandRoads = null;
    /*
     * Put the camera back exactly as it was found.
     *
     * The driving camera opens the field of view out to 80 degrees at speed,
     * and it writes camera.fov every frame. Nothing else in the game ever
     * writes it back — which is the same shape of bug as the altimeter that
     * read kilometres for the rest of the session after one trip in the boat.
     * Without this line, one fast delivery leaves every subsequent flight
     * looking through a fisheye.
     */
    if (this.driveCam) this.driveCam.restore(this.camera);
    this.driveCam = null;
    this.driveInput = null;
    if (this.touch) {
      if (this.touch.setMode) this.touch.setMode('fly');
      if (this.touch.setBoatMode) this.touch.setBoatMode(false);
    }
  }

  /**
   * Start whatever kind of thing this mission is.
   *
   * Twelve of the thirty-one are aeroplane missions and go through startMode;
   * six are boat shouts, six are courier jobs and seven are helicopter
   * missions. The helicopter's are still flights — the Skyhook is an aircraft
   * type, not a mode — so only the boat's and the car's take the other door.
   */
  startAnyMission(id) {
    const def = findMission(id);
    if (def && def.vehicle === 'boat') return this.startDrive('boat', { mission: id });
    if (def && def.vehicle === 'car') return this.startDrive('car', { job: id });
    return this.startMode('mission', { id });
  }

  /**
   * The switcher in the menu bar.
   *
   * Four games, one world. Flight and Heli are the same engine with a
   * different airframe — the Skyhook is an aircraft type, not a mode — so both
   * go through startMode(); the boat and the car are a different thing to be
   * and go through startDrive(). Whichever way it goes, the other side is torn
   * down first, because the bug this replaces was a boat and an aeroplane
   * existing at the same time.
   */
  switchGame(id) {
    if (!GAME_IDS.includes(id)) id = 'flight';

    /*
     * Switching games goes to that game's FRONT PAGE. It does not start it.
     *
     * It used to drop you straight in: press Boat and you were suddenly
     * afloat, mid-water, with a mission already running and no way back except
     * Esc and a quit. That is not a switcher, it is a trapdoor — and the whole
     * point of four games is that each one is its own place with its own
     * missions, its own maps and its own way in. You arrive at the door, not
     * in the middle of the room.
     *
     * So: put away whatever is running, then show that game's home screen and
     * let the player choose from it.
     */
    this.stopDrive();
    this.game = id;

    /*
     * The vehicle the game is about, chosen now rather than at the moment you
     * press Go — because the screens behind this one say what you are about to
     * fly. Pressing Free Flight on the Rotors page and getting a Skylark is
     * the same bug as the map cards saying how long the runway is on a map
     * with no runway.
     */
    if (id === 'heli') {
      this.lastPlane = 'harrier';
    } else if (id === 'flight' && this.lastPlane === 'harrier') {
      // Coming back from the helicopter must not silently leave you in it.
      this.lastPlane = this.menus.chosenAircraft || 'skylark';
    }
    /*
     * Remembered, not built.
     *
     * setAircraft() builds a model, and from the front page there is no
     * aeroplane yet — `this.aircraftType` is undefined until a flight starts,
     * which is deliberate and documented at the fleet-models option. So the
     * choice is recorded here and startMode() picks it up when something
     * actually begins. Calling setAircraft from a menu button threw on the
     * first press of Heli from a cold start.
     */

    // And out to the front page. quitToMenu puts back a borrowed map, stands
    // the runner down and hides the HUD, which is everything a flight leaves
    // lying about.
    this.quitToMenu('main');
    this.menus.setGame(id);
    return null;
  }

  /**
   * The world the Free Flight screen is currently set to — weather, wind, time
   * of day, fuel — so hopping between the four games does not reset the sky
   * underneath you each time.
   *
   * Deliberately the world and NOT the armed failures or disasters: those were
   * set up for a particular flight, and having an engine quit on you two
   * minutes after you picked the helicopter, because of a box you ticked for
   * something else, is not a surprise anyone enjoys.
   */
  freeOpts() {
    try {
      const all = this.menus.readFree ? this.menus.readFree() : {};
      const { fuel, time, condition, windSpeedKts, windDirDeg } = all;
      return { fuel, time, condition, windSpeedKts, windDirDeg };
    } catch (e) {
      console.warn('Could not read the Free Flight settings; using defaults.', e);
      return {};
    }
  }

  /**
   * One frame of the surface games.
   *
   * What this replaces, and why each piece had to go:
   *
   *   `throttle: ctrl.throttle * 2` — the aeroplane's throttle LEVER, doubled
   *   and then clamped to 1 inside the vehicle. So the top half of the lever
   *   did nothing, the bottom half was twice as sensitive as the on-screen
   *   slider claimed, and the demand could never go below zero: ASTERN, which
   *   is written in the physics and commented and clamped for, could not be
   *   asked for by any input device the game has. The one manoeuvre that
   *   actually stops a boat was unreachable.
   *
   *   `steer: ctrl.roll` — the aileron spring, which recentres at a fixed rate
   *   regardless of speed. A car needs the wheel to wind on more slowly the
   *   faster it goes, or a child taps a key at 90 km/h and is in the sea.
   *
   *   one camera for both: fixed distance, looking at the vehicle rather than
   *   where it is going, and ignoring the sea entirely.
   */
  updateDrive(dt) {
    const v = this.vehicle;
    if (!v) return;
    const ctrl = this.input.update(dt, { simple: true });

    if (v.isBoat) {
      const touch = this.input.touch;
      v.update(dt, {
        steer: ctrl.roll,
        // held(), not pressed(): the vehicle does its own edge detection and
        // its own hold-to-repeat, so one tap is one detent and holding the
        // key walks the lever at four detents a second.
        lever: { up: this.input.held('throttleUp'), down: this.input.held('throttleDown') },
        // The on-screen lever names a detent outright; it wins while a finger
        // is on it, exactly as the touch throttle already does for the plane.
        leverIndex: touch && touch.lever != null ? touch.lever : null,
        crashStop: this.input.held('brakes') || !!(touch && touch.brakes),
        // The sea is only as big as the weather says it is. Passing the whole
        // object rather than a number keeps surface.js out of the weather
        // model and means gusts and temporary storms are felt without another
        // line here.
        weather: this.weather,
      });
      this.boatFeedback(v);
      if (this.touch && this.touch.updateBoat) this.touch.updateBoat(v);
    } else {
      /*
       * Rain takes away grip, and it takes it away from cornering and braking
       * rather than from acceleration. One number, read from the weather that
       * is already being simulated. Full storm costs 22% of the grip.
       */
      const rain = (this.weather && this.weather.cond && this.weather.cond.rain) || 0;
      v.wet = 1 - 0.22 * Math.min(1, rain);
      const c = this.driveInput
        ? this.driveInput.update(dt, v.speed)
        : { throttle: 0, brake: 0, steer: 0, handbrake: false };
      v.update(dt, c);
      if (this.islandRoads) this.islandRoads.update();
    }

    this.vehicleModel.position.copy(v.pos);
    // The pack's launch is drawn with its keel 0.53 m below its origin, and the
    // vehicle rides at 0.18 — so it sat on the sea rather than in it, with the
    // bottom of the hull showing all the way round. The game's own text says
    // she draws about a metre; this is that metre.
    if (this.vehicleModel.userData.fromPack && v.spec.kind === 'boat') {
      this.vehicleModel.position.y -= 0.42;
    }
    this.vehicleModel.quaternion.copy(v.quat);
    updateVehicleModel(this.vehicleModel, v, dt);
    // Hide the van while the recovery truck has it, rather than drawing it
    // bobbing in the surf for two and a half seconds.
    this.vehicleModel.visible = !(v.swamped && v.recoverT < 2.1);

    /* ---- the chase camera ---- */
    if (!v.isBoat && this.driveCam) {
      this.driveCam.update(this.camera, v, dt);
    } else {
      const r = (v.heading * Math.PI) / 180;
      const sp = Math.abs(v.speed);
      // Stand off further the faster she goes: close enough alongside the quay
      // to judge a metre, far enough at speed to see what you are steering at.
      const back = 11 + sp * 0.5;
      const up = 5 + sp * 0.12;
      // Ride some of the swell. All of it is seasickness, none of it is a
      // photograph of a boat pasted on a moving sea.
      const heave = (v.heave || 0) * 0.55;
      const want = new THREE.Vector3(
        v.pos.x - Math.sin(r) * back,
        v.pos.y + up + heave,
        v.pos.z + Math.cos(r) * back
      );
      // A knock when she hits something or falls off a wave. Small, brief, and
      // it uses the vehicle's own decaying jolt so there is no timer here.
      const j = v.jolt || 0;
      if (j > 0.01) {
        want.x += Math.sin(v.t * 47) * j * 0.5;
        want.y += Math.sin(v.t * 53 + 1.7) * j * 0.42;
      }
      this.camera.position.lerp(want, Math.min(1, dt * 3.2));
      // Look AHEAD of her, not at her. Where a boat is going is the only thing
      // you actually need to see, and at three knots it is eight metres away.
      const lead = 8 + sp * 0.6;
      this.camera.lookAt(
        v.pos.x + Math.sin(r) * lead,
        v.pos.y + 1.2,
        v.pos.z - Math.cos(r) * lead
      );
    }

    /*
     * Going in the water is a delay, not an ending.
     *
     * The old car called crash() and printed "press Esc to go back", which for
     * a delivery game means a child who clips a beach at speed is sent to a
     * menu. Now a truck pulls you out where you last were, and the only thing
     * you have actually lost is the time — which is what the clock is for.
     */
    if (v.swamped && !this._swampSaid) {
      this._swampSaid = true;
      this.hud.notify('In the water. Hold on — a truck is pulling you out.', 'warn', 3);
    }
    if (!v.swamped) this._swampSaid = false;

    // Bumping a building is a bump. Only the boat can still properly crash.
    if (v.lastBump) {
      this.hud.notify(`You clipped ${v.lastBump}.`, 'warn', 2.5);
      v.lastBump = null;
    }
    if (v.crashed && !this._droveInto) {
      this._droveInto = true;
      this.hud.notify(v.crashReason + ' — press Esc to go back', 'warn', 8);
    }
    if (!v.crashed) this._droveInto = false;

    const r = v.readouts();
    if (v.isBoat && this.boatHud) {
      /*
       * The sounder needs somewhere to sound.
       *
       * BoatHud.update takes a context with `pos` or `depth` on it and falls
       * back to 99 when it has neither — and it was being handed neither, so
       * the depth under the keel, which is the single instrument the whole
       * boat game is steered by, read ninety-nine metres everywhere including
       * alongside the quay. The echo-sounder ping is gated on the same number,
       * so that never sounded either.
       */
      this.boatHud.update(dt, r, {
        sim: this,
        audio: this.audio,
        pos: v.pos,
        depth: v.depth,
        aground: v.aground,
        weather: this.weather,
      });
    } else if (this.driveHud) {
      /*
       * The drive HUD takes a STATE, not the readouts.
       *
       * It reads `s.readouts`, `s.surface`, `s.job`, `s.clock`, `s.cargo` and
       * `s.turn` off one object. Handing it the readouts directly meant
       * `s.readouts` was the readouts function itself, `r.speedKph` was
       * undefined, and every number on the courier's panel sat at whatever it
       * was built with — a frozen speed, a frozen surface word, no clock and
       * no load. The job ran; the instruments did not.
       */
      const step = this.runner.status === 'running' ? this.runner.step : null;
      const def = this.runner.def;
      const data = this.runner.data || {};
      this.driveHud.update(dt, {
        readouts: r,
        surface: v.surface,
        isBoat: false,
        job: step
          ? { title: (def && def.name) || 'Island Roads', text: step.text || '' }
          : { title: 'Island Roads', text: 'No clock. Drive where you like.' },
        clock:
          def && def.parTime && this.runner.status === 'running'
            ? Math.max(0, def.parTime - this.runner.elapsed)
            : null,
        cargo: data.cargo
          ? { pips: data.cargo.pips, max: data.cargo.max || 5, label: data.cargo.name || 'LOAD' }
          : null,
        turn: this.driveHud.tracker
          ? this.driveHud.tracker.next(v.pos, v.heading)
          : null,
      });
    } else {
      this.hud.setVehicle(r, v.spec);
    }
  }

  /**
   * The boat talking back: bangs, slams, and saying the word "aground".
   *
   * Kept out of updateDrive because it is all one-shot reaction to events the
   * physics raised. The important line is the one about carrying her way. A
   * ten-year-old who puts the lever to STOP and watches the boat keep going
   * concludes the game has stopped listening. Telling them, once, in words,
   * that it is the boat and not the controls is the difference between a
   * mechanic they learn and a bug they report.
   */
  boatFeedback(v) {
    const events = v.takeEvents();
    if (events) {
      for (const e of events) {
        if (e.kind === 'bang' || e.kind === 'wreck') {
          if (this.audio.available) this.audio.alerts.terrain();
          this.hud.notify(v.agroundMessage || "You're on the putty — astern, gently", 'warn', 6);
        } else if (e.kind === 'afloat') {
          this.hud.notify('Afloat again. Mind where she draws.', 'info', 3);
        } else if (e.kind === 'slam' && !this._slamSaid) {
          this._slamSaid = true;
          this.hud.notify('She is slamming — ease her back to Half.', 'info', 4);
        }
      }
    }
    // Said once per outing, the first time she is genuinely running on.
    if (!this._waySaid && v.speed > 3 && v.demand <= 0 && !v.aground) {
      this._waySaid = true;
      this.hud.notify('Engine stopped and she is still going — that is her carrying her way.', 'info', 5);
    }
  }

  update(dt) {
    if (this.mode === 'drive' && this.vehicle) {
      /*
       * Driving used to return from here before the key handling and before
       * input.endFrame(), which had two consequences: Esc did nothing, so
       * there was no way to pause or quit out of the boat at all; and every
       * key pressed while driving stayed in the pressed-this-frame set and
       * fired, all at once, on the next flight.
       */
      const input = this.input;
      if (input.pressed('pause')) {
        if (this.state === 'flying') this.pause();
        else if (this.state === 'paused') this.resume();
      }
      if (this.state === 'flying') {
        if (input.pressed('camera')) {
          // The rig is the aeroplane's camera and does nothing while driving,
          // so C was a key that printed a label and changed no pixels. The van
          // has its own three views, and the bonnet one is the reason the
          // bonnet view exists: it is how you place the van at a loading bay.
          if (this.driveCam && this.vehicle.spec.kind === 'car') {
            this.hud.notify(`View: ${DRIVE_VIEW_LABELS[this.driveCam.cycle()]}`, 'info', 1.8);
          } else {
            this.hud.notify(`View: ${VIEW_LABELS[this.rig.cycle()]}`, 'info', 1.8);
          }
        }
        if (input.pressed('minimap')) this.hudAction('minimap');
        if (input.pressed('help')) this.hud.toggleControls(this.input.bindings, keyLabel, ACTIONS);
        // Paused means paused. The boat used to carry on out to sea while the
        // menu was up, so you came back to it somewhere else entirely.
        this.updateDrive(dt);
        /*
         * And the chart. This branch returns long before the flight code that
         * ticks it, so the minimap froze the moment you got in the boat — it
         * showed the aeroplane's last position on the apron, for the whole
         * trip, which for a game about reading the water is the one instrument
         * that had to work.
         */
        if (this.minimap) this.minimap.update(dt, this);
        // The runner, which this branch used to return before ever reaching —
        // which is why there has never been such a thing as a boat mission or
        // a car job, however many were written.
        this.runner.update(dt);
        this.audio.updateVehicle(dt, this.vehicle.readouts(), this.weather);
        // Match the real signatures — sky.update takes the weather alone, and
        // ocean.update takes (dt, weather). Guessing them cost a thrown frame.
        this.weather.update(dt);
        if (this.ocean) this.ocean.update(dt, this.weather);
        if (this.sky) this.sky.update(this.weather);
      }
      input.endFrame();
      return;
    }
    const ac = this.aircraft;

    if (this.state === 'flying') {
      if (this.taxi.active) this.taxi.update(dt);
      const ctrl = this.input.update(dt, { simple: ac.mode === 'simplified' });
      let pitch = ctrl.pitch;
      let roll = ctrl.roll;
      let yaw = ctrl.yaw;
      let throttle = ctrl.throttle;

      // Autopilot, if it is on and you have not grabbed the controls back.
      // Note the locals: `ctrl` belongs to the input module and is reused every
      // frame, so writing the autopilot's output into it would come straight
      // back next frame looking exactly like the player moving the stick.
      if (this.autopilot.engaged && this.autopilot.handedBack) {
        const why = this.autopilot.handedBack;
        this.autopilot.handedBack = null;
        this.toggleAutopilot(false);
        this.hud.notify(why, 'good', 4);
      }
      if (this.autopilot.engaged) {
        if (this.autopilot.playerTookOver(ctrl) || ac.onGround || ac.crashed) {
          this.toggleAutopilot(false);
        } else {
          const t = this.activeTarget ? this.activeTarget.pos : null;
          const ap = this.autopilot.update(dt, ac, t);
          pitch = ap.pitch;
          roll = ap.roll;
          yaw = ap.yaw;
          throttle = ap.throttle;
          this.input.throttleTarget = ap.throttle;
          this.hud.setAutopilot(true, this.autopilot.status(t));
          // On an approach it configures the aeroplane, because that is how
          // you actually come down: a clean airframe at idle will not descend
          // steeply however hard you push, and no amount of elevator is a
          // substitute for putting the wheels and the flaps out.
          if (this.autopilot.mode === 'approach') {
            const out = -550 - ac.pos.x;
            if (out < 7000 && !ac.gearDown) ac.toggleGear();
            const wantFlap = out < 3500 ? 2 : out < 6000 ? 1 : 0;
            if (ac.flapStep() < wantFlap) ac.setFlaps(wantFlap);
          }
        }
      }

      ac.controls.pitch = pitch;
      ac.controls.roll = roll;
      ac.controls.yaw = yaw;
      ac.controls.throttle = throttle;
      ac.controls.brakes = ctrl.brakes;
      // Trim is the pilot's, and the autopilot must not inherit it — it flies
      // the elevator directly and would be fighting a bias it did not set.
      ac.controls.trim = this.autopilot.engaged ? 0 : ctrl.trim || 0;
      // Test / debug hook: lets the self-test fly the aeroplane as if it were
      // holding the controls. Ignored entirely during normal play.
      if (this.override) {
        for (const k in this.override) {
          if (this.override[k] !== null && this.override[k] !== undefined) ac.controls[k] = this.override[k];
        }
      }
    } else {
      this.input.update(dt, { simple: true });
    }
    this.handleDiscreteInput();

    this.weather.update(dt);

    if (this.state === 'flying') {
      // Fixed-step physics for consistent behaviour on any refresh rate.
      const STEP = 1 / 120;
      this.acc += Math.min(dt, 0.1);
      let steps = 0;
      while (this.acc >= STEP && steps < 12) {
        ac.update(STEP, this.weather);
        /*
         * Hover assist trim follow-up. The flight model asks, the input layer
         * answers; neither reaches into the other. Inside the fixed-step loop
         * so the trim rate is the same on a 60 Hz Chromebook and a 120 Hz
         * iPad. Not while the autopilot is flying — it sets throttleTarget
         * itself and the two would fight.
         */
        if (ac.rotor && ac.rotor.trimRequest && !this.autopilot.engaged) {
          this.input.nudgeThrottle(ac.rotor.trimRequest * STEP);
        }
        this.acc -= STEP;
        steps++;
      }
      this.updateBrace(dt);
      this.runner.update(dt);
      this.atc.update(dt);
      this.activeTarget = this.runner.activeTarget();
      if (this.crate) {
        this.crate.update(dt, heightAt, this.weather.windVector());
        /*
         * The bang belongs to whoever owns the audio, not to the bomb — the
         * marker has no idea a mixer exists. `playThunder` close-to is a deep
         * crack with a rolling tail, which is what a bomb sounds like from a
         * couple of kilometres up.
         */
        if (this.crate.justExploded) {
          this.crate.justExploded = false;
          this.audio.available && this.audio.ambience.playThunder(0.1);
        }
        /*
         * Reload once it is down. Waiting for it to land rather than arming
         * straight away is deliberate: you watch your last one all the way in,
         * which is the part you learn from, and you cannot have two in the air
         * at once confusing which is which.
         */
        if (this.crate.landed) {
          this.crateClear = (this.crateClear || 0) + dt;
          if (this.crateClear > 3 && this._storesLeft > 0 && !this._armed) {
            this.crateClear = 0;
            this.removeCrate();
            this.hasCargo = true;
            this.hud.notify(`Reloaded — ${this._storesLeft} left`, 'info', 2.6);
          }
        } else {
          this.crateClear = 0;
        }
      }
    }

    // World.
    this.sky.update(this.weather);
    this.sky.followTarget(ac.pos);
    this.ocean.follow(ac.pos);
    this.ocean.update(dt, this.weather);
    this.airport.update(dt, this.weather);
    this.apron.update(dt, this.weather);
    this.updateArmedFailures(dt);
    /*
     * Outside the branch below, deliberately.
     *
     * Inside it, the minimap's fault light only ever turned ON — the branch
     * stops running the moment the counter reaches zero, so it never got told
     * the instruments had come back and flashed for the rest of the flight.
     */
    if (this.minimap) this.minimap.setFaulty(this.instrumentBlackout > 0);
    if (this.instrumentBlackout > 0) {
      this.instrumentBlackout = Math.max(0, this.instrumentBlackout - dt);
      // Called on the way down to zero as well, so the panel comes back.
      this.hud.setBlackout(this.instrumentBlackout > 0);
      // A dead panel beeps. Once a second, not continuously — a solid tone is
      // just noise, and the gap is what makes it read as an alarm.
      // The autopilot flies on the instruments. With the panel dead it has
      // nothing to fly on, so it drops out — which is the point of a lightning
      // strike: it hands you an aeroplane in cloud with no help.
      /*
       * ...except during a mayday, where the whole point is that the
       * aeroplane keeps flying itself on the emergency system. This dropped
       * it out every frame with "Autopilot dropped out — no instruments",
       * which is exactly right after a lightning strike and exactly wrong
       * here, and it is why the aeroplane never circled.
       */
      if (this.autopilot.engaged && !this.bracing) {
        this.toggleAutopilot(false);
        this.hud.notify('Autopilot dropped out — no instruments', 'warn', 4);
      }
      this._blackoutBeep = (this._blackoutBeep || 0) - dt;
      if (this.instrumentBlackout > 0 && this._blackoutBeep <= 0) {
        this._blackoutBeep = 1;
        if (this.audio.available) {
          this.audio.mixer.tone({ bus: 'alerts', freq: 720, duration: 0.16, gain: 0.3, type: 'square' });
          this.audio.mixer.tone({ bus: 'alerts', freq: 540, duration: 0.16, gain: 0.22, type: 'square', detune: 8 });
        }
      }
      if (this.instrumentBlackout === 0) this.hud.notify('Instruments back', 'good', 2.5);
    }
    this.updateRandomDisasters(dt);
    this.updateVolcano(dt);
    this.wreck.update(dt);
    this.tornado.update(dt);

    // A lightning storm keeps striking for as long as it lasts.
    if (this.lightningStorm) {
      const st = this.lightningStorm;
      st.left -= dt;
      st.next -= dt;
      if (st.next <= 0 && st.left > 0) {
        st.next = 20 + Math.random() * 20;
        this.weather.lightningFlash = 1;
        this.instrumentBlackout = Math.max(this.instrumentBlackout, 7 + Math.random() * 7);
        this.hud.notify('Struck — instruments out', 'warn', 3);
        if (this.audio.available) this.audio.ambience.playThunder && this.audio.ambience.playThunder();
      }
      if (st.left <= 0) {
        this.lightningStorm = null;
        this.hud.notify('The storm has passed', 'good', 3);
      }
    }
    // Run the clocks on anything currently happening to you.
    if (this.activeEvents) {
      for (const id of Object.keys(this.activeEvents)) {
        this.activeEvents[id] -= dt;
        if (this.activeEvents[id] <= 0) delete this.activeEvents[id];
      }
    }
    // Keep a marker on it the whole time it is on the ground.
    if (this.tornado.active) {
      const t = this.tornado;
      const dx = t.pos.x - this.aircraft.pos.x;
      const dz = t.pos.z - this.aircraft.pos.z;
      const km = Math.hypot(dx, dz) / 1000;
      let brg = (Math.atan2(dx, -dz) * 180) / Math.PI;
      if (brg < 0) brg += 360;
      // Relative to where the nose is pointing, which is what you can act on.
      const rel = ((brg - this.aircraft.readouts().heading + 540) % 360) - 180;
      const clock = Math.round(((rel + 360) % 360) / 30) || 12;
      this.hud.setHazard(
        `<b>${t.label || 'TORNADO'} TORNADO</b> ${km.toFixed(1)} km · ` +
          `bearing ${String(Math.round(brg)).padStart(3, '0')} · ${clock} o'clock`
      );
      const near = this.tornado.proximity(this.aircraft.pos);
      this._tornadoWarn = (this._tornadoWarn || 0) - dt;
      if (near > 0.62 && this._tornadoWarn <= 0) {
        this._tornadoWarn = 6;
        this.hud.notify('You are too close to the tornado — turn away', 'warn', 4);
        this.rig.kick(near * 0.8);
      }

      /*
       * Inside the core it does damage, and the damage scales with the rating.
       *
       * The tornado used to be pure wind: unpleasant, but you could fly
       * straight through the middle of one and come out of the far side with
       * an intact aeroplane, which made the strongest weather in the game the
       * least frightening thing in it. Now the core tears at the airframe.
       */
      const bite = this.tornado.bite(this.aircraft.pos);
      /*
       * The storm penetrator's spar does not fail. Everything else is the same.
       *
       * `stormProof` buys exactly one thing: the airframe survives tornado
       * loads. The wind field is untouched, so it is still picked up, rolled
       * and thrown — and being big, slab-sided and slow to roll, it is thrown
       * harder than the trainer would be. If the ride went calm as well, the
       * aeroplane would just be a switch that turns the tornado off, which is
       * a much less interesting thing to own.
       */
      const stormProof = !!(this.aircraftType && this.aircraftType.stormProof);
      if (bite > 0.15 && !this.aircraft.crashed) {
        const ef = t.ef || 0;
        // Buffeting you can feel long before anything breaks.
        // (Not `aircraft.buffet` — the flight model recomputes that from alpha
        // every step, so writing to it here would be overwritten immediately.)
        this.rig.kick(bite * (0.6 + ef * 0.22) * (stormProof ? 1.7 : 1));
        if (stormProof) {
          // Say so occasionally, or holding together reads as the game having
          // forgotten to hurt you.
          this._proofWarn = (this._proofWarn || 0) - dt;
          if (bite > 0.4 && this._proofWarn <= 0) {
            this._proofWarn = 7;
            this.hud.notify('The spar is holding — but it is flying you now', 'warn', 4);
          }
        } else {
          this._tornadoDamage = (this._tornadoDamage || 0) + dt * bite * (0.35 + ef * 0.25);
        }
        // Things start letting go, worst first.
        const f = stormProof ? null : this.aircraft.failures;
        if (this._tornadoDamage > 1.1 && f && !f.roughEngine) {
          f.roughEngine = true;
          this.hud.notify('Debris through the engine — it is running rough', 'warn', 5);
        }
        if (this._tornadoDamage > 2.2 && f && !f.elevator) {
          f.elevator = true;
          this.hud.notify('The elevator has been torn — pitch is failing', 'warn', 5);
        }
        // Deep in the core of a strong one, the aeroplane simply comes apart —
        // unless it was built for precisely this.
        if (!stormProof && this._tornadoDamage > 3.4 && bite > 0.55 && ef >= 2) {
          this.aircraft.crash('The tornado tore the aeroplane apart');
        }
      } else if (this._tornadoDamage) {
        // Out of it — stop accumulating, but the failures stay broken.
        this._tornadoDamage = Math.max(0, this._tornadoDamage - dt * 0.2);
      }
    } else if (this._hadTornado) {
      this.hud.setHazard(null);
    }
    this._hadTornado = this.tornado.active;
    if (this.touch) this.touch.update(this.aircraft.readouts(), this);
    this.scenery.update(dt, this.weather);
    if (this.seamarks) this.seamarks.update(dt, this.weather);
    this.features.update(dt, this.weather);
    this.clouds.update(dt, this.weather, ac.pos);
    this.rain.update(dt, this.weather, this.camera.position, ac.vel);
    this.cloudImmersion = this.clouds.cloudImmersion(ac.pos.y, this.weather);
    this.papiHint = this.airport.updatePapi(ac.pos);

    // Aeroplane + cockpit.
    // A crashing fleet model drives its own transform — see model-adapter.js.
    syncAircraftModel(this.model, ac);
    this.model.userData.update(dt, ac, this.weather);
    // The model's own update is what drives a sinking wreck, so the floor has
    // to be applied after it — clamping before it is undone in the same frame.
    clampSinking(this.model, ac);
    const inCockpit = this.rig.mode === 'cockpit';
    // Two cockpit views. The default is the clean one — no panel in the way,
    // wide field of view, instruments on the overlay. "Realistic cockpit" in
    // the pause menu puts the actual instrument panel in front of you, and
    // then the overlay copies of those instruments get out of the way,
    // because you are reading them off the panel instead.
    const wantPanel = inCockpit && !!this.settings.realisticCockpit;
    // Only strip the overlay back when you are actually looking at the panel.
    const wantMinimal = wantPanel;
    if (wantMinimal !== this._minimalHud) {
      this._minimalHud = wantMinimal;
      this.hud.setMinimal(wantMinimal);
    }
    // The cockpit is drawn in *both* cockpit views. Hiding it entirely in the
    // default one was a mistake: switching to the cockpit view and finding no
    // cockpit there reads as broken, not as clean. What "realistic" changes is
    // the field of view and whether the overlay repeats the instruments — not
    // whether the aeroplane has an interior.
    this.cockpit.visible = inCockpit;
    if (inCockpit) this.cockpit.userData.update(dt, ac, this.weather);
    this.audio.setInterior(inCockpit);

    this.rig.update(dt, ac, this.input, this.weather);

    // Extra fog inside cloud gives a genuine whiteout.
    if (this.cloudImmersion > 0.01) {
      const p = this.weather.palette();
      this.scene.fog.density = p.fogDensity + this.cloudImmersion * 0.0045;
      this.scene.fog.color.copy(p.fogColor).lerp(new THREE.Color(0xdfe6ee), this.cloudImmersion * 0.7);
    }

    // Navigation guidance: the mission's current target, or the runway when
    // there is nothing else to aim at.
    if (this.navGuide) {
      let guideTarget = this.taxi.active ? this.taxi.target() : null;
      if (!guideTarget) guideTarget = this.activeTarget ? this.activeTarget.pos : null;
      // On the ground with nothing to aim at, point down the runway rather than
      // showing nothing. The rails vanishing the moment you land makes the
      // whole feature look broken, and lined up for take-off is exactly when a
      // beginner wants to know which way "straight ahead" is.
      if (!guideTarget && this.state === 'flying') {
        guideTarget = ac.onGround ? RUNWAY.thresholdEast : RUNWAY.touchdown;
      }
      /*
       * Arrow, beacon, or both — the player's choice.
       *
       * The rails and the arrow both say "turn this way"; the beacon says
       * "the place is *there*". Which one helps depends entirely on the person,
       * which is why this is a setting and not a decision I get to make.
       */
      const style = this.settings.guideStyle || 'arrow';
      const wantRails = this.state === 'flying' && style !== 'beacon';
      this.navGuide.update(
        dt,
        wantRails ? guideTarget : null,
        ac.pos,
        ac.quat,
        this.camera.position
      );
      if (this.minimap) this.minimap.update(dt, this);
      if (this.beacon) {
        const wantBeacon = this.state === 'flying' && style !== 'arrow' && this.navGuide.enabled;
        this.beacon.setTarget(wantBeacon ? guideTarget : null);
        this.beacon.update(dt);
      }
    }

    this.audio.update(dt, ac, this.weather, this.cloudImmersion);
    if (this.state === 'flying') {
      this.hud.setCoach(this.coachHint(ac));
      // The mission clock, if this one has a limit.
      const def = this.runner.status === 'running' ? this.runner.def : null;
      this.hud.setMissionClock(
        def && def.timeLimit ? def.timeLimit - this.runner.elapsed : null
      );
      this.hud.update(dt, this);
    }
    this.input.endFrame();
  }

  /* ------------------------------------------------------------------ */
  /* Headless driver — used by the automated checks and handy for debugging.
     Advances the simulation by a fixed amount without waiting for frames.   */
  /* ------------------------------------------------------------------ */

  step(seconds = 1, dt = 1 / 60) {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) this.update(dt);
    this.renderer.render(this.scene, this.camera);
    return this.snapshot();
  }

  /** Compact state dump for tests. */
  snapshot() {
    const r = this.aircraft.readouts();
    const step = this.runner.step;
    return {
      state: this.state,
      mode: this.mode,
      view: this.rig.mode,
      pos: [Math.round(this.aircraft.pos.x), Math.round(this.aircraft.pos.y), Math.round(this.aircraft.pos.z)],
      ias: Math.round(r.iasKts),
      altFt: Math.round(r.altFt),
      aglFt: Math.round(r.aglFt),
      vsFpm: Math.round(r.vsFpm),
      heading: Math.round(r.heading),
      throttle: Math.round(r.throttle * 100),
      fuelPct: Math.round(r.fuelPct * 100),
      onGround: r.onGround,
      gearDown: r.gearDown,
      flaps: r.flapStep,
      stalled: r.stalled,
      engineOn: r.engineOn,
      crashed: this.aircraft.crashed,
      crashReason: this.aircraft.crashReason,
      lastTouchdown: this.aircraft.lastTouchdown,
      missionStatus: this.runner.status,
      stepId: step ? step.id : null,
      objective: this.hud.objectiveText.textContent,
      papi: this.papiHint ? this.papiHint.state : null,
      weather: this.weather.serialize(),
      target: this.activeTarget ? this.activeTarget.label : null,
      fps: this.fps,
    };
  }

  /** Press / release a bound action the way a real keyboard would. */
  key(code, down = true) {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  }

  tap(code) {
    this.key(code, true);
    this.key(code, false);
  }

  /**
   * The single most useful thing to press right now, named explicitly. New
   * pilots do not need a manual, they need to know that Shift is power and that
   * S is back-pressure — at the moment it matters.
   */
  coachHint(ac) {
    const r = ac.readouts();
    const kts = r.iasKts;

    if (ac.crashed) return 'Press <kbd>Esc</kbd> and choose <b>Restart</b> to try again';
    if (!ac.engineOn && ac.rpm < 0.05) return 'Press <kbd>I</kbd> to start the engine';

    if (ac.onGround) {
      // Rolling fast with the power already off: they want the brakes.
      if (r.throttle < 0.2 && ac.groundSpeed > 6) return 'Hold <kbd>Space</kbd> to brake';
      if (r.throttle < 0.85) return 'Hold <kbd>Shift</kbd> for full power';
      if (kts > 52) return 'Now pull back gently on <kbd>S</kbd> to fly!';
      if (kts > 12) return 'Keep straight with <kbd>Q</kbd> / <kbd>E</kbd> — lift off at 55 knots';
      return 'Hold <kbd>Shift</kbd> — you need 55 knots to fly';
    }

    // Airborne.
    if (kts > 150) return 'Far too fast — ease the power right off with <kbd>Ctrl</kbd> and level the wings';
    if (kts < 52) return 'Too slow! Add power with <kbd>Shift</kbd> and lower the nose with <kbd>W</kbd>';
    if (ac.stalled) return 'Push the nose down with <kbd>W</kbd> and add power';
    if (ac.airborneTime < 8) return 'Climbing — keep the nose just above the horizon';

    // On final approach to runway 09.
    const onFinal =
      ac.pos.x < RUNWAY.thresholdWest.x &&
      ac.pos.x > RUNWAY.thresholdWest.x - 5000 &&
      r.aglFt < 900 &&
      Math.abs(((r.heading - 90 + 540) % 360) - 180) < 45;
    if (onFinal) {
      if (!r.gearDown) return 'Landing gear! Press <kbd>G</kbd> before you land';
      if (this.papiHint && this.papiHint.state === 'low') return 'Too low — add power with <kbd>Shift</kbd>';
      if (this.papiHint && this.papiHint.state === 'high') return 'Too high — ease the power off with <kbd>Ctrl</kbd>';
      if (kts > 95) return 'Too fast to land — ease the power off with <kbd>Ctrl</kbd> (aim for 70 knots)';
      if (r.flapStep === 0 && kts < 100) return 'Press <kbd>F</kbd> for flaps — they help you fly slowly';
      if (r.aglFt < 60) return 'Ease back on <kbd>S</kbd> just before the wheels touch';
      return 'Follow the PAPI lights — two white, two red';
    }
    return null;
  }

  loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      let dt = this.clock.getDelta();
      if (dt > 0.25) dt = 0.25; // after a tab switch, do not jump
      try {
        this.update(dt);
        this.renderer.render(this.scene, this.camera);
      } catch (err) {
        console.error(err);
        if (!this._errored) {
          this._errored = true;
          fatal('The simulator hit an unexpected error while running.', err && err.stack);
        }
        return;
      }
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime >= 1) {
        this.fps = Math.round(this.fpsFrames / this.fpsTime);
        this.fpsFrames = 0;
        this.fpsTime = 0;
        this.menus.updateFps(this.fps);
      }
    };
    tick();
  }
}

const game = new Game();
game.boot().catch((err) => {
  console.error(err);
  fatal('The simulator could not start.', err && err.stack);
});

export default game;

/** The field name, without reaching through the ATC director twice. */
function field2(game) {
  return game.atc ? game.atc.field : 'Kestrel';
}
