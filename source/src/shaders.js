// ============================================================================
// WGSL sources — Descent Subterranean Mine & Reactor Environment
// ============================================================================

const W_NOISE = /*wgsl*/`
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn vn(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1., 0., 0.)), u.x), mix(h31(i + vec3f(0., 1., 0.)), h31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h31(i + vec3f(0., 0., 1.)), h31(i + vec3f(1., 0., 1.)), u.x), mix(h31(i + vec3f(0., 1., 1.)), h31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
fn fbm(p: vec3f, n: i32) -> f32 {
  var a = .5; var s = 0.; var q = p;
  for (var i = 0; i < n; i++) { s += a * vn(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); a *= .5; }
  return s / (1. - 2. * a);
}
fn wor(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + h33(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
`;

// ---------------------------------------------------------------- subterranean mine density (compute)
// D > 0 = solid asteroid rock / concrete; D < 0 = carved mine chambers & 6DoF octagonal tunnels
const W_DENS = W_NOISE + /*wgsl*/`
struct U { n: vec4u, o: vec4f, c: vec4u };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> D: array<f32>;
@group(0) @binding(2) var<storage, read> P: array<vec4f>;
fn smax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
fn smin(a: f32, b: f32, k: f32) -> f32 { return -smax(-a, -b, k); }
fn seg2(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
// Octagonal / chamfered-box tunnel & girder cross-section SDF along 3D segment AB
fn octSeg(p: vec3f, a: vec3f, b: vec3f, rw: f32, rh: f32) -> f32 {
  let ba = b - a; let l2 = max(dot(ba, ba), 1e-4);
  let h = clamp(dot(p - a, ba) / l2, 0., 1.);
  let d = p - (a + ba * h);
  let t = normalize(ba);
  let up = select(vec3f(0., 1., 0.), vec3f(1., 0., 0.), abs(t.y) > .92);
  let rt = normalize(cross(t, up));
  let u2 = cross(rt, t);
  let lx = abs(dot(d, rt)) - rw;
  let ly = abs(dot(d, u2)) - rh;
  let lz = abs(dot(d, t)) - min(rw, rh);
  let box2 = max(lx, ly);
  let oct2 = max(box2, (lx + ly) * .74 + min(rw, rh) * .18);
  return max(oct2, lz);
}
fn dens(p: vec3f) -> f32 {
  let w = vec3f(fbm(p * .045 + 11., 3), fbm(p * .045 + 47., 3), fbm(p * .045 + 83., 3)) - .5;
  var d = 24.; // Start with solid subterranean asteroid rock
  var rgh = 1.;
  var k = 0u;
  // 1. Carve Major Octagonal Chambers (MESAS) — Natural caverns retain organic domain warping scaled by b.w!
  for (var i = 0u; i < u.c.x; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    let qw = p + w * vec3f(3.4, 2.4, 3.4) * clamp(b.w * 2.4, .15, 1.25);
    let l = abs(qw - a.xyz) - vec3f(a.w, b.x, b.y);
    let box3 = max(l.x, max(l.y, l.z));
    let chm = max(box3, (l.x + l.y + l.z) * .62 + min(a.w, b.x) * b.z);
    d = smin(d, chm, 2.4);
    rgh = mix(rgh, b.w, ss(6., -2., chm));
  }
  // 2. Skip ARCHES for now (processed after tunnels so pillars & girders stand inside chambers)
  let kArch = k;
  k += u.c.y * 2u;
  // 3. Carve Precision-Bored 6DoF Octagonal Tunnel Segments (HOLES) — Unwarped planar walls + 8m cube-segment bays!
  for (var i = 0u; i < u.c.z; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    let ba = vec3f(a.w, b.xy) - a.xyz;
    let sProj = dot(p - a.xyz, normalize(ba));
    let bay = step(.22, abs(fract(sProj * .125) - .5)) * .32;
    let td = octSeg(p, a.xyz, vec3f(a.w, b.xy), b.z + bay, b.w + bay * .5);
    d = smin(d, td, .55);
    rgh = mix(rgh, .025, ss(1.8, -.4, td));
  }
  // 4. Smooth machined zones (CLEARS)
  var clr = 0.;
  for (var i = 0u; i < u.c.w; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    clr = max(clr, 1. - ss(0., b.y, seg2(p.xz, a.xy, a.zw) - b.x));
  }
  // 5. Add Planar Structural Support Columns & Cross-Girders (ARCHES) — Unwarped crisp octagonal shafts!
  var kp = kArch;
  for (var i = 0u; i < u.c.y; i++) {
    let a = P[kp]; let b = P[kp + 1u]; kp += 2u;
    let pil = octSeg(p, a.xyz, vec3f(a.w, b.xy), b.z, b.z);
    d = smax(d, -pil, .4);
    rgh = mix(rgh, .015, ss(1.5, -.2, pil));
  }
  // 6. Natural asteroid rock Worley mineral facets (on rough cavern walls) vs clean machined ribs (on tunnels/supports)
  let rk = clamp(rgh * (1. - clr * .75), .015, 1.);
  d += rk * ((.5 - wor(p * .18 + w * 1.5)) * 2.8 + (.5 - wor(p * .42 + 7.)) * 1.1 + (fbm(p * .28, 3) - .5) * 1.6);
  d += mix(.18, .45, rk) * (abs(fract(p.y * .25) - .5) - .25);
  // Keep global solid bedrock floor below magma level (-54) and solid ceiling cap above y = -2
  d = smax(d, -54.5 - p.y, 1.5);
  d = smax(d, p.y + 1.5, 1.5);
  return d;
}
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= u.n.xyz)) { return; }
  var d = dens(u.o.xyz + vec3f(id) * u.o.w);
  if (id.x <= 1u || id.z <= 1u || id.x >= u.n.x - 2u || id.z >= u.n.z - 2u || id.y == 0u || id.y >= u.n.y - 2u) { d = 10.; }
  D[id.x + u.n.x * (id.y + u.n.y * id.z)] = d;
}
`;

