// GLSL for the 2D proof of concept. Everything is "flat": no meshes, no depth buffer.
// Depth, shape, shadows and volume are all derived from signed distance fields (SDFs).

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** Shared scene description: boxes (walls, buildings, crates) and tanks, as analytic SDFs. */
const SCENE = /* glsl */ `
uniform vec2 uYard;
uniform vec4 uBox[16];      // x, y, w, h (world px)
uniform vec2 uBoxInfo[16];  // height, material
uniform int uBoxCount;
uniform vec4 uTank[2];      // x, y, hull angle, turret angle
uniform float uRecoil[2];

float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x + s * p.y, -s * p.x + c * p.y); }

// Returns (distance, object height, material id). Materials: 0 ground, 1 wall, 2 building, 3 crate, 4/5 tank team.
vec3 scene(vec2 p) {
  vec3 r = vec3(1e5, 0.0, 0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= uBoxCount) break;
    vec4 b = uBox[i];
    float d = sdBox(p - (b.xy + b.zw * 0.5), b.zw * 0.5);
    if (d < r.x) r = vec3(d, uBoxInfo[i].x, uBoxInfo[i].y);
  }
  for (int i = 0; i < 2; i++) {
    vec2 q = rot(p - uTank[i].xy, uTank[i].z);
    float d = sdBox(q, vec2(25.0, 20.0)) - 2.0;
    vec2 tq = rot(p - uTank[i].xy, uTank[i].w);
    float barrel = sdBox(tq - vec2(26.0 - uRecoil[i] * 6.0, 0.0), vec2(16.0, 2.6));
    d = min(d, barrel);
    if (d < r.x) r = vec3(d, 34.0, 4.0 + float(i));
  }
  return r;
}
`;

