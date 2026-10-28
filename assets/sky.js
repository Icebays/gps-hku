/* The satellite map's sky: a dome around the camera with the sky's colours for the sun's height (day, golden hour,
   sunrise / sunset, blue hour, night), clouds from the weather (none on a clear day, more as it clouds over, low grey
   rain clouds when it rains) and rain streaks as heavy as the rainfall. palette() also gives the light the sky casts
   (map.js: on the buildings and the ground). */
import * as THREE from 'three';

const C = (h) => new THREE.Color(h);
// by the sun's elevation (degrees): zenith, horizon, horizon towards the sun, sun glow, sunlight, sky light (tint of
// the photo surfaces and of the ambient light), lit cloud, cloud shade
const KEYS = [
  [-18, '#03060f', '#070d1c', '#0a1222', '#000000', '#3a4a78', [0.2, 0.23, 0.34], '#1a2030', '#0c1018'],
  [-8, '#0a1a3c', '#1c3363', '#2a3a6a', '#000000', '#4a5c99', [0.32, 0.37, 0.55], '#2a3350', '#141a2c'],
  [-4, '#15336e', '#4469a8', '#8a6f9e', '#3a2a50', '#6f7fc0', [0.5, 0.56, 0.8], '#6a6f9a', '#2c3352'],     // blue hour
  [-1, '#23509a', '#a07ea0', '#f08a5a', '#ff7a3a', '#ff9a60', [0.84, 0.67, 0.62], '#f2a07a', '#5a4a6a'],   // sunrise / sunset
  [3, '#2f62b0', '#e8b08a', '#ffb070', '#ffa050', '#ffb47a', [0.97, 0.85, 0.75], '#ffd0a8', '#8a7a8a'],
  [10, '#3570c4', '#cfd9e6', '#f6dcb8', '#ffd8a0', '#ffe2bf', [1, 0.92, 0.84], '#fff1e0', '#a4a8b4'],      // golden hour
  [25, '#2e6bd0', '#b8d4ef', '#cfe0f2', '#fff4e0', '#fff8ee', [1, 1, 1], '#ffffff', '#b8c0cc'],
  [90, '#2a62c8', '#b0cdec', '#c4daf0', '#fffaf0', '#ffffff', [1, 1, 1], '#ffffff', '#c0c8d2'],
].map(([deg, z, h, sh, g, l, a, cl, cs]) => ({ deg, zenith: C(z), horizon: C(h), sunHorizon: C(sh), glow: C(g), light: C(l), amb: new THREE.Color(...a), cloudLit: C(cl), cloudShade: C(cs) }));
const FIELDS = ['zenith', 'horizon', 'sunHorizon', 'glow', 'light', 'amb', 'cloudLit', 'cloudShade'];
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/* The sky for the sun at `deg` degrees, `cloud` 0..1 of it clouded over, `rain` 0..1. */
export function palette(deg, cloud = 0, rain = 0) {
  const i = Math.max(0, KEYS.findIndex((k) => k.deg > deg) - 1), a = KEYS[i], b = KEYS[Math.min(KEYS.length - 1, i + 1)];
  const t = THREE.MathUtils.clamp((deg - a.deg) / Math.max(1e-6, b.deg - a.deg), 0, 1);
  const p = {};
  for (const f of FIELDS) p[f] = a[f].clone().lerp(b[f], t);
  // an overcast or rainy sky goes grey (as bright as the clear sky at this hour), the light flat and dimmer
  const over = THREE.MathUtils.smoothstep(cloud, 0.45, 1) * 0.85 + rain * 0.15;
  const grey = C('#aeb5bd').lerp(C('#6f7780'), rain).multiplyScalar(Math.min(1, lum(p.horizon) / lum(KEYS[6].horizon) + 0.02));
  for (const f of ['zenith', 'horizon', 'sunHorizon']) p[f].lerp(grey, over);
  p.glow.multiplyScalar(1 - over);
  p.light.lerp(new THREE.Color(1, 1, 1).multiplyScalar(lum(p.light)), over);
  p.amb.multiplyScalar((1 - 0.18 * over) * (1 - 0.15 * rain));
  p.cloudLit.lerp(C('#8a9099').multiplyScalar(lum(p.cloudLit)), rain);
  p.cloudShade.lerp(C('#4a5058').multiplyScalar(Math.max(0.15, lum(p.cloudLit))), rain);
  return p;
}