// ---------------------------------------------------------------- fullscreen helpers
const W_FS = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
`;

// rock & industrial panel detail texture (tileable): rg = slope, b = height (rock + riveted panels), a = panel/grate mask
const W_DETAIL = W_NOISE + W_FS + /*wgsl*/`
fn hp(p: vec2f, per: f32) -> f32 { return h31(vec3f(p - per * floor(p / per), per)); }
fn tn(p: vec2f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(hp(i, per), hp(i + vec2f(1., 0.), per), u.x), mix(hp(i + vec2f(0., 1.), per), hp(i + vec2f(1., 1.), per), u.x), u.y);
}
fn tf(uv: vec2f, per: f32, n: i32) -> f32 { var a = .5; var s = 0.; var pr = per; for (var i = 0; i < n; i++) { s += a * tn(uv * pr + f32(i) * 7.3, pr); pr *= 2.; a *= .5; } return s / (1. - 2. * a); }
fn tw(p: vec2f, per: f32) -> vec3f {
  let i = floor(p); let f = fract(p); var d = vec2f(9.); var id = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let c = i + o; let cw = c - per * floor(c / per);
    let hh = h33(vec3f(cw, per)); let r = o + hh.xy - f; let l = dot(r, r);
    if (l < d.x) { d.y = d.x; d.x = l; id = hh.z; } else if (l < d.y) { d.y = l; }
  } }
  return vec3f(sqrt(d), id);
}
fn H(uv: vec2f) -> f32 {
  let wq = uv + .08 * (vec2f(tf(uv, 3., 4), tf(uv + .5, 3., 4)) - .5);
  let f = tf(wq, 4., 7);
  let r1 = 1. - abs(tf(wq + 1.7, 6., 5) * 2. - 1.);
  // Industrial panel seams & rivets blended with fractured rock
  let g1 = abs(fract(uv * 8.) - .5);
  let seam = ss(.48, .44, max(g1.x, g1.y));
  let rv = ss(.12, .06, length(abs(fract(uv * 8.) - .5) - vec2f(.38)));
  let pt = tw(wq * 24., 24.);
  let facet = clamp((pt.y - pt.x) * 2.2, 0., 1.);
  return f * .42 + r1 * r1 * .22 + facet * .22 + seam * .14 + rv * .08;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 1024.; let e = 1. / 1024.;
  let h = H(uv);
  let gx = H(uv + vec2f(e, 0.)) - H(uv - vec2f(e, 0.)); let gy = H(uv + vec2f(0., e)) - H(uv - vec2f(0., e));
  let s = clamp(vec2f(gx, gy) * 1024. * .5 * .08, vec2f(-1.), vec2f(1.));
  let g2 = abs(fract(uv * 16.) - .5);
  let panel = ss(.47, .42, max(g2.x, g2.y)) * (.6 + .4 * tf(uv + 3.7, 4., 4));
  return vec4f(-s * .5 + .5, h, panel);
}
`;

// blit / mip / bloom chain
const W_BLIT = W_FS + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, uvOf(fc, 2.), 0.); }
fn kar(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  let a = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let m = a + b + c + d;
  return vec4f(m.rgb / m.a, 1.);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, .5); let e = .75 / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
`;

