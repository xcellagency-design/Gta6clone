import * as THREE from 'three';
import type { QualitySettings } from '../core/config';
import type { GameSim } from '../core/GameSim';
import type { CellData } from '../streaming/CellData';
import { CellView } from '../streaming/CellView';
import type { StreamView, ViewFactory } from '../streaming/StreamingManager';
import { VehicleRenderer } from '../vehicles/VehicleRenderer';
import { CharacterRenderer, type CharacterAnim, type CharacterPose } from './CharacterRenderer';
import { cityUniforms } from './CityMaterial';
import { SkyRenderer } from './SkyRenderer';

/** Something that adds characters to the frame (pedestrians, police on foot, story characters). */
export type CharacterSource = (add: (p: CharacterPose) => void) => void;

/** The three.js scene. Reads simulation state every frame; never writes to it. */
export class GameRenderer implements ViewFactory {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 30000);
  readonly world = new THREE.Group();
  readonly overlay = new THREE.Group();
  readonly sky: SkyRenderer;
  readonly characters: CharacterRenderer;
  readonly vehicles: VehicleRenderer;
  readonly characterSources: CharacterSource[] = [];
  readonly frameHooks: ((dt: number) => void)[] = [];
  frames = 0;
  playerLook = { shirt: 0x3d5a73, pants: 0x2b2d33, skin: 0xb98a66 };

  constructor(canvas: HTMLCanvasElement, readonly quality: QualitySettings) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.pixelRatio >= 1, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * quality.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.add(this.world, this.overlay);
    this.sky = new SkyRenderer(this.scene, this.renderer, quality);
    this.characters = new CharacterRenderer(quality.maxPedestrians + 24, quality.shadows);
    this.scene.add(this.characters.mesh);
    this.vehicles = new VehicleRenderer(quality.shadows);
    this.scene.add(this.vehicles.group);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** ViewFactory: scene objects for a streamed cell. */
  create(data: CellData): StreamView {
    return new CellView(data, this.quality.shadows, this.world);
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(sim: GameSim, dt: number): void {
    const cam = sim.camera;
    cityUniforms.uTime.value += dt;
    this.camera.position.set(cam.x, cam.y, cam.z);
    // Aim a little above the subject so the horizon stays in frame.
    this.camera.lookAt(cam.tx, cam.ty + (cam.cinematic ? 0 : 0.55), cam.tz);
    if (Math.abs(this.camera.fov - cam.fov) > 0.05) { this.camera.fov = cam.fov; this.camera.updateProjectionMatrix(); }

    const p = sim.player;
    this.characters.begin();
    const v = sim.playerVehicle;
    let anim: CharacterAnim = 'stand';
    if (p.mode === 'vehicle') anim = 'sit';
    else if (p.mode === 'swim') anim = 'swim';
    else if (!p.grounded) anim = 'air';
    else if (p.crouching) anim = 'crouch';
    // In a car the body is hidden by the cabin; on a bike or boat the rider shows.
    if (!v || v.isBike || v.isBoat) {
      this.characters.add({ x: p.x, y: p.y, z: p.z, heading: p.heading, stride: p.stride, speed: p.mode === 'vehicle' ? 0 : p.speed, anim, scale: 1, ...this.playerLook });
    }
    for (const src of this.characterSources) src((pose) => this.characters.add(pose));
    this.characters.end();
    this.vehicles.sync(sim.vehicles.all.values());
    this.sky.update(sim.env, this.camera, { x: cam.tx, y: 0, z: cam.tz });
    for (const fn of this.frameHooks) fn(dt);
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }

  info(): { drawCalls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return { drawCalls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }
}
