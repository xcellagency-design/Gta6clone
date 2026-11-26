import * as THREE from 'three';

/**
 * The one material every static surface of the city uses. There are no texture files: windows,
 * lane markings, paving joints, puddles and lit rooms are computed in the fragment shader from
 * surface coordinates in metres and a per-vertex style id (see streaming/styles.ts).
 *
 * Built on MeshStandardMaterial so lighting, shadows, fog and tone mapping stay three.js's own.
 */

export const cityUniforms = {
  uNight: { value: 0 },
  uWet: { value: 0 },
  uTime: { value: 0 },
};

const VERT_DECL = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aParams;
varying vec2 vCUv;
// Flat: style parameters are per-surface constants and must not pick up interpolation error,
// or every hash seeded from them turns into per-pixel noise.
flat varying vec4 vCParams;
varying vec3 vCWorld;
`;

const VERT_MAIN = /* glsl */ `
vCUv = aUv;
vCParams = aParams;
#ifdef USE_INSTANCING
  vCWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vCWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;

/** Instance colour tints a model unless a vertex opts out with seed < 0 (glass, tyres, lamps). */
const VERT_COLOR = /* glsl */ `
#ifdef USE_INSTANCING_COLOR
  if (aParams.y < -0.5) vColor.rgb = color.rgb;
#endif
`;

const FRAG_DECL = /* glsl */ `
uniform float uNight;
uniform float uWet;
uniform float uTime;
uniform float uFade;
varying vec2 vCUv;
// Flat: style parameters are per-surface constants and must not pick up interpolation error,
// or every hash seeded from them turns into per-pixel noise.
flat varying vec4 vCParams;
varying vec3 vCWorld;

float cHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), f.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float cFbm(vec2 p) {
  return 0.5 * cNoise(p) + 0.3 * cNoise(p * 2.7 + 11.0) + 0.2 * cNoise(p * 7.1 + 3.0);
}
// 1 inside [a, b], antialiased by w.
float cBand(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
}
`;

const FRAG_FADE = /* glsl */ `
if (uFade < 0.999) {
  float cDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (cDither > uFade) discard;
}
`;