// animated magma & plasma energy lattice texture: r = plasma/magma veins, ba = convection slope
const W_WATER = W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> tm: vec4f;
fn caus(uv: vec2f, t: f32) -> f32 {
  let p = uv * 6.2831853;
  var i = p; var c = 0.;
  for (var n = 1; n <= 5; n++) {
    let tt = t * (1. - 3.5 / f32(n));
    i = p + vec2f(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    let s = sin(i.x + tt); let k = cos(i.y + tt);
    c += abs(s * k) / (1.25 * sqrt(s * s + k * k) + 1e-4);
  }
  c = 1.17 - pow(c / 5., 1.4);
  return pow(abs(c), 7.);
}
const WK = array<vec3f, 10>(vec3f(1., 2., 1.), vec3f(-2., 1., .9), vec3f(3., 1., .6), vec3f(1., -4., .5), vec3f(4., 3., .4),
  vec3f(-3., 5., .32), vec3f(6., -2., .28), vec3f(5., 7., .2), vec3f(-8., 3., .18), vec3f(2., 11., .14));
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / ${WATER}.; let t = tm.x;
  let c = caus(uv, t * .38 + 23.);
  let wu = uv + .02 * vec2f(sin(6.2831853 * (uv.y * 2. + .08 * t)), cos(6.2831853 * (uv.x * 3. - .06 * t)));
  var s = vec2f(0.);
  for (var i = 0; i < 10; i++) {
    let k = WK[i];
    s += k.xy * k.z * cos(dot(k.xy, wu) * 6.2831853 + t * (.4 + .3 * sqrt(length(k.xy))) * select(-1., 1., (i & 1) == 0) + f32(i) * 1.7);
  }
  return vec4f(c, c, s * .06);
}
`;

// ---------------------------------------------------------------- shared scene code
// Atmosphere: smoky subterranean mine haze (warm amber/crimson reactor haze -> cool cyan/indigo in Energy bays)
const S_G = /*wgsl*/`
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, sun: vec4f, res: vec4f, mis: vec4f };
const SIG = vec3f(.016, .019, .024);
const KD = vec3f(.012, .016, .022);
const WCOL = vec3f(.42, .26, .18);
const KDZ = vec3f(.012, .014, .012);
const PCOL = vec3f(.18, .48, .85);
const SUNC = vec3f(1.85, 1.55, 1.25);
const TAU = 6.2831853;
const LOW = ${LV > 1};
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }
fn hs(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn kd(z: f32) -> vec3f { return mix(KD, KDZ, z); }
fn sg(z: f32) -> vec3f { return mix(SIG, vec3f(.015, .018, .016), z); }
fn fin(c: vec3f) -> vec4f { return vec4f(min(max(c, vec3f(0.)), vec3f(40.)), 1.); }
const KDF = vec3f(.014, .015, .014);
fn fogIn(ro: vec3f, rd: vec3f, d: f32, z: f32, sun: vec3f) -> vec3f {
  let a = sg(z);
  let I = (1. - exp(-a * d)) / a;
  let hd = max(dot(rd, normalize(g.fwd.xyz)), 0.);
  return mix(WCOL, PCOL, z) * sg(z) * I * (.48 + .65 * pow(hd, 6.));
}
`;

const S_B = S_G + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sC: sampler;
@group(0) @binding(3) var sS: sampler_comparison;
@group(0) @binding(4) var tSh: texture_depth_2d;
@group(0) @binding(5) var tW: texture_2d<f32>;
@group(0) @binding(6) var tD: texture_2d<f32>;
@group(0) @binding(7) var tV: texture_3d<f32>;
@group(0) @binding(8) var tM: texture_2d<f32>;
fn shUV(p: vec3f) -> vec3f { let s = g.sm * vec4f(p, 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, s.z - .0007); }
fn shadow1(p: vec3f) -> f32 { return 1.; }
fn shadow4(p: vec3f) -> f32 { return 1.; }
fn shadow9(p: vec3f) -> f32 { return 1.; }
fn cuv(p: vec3f) -> vec2f { return p.xz * .85 + vec2f(p.y * .25); }
fn caus(p: vec3f, d: f32) -> vec3f {
  let q = cuv(p);
  let o = vec2f(.004, .0025);
  let a = vec3f(textureSample(tW, sR, q / 3.8 + o).r, textureSample(tW, sR, q / 3.8).r, textureSample(tW, sR, q / 3.8 - o).r);
  let b = textureSample(tW, sR, q.yx / 7.2 + .37).r;
  let c = min(pow(a, vec3f(2.1)) * 4.5 * (.45 + b * 1.2), vec3f(3.8));
  return mix(c, vec3f(.35), ss(40., 110., d));
}
fn caus2(p: vec3f, d: f32) -> f32 {
  let q = cuv(p);
  let c = min(pow(textureSample(tW, sR, q / 4.2).r, 1.4) * 2.4 * (.45 + textureSample(tW, sR, q.yx / 7.2 + .37).r * 1.2), 2.5);
  return mix(c, .35, ss(40., 110., d));
}
// Twin off-axis Pyro-GX Wingtip Headlights (prevents central glare washout)
fn spotLight(p: vec3f, n: vec3f, orig: vec3f, fw: vec3f) -> f32 {
  let v = p - orig;
  let d = max(length(v), .5);
  let dir = v / d;
  let spot = ss(.76, .93, dot(dir, fw));
  let att = exp(-d * .032) * (1. / (1. + d * d * .0024));
  let ndl = sat(dot(n, -dir));
  return spot * att * (.22 + .78 * ndl);
}
fn headlight(p: vec3f, n: vec3f) -> vec3f {
  let fw = normalize(g.fwd.xyz);
  let off = g.right.xyz * 1.35;
  let drop = g.up.xyz * .45;
  let l = spotLight(p, n, g.cam.xyz - off - drop, fw)
        + spotLight(p, n, g.cam.xyz + off - drop, fw);
  return vec3f(1.25, 1.15, .98) * l * 1.35;
}
fn sunE(y: f32, z: f32) -> vec3f { return mix(vec3f(.65, .52, .38), vec3f(.32, .68, 1.0), z); }
fn vol(p: vec3f) -> vec4f { return textureSampleLevel(tV, sC, (p - vec3f(-192., -78., -192.)) / vec3f(384., 84., 384.), 0.); }
fn amb(p: vec3f, n: vec3f, sky: f32, z: f32) -> vec3f {
  let lavaGlow = ss(-34., -52., p.y) * max(-n.y * .6 + .4, .2) * vec3f(1.15, .30, .04);
  let base = mix(vec3f(.08, .09, .12), vec3f(.05, .14, .28), z) * (.22 + 1.35 * sky);
  return base + lavaGlow + vec3f(.012, .014, .018);
}
fn zone(p: vec3f) -> f32 { return mix(g.sun.w, textureSampleLevel(tM, sC, p.xz / 384. + .5, 0.).b, .45); }
fn side(p: vec3f, n: vec3f, open: f32, z: f32) -> vec3f { return mix(vec3f(.18, .10, .06), vec3f(.06, .18, .32), z) * open * (1. - abs(n.y)) * .45; }
fn fog(c: vec3f, wp: vec3f, z: f32) -> vec3f {
  let v = wp - g.cam.xyz; let d = length(v); let rd = v / d;
  return c * exp(-sg(z) * d) * ss(220., 175., d) + fogIn(g.cam.xyz, rd, d, z, g.sun.xyz) * (.35 + .55 * vol(g.cam.xyz + rd * min(d, 90.)).g);
}
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;

// ---------------------------------------------------------------- solid meshes (mine walls, steel bulkheads, reactor core, turrets)
const W_SOLID = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) on: vec3f,
  @location(4) @interpolate(flat) m: vec4f, @location(5) @interpolate(flat) q: vec4f, @location(6) ao: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  var sc = i.a.w;
  if (i.c.x < 1.5 && i.c.z > 1.5 && g.res.x > 0.) { sc *= 1. - ss(i.c.z * .7, i.c.z, distance(i.a.xyz, g.cam.xyz) / g.mis.z); }
  var w = i.a.xyz + qrot(i.b, i.p * sc);
  w.y += sin(g.cam.w * .8 + i.c.y * 40.) * i.c.w;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = qrot(i.b, i.n.xyz); o.op = i.p * i.a.w + i.c.y * 37.; o.on = i.n.xyz;
  o.m = i.c; o.q = i.b; o.ao = i.n.w;
  return o;
}
struct TP { h: f32, c: f32, n: vec3f };
fn tri(p: vec3f, n: vec3f, s: f32) -> TP {
  var w = pow(abs(n), vec3f(4.)); w /= (w.x + w.y + w.z);
  let x = textureSample(tD, sR, p.zy * s); let y = textureSample(tD, sR, p.xz * s); let z = textureSample(tD, sR, p.xy * s);
  var o: TP;
  o.h = x.b * w.x + y.b * w.y + z.b * w.z;
  o.c = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.n = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = i32(i.m.x + .5); let sd = i.m.y; let fl_ = select(-1., 1., ff);
  let on = normalize(i.on) * fl_; let n0 = normalize(i.n) * fl_;
  let dist = length(i.wp - g.cam.xyz);
  let ts = select(1., i.m.z, mat >= 2);
  let A = tri(i.op, on, .11 * ts); let B = tri(i.op, on, .45 * ts); let C = tri(i.op, on, 1.8 * ts); let F = tri(i.op, on, 6.5 * ts); let fk = ss(12., 1.8, dist) * f32(mat <= 1);
  let big = textureSample(tD, sR, i.op.xz * .015 + i.op.y * .021).a;
  let big2 = textureSample(tD, sR, i.op.zx * .033 + i.op.y * .043 + .37).a;
  var sgro = 0.;
  let gm = textureSample(tM, sC, i.wp.xz / 384. + .5);
  let hgt = A.h * .5 + B.h * .35 + C.h * .15;
  var bump = 1.6; var gloss = .25; var alb = vec3f(0.); var emi = vec3f(0.); var vao = 1.; var flu = 0.;
  let flt = ss(.68, .92, abs(n0.y));
  let wall = 1. - abs(n0.y);
  if (mat == 0) {
    // Subterranean Mine Walls, Floors & Ceilings:
    // Dark blasted basalt/oxidized ore contrasted with machined steel wall panels, floor grates, and recessed ceiling light bars
    let st = i.wp.y * .45 + A.h * 1.1 + big * 3.;
    let bed = hs(floor(st)); let sf = fract(st);
    alb = mix(vec3f(.065, .070, .080), vec3f(.18, .10, .07), sat(A.c * 1.4 - .2));
    alb = mix(alb, mix(vec3f(.16, .08, .05), vec3f(.08, .12, .11), bed), ss(.4, .65, big) * .7);
    // Recessed industrial steel wall paneling
    let band = ss(.3, .7, sin(i.wp.y * .55) * .5 + .5) * wall;
    let pan = B.c * ss(.35, .65, gm.r + .25) * band;
    alb = mix(alb, vec3f(.13, .15, .18) * (.55 + .6 * B.h), pan * .88);
    // Crisp 45-degree Yellow & Black Hazard Stripes strictly on narrow machined wall datum trim
    let yBand = ss(.48, .18, abs(fract(i.wp.y * .125) - .5) * 8.);
    let hazMask = wall * yBand * ss(.50, .72, gm.r) * ss(.30, .60, pan);
    let stripe = step(.5, fract((i.wp.x + i.wp.z + i.wp.y * 1.2) * 1.35));
    let hazCol = mix(vec3f(.04, .04, .05), vec3f(.88, .62, .03), stripe);
    alb = mix(alb, hazCol * (.6 + .5 * B.h), hazMask * .92);
    // Metal deck grating on flat tunnel floors
    let grate = step(.35, fract(i.wp.x * 1.5)) * step(.35, fract(i.wp.z * 1.5));
    alb = mix(alb, vec3f(.10, .11, .13) * (.42 + .65 * grate) * (.6 + .5 * B.h), ss(.75, .92, n0.y) * gm.a * .88);
    // Glowing recessed fluorescent / plasma light strips in tunnel ceilings & red wall beacons
    let lGridZ = abs(fract(i.wp.z * .125) - .5);
    let lGridX = abs(fract(i.wp.x * .125) - .5);
    let ceilStrip = ss(-.70, -.92, n0.y) * ss(.08, .03, min(lGridX, lGridZ)) * step(.25, B.c);
    let bCell = floor(i.wp * vec3f(.125, .25, .125));
    let bRnd = hs(bCell.x * 13.7 + bCell.y * 7.1 + bCell.z * 31.3);
    let wallBeacon = wall * step(.82, bRnd) * ss(.96, .99, sin(i.wp.y * .85)) * ss(.028, .008, min(lGridX, lGridZ)) * ss(.25, .55, pan);
    let lCol = mix(vec3f(1.8, 1.35, .85), vec3f(.35, 1.4, 2.2), gm.b);
    let bCol = mix(vec3f(1.8, .35, .08), vec3f(.2, 1.3, 1.8), step(.92, bRnd));
    emi += lCol * ceilStrip * 2.6 + bCol * wallBeacon * (1.0 + .6 * sin(g.cam.w * 4. + bRnd * 40.));
    // Deep magma fissure glow near bottom of East Foundry & Reactor Pit
    let fis = ss(-43., -51., i.wp.y) * ss(.52, .72, A.c);
    emi += vec3f(3.2, .65, .08) * fis * 1.8;
    alb *= (.35 + 1.15 * hgt) * mix(1., .65 + .7 * F.h, fk);
    sgro = -ss(.14, .0, sf) * wall * 1.1;
    gloss = mix(.22, .68, pan + hazMask + flt * gm.a);
  } else if (mat == 1) {
    // Structural Steel Bulkhead Frames (Mesh 10) & Asteroid Ore Boulders
    let stripe = step(.5, fract((i.op.x + i.op.y + i.op.z) * 1.6));
    let haz = mix(vec3f(.04, .04, .05), vec3f(.88, .62, .04), stripe);
    alb = mix(vec3f(.11, .13, .16), vec3f(.22, .25, .29), B.c) * (.55 + .6 * A.h);
    // Restrict hazard stripes to corner gusset bumpers only
    let corner = ss(.65, .85, abs(i.op.x)) * ss(.55, .75, abs(i.op.y));
    alb = mix(alb, haz, corner * ss(.45, .75, abs(on.z)) * .85);
    // Small recessed bulkhead navigation LEDs
    let bLit = ss(.92, .97, abs(sin(i.op.y * 1.6))) * ss(.25, .05, abs(on.z)) * step(.01, .005 - abs(i.m.w));
    emi = mix(vec3f(1.8, .45, .08), vec3f(.2, 1.4, 2.0), step(.5, sd)) * bLit * 1.1;
    gloss = .78; bump = .9;
  } else if (mat == 2 || mat == 3) {
    // Reactor Core (mat 2) & Smelting Rig (mat 3): Heavy dark gunmetal shielding + glowing internal plasma core
    let pulse = .65 + .35 * sin(g.cam.w * 4.5 + i.op.y * .6);
    let rXZ = length(i.op.xz);
    let coreZone = ss(3.9, 2.0, rXZ) * ss(.25, .75, abs(sin(i.op.y * .85 + g.cam.w * 1.5)));
    let shield = mix(vec3f(.09, .11, .14), vec3f(.22, .25, .29), B.c) * (.5 + .6 * A.h);
    let eCol = select(vec3f(.15, 1.6, 2.8), vec3f(2.8, .75, .12), mat == 3 || sin(i.op.y * .4) > .2);
    alb = mix(shield, eCol * .45, coreZone);
    emi = eCol * coreZone * pulse * 3.6;
    // Narrow caution band only on the outer face of the central equatorial ring (y near 0)
    let ringHaz = ss(1.2, .3, abs(i.op.y)) * ss(6.6, 7.1, rXZ) * step(.5, fract((i.op.x + i.op.z) * 1.2));
    alb = mix(alb, vec3f(.88, .62, .04), ringHaz * .85);
    gloss = .85; bump = .75;
  } else if (mat == 4) {
    // Industrial Supply Crates, Louvered Transformers, Emitter Pads & Pipe Manifolds
    let hue = fract(sd * 7.31);
    alb = mix(vec3f(.18, .21, .25), vec3f(.48, .30, .10), step(.5, hue));
    if (hue > .75) { alb = vec3f(.14, .32, .42); }
    alb *= (.55 + .65 * B.h);
    let band = ss(.12, .04, abs(fract(i.op.y * 1.8) - .5));
    emi = mix(vec3f(1.8, .6, .1), vec3f(.1, 1.5, 2.2), step(.5, hue)) * band * 1.1;
    vao = i.ao * i.ao; gloss = .75; bump = 0.85;
  } else {
    // Defense Laser Turrets & High-Voltage Quartz/Energy Capacitors
    let hue = fract(sd * 5.73);
    alb = mix(vec3f(.20, .23, .28), vec3f(.58, .15, .10), fract(hue * 3.));
    alb *= (.5 + .7 * B.h) * (.5 + .8 * i.ao);
    let tip = ss(.65, .92, i.ao);
    emi = mix(vec3f(2.6, .25, .12), vec3f(.2, 1.8, 2.6), step(.5, hue)) * tip * 1.9;
    flu = .6; gloss = .8; bump = 0.8;
  }
  let N = normalize(qrot(i.q, normalize(on + (A.n * .8 + B.n * .6 + C.n * .4 * ss(60., 12., dist) + F.n * .4 * fk) * bump + vec3f(0., sgro, 0.))));
  let L = normalize(vec3f(.25, .85, -.35)); let V = normalize(g.cam.xyz - i.wp);
  let v1 = vol(i.wp + n0 * 1.5); let v2 = vol(i.wp + n0 * 4.2);
  let ao = (sat((v1.r - .35) * 3.5) * .55 + sat((v2.r - .35) * 2.2) * .45) * vao * ss(.1, .55, hgt);
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * v1.g * .85;
  let hl = headlight(i.wp, N);
  let ndl = sat(dot(N, L)) * .5 + .5;
  let am = (amb(i.wp, N, v1.g, z) + side(i.wp, N, sat((v2.r - .35) * 2.5), z)) * ao;
  let dl = E * ndl + hl;
  var c = alb * (dl + am) + emi + alb * flu * dot(dl + am, vec3f(.2, .4, .4));
  let hv = V + normalize(g.fwd.xyz * -.5 + vec3f(0., 1., 0.));
  let H = hv / max(length(hv), 1e-4);
  c += (E * .35 + hl * .65) * pow(sat(dot(N, H)), mix(12., 64., gloss)) * gloss * 1.1;
  c += amb(i.wp, reflect(-V, N), v1.g, z) * ao * (.10 + gloss) * .45 * pow(1. - sat(dot(N, V)), 2.5);
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- industrial conduits, power cables & laser grid strands
const W_LEAF = S_B + /*wgsl*/`
override ROWS: f32 = 7.;
override FAR: f32 = 150.;
struct LI { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f };
struct LO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) col: vec3f, @location(4) @interpolate(flat) pr: vec4f,
  @location(5) @interpolate(flat) sd: vec2f, @location(6) @interpolate(flat) spc: vec3f };
