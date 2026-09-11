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
import { addPlatform, addObstacleAt } from './terrain.js';

/** Deck dimensions, in metres. A real Nimitz deck is 333 x 77. */
export const DECK = { length: 300, width: 72, height: 20 };

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

    const hullMat = new THREE.MeshStandardMaterial({ color: 0x3b434c, roughness: 0.85, metalness: 0.25 });
    const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.92, metalness: 0.1 });
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x4a525b, roughness: 0.8, metalness: 0.2 });

    const L = DECK.length;
    const W = DECK.width;
    const H = DECK.height;

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
    deck.position.y = H;
    deck.receiveShadow = true;
    this.group.add(deck);

    // The island — the superstructure, always to starboard.
    const isle = new THREE.Mesh(new THREE.BoxGeometry(11, 22, 34), islandMat);
    isle.position.set(W * 0.34, H + 11, L * 0.08);
    isle.castShadow = true;
    this.group.add(isle);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 16, 8), islandMat);
    mast.position.set(W * 0.34, H + 30, L * 0.08);
    this.group.add(mast);

    // Arrester wires, across the landing area aft.
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, W * 0.62, 6), wireMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(-W * 0.04, H + 1.1, L * 0.18 + i * 14);
      this.group.add(w);
    }

    this.group.position.set(at.x, 0, at.z);
    this.group.rotation.y = THREE.MathUtils.degToRad(-(at.headingDeg || 0));
    scene.add(this.group);

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
    addPlatform(at.x, at.z, bw, bd, H + 0.8, this.name);
    // The superstructure is solid; the deck is not, because you land on it.
    addObstacleAt(
      at.x + (along ? W * 0.34 : 0),
      at.z + (along ? 0 : W * 0.34),
      along ? 11 : 34,
      along ? 34 : 11,
      H,
      34,
      `You flew into ${this.name}`
    );
  }

  dispose(scene) {
    scene.remove(this.group);
  }
}
