/**
 * An aircraft carrier.
 *
 * Built for the Osprey CV, which has had an arrester hook modelled on it since
 * the day it was added and nowhere to put it. The deck is a real landing
 * surface — registered as a platform, so `heightAt` returns deck height over
 * it and the undercarriage lands on steel rather than falling through to the
 * sea underneath.
 *
 * Everything is primitives and generated texture, like the rest of the world.
 */

import * as THREE from '../vendor/three.module.js';

/** The pack's carrier, if it loads. The ship is a picture; the deck is not. */
let packCarrier = null;
try {
  ({ createCarrier: packCarrier } = await import('../fleet/maritime.js'));
} catch (e) {
  console.warn('The pack carrier is unavailable; using the built-in ship.', e);
}
import { addPlatform, addObstacleAt } from './terrain.js';

/** Deck dimensions, in metres. A real Nimitz deck is 333 x 77. */
/*
 * Five times a real carrier.
 *
 * A Nimitz is 333 m and this was 300, which is right and reads as nothing
 * from a thousand feet up — "way too small" was the verdict, and adding
 * parked aircraft for scale only went so far. At 1,500 m it is longer than
 * the runway and unmistakable from anywhere on the map, and the deck is wide
 * enough that landing on it is a thing a ten-year-old can actually do.
 *
 * Everything else is derived from these numbers — the hull, the island, the
 * wires, the landing platform, the solid obstacle and the parked aeroplanes —
 * so this is the only place the size lives.
 */

/** What the pack builds, in metres: a real carrier, deck surface at 20.8. */
const REAL = { length: 300, width: 72, deckY: 20.8 };

/** How many times a real carrier this one is. */
export const SCALE = 5;

/*
 * The island, measured off the pack's own ship in its own units so that it
 * grows with the rest of it: a third of the width to starboard, a little aft
 * of midships, and tall enough to take in the radar mast.
 */
const ISLAND = { x: 24.4, z: 23, width: 13.4, depth: 29, height: 32 };

export const DECK = {
  length: REAL.length * SCALE,
  width: REAL.width * SCALE,
  /** Freeboard. The deck slab sits on this, and its top is 0.8 m higher. */
  height: REAL.deckY * SCALE - 0.8,
  /*
   * The landing surface: what the wheels touch, what `heightAt` returns over
   * the ship, and the one number that has to agree with the picture. Scaling
   * the model without scaling this is how you get a deck you fall through.
   */
  y: REAL.deckY * SCALE,
};

function deckTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#2e3237';
  g.fillRect(0, 0, S, S);
  // Non-skid: a fine speckle, which is what a flight deck actually looks like.
  let seed = 7717;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.08)';
    g.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  // The angled landing area, painted along the deck.
  g.strokeStyle = '#e8eef5';
  g.lineWidth = 5;
  g.setLineDash([26, 20]);
  g.beginPath();
  g.moveTo(S * 0.5, 0);
  g.lineTo(S * 0.5, S);
  g.stroke();
  g.setLineDash([]);
  // Edge lines.
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(232,238,245,0.8)';
  g.strokeRect(S * 0.14, 4, S * 0.72, S - 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Carrier {
  /**
   * @param {THREE.Scene} scene
   * @param {{x:number, z:number, headingDeg:number, name?:string}} at
   */
  constructor(scene, at) {
    this.group = new THREE.Group();
    this.group.name = 'carrier';
    this.pos = { x: at.x, z: at.z };
    this.name = at.name || 'CV-11 Resolute';

    /*
     * The ship itself comes from the model pack, which draws a far better one
     * than this file did: a real angled deck at 9 degrees, a glazed island
     * with a bridge and Pri-Fly, catapult tracks, arrester wires on sheaves
     * and a radar that turns. Its deck sits at 20.8 m, which is exactly where
     * this file already put it, so the landing surface does not move.
     *
     * What stays here is everything the game relies on: the deck registered
     * as a platform you can actually land on, the island registered as
     * something solid, and the published numbers the carrier missions read.
     * A prettier ship is not worth a deck you fall through.
     */
    if (packCarrier) {
      try {
        this.ship = packCarrier({ name: this.name });
        /*
         * The pack builds its ship at a real carrier's 300 m whatever DECK
         * says, so it is scaled to match. Scaling the picture rather than
         * rebuilding it keeps every detail — the angled deck markings, the
         * island, the wires — in proportion, and DECK stays the one place the
         * size is decided.
         */
        if (Math.abs(SCALE - 1) > 0.001) this.ship.scale.setScalar(SCALE);
        this.group.add(this.ship);
      } catch (e) {
        console.warn('The pack carrier could not be built; using the built-in one.', e);
        this.ship = null;
      }
    }

    const hullMat = new THREE.MeshStandardMaterial({ color: 0x3b434c, roughness: 0.85, metalness: 0.25 });
    const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.92, metalness: 0.1 });
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x4a525b, roughness: 0.8, metalness: 0.2 });

    const L = DECK.length;
    const W = DECK.width;
    const H = DECK.height;

    // The original ship, kept as the fallback. Everything below is skipped
    // when the pack built one.
    if (!this.ship) this.buildFallback(hullMat, deckMat, islandMat, L, W, H);

    this.group.position.set(at.x, 0, at.z);
    this.group.rotation.y = THREE.MathUtils.degToRad(-(at.headingDeg || 0));
    scene.add(this.group);
    this.register(at, L, W, H);
  }

  /** The slab-and-cone carrier this file used to draw. */
  buildFallback(hullMat, deckMat, islandMat, L, W, H) {
    // Hull: a slab that tapers to a bow, sitting in the water.
    const hull = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, H, L * 0.94), hullMat);
    hull.position.y = H / 2 - 4;
    hull.castShadow = hull.receiveShadow = true;
    this.group.add(hull);

    const bow = new THREE.Mesh(new THREE.ConeGeometry(W * 0.39, L * 0.16, 4), hullMat);
    bow.rotation.x = -Math.PI / 2;
    bow.rotation.y = Math.PI / 4;
    bow.position.set(0, H / 2 - 4, -L * 0.53);
    this.group.add(bow);

    // The flight deck itself.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 1.6, L), deckMat);
    // Named so the self-test can measure the painted deck against the one the
    // wheels land on, whichever ship is on the water.
    deck.name = 'flightDeck';
    deck.position.y = H;
    deck.receiveShadow = true;
    this.group.add(deck);

    // The island — the superstructure, always to starboard. Same place and
    // same size as the obstacle registered for it, and scaled with the ship.
    const iw = ISLAND.width * SCALE;
    const ih = ISLAND.height * SCALE * 0.6;
    const id = ISLAND.depth * SCALE;
    const isle = new THREE.Mesh(new THREE.BoxGeometry(iw, ih, id), islandMat);
    isle.position.set(ISLAND.x * SCALE, H + ih / 2, ISLAND.z * SCALE);
    isle.castShadow = true;
    this.group.add(isle);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5 * SCALE, 0.7 * SCALE, ISLAND.height * SCALE * 0.4, 8),
      islandMat
    );
    mast.position.set(ISLAND.x * SCALE, H + ih + ISLAND.height * SCALE * 0.2, ISLAND.z * SCALE);
    this.group.add(mast);

    // Arrester wires, across the landing area aft.
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, W * 0.62, 6), wireMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(-W * 0.04, H + 1.1, L * 0.192 + i * 12 * SCALE);
      this.group.add(w);
    }

  }

  register(at, L, W, H) {
    /*
     * Register the deck.
     *
     * The platform box is axis-aligned, so a carrier at an angle would have a
     * landing surface that did not match the picture. Rather than pretend, the
     * ship is placed on a cardinal heading and the box matches it exactly —
     * an honest deck you can trust beats a prettier one you fall through.
     */
    const along = Math.abs(((at.headingDeg || 0) % 180)) < 45;
    const bw = along ? W : L;
    const bd = along ? L : W;
    /*
     * Publish the deck so missions can ask about it instead of hard-coding it.
     * A mission that carries its own copy of these numbers is a mission that
     * silently points at empty sea the day the ship moves.
     */
    /*
     * The top of the deck slab — H + 0.8 by construction, but taken from DECK
     * so that the number the game lands on and the number the model is built
     * to can never drift apart again.
     */
    this.deckY = DECK.y;
    this.halfWidth = bw / 2;
    this.halfDepth = bd / 2;
    /*
     * The wires.
     *
     * Landing on a carrier without them is not hard, it is impossible: you get
     * 300 metres of deck, of which the last 90 are where you are allowed to
     * touch down, and no aeroplane in this game stops in 90 metres on wheel
     * brakes. Everyone who tried it ran off the bow.
     *
     * The band is deliberately generous — 70 m rather than the four wires'
     * real 14 m spacing — because the lesson worth teaching here is the
     * approach, not the inch.
     */
    /*
     * Proportional to the deck, not a fixed 72 metres.
     *
     * These were absolute offsets measured on a 300 m ship, so when the deck
     * grew five times they stayed a short band near the middle of an enormous
     * one — you would have flown the whole length looking for them.
     */
    const wireFrom = DECK.length * 0.133;
    const wireTo = DECK.length * 0.373;
    this.wires = along
      ? { z0: at.z + wireFrom, z1: at.z + wireTo }
      : { x0: at.x + wireFrom, x1: at.x + wireTo };
    addPlatform(at.x, at.z, bw, bd, this.deckY, this.name, {
      ...this.wires,
      along,
    });
    /*
     * The superstructure is solid; the deck is not, because you land on it.
     *
     * The box is the island the ship actually has, scaled with the ship and
     * standing on the deck. It used to be an 11 x 34 m box on the centreline
     * at hull height: the right hitbox for a ship five times smaller, a
     * hundred metres from the island and eighty below it.
     */
    const yaw = THREE.MathUtils.degToRad(-(at.headingDeg || 0));
    const ox = ISLAND.x * SCALE;
    const oz = ISLAND.z * SCALE;
    addObstacleAt(
      at.x + ox * Math.cos(yaw) + oz * Math.sin(yaw),
      at.z - ox * Math.sin(yaw) + oz * Math.cos(yaw),
      (along ? ISLAND.width : ISLAND.depth) * SCALE,
      (along ? ISLAND.depth : ISLAND.width) * SCALE,
      this.deckY,
      ISLAND.height * SCALE,
      `You flew into ${this.name}`
    );
  }

  /**
   * Park a few aeroplanes on the deck.
   *
   * The ship is 300 m long — a real Nimitz is 333 — and it still read as small
   * from the air, because an empty grey rectangle on an empty grey sea has
   * nothing in it to measure against. Six aeroplanes on the deck fix that
   * instantly: you know how big an aeroplane is, so now you know how big the
   * ship is.
   *
   * They are parked clear of the angled landing area, so nothing is in the way
   * of the thing you came here to do.
   */
  parkAircraft(makeModel, type, scheme) {
    if (!makeModel || !type) return;
    const W = DECK.width;
    const L = DECK.length;
    const spots = [
      [W * 0.30, -L * 0.30, 0.5],
      [W * 0.31, -L * 0.20, 0.5],
      [W * 0.30, -L * 0.10, 0.5],
      [-W * 0.34, L * 0.36, 2.4],
      [-W * 0.22, L * 0.40, 2.4],
      [W * 0.30, L * 0.42, 2.6],
    ];
    for (const [x, z, rot] of spots) {
      let m;
      try {
        m = makeModel({ type, livery: scheme });
      } catch (e) {
        console.warn('Could not park an aeroplane on the deck.', e);
        return;
      }
      m.position.set(x, this.deckY, z);
      m.rotation.y = rot;
      // Wings folded is beyond the models, so they simply sit still: engine
      // off, wheels down, nothing turning.
      if (m.userData.update) {
        try {
          m.userData.update(0.016, {
            controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 },
            rpm: 0, flaps: 0, gearPos: 1, gearDown: true, onGround: true,
            groundSpeed: 0, agl: 0, alt: this.deckY, engineOn: false,
            vel: new THREE.Vector3(), pos: m.position, quat: m.quaternion,
          }, { isNight: false, cond: { cloud: 0 } });
        } catch (e) {
          /* a model that will not animate parked is still fine to look at */
        }
      }
      this.group.add(m);
    }
  }

  dispose(scene) {
    scene.remove(this.group);
  }
}