const FRAG_COLOR = /* glsl */ `
float cStyle = floor(vCParams.x + 0.5);
vec3 cEmissive = vec3(0.0);
float cRough = 0.88;
float cMetal = 0.0;
vec3 cBase = diffuseColor.rgb;
// Screen-space derivatives are taken here, outside any branch, where they are well defined.
float cFwU = fwidth(vCUv.x);
float cFwV = fwidth(vCUv.y);
vec2 cFwW = fwidth(vCWorld.xz);
float cFwWm = max(cFwW.x, cFwW.y);

if (cStyle < 0.5) {
  // Plain surface: p2 roughness, p3 metalness.
  cRough = vCParams.z > 0.0 ? vCParams.z : 0.85;
  cMetal = vCParams.w;
  cBase *= 0.92 + 0.16 * cNoise(vCWorld.xz * 0.7 + vCWorld.y);
} else if (cStyle < 9.5) {
  // ── Façades ──────────────────────────────────────────────────────────────
  float seed = vCParams.y;
  float floorH = max(vCParams.z, 1.0);
  float bayW = max(vCParams.w, 0.5);
  vec2 g = vec2(vCUv.x / bayW, vCUv.y / floorH);
  vec2 id = floor(g);
  vec2 f = fract(g);
  float aa = max(cFwU / bayW, cFwV / floorH);
  // Fade the pattern to its average once a window is smaller than about a pixel.
  float lodFade = smoothstep(0.35, 1.1, aa);
  float w = clamp(aa, 0.002, 0.2);
  float rnd = cHash(id + seed * 91.7);
  float rnd2 = cHash(id * 1.37 + seed * 17.3 + 4.0);
  float win = 0.0;       // window mask
  float lit = 0.0;       // fraction of windows lit at night
  vec3 wall = cBase;
  vec3 glass = vec3(0.045, 0.07, 0.09);
  float winAvg = 0.3;
  float ground = step(vCUv.y, floorH);

  if (cStyle < 1.5) {
    // Curtain wall: glass floor to ceiling, thin mullions, spandrel band.
    float mull = 1.0 - cBand(f.x, 0.05, 0.95, w);
    float span = 1.0 - cBand(f.y, 0.14, 1.0, w);
    win = (1.0 - mull) * (1.0 - span);
    wall = cBase * 0.55;
    glass = cBase * (0.42 + 0.3 * rnd2);
    winAvg = 0.8; lit = 0.34;
    cMetal = mix(0.2, 0.75, win); cRough = mix(0.5, 0.09, win);
  } else if (cStyle < 2.5) {
    win = cBand(f.x, 0.2, 0.8, w) * cBand(f.y, 0.28, 0.82, w);
    winAvg = 0.33; lit = 0.3;
    wall *= 0.94 + 0.12 * cNoise(vCUv * 0.5);
    cRough = mix(0.86, 0.12, win); cMetal = mix(0.0, 0.55, win);
  } else if (cStyle < 3.5) {
    win = cBand(f.x, 0.3, 0.7, w) * cBand(f.y, 0.3, 0.76, w);
    // Balcony slab every other bay.
    float balc = step(0.5, fract(id.x * 0.5 + seed)) * cBand(f.y, 0.0, 0.08, w);
    wall = mix(wall, wall * 0.7, balc);
    wall *= 0.92 + 0.14 * cNoise(vCUv * 0.8 + seed * 10.0);
    winAvg = 0.18; lit = 0.5;
    cRough = mix(0.9, 0.15, win); cMetal = mix(0.0, 0.4, win);
  } else if (cStyle < 4.5) {
    // Shopfronts at street level, punched windows above.
    float shop = cBand(f.x, 0.06, 0.94, w) * cBand(vCUv.y, 0.5, floorH * 0.82, 0.03) * ground;
    float upper = cBand(f.x, 0.22, 0.78, w) * cBand(f.y, 0.28, 0.8, w) * (1.0 - ground);
    win = max(shop, upper);
    float awn = cBand(vCUv.y, floorH * 0.84, floorH, 0.03);
    vec3 awnCol = 0.5 + 0.5 * cos(6.2831 * (cHash(vec2(id.x, seed * 7.0)) + vec3(0.0, 0.33, 0.67)));
    wall = mix(wall, awnCol * 0.35, awn * ground * step(0.3, cHash(vec2(id.x + 3.0, seed))) * (1.0 - lodFade));
    winAvg = 0.35; lit = mix(0.25, 0.95, ground);
    cRough = mix(0.88, 0.1, win); cMetal = mix(0.0, 0.45, win);
  } else if (cStyle < 5.5) {
    // Corrugated metal with roll-up doors.
    float rib = 0.5 + 0.5 * sin(vCUv.x * 26.0);
    wall *= 0.82 + 0.22 * rib * (1.0 - smoothstep(0.2, 0.9, cFwU * 26.0));
    float door = cBand(f.x, 0.25, 0.75, w) * step(vCUv.y, 4.6) * step(0.55, rnd);
    wall = mix(wall, vec3(0.16, 0.17, 0.18), door);
    wall *= 0.9 + 0.2 * cNoise(vCUv * vec2(0.3, 1.2) + seed * 5.0);
    cRough = 0.55; cMetal = 0.5; winAvg = 0.0;
  } else if (cStyle < 6.5) {
    // Bare concrete with form lines and weather streaks.
    wall *= 0.88 + 0.12 * cNoise(vec2(vCUv.x * 0.4, vCUv.y * 2.5));
    wall *= 1.0 - 0.12 * cBand(fract(vCUv.y / 3.0), 0.0, 0.03, 0.01);
    cRough = 0.92; winAvg = 0.0;
  } else if (cStyle < 7.5) {
    // Lap siding, a few sash windows.
    float lap = fract(vCUv.y / 0.22);
    wall *= 0.93 + 0.07 * lap * (1.0 - smoothstep(0.3, 1.0, cFwV / 0.22));
    win = cBand(f.x, 0.32, 0.68, w) * cBand(f.y, 0.36, 0.74, w) * step(0.35, rnd);
    float trim = cBand(f.x, 0.29, 0.71, w) * cBand(f.y, 0.33, 0.77, w) * step(0.35, rnd);
    wall = mix(wall, vec3(0.85), (trim - win) * 0.8);
    winAvg = 0.1; lit = 0.55;
    cRough = mix(0.8, 0.15, win); cMetal = mix(0.0, 0.4, win);
  } else {
    // Open frame / chain-link: a see-nothing grid.
    float gx = cBand(f.x, 0.0, 0.06, w) + cBand(f.y, 0.0, 0.06, w);
    wall *= 0.75 + 0.35 * clamp(gx, 0.0, 1.0);
    cRough = 0.7; cMetal = 0.4; winAvg = 0.0;
  }

  float isLit = step(1.0 - lit, rnd) * uNight;
  vec3 lightCol = mix(vec3(1.0, 0.78, 0.48), vec3(0.78, 0.9, 1.0), step(0.72, rnd2));
  vec3 detailed = mix(wall, glass, win);
  vec3 detailedEm = win * isLit * lightCol * (0.9 + 1.4 * rnd2);
  vec3 avg = mix(wall, glass, winAvg);
  vec3 avgEm = winAvg * lit * uNight * vec3(1.0, 0.8, 0.52) * 1.1;
  cBase = mix(detailed, avg, lodFade);
  cEmissive = mix(detailedEm, avgEm, lodFade);
  if (lodFade > 0.5) { cRough = mix(cRough, 0.5, lodFade); cMetal *= 1.0 - 0.5 * lodFade; }
} else if (cStyle < 19.5) {
  // ── Roads ────────────────────────────────────────────────────────────────
  float asph = cFbm(vCWorld.xz * 0.9);
  float patchN = cNoise(vCWorld.xz * 0.06);
  cBase = cBase * (0.8 + 0.3 * asph) * (0.9 + 0.2 * patchN);
  cRough = 0.9;
  if (cStyle < 10.5) {
    float code = floor(vCParams.y + 0.5);
    float xw = floor(code / 10.0 + 0.001);
    float cls = code - xw * 10.0;
    float halfW = cls > 2.5 ? 13.0 : cls > 1.5 ? 8.5 : 5.0;
    float lanes = cls;
    float u = vCUv.x, v = vCUv.y;
    float halfLen = vCParams.z;
    float aw = clamp(cFwU, 0.01, 0.5);
    float edge = halfW - 0.45;
    float laneW = (edge - (cls > 2.5 ? 0.9 : 0.25)) / lanes;
    float off = cls > 2.5 ? 0.9 : 0.25;
    float dash = step(fract(v / 9.0), 0.36);
    vec3 white = vec3(0.78);
    vec3 yellow = vec3(0.82, 0.62, 0.12);
    float m = 0.0; vec3 mc = white;
    // Lane dividers.
    for (float i = 1.0; i < 3.0; i += 1.0) {
      if (i < lanes) m = max(m, cBand(abs(u), off + laneW * i - 0.07, off + laneW * i + 0.07, aw) * dash);
    }
    // Edge lines.
    if (cls > 1.5) m = max(m, cBand(abs(u), edge - 0.08, edge + 0.08, aw));
    // Centre.
    float cm = 0.0;
    if (cls < 1.5) cm = cBand(abs(u), 0.0, 0.08, aw) * dash;
    else if (cls < 2.5) cm = cBand(abs(u), 0.1, 0.24, aw);
    else { float med = cBand(abs(u), 0.0, 0.6, aw); cBase = mix(cBase, vec3(0.42, 0.42, 0.4), med); cm = cBand(abs(u), 0.7, 0.86, aw); }
    // Markings stop short of the intersection; a stop line and zebra go there instead.
    float d0 = v + halfLen, d1 = halfLen - v;
    float startX = step(0.5, mod(xw, 2.0)), endX = step(1.5, xw);
    float nearX = min(mix(99.0, d0, startX), mix(99.0, d1, endX));
    float clear = smoothstep(7.5, 8.0, nearX);
    m *= clear; cm *= clear;
    float zebra = cBand(nearX, 1.2, 4.2, 0.05) * step(fract(u / 1.2), 0.5) * step(abs(u), edge);
    float stopL = cBand(nearX, 5.6, 6.1, 0.05) * step(abs(u), edge);
    float fadeM = 1.0 - smoothstep(0.25, 0.9, cFwU);
    cBase = mix(cBase, yellow, cm * fadeM * 0.85);
    cBase = mix(cBase, mc, max(m, max(zebra, stopL)) * fadeM * 0.8);
  }
  // Rain: darker, glossier, with standing water in the low spots.
  float puddle = smoothstep(0.52, 0.7, cFbm(vCWorld.xz * 0.11 + 7.0));
  cBase *= 1.0 - 0.38 * uWet;
  cRough = mix(cRough, mix(0.34, 0.05, puddle), uWet);
  cMetal = 0.0;
} else if (cStyle < 29.5) {
  // ── Ground ───────────────────────────────────────────────────────────────
  vec2 wp = vCWorld.xz;
  if (cStyle < 20.5) {
    vec2 j = abs(fract(wp / 1.6) - 0.5);
    float joint = 1.0 - smoothstep(0.47, 0.5, max(j.x, j.y));
    float jf = 1.0 - smoothstep(0.2, 0.7, cFwWm / 1.6);
    cBase *= (0.9 + 0.16 * cFbm(wp * 0.6)) * mix(1.0, 0.82 + 0.18 * joint, jf);
    cRough = mix(0.9, 0.4, uWet); cBase *= 1.0 - 0.25 * uWet;
  } else if (cStyle < 21.5) {
    float n = cFbm(wp * 0.35), n2 = cNoise(wp * 3.1);
    cBase *= 0.72 + 0.4 * n + 0.14 * n2;
    cBase = mix(cBase, cBase * vec3(1.15, 1.08, 0.8), smoothstep(0.55, 0.8, cNoise(wp * 0.05)) * 0.5);
    cRough = 0.95;
  } else if (cStyle < 22.5) {
    float ripple = 0.5 + 0.5 * sin(wp.x * 1.7 + cNoise(wp * 0.3) * 6.0);
    cBase *= 0.9 + 0.1 * cFbm(wp * 0.5) + 0.04 * ripple;
    cRough = 0.96;
  } else if (cStyle < 23.5) {
    cBase *= 0.75 + 0.4 * cFbm(wp * 0.4);
    cRough = mix(0.95, 0.5, uWet); cBase *= 1.0 - 0.3 * uWet;
  } else if (cStyle < 24.5) {
    float bay = cBand(fract(wp.x / 2.6), 0.0, 0.045, cFwWm / 2.6) * step(fract(wp.y / 17.0), 0.62);
    float bf = 1.0 - smoothstep(0.2, 0.7, cFwWm / 2.6);
    cBase = cBase * (0.8 + 0.3 * cFbm(wp * 0.7));
    cBase = mix(cBase, vec3(0.7), bay * bf * 0.7);
    cRough = mix(0.9, 0.3, uWet); cBase *= 1.0 - 0.3 * uWet;
  } else if (cStyle < 25.5) {
    float dir = step(0.5, vCParams.y);
    float row = 0.5 + 0.5 * sin((dir > 0.5 ? wp.x : wp.y) * 2.1);
    float rf = 1.0 - smoothstep(0.3, 1.2, cFwWm * 2.1);
    cBase *= mix(1.0, 0.72 + 0.4 * row, rf) * (0.85 + 0.25 * cNoise(wp * 0.08));
    cRough = 0.96;
  } else if (cStyle < 26.5) {
    float plank = fract(wp.x / 0.3 + wp.y / 0.3);
    cBase *= 0.8 + 0.2 * cHash(floor(wp / 0.3)) * (1.0 - smoothstep(0.3, 1.0, cFwWm / 0.3));
    cRough = 0.8;
  } else {
    // Pool.
    float cs = 0.5 + 0.5 * sin(wp.x * 2.3 + uTime * 1.3) * sin(wp.y * 2.1 - uTime);
    cBase = cBase * (0.8 + 0.3 * cs);
    cEmissive = cBase * 0.5 * uNight;
    cRough = 0.06;
  }
} else {
  // ── Emitters ─────────────────────────────────────────────────────────────
  if (cStyle < 30.5) {
    float flick = 0.92 + 0.08 * sin(uTime * (8.0 + 20.0 * vCParams.y) + vCParams.y * 40.0);
    cEmissive = cBase * (0.35 + 2.6 * uNight) * flick;
    cBase *= 0.6;
  } else if (cStyle < 31.5) {
    cEmissive = cBase * (0.05 + 4.0 * uNight);
  } else {
    cEmissive = cBase * 2.5;
  }
  cRough = 0.4;
}
diffuseColor.rgb = cBase;
`;

export interface CityMaterialHandle {
  material: THREE.MeshStandardMaterial;
  fade: { value: number };
}

/**
 * Each cell layer gets its own material instance so it can cross-fade independently; they all
 * compile to the same program because the injected source is identical.
 */
export function createCityMaterial(opts: { instanced?: boolean; doubleSide?: boolean } = {}): CityMaterialHandle {
  const fade = { value: 1 };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.uniforms.uWet = cityUniforms.uWet;
    shader.uniforms.uTime = cityUniforms.uTime;
    shader.uniforms.uFade = fade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN)
      .replace('#include <color_vertex>', '#include <color_vertex>\n' + VERT_COLOR);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_FADE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = cRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = cMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cEmissive;');
  };
  material.customProgramCacheKey = () => 'city-v3';
  return { material, fade };
}

/** Sets the attributes the city shader needs on a geometry made elsewhere (props, for instance). */
export function setCityAttributes(geo: THREE.BufferGeometry, style: number, seed = 0, p2 = 0.8, p3 = 0): void {
  const n = geo.getAttribute('position').count;
  const params = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) params.set([style, seed, p2, p3], i * 4);
  geo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
  if (!geo.getAttribute('aUv')) geo.setAttribute('aUv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
}