fn sway(p: vec2f, h: f32, t: f32) -> vec2f {
  return vec2f(0.);
}
fn shape2(v: f32) -> f32 { return sin(3.14159 * sat(v)); }
fn pal(h: f32) -> vec3f {
  if (h < .35) { return vec3f(1., .68, .12); }
  if (h < .7) { return vec3f(.18, .88, 1.); }
  return vec3f(1., .25, .12);
}
@vertex fn vs(@builtin(vertex_index) vi: u32, i: LI) -> LO {
  var o: LO;
  let u = f32(vi & 1u) * 2. - 1.; let v = sin(f32(vi >> 1u) / (ROWS - 1.) * 1.5708);
  let ty = i32(i.c.x * 255. + .5); let s1 = i.c.y; let s2 = i.c.z;
  let t = g.cam.w;
  let len = i.a.w; let hA = i.b.w;
  let cy = cos(i.b.x); let sy = sin(i.b.x); let ct = cos(i.b.y); let st = sin(i.b.y);
  let d = vec3f(st * cy, ct, st * sy); let pe = vec3f(ct * cy, -st, ct * sy); let sd = vec3f(-sy, 0., cy);
  var col = vec3f(0.); var pr = vec4f(0.); var spc = vec3f(0.); var shp = vec2f(.2, .15); var wav = .25; var fls = .3;
  let hsel = hs(s1 * 13.7 + s2 * 71.3);
  switch ty {
    case 1 { col = vec3f(.14, .16, .19); pr = vec4f(.3, .1, 0., .08); spc = vec3f(1., .65, .15); shp = vec2f(.05, .1); wav = .15; }
    case 5 { col = mix(vec3f(.12, .65, .95), vec3f(.95, .45, .10), step(.6, s1)); pr = vec4f(.5, .8, .3, .65); spc = pal(hsel); shp = vec2f(.15, .15); }
    default { col = mix(vec3f(.18, .20, .24), vec3f(.35, .24, .14), s1); pr = vec4f(.35, .3, .2, .25); spc = pal(hsel); shp = vec2f(.15, .15); }
  }
  pr.x = step(hs(s1 * 91.7 + s2 * 37.1 + i.b.x), pr.x);
  let k = (i.c.w - .3) * 1.2 + sin(t * (.8 + s1) * fls + s2 * 40. + hA * .25) * .04;
  let wph = v * (3. + 5. * s2) + s1 * 30. + t * 1.1;
  let wv = sin(wph) * .04 * wav;
  let kq = k * 1.2; let ka = select(kq, .06, abs(kq) < .06);
  let sK = sin(ka * v); let cK = cos(ka * v);
  let c = i.a.xyz + len * (d * (sK / ka) + pe * ((1. - cK) / ka + wv * v));
  let sl = sK + wv;
  let N = normalize(pe * cK - d * sl);
  let S = sd; let N2 = N;
  let shape = .85 + .15 * sin(3.14159 * v);
  let shp_ = g.res.x == 0.;
  let cd = distance(i.a.xyz, g.cam.xyz); let far = FAR * g.mis.z;
  let farK = select((1. - ss(far * .8, far, cd)) * ss(.6, 2.2, distance(c, g.cam.xyz)), 1., shp_);
  var p = c + S * (u * farK * i.b.z * .5 * shape);
  let sw = sway(i.a.xz, hA + (p.y - i.a.y), t);
  p.x += sw.x; p.z += sw.y;
  o.cp = g.vp * vec4f(p, 1.); o.wp = p; o.n = normalize(N2 + S * u * .65); o.uv = vec2f(u, v);
  o.col = col; o.pr = pr; o.sd = vec2f(s1, s2); o.spc = spc;
  return o;
}
struct GO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) col: vec3f };
@vertex fn vsGl(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> GO {
  var o: GO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.; let t = g.cam.w;
  var p = a.xyz;
  p += .14 * vec3f(sin(t * 1.4 + b.x * 50.), sin(t * 1.8 + b.x * 70.), cos(t * 1.5 + b.x * 90.));
  let d = length(p - g.cam.xyz);
  if (d > 125. || dot(p - g.cam.xyz, g.fwd.xyz) < -1.) { o.cp = vec4f(0., 0., 2., 1.); return o; }
  let tw = .35 + .65 * pow(.5 + .5 * sin(t * (1.8 + 2.2 * hs(b.x)) + b.x * 100.), 2.);
  let sz = min(max(b.z * 1.35, d * .0032), d * .0065);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q;
  let e = b.z / sz;
  o.col = pal(b.y) * (.35 + tw * 1.8) * e * e * exp(-SIG.g * d) * ss(.4, 1.5, d) * 24.;
  return o;
}
@fragment fn fsGl(i: GO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  return vec4f(min(i.col * exp(-r * 6.5) * (1. - ss(.7, 1., r)), vec3f(12.)), 0.);
}
@fragment fn fs(i: LO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp);
  let vv = vol(i.wp);
  let hl = headlight(i.wp, n);
  // Ribbed industrial conduit sheath + pulsing energy core
  let rib = .65 + .35 * sin(i.uv.y * 55. + i.sd.x * 20.);
  var alb = i.col * rib * (1. - .35 * i.uv.x * i.uv.x);
  let pulse = ss(.65, .95, sin(i.uv.y * 12. - g.cam.w * 4.5 + i.sd.x * 30.));
  var c = alb * (amb(i.wp, n, vv.g, z) + hl) + i.spc * (i.pr.w * (.4 + 1.4 * pulse));
  c += (hl + vec3f(.5)) * pow(sat(dot(n, V)), 16.) * .35;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- Autonomous Mining Robots (Patrol Drones & Heavy Hulks)
const W_ANIM = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) @interpolate(flat) sd: f32, @location(4) lt: f32 };
@vertex fn vsFish(i: VI) -> VO {
  var o: VO;
  let s = i.b.x; let h = vec3f(hs(s), hs(s + .37), hs(s + .71));
  let R = i.a.w; let t = g.cam.w;
  let ta = t * i.b.y + i.b.w * 6.3 + (h.x - .5) * (24. / R);
  let ph = i.b.w * 17.;
  let P = i.a.xyz + vec3f(R * cos(ta), 2.6 * sin(2. * ta + ph), R * .75 * sin(ta));
  let T = normalize(vec3f(-R * sin(ta), 5.2 * cos(2. * ta + ph), R * .75 * cos(ta))) * sign(i.b.y);
  let S = normalize(cross(vec3f(0., 1., 0.), T)); let Up = cross(T, S);
  let off = S * ((h.y - .5) * 6.) + Up * ((h.z - .5) * 4. + sin(t * 2.2 + s * 31.) * .35);
  let l = i.p * i.b.z * (.85 + .4 * h.z);
  // Subtle robotic banking roll as drones turn
  let bank = .35 * sin(t * 2.5 + s * 20.);
  let S2 = S * cos(bank) + Up * sin(bank); let Up2 = Up * cos(bank) - S * sin(bank);
  let w = P + off + T * l.x + Up2 * l.y + S2 * l.z;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = T * i.n.x + Up2 * i.n.y + S2 * i.n.z; o.op = i.p; o.sd = s;
  o.lt = 1.;
  return o;
}
@fragment fn fsFish(i: VO) -> @location(0) vec4f {
  let n = normalize(i.n); let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  // Armored drone plating (charcoal steel + caution yellow/crimson markings)
  var alb = mix(vec3f(.18, .21, .25), vec3f(.55, .42, .10), step(.35, abs(i.op.z)));
  let visor = ss(.22, .45, i.op.x) * ss(.15, .02, abs(i.op.y));
  let engine = ss(-.30, -.44, i.op.x);
  let hl = headlight(i.wp, n);
  var c = alb * (amb(i.wp, n, vv.g, z) * 1.5 + hl);
  c += pow(sat(dot(n, V)), 20.) * vec3f(.6, .7, .8) * .6;
  // Glowing red Cyclops optical sensor + cyan thruster exhaust
  c += vec3f(3.2, .25, .08) * visor + vec3f(.2, 1.8, 2.8) * engine * 1.6;
  return fin(fog(c, i.wp, z));
}
@vertex fn vsManta(i: VI) -> VO {
  var o: VO;
  let t = g.cam.w; let R = i.a.w; let sz = i.b.z;
  let ta = t * i.b.y + i.b.x;
  let P = i.a.xyz + vec3f(R * cos(ta), 2.2 * sin(2. * ta + i.b.w), R * .8 * sin(ta));
  let T = normalize(vec3f(-R * sin(ta), 4.4 * cos(2. * ta + i.b.w), R * .8 * cos(ta))) * sign(i.b.y);
  var S = normalize(cross(vec3f(0., 1., 0.), T)); var Up = cross(T, S);
  let bank = -.32 * sign(i.b.y) + .12 * sin(t * 1.8 + i.b.w * 7.);
  let S2 = S * cos(bank) + Up * sin(bank); Up = Up * cos(bank) - S * sin(bank); S = S2;
  let u = i.n.w; let au = abs(u);
  // Mechanical weapon-arm recoil / scanning articulation
  var l = i.p;
  l.z += step(.5, au) * sin(t * 3.5 + u * 4. + i.b.w * 10.) * .06;
  let w = P + (S * l.x + Up * l.y + T * l.z) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = S * i.n.x + Up * i.n.y + T * i.n.z; o.op = i.p; o.sd = i.b.w;
  o.lt = 1.;
  return o;
}
@fragment fn fsManta(i: VO) -> @location(0) vec4f {
  let tx = textureSample(tD, sR, i.op.xz * 1.2 + i.sd);
  let n = normalize(i.n + (vec3f(tx.r, 0., tx.g) - vec3f(.5, 0., .5)) * .4);
  let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  let au = abs(i.op.x);
  // Heavy Class-1 Hulk Mech armor: olive/gunmetal hull + hazard stripes on shoulder pods
  let stripe = step(.5, fract((i.op.x + i.op.z) * 4.5));
  let haz = mix(vec3f(.08, .08, .09), vec3f(.92, .65, .05), stripe);
  var alb = mix(vec3f(.22, .25, .28), vec3f(.38, .28, .16), tx.a);
  alb = mix(alb, haz, ss(.35, .65, au) * ss(.15, -.15, i.op.z) * .7);
  // Glowing red scanning visor & green plasma cannon muzzles + rear twin thrusters
  let visor = ss(.35, .58, i.op.z) * ss(.22, .05, au) * ss(.12, .02, abs(i.op.y));
  let muzzle = ss(.65, .76, i.op.z) * ss(.62, .82, au);
  let thrust = ss(-.48, -.58, i.op.z) * ss(.25, .05, au);
  let hl = headlight(i.wp, n);
  var c = alb * (amb(i.wp, n, vv.g, z) * 1.4 + hl + side(i.wp, n, 1., z) * .8);
  c += pow(sat(dot(n, V)), 24.) * vec3f(.7, .75, .85) * .65;
  c += vec3f(3.5, .2, .05) * visor * (1.2 + .5 * sin(g.cam.w * 6. + i.sd * 20.))
     + vec3f(.2, 2.8, .35) * muzzle * 1.8
     + vec3f(.25, 1.6, 3.0) * thrust * 2.2;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- Molten Magma Sea & Subterranean Void
const W_SURF = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  // Molten magma lake level at y = -49.5m in the deep chambers (Foundry, Reactor Pit, North Shaft bottom)
  o.wp = vec3f(g.cam.x + p.x * 400., -49.5, g.cam.z + p.y * 400.);
  o.cp = g.vp * vec4f(o.wp, 1.);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let t = g.cam.w;
  let crust = textureSample(tD, sR, i.wp.xz * .045 + vec2f(t * .006, t * .004));
  let veins = textureSample(tW, sR, i.wp.xz * .055 - vec2f(t * .008, 0.)).r;
  let hot = sat(veins * 1.45 + (1. - crust.b) * .55 - .48);
  let col = mix(vec3f(.035, .025, .022) * (.5 + crust.b), vec3f(2.1, .38, .04), ss(.18, .62, hot))
          + vec3f(2.8, 1.35, .22) * ss(.65, .95, hot);
  let z = zone(i.wp);
  return fin(fog(col, i.wp, z));
}
@vertex fn vsB(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = g.cam.xyz + g.fwd.xyz + g.right.xyz * (p.x * g.right.w) + g.up.xyz * (p.y * g.up.w);
  o.cp = vec4f(p, 1e-7, 1.);
  return o;
}
@fragment fn fsB(i: VO) -> @location(0) vec4f {
  let p = g.cam.xyz + normalize(i.wp - g.cam.xyz) * 200.;
  return fin(fog(vec3f(0.), p, zone(p)));
}
`;

// ---------------------------------------------------------------- sprites: reactor plasma orbs / magma embers & industrial dust
const W_SPR = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pr: vec4f, @location(2) wp: vec3f };
fn quad(i: u32) -> vec2f { return vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.; }
@vertex fn vsBub(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let life = fract(t * b.y / b.z + b.x);
  let h = life * b.z;
  var p = a.xyz + vec3f(0., h, 0.);
  let wob = b.w * .18;
  p.x += sin(t * 3.5 + b.x * 50. + h * .4) * wob;
  p.z += cos(t * 3.1 + b.x * 33. + h * .4) * wob;
  let sz = a.w * (1. - life * .6) * ss(0., .06, life) * ss(1., .65, life);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  o.pr = vec4f(b.x, sz, life, 0.);
  return o;
}
@fragment fn fsBub(i: VO) -> @location(0) vec4f {
  let r = length(i.uv);
  let disc = 1. - ss(.15, .9, r);
  let core = 1. - ss(0., .4, r);
  let col = vec3f(2.6, .55, .08) + vec3f(1.8, 1.2, .4) * core;
  let v = i.wp - g.cam.xyz; let d = length(v);
  let T = exp(-SIG.g * d) * ss(1.2, 3., d);
  let al = disc * T * (1. - i.pr.z) * .9;
  return vec4f(min(col * al, vec3f(12.)), al);
}
@vertex fn vsSnow(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let B = 44.;
  var p = a.xyz * B + vec3f(t * .15, -t * .08, t * .12) + .4 * vec3f(sin(t * .4 + a.x * 60.), sin(t * .3 + a.y * 50.), cos(t * .35 + a.z * 70.));
  p = g.cam.xyz + (fract((p - g.cam.xyz) / B + .5) - .5) * B;
  let d = length(p - g.cam.xyz);
  let sz = (.012 + .042 * a.w * a.w * a.w);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * max(sz, d * .0012);
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  let fade = ss(B * .5, B * .32, d) * ss(.6, 2.5, d) * min(1., sz / (d * .0012));
  let tw = .6 + .4 * sin(t * (1.5 + a.w * 3.) + a.x * 100.);
  o.pr = vec4f(fade * tw, 1., a.w, d);
  return o;
}
@fragment fn fsSnow(i: VO) -> @location(0) vec4f {
  let r = length(i.uv);
  let m = ss(1., .2, r);
  let z = zone(i.wp);
  let c = mix(vec3f(1.4, .95, .55), vec3f(.55, 1.1, 1.5), max(z, i.pr.z));
  return vec4f(min(max(c * m * m * i.pr.x * exp(-SIG.g * i.pr.w), vec3f(0.)), vec3f(8.)), 0.);
}
`;