/** Pass 1: bake the scene's distance field + heights into a half-res texture used for shadow/AO marching. */
export const SDF_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
${SCENE}
void main() {
  // Stored un-flipped: texel (u, v) holds world point (u, v) * yard, so lookups are just texture(uSdf, p / uYard).
  vec2 p = vUv * uYard;
  vec3 s = scene(p);
  o = vec4(s.x, s.y, s.z, 1.0);
}`;

/** Pass 2: material, height/normals, lights with SDF soft shadows, fake volumetric scatter, smoke. Output is HDR (linear). */
export const LIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
${SCENE}
uniform sampler2D uSdf;
uniform vec4 uLight[16];     // x, y, z, radius
uniform vec4 uLightCol[16];  // rgb (pre-multiplied intensity), cone direction (or -9 = omni)
uniform int uLightCount;
uniform vec4 uSmoke[4];      // x, y, radius, alpha
uniform int uSmokeCount;
uniform vec4 uShell[8];      // x, y, vx, vy
uniform int uShellCount;
uniform vec2 uLamps[8];
uniform int uLampCount;
uniform float uTime;
uniform int uView;            // 0 final, 1 albedo, 2 normals, 3 sdf, 4 light only
uniform bvec4 uFx;            // normals, shadows, scatter, ambient occlusion

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

float puddle(vec2 p) { return smoothstep(0.60, 0.64, fbm(p * 0.006 + 3.1)); }

// Cobblestones: an offset brick grid of rounded stones. Returns (height, stone id).
vec2 cobble(vec2 p) {
  vec2 cs = vec2(16.0, 12.0);
  float row = floor(p.y / cs.y);
  vec2 q = vec2(p.x + mod(row, 2.0) * cs.x * 0.5, p.y);
  vec2 cell = floor(q / cs);
  vec2 f = q - (cell + 0.5) * cs;
  float d = sdBox(f, cs * 0.5 - 2.6) - 1.6;
  float h = smoothstep(1.0, -2.5, d) * (0.7 + 0.3 * hash(cell));
  return vec2(h, hash(cell + 7.0));
}

// Height of the visible surface at p (world px, z up). This "height map" is what gives flat
// sprites a shape: normals are its slope, and shadows test against it.
float heightAt(vec2 p) {
  vec3 s = scene(p);
  if (s.x > 0.0) {
    float c = cobble(p).x * 2.0;
    return mix(c, 0.4, puddle(p)); // water fills the gaps between stones
  }
  float bevel = s.z >= 4.0 ? 5.0 : (s.z == 3.0 ? 3.0 : 7.0);
  float h = s.y * smoothstep(0.0, bevel, -s.x);
  if (s.z >= 4.0) {
    int i = int(s.z) - 4;
    vec2 q = rot(p - uTank[i].xy, uTank[i].z);
    h = 18.0 * smoothstep(0.0, 4.0, -s.x);
    h -= smoothstep(13.0, 15.0, abs(q.y)) * 6.0;                       // treads sit lower
    h += abs(q.y) > 15.0 ? step(0.5, fract(q.x / 4.0)) * 1.2 : 0.0;    // tread links
    vec2 tq = rot(p - uTank[i].xy, uTank[i].w);
    float tr = length(tq + vec2(3.0, 0.0));
    if (tr < 13.0) h = max(h, 22.0 + 10.0 * sqrt(1.0 - (tr * tr) / 169.0)); // turret dome
    float barrel = sdBox(tq - vec2(26.0 - uRecoil[i] * 6.0, 0.0), vec2(16.0, 2.6));
    if (barrel < 0.0) h = max(h, 30.0 + 2.0 * sqrt(max(0.0, -barrel / 2.6)));
  } else if (s.z == 1.0) {
    // poured concrete slabs with a rounded pipe cap running along the top
    vec4 b; for (int i = 0; i < 16; i++) { if (i >= uBoxCount) break; vec4 bb = uBox[i]; if (sdBox(p - (bb.xy + bb.zw * 0.5), bb.zw * 0.5) <= s.x + 0.01) { b = bb; break; } }
    bool horiz = b.z > b.w;
    float across = horiz ? (p.y - b.y) / b.w : (p.x - b.x) / b.z;
    float along = horiz ? p.x : p.y;
    h += 6.0 * sqrt(max(0.0, 1.0 - pow((across - 0.5) * 2.2, 2.0)));
    h -= smoothstep(0.9, 1.0, abs(fract(along / 60.0) - 0.5) * 2.0) * 3.0;
    h += (fbm(p * 0.3) - 0.5) * 1.5;
  } else if (s.z == 3.0) {
    h += step(0.5, fract(p.x / 8.0 + p.y / 80.0)) * 1.0;   // corrugated metal
  } else {
    h += (fbm(p * 0.2) - 0.5) * 2.0 + step(0.92, fbm(p * 0.05)) * 4.0; // roof tar + vents
  }
  return h;
}

vec3 albedo(vec2 p, vec3 s) {
  if (s.x > 0.0) {
    vec2 c = cobble(p);
    vec3 stone = mix(vec3(0.42, 0.41, 0.37), vec3(0.56, 0.53, 0.46), c.y);
    vec3 moss = vec3(0.16, 0.24, 0.17);
    vec3 col = mix(moss, stone, smoothstep(0.05, 0.4, c.x));
    col = mix(col, col * vec3(0.8, 0.75, 0.68), smoothstep(0.4, 0.7, fbm(p * 0.01)));
    col = mix(col, vec3(0.08, 0.09, 0.09), puddle(p) * 0.85);
    return col;
  }
  if (s.z == 1.0) {
    vec3 col = vec3(0.66, 0.65, 0.61) * (0.85 + 0.25 * fbm(p * 0.05));
    float g = fbm(p * 0.03 + 11.0);
    if (g > 0.62) col = mix(col, vec3(0.77, 0.28, 0.23), 0.6);             // faded graffiti
    else if (g < 0.3) col = mix(col, vec3(0.38, 0.63, 0.73), 0.45);
    return col;
  }
  if (s.z == 2.0) return vec3(0.31, 0.34, 0.33) * (0.8 + 0.3 * fbm(p * 0.1));
  if (s.z == 3.0) return mix(vec3(0.45, 0.28, 0.17), vec3(0.3, 0.3, 0.27), fbm(p * 0.08));
  int i = int(s.z) - 4;
  vec3 team = i == 0 ? vec3(0.44, 0.66, 0.74) : vec3(0.73, 0.46, 0.34);
  vec2 q = rot(p - uTank[i].xy, uTank[i].z);
  if (abs(q.y) > 15.0) return vec3(0.1, 0.11, 0.12);
  return team * (0.85 + 0.2 * fbm(p * 0.2));
}

float smokeDensity(vec2 p) {
  float d = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uSmokeCount) break;
    vec4 s = uSmoke[i];
    float r = length(p - s.xy) / s.z;
    float n = fbm(p * 0.018 + vec2(uTime * 0.15, -uTime * 0.1) + float(i) * 13.0);
    d += s.w * smoothstep(1.0, 0.2, r + (n - 0.5) * 0.7);
  }
  return clamp(d, 0.0, 1.0);
}

// Soft shadow by sphere-tracing the baked SDF from the surface point toward the light.
// The ray rises from the surface height to the light's height, so tall walls cast long shadows
// and low crates short ones. Closest approach (d / t) gives the penumbra for free.
float shadow(vec2 p, float h0, vec3 L) {
  vec2 dir = L.xy - p;
  float D = length(dir);
  dir /= D;
  // Start just outside the object we're standing on, so a tank's turret doesn't shadow its own hull.
  float res = 1.0, t = 3.0 + max(0.0, -texture(uSdf, p / uYard).x), trans = 1.0;
  for (int i = 0; i < 28; i++) {
    if (t >= D) break;
    vec2 q = p + dir * t;
    vec4 s = texture(uSdf, vec2(q.x, q.y) / uYard);
    float rayH = mix(h0, L.z, t / D);
    float step_ = max(abs(s.x), 4.0);
    if (s.y > rayH + 1.0) {
      if (s.x < 0.5) return 0.0;
      res = min(res, 8.0 * s.x / t);
    }
    if (uSmokeCount > 0) trans *= exp(-smokeDensity(q) * step_ * 0.02);
    t += step_;
  }
  return clamp(res, 0.0, 1.0) * trans;
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uYard;
  vec3 s = scene(p);

  if (uView == 3) {
    float d = texture(uSdf, p / uYard).x;
    vec3 c = d < 0.0 ? vec3(0.9, 0.45, 0.3) : vec3(0.35, 0.6, 0.85);
    c *= 0.6 + 0.4 * cos(d * 0.25);
    c *= 1.0 - exp(-abs(d) * 0.3);
    o = vec4(lin(c), 1.0);
    return;
  }

  float h = heightAt(p);
  vec3 N = vec3(0, 0, 1);
  if (uFx.x) {
    float e = 1.0;
    float hx = heightAt(p + vec2(e, 0)) - heightAt(p - vec2(e, 0));
    float hy = heightAt(p + vec2(0, e)) - heightAt(p - vec2(0, e));
    N = normalize(vec3(-hx, -hy, 2.0 * e));
  }
  if (uView == 2) { o = vec4(lin(N * 0.5 + 0.5), 1.0); return; }

  vec3 A = lin(albedo(p, s));
  if (uView == 1) { o = vec4(A, 1.0); return; }
  if (uView == 4) A = vec3(0.5);

  bool wet = s.x > 0.0 && puddle(p) > 0.5;
  bool metal = s.z >= 3.0;
  float shin = wet ? 120.0 : (metal ? 40.0 : 8.0);
  float specK = wet ? 1.4 : (metal ? 0.5 : 0.04);

  // Contact shadows / ambient occlusion: the baked SDF says how close a taller object is.
  float ao = 1.0;
  if (uFx.w) {
    vec4 sd = texture(uSdf, p / uYard);
    if (sd.x > 0.0 && sd.y > h) ao = mix(0.35, 1.0, smoothstep(0.0, 28.0, sd.x));
  }

  // Cold overcast moonlight from the upper left, plus a low ambient term.
  vec3 moonDir = normalize(vec3(-0.45, -0.55, 0.7));
  float moonSh = uFx.y ? shadow(p, h, vec3(p + moonDir.xy * 600.0, h + moonDir.z * 600.0)) : 1.0;
  vec3 light = vec3(0.05, 0.07, 0.07) * ao + vec3(0.10, 0.13, 0.16) * max(dot(N, moonDir), 0.0) * moonSh;
  vec3 spec = vec3(0.0);
  vec3 scatter = vec3(0.0);
  vec3 smokeLight = vec3(0.07, 0.09, 0.09);

  for (int i = 0; i < 16; i++) {
    if (i >= uLightCount) break;
    vec4 Lp = uLight[i];
    vec4 Lc = uLightCol[i];
    vec2 d2 = Lp.xy - p;
    float dist = length(d2);
    if (dist > Lp.w) continue;
    float att = pow(1.0 - dist / Lp.w, 2.0);
    if (Lc.w > -5.0) { // spotlight cone
      vec2 cd = vec2(cos(Lc.w), sin(Lc.w));
      float cs = dot(normalize(-d2 + cd * 0.001), cd);
      att *= smoothstep(0.82, 0.95, cs) * step(6.0, dist) + smoothstep(14.0, 0.0, dist) * 0.5;
    }
    if (att <= 0.0) continue;
    float sh = uFx.y ? shadow(p, h, Lp.xyz) : 1.0;
    vec3 L = normalize(vec3(d2, Lp.z - h));
    float ndl = max(dot(N, L), 0.0);
    light += Lc.rgb * ndl * att * sh;
    vec3 H = normalize(L + vec3(0, 0, 1));
    spec += Lc.rgb * pow(max(dot(N, H), 0.0), shin) * specK * att * sh;
    // Fake volumetric: haze between the camera and the ground glows wherever this light reaches.
    // Because it reuses the ground point's shadow, walls carve visible light shafts into the haze.
    if (uFx.z) scatter += Lc.rgb * 0.05 * pow(1.0 - dist / Lp.w, 3.0) * sh;
    smokeLight += Lc.rgb * att * 0.6 * sh;
  }

  vec3 col = A * light + spec + scatter;

  // Emissives: lamp heads and shell tracers.
  for (int i = 0; i < 8; i++) {
    if (i >= uLampCount) break;
    float d = length(p - uLamps[i]);
    col += vec3(4.0, 2.4, 1.0) * smoothstep(5.0, 2.0, d);
  }
  for (int i = 0; i < 8; i++) {
    if (i >= uShellCount) break;
    vec2 a = uShell[i].xy, b = a - uShell[i].zw * 0.02;
    vec2 pa = p - a, ba = b - a;
    float k = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d = length(pa - ba * k);
    col += vec3(6.0, 3.0, 1.2) * smoothstep(3.0, 0.5, d) * (1.0 - k);
  }

  // Smoke drawn over the top, lit by the same lights (so it glows amber under a streetlamp).
  float sd = smokeDensity(p);
  col = mix(col, vec3(0.55, 0.57, 0.56) * smokeLight, sd * 0.92);

  o = vec4(col, 1.0);
}`;

