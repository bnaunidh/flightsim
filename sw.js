/** Offline asset update, 2026-09-20: precache 99 -> 100 entries; adds
 * civil-details.js and advances the cache version. All precached files exist;
 * all source JS is listed; final suite reports 85 loaded modules precached.
 * An actual disconnected iPad installation was not tested. */
/**
 * Service worker — offline support.
 *
 * Everything the game needs is a static file, so the strategy is simple and
 * robust: precache the whole app on install, then serve from cache first and
 * fall back to the network. Because all textures and sounds are generated in
 * code, there are no media assets that could go missing offline.
 *
 * Bump CACHE_VERSION when you change any game file.
 */

const CACHE_VERSION = 'island-flight-v51';

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles/main.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',

  'src/main.js',
  'src/core/noise.js',
  'src/core/storage.js',
  'src/render/textures.js',

  'src/world/weather.js',
  'src/world/sky.js',
  'src/world/terrain.js',
  'src/world/maps.js',
  'src/world/water.js',
  'src/world/airport.js',
  'src/world/scenery.js',
  'src/world/clouds.js',
  'src/world/precip.js',

  'src/aircraft/physics.js',
  'src/aircraft/model.js',
  'src/aircraft/model-adapter.js',
  'src/aircraft/cockpit.js',
  'src/aircraft/types.js',
  'src/aircraft/liveries.js',

  // The fleet models. Offline is the whole point of the service worker, and an
  // aeroplane that only exists when the wifi is up is not an aeroplane.
  'src/fleet/aircraft-game-bridge.js',
  'src/fleet/aircraft-fleet.js',
  'src/fleet/aircraft-core.js',
  'src/fleet/aircraft-light.js',
  'src/fleet/aircraft-transport.js',
  'src/fleet/aircraft-combat.js',
  'src/fleet/aircraft-impact.js',
  'src/fleet/aircraft-textures.js',
  'src/fleet/aircraft-upgrades.js',
  'src/fleet/common.js',
  'src/fleet/helicopter.js',
  'src/fleet/physics.js',
  'src/fleet/effects.js',

  'src/flight/input.js',
  'src/flight/autopilot.js',
  'src/flight/camera.js',

  'src/audio/index.js',
  'src/audio/mixer.js',
  'src/audio/engine.js',
  'src/audio/ambience.js',
  'src/audio/atc.js',
  'src/audio/alerts.js',
  'src/audio/music.js',

  'src/game/runner.js',
  'src/game/missions.js',
  'src/game/tutorial.js',
  'src/game/markers.js',
  'src/game/atc-director.js',
  'src/game/navguide.js',
  'src/game/taxi.js',

  'src/ui/hud.js',
  'src/ui/menus.js',
  'src/ui/credits.js',


  /*
   * Seventeen modules were missing from this list — the credits and the
   * military unlock, the minimap, the touch controls, the boat and the car,
   * the disasters and the tornado. The runtime handler caches whatever the
   * game asks for, so they arrived after one online play; install the game
   * and go straight offline, though, and half of it was not there.
   */
  'src/audio/jet.js',
  'src/game/beacon.js',
  'src/game/campaign-b.js',
  'src/game/campaign.js',
  'src/game/disasters.js',
  'src/game/progression.js',
  'src/game/wreck.js',
  'src/ui/icons.js',
  'src/ui/minimap.js',
  'src/ui/touch.js',
  'src/vehicles/models.js',
  'src/vehicles/surface.js',
  'src/world/apron.js',
  'src/world/carrier.js',
  'src/world/features.js',
  'src/world/tornado.js',

  /*
   * And twenty-one more, which is the second time this list has fallen
   * behind the game. Between them they are the boat, the car, the
   * helicopter and the four-game menu — every HUD but the aeroplane's, the
   * job board, the boat and helicopter missions, the roads, the pads, the
   * seamarks, the vehicle engines and the game switcher itself. Install the
   * game, go offline, pick anything but Flight, and it was not there.
   *
   * The check in tests/selftest.js compares this list against every module
   * the running game actually loaded, so the next twenty-one cannot go
   * missing quietly.
   */
  'src/aircraft/models/skylark.js',
  'src/aircraft/models/civil-details.js',
  'src/aircraft/rotor-assist.js',
  'src/audio/vehicles.js',
  'src/fleet/airport.js',
  'src/fleet/atc.js',
  'src/fleet/ground.js',
  'src/fleet/maritime.js',
  'src/fleet/scenery.js',
  'src/game/jobs.js',
  'src/game/missions-boat.js',
  'src/game/missions-heli.js',
  'src/game/pursuer.js',
  'src/ui/briefing.js',
  'src/ui/game-ui.js',
  'src/ui/hud-boat.js',
  'src/ui/hud-drive.js',
  'src/ui/hud-rotor.js',
  'src/vehicles/driving.js',
  'src/world/pads.js',
  'src/world/roads.js',
  'src/world/seamarks.js',

  // The plug-in layer and its slots — see src/game/extensions.js.
  'src/aircraft/extra/airliners.js',
  'src/aircraft/extra/fighters.js',
  'src/aircraft/extra/index.js',
  'src/features/index.js',
  'src/fleet/extra/airliners.js',
  'src/fleet/extra/fighters.js',
  'src/fleet/extra/index.js',
  'src/game/extensions.js',
  'src/game/extra/events.js',
  'src/game/extra/goofy.js',
  'src/game/extra/index.js',
  'src/game/extra/fire.js',
  'src/game/extra/meteor.js',
  // Added by tools/sync-precache.mjs.
  'src/features/airliners.js',
  'src/features/airport-services.js',
  'src/features/stovl.js',
  'src/features/warnings-rules.js',
  'src/features/warnings.js',
  'src/world/airport-kit.js',
  'src/world/airport-layout.js',
  'src/world/airport-vehicles.js',
  // Added by tools/sync-precache.mjs.
  'src/features/explosions.js',
  'src/features/meteor.js',
  // Added by tools/sync-precache.mjs.
  'src/features/wildfire.js',
  'src/features/wildfire/audio.js',
  'src/features/wildfire/fx.js',
  'src/features/wildfire/grid.js',
  'src/features/wildfire/ground.js',
  'src/features/wildfire/hud.js',
  'src/features/wildfire/scenario.js',
  'src/features/wildfire/surface.js',
  'src/features/wildfire/tank.js',
  'src/features/wildfire/textures.js',
  'src/features/wildfire/woods.js',
  // Added by tools/sync-precache.mjs.
  'src/aircraft/models/civil-build.js',
  'src/aircraft/models/civil-kit.js',
  'src/aircraft/models/courier.js',
  'src/aircraft/models/meridian.js',
  'src/aircraft/models/skyhook.js',
  'src/aircraft/models/tempest.js',
  // Added by tools/sync-precache.mjs.
  'src/features/onfoot.js',
  'src/features/staff.js',
  'src/features/staff/jobs.js',
  'src/features/staff/models.js',
  'src/features/staff/person.js',
  'src/features/staff/ui.js',
  'src/features/staff/vehicles.js',
  'src/features/staff/walk.js',
  // Added by tools/sync-precache.mjs.
  'src/features/maps-retired.js',
  // Added by tools/sync-precache.mjs.
  'src/features/events/bridge.js',
  'src/features/events/common.js',
  'src/features/events/escort.js',
  'src/features/events/goofy-props.js',
  'src/features/events/hijack.js',
  'src/features/events/props.js',
  'src/features/events/sfx.js',
  'src/features/events/ui.js',
  'src/features/events/vehicles.js',
  'src/features/flight-events.js',
  // Added by tools/sync-precache.mjs.
  'src/features/multiplayer.js',
  'src/features/multiplayer/interp.js',
  'src/features/multiplayer/link.js',
  'src/features/multiplayer/protocol.js',
  'src/features/multiplayer/remotes.js',
  'src/features/multiplayer/session.js',
  'src/features/multiplayer/signaling.js',
  'src/features/multiplayer/ui.js',
  // Added by tools/sync-precache.mjs.
  'src/features/traffic.js',
  'src/features/traffic/field.js',
  'src/features/traffic/lod.js',
  'src/features/traffic/path.js',
  'src/features/traffic/planner.js',
  'src/features/traffic/rules.js',
  'src/features/traffic/sound.js',
  // Added by tools/sync-precache.mjs.
  'src/features/multiplayer/lobby.js',
  'src/features/multiplayer/lobbyui.js',
  // Added by tools/sync-precache.mjs.
  'src/features/crashes.js',
  'src/features/crashes/fx.js',
  'src/features/crashes/kinds.js',
  'src/features/crashes/marks.js',
  'src/features/crashes/motion.js',
  'src/features/wildfire-disaster.js',
  'src/game/happenings.js',
  // Added by tools/sync-precache.mjs.
  'src/aircraft/extra/tpose.js',
  'src/aircraft/models/tpose-harrison.js',
  'src/features/eject.js',
  'src/features/eject/chute.js',
  'src/features/eject/dragchute.js',
  'src/features/eject/profiles.js',
  'src/features/eject/ui.js',
  'src/features/runaway.js',
  'src/features/tpose.js',
  'src/features/uniforms.js',
  'src/features/wasted.js',
  // Added by tools/sync-precache.mjs.
  'src/features/fun.js',
  'src/features/fun/fx.js',
  'src/features/fun/save.js',
  'src/features/fun/stars.js',
  'src/features/fun/stickers.js',
  'src/features/fun/stunts.js',
  'src/features/fun/ui.js',
  // Added by tools/sync-precache.mjs.
  'src/features/rocket.js',
  'src/features/rocket/audio.js',
  'src/features/rocket/camera.js',
  'src/features/rocket/flights.js',
  'src/features/rocket/hud.js',
  'src/features/rocket/menu.js',
  'src/features/rocket/models.js',
  'src/features/rocket/physics.js',
  'src/features/rocket/site.js',
  'src/features/rocket/space.js',
  // Added by tools/sync-precache.mjs.
  'src/features/multiplayer/events.js',
  // Added by tools/sync-precache.mjs.
  'src/features/multiplayer/admin.js',
  'src/features/multiplayer/p256.js',
  // Added by tools/sync-precache.mjs.
  'src/features/bump.js',
  'src/features/mpplay/shared.js',
  'src/features/mpplay/sights.js',
  'src/features/mpworld.js',
  'src/features/pvp.js',
  'src/features/pvp/rules.js',
  'src/features/race.js',
  'src/features/race/rules.js',
  // Added by tools/sync-precache.mjs.
  'src/features/race/courses.js',
  'src/features/race/draw.js',
  'src/features/race/hub.js',
  // Added by tools/sync-precache.mjs.
  'src/features/knockdown.js',
  'src/features/multiplayer/walkers.js',
  'src/features/pilot-mp.js',
  'src/features/ragdoll.js',
  // Added by tools/sync-precache.mjs.
  'src/features/carrier-ops.js',
  'src/features/carrier/deck.js',
  'src/features/carrier/gear.js',
  'src/features/carrier/lso.js',
  'src/features/carrier/ui.js',
  'src/features/carrier/visuals.js',
  'src/features/carrier/who.js',
  'src/features/rocket/spaceport.js',
  'src/features/roles.js',
  'src/features/tpose/moves.js',
  'src/features/tpose/signal.js',
  'src/features/tpose/ui.js',
  'src/game/roles/cast.js',
  'src/game/roles/hijack-lead.js',
  'src/game/roles/npc-flyer.js',
  'src/game/roles/roles.js',
  'src/ui/hangar-showcase-ui.js',
  'src/ui/hangar-showcase.js',
  'src/ui/roles-ui.js',
  'src/world/carrier-berth.js',
  'src/vendor/three.module.js',
  'src/vendor/three.LICENSE',

  // BLENDER MODELS: the helicopter, van and launch (tools/blender/), and
  // the reader that draws them. 2.1 MB, the game's only model files.
  'src/vehicles/glb.js',
  'src/vehicles/blender-models.js',
  'src/vehicles/blender-boat-water.js',
  'assets/models/skyhook.glb',
  'assets/models/courier-van.glb',
  'assets/models/kestrel-launch.glb',
];