// ---------------------------------------------------------------- volumetric light shafts (Pyro-GX Headlight Beam + Reactor Glow)
const W_RAYS = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var tW: texture_2d<f32>;
@group(0) @binding(3) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
@group(0) @binding(4) var tV: texture_3d<f32>;
@group(0) @binding(5) var sC: sampler;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dp = textureLoad(tDp, vec2i(fc.xy) * 2, 0);
  let uv = fc.xy * 2. * g.res.zw;
  let nd = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  let rv = g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w);
  let rl = length(rv); let rd = rv / rl;
  let zl = g.fwd.w / max(dp, 1e-6);
  let tm = min(zl * rl, 95.);
  let ro = g.cam.xyz; let sgz = sg(g.sun.w);
  let dt = tm / ${RAYN}.;
  let j = ign(fc.xy);
  var acc = vec3f(0.);
  for (var n = 0; n < ${RAYN}; n++) {
    let t = (f32(n) + j) * dt;
    let p = ro + rd * t;
    let v = textureSampleLevel(tV, sC, (p - vec3f(-192., -78., -192.)) / vec3f(384., 84., 384.), 0.);
    let pat = .4 + .6 * textureSampleLevel(tW, sR, p.xz / 22. + p.y * .03, 2.).r;
    let chGlow = pow(v.g, 2.8) * pat * .75;
    let z = g.sun.w;
    let col = mix(vec3f(1.1, .55, .22), vec3f(.25, .75, 1.25), z) * chGlow;
    acc += exp(-sgz * t) * col;
  }
  return vec4f(min(acc * dt * sgz * g.mis.y * .9, vec3f(8.)), zl);
}
`;
// depth-aware 3x3 blur of the half-res shafts (hides the sampling dither)
const W_RBLUR = W_FS + /*wgsl*/`
@group(0) @binding(0) var tR: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy); let mx = vec2i(textureDimensions(tR)) - 1;
  let c = textureLoad(tR, p, 0);
  var acc = vec3f(0.); var ws = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let r = textureLoad(tR, clamp(p + vec2i(x, y) , vec2i(0), mx), 0);
    let w = 1. / (.03 + abs(r.a - c.a) / c.a);
    acc += r.rgb * w; ws += w;
  } }
  return vec4f(acc / ws, c.a);
}
`;

// ---------------------------------------------------------------- final composite
const W_POST = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sC: sampler;
@group(0) @binding(2) var tS: texture_2d<f32>;
@group(0) @binding(3) var tR: texture_2d<f32>;
@group(0) @binding(4) var tB: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
fn tmap(x: vec3f) -> vec3f { return sat3((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14)); }
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.), vec3f(1.)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let uv = fc.xy * g.res.zw;
  let zf = g.fwd.w / max(textureLoad(tDp, px, 0), 1e-6);
  // depth-aware upsample of the half-res shafts
  let h = fc.xy * .5 - .5; let b = floor(h); let f = h - b; let bi = vec2i(b);
  let mx = vec2i(textureDimensions(tR)) - 1;
  var acc = vec3f(0.); var ws = 0.;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let r = textureLoad(tR, clamp(bi + o, vec2i(0), mx), 0);
    let bw = mix(1. - f.x, f.x, f32(o.x)) * mix(1. - f.y, f.y, f32(o.y));
    let w = (bw + .02) / (.02 + abs(r.a - zf) / zf);
    acc += r.rgb * w; ws += w;
  }
  var c = textureLoad(tS, px, 0).rgb + acc / ws;
  let bl = textureSampleLevel(tB, sC, uv, 0.).rgb;
  c = mix(c, bl, .08) + bl * .05;
  c *= g.mis.x;
  let q = uv - .5;
  c *= 1. - dot(q, q) * .55;
  c = tmap(c);
  let l0 = dot(c, vec3f(.2126, .7152, .0722));
  let l = mix(l0, l0 * l0 * (3. - 2. * l0), .55);
  c *= l / max(l0, 1e-4);
  c = mix(c, vec3f(l), ss(.55, 1., l) * .1);
  c = mix(vec3f(l), c, .95) + vec3f(.008, .003, 0.);
  c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2));
  let n = ign(fc.xy) + ign(fc.xy + 37.) - 1.;
  return vec4f(c + n / 255., 1.);
}
`;