export const BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec3 c = vec3(0.0);
  for (int x = -1; x <= 1; x += 2) for (int y = -1; y <= 1; y += 2) c += texture(uTex, vUv + vec2(x, y) * uTexel).rgb;
  c *= 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  o = vec4(c * smoothstep(0.6, 1.6, l), 1.0);
}`;

export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uDir; // texel-sized step along one axis (separable Gaussian)
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.227;
  c += (texture(uTex, vUv + uDir * 1.385).rgb + texture(uTex, vUv - uDir * 1.385).rgb) * 0.316;
  c += (texture(uTex, vUv + uDir * 3.231).rgb + texture(uTex, vUv - uDir * 3.231).rgb) * 0.070;
  o = vec4(c, 1.0);
}`;

export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uHdr;
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform bool uBloom;
uniform bool uGrade;
uniform float uTime;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture(uHdr, vUv).rgb;
  if (uBloom) c += texture(uBloomA, vUv).rgb * 0.5 + texture(uBloomB, vUv).rgb * 0.7;
  if (uGrade) {
    c = aces(c * 1.3);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, c * vec3(0.86, 1.0, 1.08), 1.0 - smoothstep(0.0, 0.5, l)); // cool shadows
    c = mix(c, c * vec3(1.08, 1.0, 0.88), smoothstep(0.4, 1.0, l));       // warm highlights
    vec2 v = vUv - 0.5;
    c *= 1.0 - dot(v, v) * 0.9;                                              // vignette
    c = pow(c, vec3(1.0 / 2.2));
    c += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.035;                         // film grain
  } else {
    c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  }
  o = vec4(c, 1.0);
}`;