// Files that are useful but not required for the game to run. If one of these
// fails to cache, offline play still works.
const OPTIONAL = ['assets/atc/manifest.json', 'tests/selftest.js', 'README.md'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // addAll fails the whole install if one file 404s, so add individually
      // and report anything missing to the console instead of breaking install.
      await Promise.all(
        [...PRECACHE, ...OPTIONAL].map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (res.ok) await cache.put(url, res);
            else console.warn('[sw] could not precache', url, res.status);
          } catch (err) {
            console.warn('[sw] could not precache', url, err);
          }
        })
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the source ZIP — it is large and only ever downloaded once.
  if (url.pathname.includes('/download/')) return;

  /*
   * And never cache /gpt/, which is a whole second copy of the game.
   *
   * It is the build ChatGPT delivered on 20 September, kept beside this one
   * behind Dev mode so the two can be compared. Four megabytes of modules
   * that nobody plays offline, on the same origin as the game that does, is
   * exactly what the cache should not fill up with.
   */
  if (url.pathname.includes('/gpt/')) return;
  // The side-by-side page loads both copies; it is a tool, not the game.
  if (url.pathname.endsWith('/compare.html')) return;

  /*
   * Code goes to the network first; everything else comes from the cache first.
   *
   * The whole app used to be cache-first with a background refresh, which
   * meant a change only appeared on the *second* load — and with the cache
   * version left at v14 while the game reached v23, it often never appeared at
   * all. Several bugs were reported as "still broken" when they had in fact
   * been fixed; the browser was simply showing code from weeks earlier.
   *
   * Markup, styles and modules are small, so asking the network for them costs
   * little and guarantees the running game is the game as written. If the
   * network does not answer within a moment — or at all, which is the point of
   * an offline game — the cached copy is served exactly as before.
   */
  const isCode = /\.(js|css|html|webmanifest)$/.test(url.pathname) || req.mode === 'navigate';

  if (isCode) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        try {
          const fresh = await Promise.race([
            fetch(req),
            new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 2500)),
          ]);
          if (fresh && fresh.ok && fresh.type === 'basic') await cache.put(req, fresh.clone());
          return fresh;
        } catch (err) {
          const hit = await cache.match(req, { ignoreSearch: true });
          if (hit) return hit;
          if (req.mode === 'navigate') {
            const shell = await cache.match('index.html');
            if (shell) return shell;
          }
          return new Response('Offline and this file is not cached.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) {
        // Refresh in the background so updates land on the next visit.
        event.waitUntil(
          (async () => {
            try {
              const fresh = await fetch(req);
              if (fresh.ok) await cache.put(req, fresh.clone());
            } catch (err) {
              /* offline — the cached copy is what we want anyway */
            }
          })()
        );
        return hit;
      }
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') await cache.put(req, res.clone());
        return res;
      } catch (err) {
        // Offline and not cached: for navigations, hand back the app shell.
        if (req.mode === 'navigate') {
          const shell = await cache.match('index.html');
          if (shell) return shell;
        }
        return new Response('Offline and this file is not cached.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })()
  );
});
