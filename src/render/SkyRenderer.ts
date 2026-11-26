import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { QualitySettings } from '../core/config';
import type { Environment } from '../environment/Environment';
import { WATER_LEVEL } from '../player/PlayerController';
import { cityUniforms } from './CityMaterial';

const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform float uFogDensity;
uniform float uWind;
varying vec3 vWorld;
float h(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float waves(vec2 p) {
  float t = uTime * (0.5 + uWind);
  return n(p * 0.09 + vec2(t * 0.11, t * 0.07)) * 0.5 + n(p * 0.31 - vec2(t * 0.17, -t * 0.12)) * 0.3 + n(p * 1.1 + vec2(-t * 0.3, t * 0.2)) * 0.2;
}
void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  float e = 0.6;
  float amp = (0.5 + uWind * 1.4) / (1.0 + dist * 0.004);
  float c = waves(vWorld.xz);
  vec3 nrm = normalize(vec3((waves(vWorld.xz + vec2(e, 0.0)) - c) * amp * 3.0, 1.0, (waves(vWorld.xz + vec2(0.0, e)) - c) * amp * 3.0));
  float fres = pow(1.0 - max(dot(view, nrm), 0.0), 4.0) * 0.92 + 0.04;
  vec3 refl = reflect(-view, nrm);
  vec3 sky = mix(uHorizon, uZenith, clamp(refl.y * 1.6, 0.0, 1.0));
  float glint = pow(max(dot(refl, uSunDir), 0.0), 220.0) * 3.0 + pow(max(dot(refl, uSunDir), 0.0), 24.0) * 0.25;
  vec3 col = mix(uDeep, sky, fres) + uSunColor * glint;
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uHorizon, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const CLOUD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCover;
uniform vec3 uLight;
uniform vec3 uDark;
uniform vec2 uOffset;
varying vec3 vWorld;
float h(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
void main() {
  vec2 p = (vWorld.xz + uOffset) * 0.00042 + vec2(uTime * 0.004, uTime * 0.0017);
  float d = fbm(p);
  float edge = 1.0 - uCover * 0.92;
  float a = smoothstep(edge - 0.12, edge + 0.22, d);
  float shade = smoothstep(edge, edge + 0.45, d);
  float r = length(vWorld.xz - cameraPosition.xz);
  a *= 1.0 - smoothstep(9000.0, 15000.0, r);
  gl_FragColor = vec4(mix(uLight, uDark, shade * (0.35 + 0.5 * uCover)), a * 0.94);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RAIN_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCentre;
uniform float uWind;
attribute float aEnd;
varying float vA;
void main() {
  vec3 p = position;
  float fall = uTime * (28.0 + fract(p.x * 7.3) * 10.0);
  p.y = mod(p.y - fall, 40.0);
  p.x += uWind * (40.0 - p.y) * 0.1;
  p.y += aEnd * 0.9;
  p.x -= aEnd * uWind * 0.09;
  vec3 w = vec3(mod(p.x - uCentre.x, 60.0) - 30.0 + uCentre.x, p.y + uCentre.y - 14.0, mod(p.z - uCentre.z, 60.0) - 30.0 + uCentre.z);
  vA = 0.35 + 0.4 * aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const tmp = new THREE.Color();
const lerpC = (out: THREE.Color, a: number, b: number, t: number) => out.set(a).lerp(tmp.set(b), Math.max(0, Math.min(1, t)));

/** Sky, sun and moon light, fog, clouds, sea, rain and stars — all driven by the Environment. */
export class SkyRenderer {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b6558, 1);
  private sky = new Sky();
  private water: THREE.Mesh;
  private clouds: THREE.Mesh;
  private rain: THREE.LineSegments;
  private stars: THREE.Points;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envScene = new THREE.Scene();
  private envSky = new Sky();
  private lastEnvKey = '';
  private sunDir = new THREE.Vector3(0, 1, 0);
  readonly horizon = new THREE.Color();
  private zenith = new THREE.Color();
  private sunColor = new THREE.Color();
  exposure = 0.6;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, private q: QualitySettings) {
    this.sky.scale.setScalar(40000);
    (this.sky.material as THREE.ShaderMaterial).fog = false;
    scene.add(this.sky);
    this.envSky.scale.setScalar(40000);
    this.envScene.add(this.envSky);

    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.setScalar(q.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 10; sc.far = 900;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.35;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.FogExp2(0xb8c8d8, 0.00018);

    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(60000, 60000, 1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
        uniforms: {
          uTime: cityUniforms.uTime, uSunDir: { value: this.sunDir }, uSunColor: { value: this.sunColor }, uZenith: { value: this.zenith },
          uHorizon: { value: this.horizon }, uDeep: { value: new THREE.Color(0x0b2a36) }, uFogDensity: { value: 0.0002 }, uWind: { value: 0.3 },
        },
      }),
    );
    this.water.position.y = WATER_LEVEL;
    this.water.renderOrder = -1;
    scene.add(this.water);

    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(36000, 36000).rotateX(Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: WATER_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uTime: cityUniforms.uTime, uCover: { value: 0.2 }, uLight: { value: new THREE.Color(1, 1, 1) }, uDark: { value: new THREE.Color(0.5, 0.52, 0.56) }, uOffset: { value: new THREE.Vector2() } },
      }),
    );
    this.clouds.position.y = 1500;
    this.clouds.renderOrder = 2;
    scene.add(this.clouds);

    // Rain: streaks in a box that wraps around the camera.
    const N = 2200;
    const pos = new Float32Array(N * 6), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * 60, y = Math.random() * 40, z = Math.random() * 60;
      pos.set([x, y, z, x, y, z], i * 6);
      end.set([0, 1], i * 2);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: 'uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(0.78, 0.84, 0.92, vA * uAlpha); }',
      transparent: true, depthWrite: false,
      uniforms: { uTime: cityUniforms.uTime, uCentre: { value: new THREE.Vector3() }, uWind: { value: 0.3 }, uAlpha: { value: 0 } },
    }));
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 3;
    scene.add(this.rain);

    const SN = 900;
    const sp = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random() * 0.95 + 0.02);
      sp.set([Math.sin(v) * Math.cos(u) * 20000, Math.cos(v) * 20000, Math.sin(v) * Math.sin(u) * 20000], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    if (q.envMap) this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  private applySky(sky: Sky, env: Environment, elev: number): void {
    const u = (sky.material as THREE.ShaderMaterial).uniforms;
    u.turbidity.value = 2.2 + env.cloud * 6 + env.fog * 8;
    u.rayleigh.value = (elev > 0 ? 1.1 + 1.6 * Math.max(0, 1 - elev * 2.2) : 0.2) * (1 - 0.55 * env.cloud);
    u.mieCoefficient.value = 0.004 + env.fog * 0.02;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
  }

  update(env: Environment, camera: THREE.PerspectiveCamera, focus: { x: number; y: number; z: number }): void {
    const elev = env.sunElevation(), az = env.sunAzimuth();
    const day = env.daylight(), night = 1 - day;
    this.sunDir.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az) * 0.85 + 0.25).normalize();
    this.applySky(this.sky, env, elev);
    this.sky.position.copy(camera.position);

    // Light: warm and low at dawn and dusk, white at noon, a dim blue moon at night.
    const low = Math.max(0, 1 - Math.max(0, elev) * 3.2);
    const overcast = 1 - 0.7 * env.cloud;
    lerpC(this.sunColor, 0xfff4e2, 0xff8a45, low * 0.9);
    if (day > 0.02) {
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = 3.4 * day * overcast;
      this.sun.position.set(focus.x + this.sunDir.x * 400, focus.y + Math.max(0.12, this.sunDir.y) * 400, focus.z + this.sunDir.z * 400);
    } else {
      this.sun.color.set(0x9fb4e6);
      this.sun.intensity = 0.7 * overcast;
      this.sun.position.set(focus.x - 160, focus.y + 380, focus.z + 120);
    }
    this.sunColor.multiplyScalar(day * overcast);
    this.sun.target.position.set(focus.x, focus.y, focus.z);
    this.sun.target.updateMatrixWorld();

    lerpC(this.zenith, 0x05070d, 0x3f78c9, day).lerp(tmp.set(0x7c8794), env.cloud * 0.75 * day);
    lerpC(this.horizon, 0x0a0d16, 0xb9cfe6, day);
    this.horizon.lerp(tmp.set(0xf0a070), low * day * 0.55 * overcast).lerp(tmp.set(0x9aa3ad), Math.max(env.cloud * 0.7, env.fog) * day);
    // City glow on the night horizon.
    this.horizon.lerp(tmp.set(0x2a2530), night * 0.5);
    this.hemi.color.copy(this.zenith).lerp(tmp.set(0xffffff), 0.35);
    this.hemi.groundColor.set(0x6b6558).multiplyScalar(0.35 + 0.65 * day);
    // Night is never black in a city: sodium haze off the clouds fills the shadows.
    this.hemi.color.lerp(tmp.set(0x4a5878), night * 0.8);
    this.hemi.groundColor.lerp(tmp.set(0x3a3026), night * 0.8);
    this.hemi.intensity = 0.95 * night + 1.5 * day * (0.75 + 0.25 * env.cloud);

    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.horizon);
    fog.density = 0.00012 + env.fog * 0.0042 + env.rain * 0.0009 + env.cloud * 0.00006;
    this.exposure = 0.5 + 0.34 * night;
    this.renderer.toneMappingExposure = this.exposure;

    const wu = (this.water.material as THREE.ShaderMaterial).uniforms;
    wu.uFogDensity.value = fog.density;
    wu.uWind.value = env.wind;
    this.water.position.x = camera.position.x; this.water.position.z = camera.position.z;

    const cu = (this.clouds.material as THREE.ShaderMaterial).uniforms;
    cu.uCover.value = env.cloud;
    cu.uOffset.value.set(0, 0);
    (cu.uLight.value as THREE.Color).copy(tmp.set(0xffffff)).multiplyScalar(0.12 + 0.95 * day).lerp(this.sunColor, low * 0.35 * day);
    (cu.uDark.value as THREE.Color).set(0x59606b).multiplyScalar(0.1 + 0.8 * day);
    this.clouds.position.x = camera.position.x; this.clouds.position.z = camera.position.z;

    const ru = (this.rain.material as THREE.ShaderMaterial).uniforms;
    ru.uAlpha.value = env.rain * 0.55;
    ru.uWind.value = env.wind * 3;
    (ru.uCentre.value as THREE.Vector3).copy(camera.position);
    this.rain.visible = env.rain > 0.02;

    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, night - 0.3) * (1 - env.cloud) * 1.3;
    this.stars.position.copy(camera.position);
    this.stars.visible = night > 0.3;

    cityUniforms.uNight.value = Math.min(1, night * 1.25);
    cityUniforms.uWet.value = env.wetness;

    // Image-based lighting from the sky, refreshed when the light has visibly changed.
    if (this.pmrem) {
      const key = `${Math.round(env.hour * 3)}|${Math.round(env.cloud * 5)}|${Math.round(env.fog * 4)}`;
      if (key !== this.lastEnvKey) {
        this.lastEnvKey = key;
        this.applySky(this.envSky, env, elev);
        const rt = this.pmrem.fromScene(this.envScene, 0, 1, 50000);
        this.envRT?.dispose();
        this.envRT = rt;
        this.scene.environment = rt.texture;
      }
      this.scene.environmentIntensity = 0.12 + 0.55 * day;
    }
  }
}