const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;   // on the far plane
}`;
const SKY_FS = `
uniform vec3 uZenith, uHorizon, uSunHorizon, uGlow, uSunDir, uCloudLit, uCloudShade;
uniform float uCloud, uRain, uTime, uSunUp;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec2 sxz = normalize(uSunDir.xz + 1e-5), dxz = normalize(d.xz + 1e-5);
  float toSun = pow(dot(dxz, sxz) * 0.5 + 0.5, 3.0);
  vec3 hor = mix(uHorizon, uSunHorizon, toSun);
  vec3 col = mix(hor, uZenith, pow(h, 0.5));
  float g = max(dot(d, normalize(uSunDir)), 0.0);
  col += uGlow * (pow(g, 6.0) * 0.35 + pow(g, 60.0) * 0.4) * (1.0 - uCloud * 0.7);
  col += uGlow * smoothstep(0.9993, 0.9997, g) * uSunUp * (1.0 - smoothstep(0.3, 0.8, uCloud));   // the sun's disc
  // clouds: a layer above, seen in perspective (thinner towards the horizon), drifting
  if (uCloud > 0.001) {
    vec2 p = d.xz / (h + 0.12) * 1.1 + vec2(uTime * 0.006, uTime * 0.0025);
    float n = fbm(p) + 0.18 * fbm(p * 3.1 - uTime * 0.01);
    float cov = mix(1.25, 0.12, uCloud);
    float c = smoothstep(cov, cov + 0.28 + 0.2 * uRain, n) * smoothstep(0.0, 0.1, h);
    float lit = clamp(0.55 + (n - cov) * 1.4 + 0.35 * pow(g, 3.0), 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    col = mix(col, cc, c * (0.9 + 0.1 * uRain));
  }
  // below the horizon (seen past the edge of the ground): the haze of the horizon
  col = mix(col, hor, smoothstep(0.0, -0.05, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// rain: streaks in a box that wraps around the camera, falling and slanting with a little wind
const RAIN_N = 6000, RAIN_R = 140, RAIN_H = 200;
const RAIN_VS = `
attribute float aEnd;
uniform vec3 uCam;
uniform float uTime, uLen;
void main() {
  vec3 p = position;
  vec3 w;
  w.xz = uCam.xz + mod(p.xz - uCam.xz + ${RAIN_R.toFixed(1)}, ${(2 * RAIN_R).toFixed(1)}) - ${RAIN_R.toFixed(1)};
  w.y = uCam.y - ${(RAIN_H * 0.7).toFixed(1)} + mod(p.y - uTime * 38.0, ${RAIN_H.toFixed(1)});
  w += vec3(0.18, -1.0, 0.08) * uLen * aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const RAIN_FS = `
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor, uOpacity); }`;

export function createSky() {
  const U = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() }, uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uCloud: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 }, uSunUp: { value: 1 },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24),
    new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false }));
  dome.renderOrder = -1000; dome.frustumCulled = false;

  const pos = new Float32Array(RAIN_N * 6), end = new Float32Array(RAIN_N * 2);
  for (let i = 0; i < RAIN_N; i++) {
    const x = Math.random() * 2 * RAIN_R, y = Math.random() * RAIN_H, z = Math.random() * 2 * RAIN_R;
    pos.set([x, y, z, x, y, z], i * 6); end.set([0, 1], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const RU = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uLen: { value: 7 }, uColor: { value: new THREE.Color(0xc9d3de) }, uOpacity: { value: 0.35 } };
  const rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: RU, vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, fog: false }));
  rain.frustumCulled = false; rain.visible = false; rain.renderOrder = 5;

  const group = new THREE.Group(); group.add(dome, rain);
  let last = null;
  const fwd = new THREE.Vector3();
  return {
    group,
    // p: palette(); sunDir: towards the true sun (may be below the horizon)
    set(p, sunDir, cloud, rainK) {
      last = p;
      for (const [u, f] of [['uZenith', 'zenith'], ['uHorizon', 'horizon'], ['uSunHorizon', 'sunHorizon'], ['uGlow', 'glow'], ['uCloudLit', 'cloudLit'], ['uCloudShade', 'cloudShade']]) U[u].value.copy(p[f]);
      U.uSunDir.value.copy(sunDir); U.uSunUp.value = THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.02);
      U.uCloud.value = cloud; U.uRain.value = rainK;
      rain.visible = rainK > 0.02;
      g.setDrawRange(0, Math.round(RAIN_N * Math.min(1, rainK) * 2 / 2) * 2);
      RU.uOpacity.value = 0.22 + 0.2 * rainK; RU.uLen.value = 5 + 6 * rainK;
      RU.uColor.value.setRGB(0.79, 0.83, 0.87).multiplyScalar(Math.max(0.25, lum(p.amb)));
    },
    // fog: the colour of the horizon the camera looks at (towards the sun: its glow), so the haze meets the sky there
    update(camera, seconds, fog) {
      dome.position.copy(camera.position);
      if (fog && last) {
        camera.getWorldDirection(fwd); fwd.y = 0;
        const s = U.uSunDir.value, k = Math.pow((fwd.normalize().dot(new THREE.Vector3(s.x, 0, s.z).normalize()) || 0) * 0.5 + 0.5, 3);
        fog.color.copy(last.horizon).lerp(last.sunHorizon, k);
      }
      U.uTime.value = seconds; RU.uTime.value = seconds; RU.uCam.value.copy(camera.position);
    },
  };
}
