// ============================================================================
// world layout + procedural content generation (load-time only)
// ============================================================================

// Subterranean mine chambers (octagonal/domed vaults):
// [cx, cy, cz, rx, ry, rz, octagonalBevel, roughness]
const MESAS = [
  [0, -28, 0, 32, 22, 32, 0.35, 0.32],       // 0: Central Reactor Core Cavern
  [0, -34, -88, 28, 28, 28, 0.3, 0.38],      // 1: North Vertical Mining Shaft
  [64, -36, 12, 28, 20, 26, 0.25, 0.48],     // 2: East Molten Magma Foundry
  [-62, -28, -8, 24, 18, 26, 0.4, 0.16],     // 3: West Automated Processing Bay
  [6, -28, 84, 28, 20, 28, 0.35, 0.22],      // 4: South Energy Center & Recharge Vault
  [-44, -36, -64, 18, 15, 18, 0.3, 0.52],    // 5: NW Ore Junction
  [44, -32, -62, 18, 15, 18, 0.35, 0.28],    // 6: NE Cooling Substation
  [-40, -32, 46, 18, 15, 18, 0.35, 0.28],    // 7: SW Conduit Hub
  [42, -34, 54, 18, 15, 18, 0.3, 0.45],      // 8: SE Smelting Annex
];

// Deformed hexahedral / octagonal tunnel segments (6DoF corridors & shafts):
// [ax, ay, az, bx, by, bz, halfWidth, halfHeight]
const HOLES = [
  // Main North-South arterial shafts
  [0, -32, -24, 0, -32, -66, 8.5, 7.5],      // Reactor N -> North Shaft
  [0, -30, 24, 6, -30, 62, 8.5, 7.5],        // Reactor S -> South Energy Vault
  // Main East-West arterial shafts
  [24, -32, 2, 44, -36, 10, 8.5, 7.5],       // Reactor E -> Magma Foundry
  [-24, -30, -2, -44, -28, -6, 8.5, 7.5],    // Reactor W -> Processing Bay
  // Outer ring & sloped 6DoF banking tunnels
  [-58, -28, -26, -44, -36, -64, 7.2, 6.5],  // West Bay -> NW Ore Junction
  [-44, -36, -64, -18, -42, -84, 7.2, 6.5],  // NW Ore Junction -> North Shaft Lower
  [18, -22, -84, 44, -32, -62, 7.2, 6.5],    // North Shaft Upper -> NE Substation
  [44, -32, -62, 62, -34, -8, 7.2, 6.5],     // NE Substation -> Magma Foundry
  [62, -36, 30, 42, -34, 54, 7.5, 6.8],      // Magma Foundry -> SE Annex
  [42, -34, 54, 24, -28, 82, 7.2, 6.5],      // SE Annex -> South Energy Vault
  [-14, -28, 82, -40, -32, 46, 7.2, 6.5],    // South Energy Vault -> SW Hub
  [-40, -32, 46, -60, -28, 12, 7.2, 6.5],    // SW Hub -> West Bay
  // Steep vertical/diagonal 6DoF bypass chutes
  [0, -10, -20, 0, -16, -70, 6.2, 5.8],      // High Upper Overpass (Reactor Roof -> North Shaft Top)
  [-12, -18, 22, -40, -32, 46, 6.2, 5.8],    // Reactor Upper -> SW Hub chute
  [12, -18, -22, 44, -32, -62, 6.2, 5.8],    // Reactor Upper -> NE Substation chute
  [0, -52, -88, 0, -6, -88, 11.0, 11.0],     // Vertical Core of North Mining Shaft
];

// Planar structural support columns & horizontal cross-girders inside chambers:
// [ax, ay, az, bx, by, bz, radius, bevel]
const ARCHES = [
  [-20, -54, -20, -20, -2, -20, 2.8, 0.4],   // Reactor NW Shield Column
  [20, -54, -20, 20, -2, -20, 2.8, 0.4],     // Reactor NE Shield Column
  [-20, -54, 20, -20, -2, 20, 2.8, 0.4],     // Reactor SW Shield Column
  [20, -54, 20, 20, -2, 20, 2.8, 0.4],       // Reactor SE Shield Column
  [-20, -12, -12, 20, -12, -12, 2.0, 0.4],   // Reactor North Overhead Cross-Girder
  [-20, -12, 12, 20, -12, 12, 2.0, 0.4],     // Reactor South Overhead Cross-Girder
  [74, -60, 0, 74, -12, 0, 3.0, 0.3],        // Foundry Support Column 1
  [74, -60, 24, 74, -12, 24, 3.0, 0.3],      // Foundry Support Column 2
  [50, -20, 0, 78, -20, 0, 2.1, 0.3],        // Foundry Overhead Crane Girder
  [-68, -52, -16, -68, -6, -16, 2.8, 0.5],   // West Bay Pylon
];

// Smooth-rock / machined zone overrides (low roughness for crisp industrial plating):
// [ax, az, bx, bz, radius, softness]
const CLEARS = [
  [0, -24, 0, 24, 24, 10], [0, -88, 0, -88, 22, 10], [-62, -24, -62, 12, 20, 8], [6, 60, 6, 102, 24, 10],
];

const PURPLE = [6, 84]; // South Energy Center (cyan/blue-violet high-energy zone)
const zoneP = (x, z) => sstep(54, 24, hypot(x - PURPLE[0], z - PURPLE[1])) + 0.65 * sstep(46, 18, hypot(x + 62, z + 8));
// Hazard & Energy floor grating patches: [x, z, radius]
const MAGENTA = [
  [0, 0, 18], [6, 84, 24], [-62, -8, 18], [64, 12, 20], [0, -88, 18],
  [-44, -64, 12], [44, -62, 12], [-40, 46, 12], [42, 54, 12], [0, -45, 10], [0, 44, 10], [34, 6, 10], [-34, -4, 10],
];
const magAt = (x, z) => {
  let m = sstep(0.56, 0.68, fbm(x * 0.03, 7, z * 0.03, 3)) * 0.6;
  for (const p of MAGENTA) m = max(m, sstep(p[2], p[2] * 0.5, hypot(x - p[0], z - p[1])));
  return m;
};

function primBuffer() {
  const a = [];
  for (const m of MESAS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  for (const m of ARCHES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  for (const m of HOLES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  for (const m of CLEARS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0);
  return new Float32Array(a);
}

// ---------------------------------------------------------------- terrain mesh from the density grid
function buildTerrain(D) {
  const sn = surfaceNets(D, NX, NY, NZ), nv = sn.nv, gp = sn.pos;
  const smp = sampler3(D, NX, NY, NZ);
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  const wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3);
  for (let k = 0; k < nv; k++) {
    const x = gp[k * 3], y = gp[k * 3 + 1], z = gp[k * 3 + 2], e = 0.8;
    let nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const X = OX + x * VS, Y = OY + y * VS, Z = OZ + z * VS;
    wp[k * 3] = vf[k * 4] = X; wp[k * 3 + 1] = vf[k * 4 + 1] = Y; wp[k * 3 + 2] = vf[k * 4 + 2] = Z;
    wn[k * 3] = nx; wn[k * 3 + 1] = ny; wn[k * 3 + 2] = nz;
    v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = 127;
  }
  // bucket quads into the XZ culling grid
  const nq = sn.ni / 6, key = new Uint8Array(nq), cnt = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9), hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let q = 0; q < nq; q++) {
    const a = sn.idx[q * 6] * 3;
    const c = clamp(floor((wp[a] - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((wp[a + 2] - OZ) / CELLW), 0, CELLS - 1);
    key[q] = c; cnt[c + 1]++;
    for (let j = 0; j < 6; j++) { const y = wp[sn.idx[q * 6 + j] * 3 + 1]; if (y < lo[c]) lo[c] = y; if (y > hi[c]) hi[c] = y; }
  }
  for (let c = 0; c < CELLS * CELLS; c++) cnt[c + 1] += cnt[c];
  const ib = new Uint32Array(sn.ni), fill = cnt.slice();
  for (let q = 0; q < nq; q++) { const o = fill[key[q]]++ * 6; for (let j = 0; j < 6; j++) ib[o + j] = sn.idx[q * 6 + j]; }
  return { vb, ib, nv, wp, wn, smp, start: cnt, lo, hi };
}

// ---------------------------------------------------------------- instance stores
function makeWorld(D, T, flyPts, POSES) {
  const gi = (x, y, z) => x + NX * (y + NY * z);
  const smp = T.smp;
  const Dw = (x, y, z) => smp((x - OX) / VS, (y - OY) / VS, (z - OZ) / VS);
  const nCells = CELLS * CELLS;
  const cellOf = (x, z) => clamp(floor((x - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((z - OZ) / CELLW), 0, CELLS - 1);
  const big = Array.from({ length: nCells }, () => []), small = Array.from({ length: nCells }, () => []);
  let nth = 0;
  const leaf = (L, x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend) => { if (type === 1 || !(nth++ % THIN)) L[cellOf(x, z)].push(x, y, z, len, yaw, tilt, type === 1 ? wid : wid * (1 + LV / 2), hA, type, s1, s2, bend); };
  const glint = (...a) => { nth++ % THIN || glints.push(...a); };
  const solids = []; // per mesh id: arrays of 12 floats
  const props = Array.from({ length: 6 }, () => Array.from({ length: nCells }, () => []));
  const solid = (mesh, x, y, z, sc, q, mat, seed, ts = 1, bob = 0) => { (mesh > 3 && mesh < 10 ? props[mesh - 4][cellOf(x, z)] : (solids[mesh] ||= [])).push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, ts, bob); };
  const chunks = Array.from({ length: NCHUNK }, () => Array.from({ length: nCells }, () => []));
  const glints = [];
  const bubbles = [];

  // --- surface queries
  const fl = [];
  const floorsAt = (x, z) => {
    const ix = clamp(round((x - OX) / VS), 1, NX - 2), iz = clamp(round((z - OZ) / VS), 1, NZ - 2);
    fl.length = 0; let ceil = 3;
    for (let gy = NY - 2; gy >= 1; gy--) {
      const d = D[gi(ix, gy, iz)], da = D[gi(ix, gy + 1, iz)];
      if (da <= 0 && d > 0) { const y = OY + (gy + d / (d - da)) * VS; if (ceil - y > 2.5) fl.push(y, ceil - y); }
      else if (da > 0 && d <= 0) ceil = OY + (gy + da / (da - d)) * VS;
    }
    return fl;
  };
  const grad = (x, y, z) => {
    const e = 0.6; let nx = Dw(x - e, y, z) - Dw(x + e, y, z), ny = Dw(x, y - e, z) - Dw(x, y + e, z), nz = Dw(x, y, z - e) - Dw(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
  };
  const snap = (x, y, z, n) => {
    let px = x + n[0] * 2.5, py = y + n[1] * 2.5, pz = z + n[2] * 2.5, prev = Dw(px, py, pz);
    if (prev > 0) return null;
    for (let i = 0; i < 24; i++) {
      const qx = px - n[0] * 0.25, qy = py - n[1] * 0.25, qz = pz - n[2] * 0.25, d = Dw(qx, qy, qz);
      if (d > 0) { const t = prev / (prev - d); const p = [mix(px, qx, t), mix(py, qy, t), mix(pz, qz, t)]; return p.concat(grad(p[0], p[1], p[2])); }
      px = qx; py = qy; pz = qz; prev = d;
    }
    return null;
  };
  const pickV = () => ((rnd() * T.nv) | 0) * 3;
  const tangent = (n) => { let t = abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [1, 0, 0]; const l = hypot(...t); t = t.map((v) => v / l); return [t, [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]]; };
  const nearFly = (x, y, z, r) => { for (const p of flyPts) if (hypot(x - p[0], z - p[2]) < r && abs(y - p[1]) < r) return true; return false; };

  // --- 1. Structural Steel Bulkhead Ribs along all tunnel segments (HOLES)
  // Also collect light emitters along tunnels and chambers for the 3D light volume!
  const lights = [
    // Major Chamber Emitters: [x, y, z, intensity, radius]
    [0, -26, 0, 1.5, 42],        // Reactor Core heart
    [0, -44, 0, 1.2, 34],        // Reactor lower magma glow
    [64, -44, 12, 1.5, 42],      // East Magma Foundry lake
    [64, -22, 12, 1.0, 32],      // East Foundry upper crane lights
    [-62, -26, -8, 1.25, 36],    // West Automated Processing Bay
    [6, -26, 84, 1.45, 40],      // South Energy Center & Recharge Vault
    [0, -18, -88, 1.2, 36],      // North Shaft Upper
    [0, -46, -88, 1.2, 36],      // North Shaft Lower
    [-44, -34, -64, 1.0, 26],    // NW Ore Junction
    [44, -30, -62, 1.0, 26],     // NE Cooling Substation
    [-40, -30, 46, 1.0, 26],     // SW Conduit Hub
    [42, -32, 54, 1.0, 26],      // SE Smelting Annex
  ];

  rseed(1);
  // Place octagonal bulkhead frames (mesh 10) along every tunnel segment
  for (let hIdx = 0; hIdx < HOLES.length; hIdx++) {
    const h = HOLES[hIdx];
    const dx = h[3] - h[0], dy = h[4] - h[1], dz = h[5] - h[2], len = hypot(dx, dy, dz);
    const tx = dx / len, ty = dy / len, tz = dz / len;
    const isVert = abs(ty) > 0.85;
    // Rotation taking local +Z (or +Y) along tunnel tangent
    const q = isVert ? qAxis(1, 0, 0, PI / 2) : qAxis(0, 1, 0, atan2(tx, tz));
    const pitch = isVert ? 0 : atan2(ty, hypot(tx, tz));
    const qFull = isVert ? q : qMul(q, qAxis(1, 0, 0, -pitch));
    const step = isVert ? 9.5 : 8.0;
    const nFrames = max(2, floor(len / step));
    for (let k = 1; k < nFrames; k++) {
      const u = k / nFrames;
      const px = mix(h[0], h[3], u), py = mix(h[1], h[4], u), pz = mix(h[2], h[5], u);
      const sc = min(h[6], h[7]) * 0.96;
      solid(10, px, py, pz, sc, qFull, 1, (hIdx * 0.17 + k * 0.31) % 1, 1, 0);
      if (k % 2 === 1) lights.push([px, py + h[7] * 0.45, pz, 0.9, 20]);
    }
  }

  // --- 2. Taut Overhead Power Conduits & Laser Barrier Strands (using W_LEAF ribbons)
  const cableCluster = (x, y, z, H, kind) => {
    const strands = 2, ph = rnd() * TAU, sr = rr(0.2, 0.45);
    for (let s = 0; s < strands; s++) {
      const a = ph + s * TAU / strands, rx = x + cos(a) * sr, rz = z + sin(a) * sr;
      for (let h = 0; h < H - 1; h += 2.2) {
        leaf(big, rx, y + h, rz, 2.4, a + PI / 2, 0.02, kind === 1 ? 0.12 : 0.16, h, kind === 1 ? 5 : 1, rnd(), rnd(), 0.02);
      }
      for (let h = 1; h < H - 1; h += 4.5) {
        glint(rx, y + h, rz, h, rnd(), kind === 1 ? 0.85 : 0.15, rr(0.03, 0.06), 0);
      }
    }
  };
  rseed(2);
  for (let i = 0; i < 1200; i++) {
    const a = rnd() * TAU, r = sqrt(rnd()) * 120, x = cos(a) * r, z = sin(a) * r;
    if (hypot(x, z) < 14) continue;
    const f = floorsAt(x, z);
    for (let j = 0; j < f.length; j += 2) {
      const fy = f[j], fh = f[j + 1];
      if (fh > 10 && fh < 34 && !nearFly(x, fy + fh * 0.5, z, 7.0) && rnd() < 0.05) {
        cableCluster(x, fy, z, fh, zoneP(x, z) > 0.35 || rnd() < 0.3 ? 1 : 0);
        break;
      }
    }
  }

  // Sparse ceiling power conduits in large chambers
  rseed(3);
  for (let i = 0; i < 4000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (hypot(x, z) > 135 || nearFly(x, y, z, 5.5)) continue;
    const zp = zoneP(x, z);
    if (ny < -0.75 && rnd() < 0.08) {
      for (let j = 0; j < 2; j++) {
        leaf(big, x + rr(-0.4, 0.4), y + 0.1, z + rr(-0.4, 0.4), rr(1.2, 3.2), rnd() * TAU, PI - 0.04, rr(0.06, 0.10), 0, zp > 0.3 || rnd() < 0.4 ? 5 : 4, rnd(), rnd(), 0.04);
      }
      if (rnd() < 0.35) glint(x, y - rr(0.4, 1.4), z, 0, rnd(), zp > 0.3 ? 0.65 : 0.1, rr(0.03, 0.06), 0);
    }
  }

  // --- 3. Energy Center & Recharge Station Spark Fields (glints only, no seabed grass tufts)
  rseed(4);
  for (const p of MAGENTA) for (let i = p[2] * p[2] * 3 | 0; i > 0; i--) {
    const a = rnd() * TAU, r = sqrt(rnd()) * p[2], x = p[0] + cos(a) * r, z = p[1] + sin(a) * r;
    const f = floorsAt(x, z); if (!f.length) continue;
    const y = f[f.length - 2], fh = f[f.length - 1];
    if (grad(x, y, z)[1] < 0.65) continue;
    const isEnergy = hypot(x - 6, z - 84) < 28 || hypot(x + 62, z + 8) < 22 || hypot(x, z) < 20;
    if (rnd() < (isEnergy ? 0.55 : 0.18)) {
      glint(x, y + rr(0.2, min(fh - 0.5, 8.0)), z, 0, rnd(), isEnergy ? rr(0.55, 0.85) : rr(0.0, 0.28), rr(0.025, 0.055), 0);
    }
  }

  // --- 4. Purposeful Architectural Descent Props (~350 ceiling turrets, floor crates, transformers & pipe manifolds)
  const spots = [];
  rseed(6);
  for (let i = 0; i < 6500; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
    if (hypot(x, z) > 130 || nearFly(x, y, z, 4.5)) continue;
    const n0 = [T.wn[k], T.wn[k + 1], T.wn[k + 2]];
    const isCeil = n0[1] < -0.78 && rnd() < 0.08;
    const isFloor = n0[1] > 0.82 && rnd() < 0.12;
    if (!isCeil && !isFloor) continue;
    const s = snap(x, y, z, n0);
    if (!s) continue;
    let ux = s[3], uy = s[4], uz = s[5]; const l = hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    const q = qMul(qFromY(ux, uy, uz), qAxis(0, 1, 0, (rnd() * 4 | 0) * PI / 2));
    const sc = isCeil ? rr(0.75, 1.25) : rr(0.65, 1.15);
    const meshId = isCeil ? (rnd() < 0.7 ? 8 : 7) : (rnd() < 0.22 ? 9 : 4 + (rnd() * 3 | 0));
    solid(meshId, s[0] - ux * 0.08 * sc, s[1] - uy * 0.08 * sc, s[2] - uz * 0.08 * sc, sc, q, isCeil ? 5 : 4, rnd(), 1, 0);
    if (isFloor && rnd() < 0.25) spots.push([x + n0[0] * 0.5, y + n0[1] * 0.5, z + n0[2] * 0.5]);
  }

  // --- 5. Sparse Floating Asteroid Ore Pods & Deep Cavern Floor Boulders
  const BOULD = [
    [0, -24, -88, 6, 9], [64, -28, 12, 8, 10], [-62, -24, -8, 5, 8],
    [6, -22, 84, 6, 9],
  ];
  rseed(8);
  for (const b of BOULD) for (let i = 0; i < b[3]; i++) {
    const sc = rr(0.45, 1.35);
    const x = b[0] + rr(-1, 1) * b[4], y = b[1] + rr(-1, 1) * b[4] * 0.5, z = b[2] + rr(-1, 1) * b[4];
    if (Dw(x, y, z) > -sc - 1.5 || nearFly(x, y, z, 5.0)) continue;
    solid(rnd() * 4 | 0, x, y, z, sc, qRand(), 1, rnd(), 1, rr(0.1, 0.3));
  }

  rseed(10);
  for (let i = 0; i < 4500; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (hypot(x, z) > 135 || ny < 0.65 || nearFly(x, y, z, 4.5)) continue;
    const sc = 0.35 + 0.9 * pow(rnd(), 2.2), q = qRand();
    chunks[(sc > 0.85 ? 3 : 0) + (rnd() * 3 | 0)][cellOf(x, z)].push(x - T.wn[k] * sc * 0.3, y - ny * sc * 0.3, z - T.wn[k + 2] * sc * 0.3, sc, q[0], q[1], q[2], q[3], 1, rnd(), sc > 0.85 ? 0 : 96, 0);
  }

  // --- 6. Major Set Pieces: The Central Reactor Core & Magma Foundry Extractor Rig
  const gy = (x, z) => { const f = floorsAt(x, z); return f.length ? f[f.length - 2] : -44; };
  // Central Reactor Core in the main hub (0, -28, 0)
  solid(11, 0, -28, 0, 1.15, qAxis(0, 1, 0, 0.4), 2, 0.3, 1, 0.18);
  // Secondary Reactor / Smelting Rig in the East Magma Foundry (64, -30, 12)
  solid(11, 64, -31, 12, 0.85, qMul(qAxis(0, 1, 0, 1.1), qAxis(0, 0, 1, 0.15)), 3, 0.7, 1, 0.1);
  // Recharge Energy Pylon in the South Energy Center (6, -28, 84)
  solid(11, 6, -28, 84, 0.8, qAxis(0, 1, 0, -0.5), 2, 0.9, 1, 0.22);

  // --- 7. Rising Molten Magma Embers (strictly over deep lava pits)
  const VENTS = [
    [0, -50, 0], [5, -50, -4], [-5, -50, 4],
    [64, -50, 12], [58, -50, 8], [70, -50, 16], [60, -50, 18], [68, -50, 6],
    [0, -50, -88], [5, -50, -84], [-5, -50, -92],
  ];
  rseed(13);
  for (const v of VENTS) {
    const n = 45 + (rnd() * 35 | 0), y0 = v[1];
    for (let i = 0; i < n; i++) {
      const sz = rr(0.025, 0.075);
      bubbles.push(v[0] + rr(-2.2, 2.2), y0, v[2] + rr(-2.2, 2.2), sz, rnd(), rr(2.2, 4.5), 11, rr(0.04, 0.14));
    }
  }

  // --- pack leaves (36 bytes: 8 floats + 4 unorm8), sorted by culling cell
  const pack = (L, step = 1, wm = 1) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += Math.ceil(L[c].length / 12 / step); }
    start[nCells] = n;
    const buf = new ArrayBuffer(n * 36), f = new Float32Array(buf), u8 = new Uint8Array(buf), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12 * step, k++) {
      for (let j = 0; j < 8; j++) f[k * 9 + j] = a[i + j];
      f[k * 9 + 6] *= wm;
      u8[k * 36 + 32] = a[i + 8]; u8[k * 36 + 33] = a[i + 9] * 255; u8[k * 36 + 34] = a[i + 10] * 255; u8[k * 36 + 35] = a[i + 11] * 255;
      const y = a[i + 1], l = a[i + 3]; if (y - l < lo[c]) lo[c] = y - l; if (y + l > hi[c]) hi[c] = y + l;
    } }
    return { buf, n, start, lo, hi };
  };

  // --- half-res 3D volume: r = openness (AO), g = local mine radiance (point lights + reactor + magma glow)
  const hx = NX / 2, hy = NY / 2, hz = NZ / 2, volD = new Uint8Array(hx * hy * hz * 2);
  for (let z = 0; z < hz; z++) {
    const wz = OZ + (z * 2 + 1) * VS;
    for (let y = 0; y < hy; y++) {
      const wy = OY + (y * 2 + 1) * VS;
      for (let x = 0; x < hx; x++) {
        const wx = OX + (x * 2 + 1) * VS;
        const g0 = gi(x * 2, y * 2, z * 2);
        const d = (D[g0] + D[g0 + 1] + D[g0 + NX] + D[g0 + NX + 1] + D[g0 + NX * NY] + D[g0 + NX * NY + 1] + D[g0 + NX * NY + NX] + D[g0 + NX * NY + NX + 1]) * 0.125;
        const open = clamp(0.5 - d / 12, 0, 1);
        let lit = 0.15;
        // Accumulate local point lights & magma glow
        for (let k = 0; k < lights.length; k++) {
          const L = lights[k], dx = wx - L[0], dy = wy - L[1], dz = wz - L[2];
          const r2 = dx * dx + dy * dy + dz * dz, R = L[4];
          if (r2 < R * R) {
            const u = 1 - sqrt(r2) / R;
            lit += L[3] * u * u * (3 - 2 * u);
          }
        }
        // Deep magma glow near floor of deep chambers
        if (wy < -44) lit += clamp((-44 - wy) / 10, 0, 0.9);
        const o = x + hx * (y + hy * z);
        volD[o * 2] = open * 255;
        volD[o * 2 + 1] = clamp(lit * clamp(0.65 - d / 6, 0.15, 1), 0, 1) * 255;
      }
    }
  }

  // --- ground map: r hazard stripe/grating zone, b high-energy cyan/purple zone, a metal deck plating
  const gm = new Uint8Array(512 * 512 * 4);
  for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) {
    const x = (i + 0.5) / 512 * 384 - 192, z = (j + 0.5) / 512 * 384 - 192, o = (i + 512 * j) * 4;
    gm[o] = magAt(x, z) * 255;
    gm[o + 2] = clamp(zoneP(x, z), 0, 1) * 255;
    gm[o + 3] = sstep(0.38, 0.58, fbm(x * 0.04, 3, z * 0.04, 3)) * 255;
  }

  // --- Autonomous Mining Robots: Patrol Drones (fish shader) & Heavy Hulks (manta shader)
  const fish = [];
  rseed(14);
  // Patrol Drone squadrons: [cx, cy, cz, radius, count, scale, dir, seed]
  const SCH = [
    [0, -24, 0, 18, 28, 0.85, 1, 0.92],       // Reactor Core Defense Drones
    [0, -34, 0, 22, 24, 0.8, -1, 0.15],       // Reactor Lower Patrol
    [0, -28, -88, 16, 26, 0.85, -1, 0.45],    // North Shaft Swarm
    [64, -30, 12, 18, 26, 0.85, 1, 0.78],     // East Magma Foundry Drones
    [-62, -26, -8, 15, 24, 0.8, -1, 0.3],     // West Processing Bay Drones
    [6, -26, 84, 18, 28, 0.85, 1, 0.6],       // South Energy Center Drones
    [-44, -34, -64, 10, 16, 0.75, 1, 0.2],    // NW Ore Junction
    [44, -30, -62, 10, 16, 0.75, -1, 0.85],   // NE Substation
    [-40, -30, 46, 10, 16, 0.75, 1, 0.5],     // SW Hub
    [42, -32, 54, 10, 16, 0.75, -1, 0.1],     // SE Annex
  ];
  for (const s of SCH) { const ss = s[7] === undefined ? rnd() : s[7]; for (let i = 0; i < s[4]; i++) fish.push(s[0], s[1], s[2], s[3], rnd(), s[6] * 2.1 / s[3], s[5], ss); }

  // Heavy Class-1 Hulk / Lifter Mechs patrolling major vaults:
  // [cx, cy, cz, radius, phase, speed, scale, seed]
  const mantas = [];
  for (const m of [
    [0, -20, 0, 19, 0.4, 0.11, 2.8, 0.15],
    [0, -35, 0, 16, 3.5, -0.10, 2.6, 0.65],
    [64, -26, 12, 16, 1.2, -0.11, 3.0, 0.4],
    [0, -22, -88, 15, 0.8, 0.12, 2.7, 0.75],
    [-62, -24, -8, 14, 2.5, -0.11, 2.6, 0.55],
    [6, -22, 84, 16, 4.1, 0.10, 2.8, 0.85],
    [0, -31, -45, 8, 1.9, 0.14, 2.2, 0.25],
    [0, -29, 44, 8, 5.0, -0.14, 2.2, 0.9],
  ]) mantas.push(...m);

  // --- drifting subterranean dust & metallic sparks
  const snow = new Float32Array(9000 * 4);
  for (let i = 0; i < snow.length; i++) snow[i] = rnd();

  const sol = { data: [], ranges: [] }; let si = 0;
  for (let m = 0; m < 12; m++) { const a = solids[m] || []; sol.ranges.push([si, a.length / 12]); si += a.length / 12; for (let i = 0; i < a.length; i++) sol.data.push(a[i]); }
  const packC = (L) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += L[c].length / 12; }
    start[nCells] = n;
    const data = new Float32Array(n * 12), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12) { for (let j = 0; j < 12; j++) data[k++] = a[i + j]; lo[c] = min(lo[c], a[i + 1] - 3); hi[c] = max(hi[c], a[i + 1] + 3); } }
    return { data, n, start, lo, hi };
  };
  return { gy, glints: new Float32Array(glints), chunks: chunks.map(packC), props: props.map(packC), big: pack(big), bigF: pack(big, 2, 1.5), small: pack(small), solids: { data: new Float32Array(sol.data), ranges: sol.ranges }, bubbles: new Float32Array(bubbles), volD, gm, fish: new Float32Array(fish), mantas: new Float32Array(mantas), snow };
}
const fract = (x) => x - floor(x);

// ---------------------------------------------------------------- procedural meshes
// Faceted asteroid rock chunks & ore boulders
function meshChunk(sd, sub = 2, det = sub > 2) {
  if (LV > 1 && sub > 1) sub--;
  rseed(100 + sd);
  const pl = []; for (let i = 0; i < 6; i++) { const q = qRand(); pl.push([q[0], q[1], q[2], rr(0.72, 0.92)]); const l = hypot(q[0], q[1], q[2]) || 1; pl[i][0] /= l; pl[i][1] /= l; pl[i][2] /= l; }
  return icosphere(sub, (x, y, z) => {
    let r = 1 + (fbm(x * 1.8 + sd, y * 1.8, z * 1.8, 2) - 0.5) * 0.8 + (det ? (fbm(x * 4.5 + sd, y * 4.5, z * 4.5, 2) - 0.5) * 0.22 : 0);
    let px = x * r, py = y * r * 0.85, pz = z * r;
    for (const p of pl) { const d = px * p[0] + py * p[1] + pz * p[2] - p[3]; if (d > 0) { px -= p[0] * d; py -= p[1] * d; pz -= p[2] * d; } }
    return [px, py, pz];
  });
}

// Hard-edged Descent industrial props via Mesh.sweep:
// 0: Armored Supply Crate Stack, 1: Louvered Wall/Floor Transformer, 2: Octagonal Shield/Energy Emitter Pad
function meshLathe(kind) {
  const m = new Mesh();
  if (kind === 0) {
    // Stacked armored munitions crates with corner bumpers
    m.sweep([[0, 0, 0], [0, 0.65, 0]], 0.85, 0.85, () => [0, 0, 1]);
    m.sweep([[0.12, 0.65, -0.08], [0.12, 1.15, -0.08]], 0.52, 0.52, () => [0, 0, 1]);
    m.sweep([[-0.35, 0, 0], [-0.35, 0.7, 0]], 0.14, 0.92, () => [0, 0, 1]);
    m.sweep([[0.35, 0, 0], [0.35, 0.7, 0]], 0.14, 0.92, () => [0, 0, 1]);
  } else if (kind === 1) {
    // Tall louvered industrial transformer cabinet with dual cooling fins
    m.sweep([[0, 0, 0], [0, 1.4, 0]], 0.68, 0.48, () => [0, 0, 1]);
    for (const sx of [-0.38, 0.38]) m.sweep([[sx, 0.15, 0], [sx, 1.25, 0]], 0.12, 0.36, () => [0, 0, 1]);
    m.sweep([[0, 1.4, 0], [0, 1.56, 0]], 0.5, 0.34, () => [0, 0, 1]);
  } else {
    // Low-profile octagonal shield/energy emitter pad
    const ring = [];
    for (let i = 0; i <= 8; i++) { const a = i / 8 * TAU; ring.push([cos(a) * 0.58, 0.14, sin(a) * 0.58]); }
    m.sweep(ring, 0.22, 0.28, () => [0, 1, 0], false);
    m.sweep([[0, 0, 0], [0, 0.42, 0]], 0.38, 0.38, () => [0, 0, 1]);
  }
  return m;
}

// Angular defense turrets & high-voltage capacitor pylons
function meshCoral(fan, lo = LV > 1) {
  rseed(200 + fan);
  const m = new Mesh();
  if (fan) {
    // Twin-barrel Defense Laser Turret on octagonal mount
    m.sweep([[0, 0, 0], [0, 0.35, 0]], 0.55, 0.55, () => [0, 0, 1]);
    m.sweep([[0, 0.35, -0.15], [0, 0.65, 0.15]], 0.38, 0.32, () => [0, 1, 0]);
    for (const sx of [-0.16, 0.16]) {
      m.sweep([[sx, 0.55, 0], [sx, 0.95, 0.45]], 0.09, 0.09, () => [0, 1, 0]);
    }
  } else {
    // High-voltage Transformer / Quartz Crystal Cluster
    const n0 = lo ? 3 : 4;
    for (let i = 0; i < n0; i++) {
      const a = i / n0 * TAU + rr(-0.15, 0.15), tilt = rr(0.12, 0.42), H = rr(0.55, 1.05), w = rr(0.14, 0.22);
      const dx = cos(a) * sin(tilt), dy = cos(tilt), dz = sin(a) * sin(tilt);
      m.sweep([[0, 0, 0], [dx * H * 0.7, dy * H * 0.7, dz * H * 0.7], [dx * H, dy * H, dz * H]], (k) => k === 2 ? 0.02 : w, (k) => k === 2 ? 0.02 : w, () => [0, 1, 0]);
    }
  }
  return m;
}

// Right-angle industrial pipe manifold with flanged collars
function meshTubes() {
  const m = new Mesh();
  for (const [ox, oz, h, dx, dz] of [[-0.28, -0.15, 0.95, 0.45, 0], [0.22, -0.15, 0.65, 0, 0.45], [-0.05, 0.24, 1.15, -0.35, 0.2]]) {
    m.sweep([[ox, 0, oz], [ox, h, oz], [ox + dx, h, oz + dz]], 0.16, 0.16, () => [0, 0, 1]);
    m.sweep([[ox, h * 0.5, oz], [ox, h * 0.5 + 0.1, oz]], 0.24, 0.24, () => [0, 0, 1]);
  }
  return m;
}

// Mesh 10: Octagonal Structural Steel Bulkhead Frame (placed along tunnel segments!)
// Uses Mesh.sweep for crisp hard-edged riveted steel beams + glowing ceiling/wall light strips
function meshFluke() {
  const m = new Mesh();
  const N = 8, R = 1.08, pts = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N + 0.0625) * TAU;
    pts.push([cos(a) * R, sin(a) * R * 0.88, 0]);
  }
  // Main outer octagonal I-beam flange
  m.sweep(pts, 0.18, 0.24, (p) => { const l = hypot(p[0], p[1]) || 1; return [p[0] / l, p[1] / l, 0]; }, false);
  // Inner recessed rib & corner gusset struts
  for (let i = 0; i < N; i += 2) {
    const a = (i / N + 0.0625) * TAU, c = cos(a), s = sin(a);
    m.sweep([[c * R * 0.92, s * R * 0.80, -0.22], [c * R * 0.92, s * R * 0.80, 0.22]], 0.12, 0.12, () => [c, s, 0], true);
  }
  return m.build();
}

// Mesh 11: The Descent Reactor Core — Towering multi-pronged energy core with containment rings & cooling pylons
function meshShip() {
  const m = new Mesh();
  // Central vertical reactor column
  m.sweep([[0, -14, 0], [0, -6, 0], [0, 0, 0], [0, 6, 0], [0, 14, 0]], (k) => (k === 2 ? 3.8 : k === 1 || k === 3 ? 2.6 : 3.4), (k) => (k === 2 ? 3.8 : k === 1 || k === 3 ? 2.6 : 3.4), () => [1, 0, 0]);
  // 8 Radial Cooling Fins / Energy Prongs
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU, c = cos(a), s = sin(a);
    m.sweep([
      [c * 2.4, -10, s * 2.4],
      [c * 5.6, -4.5, s * 5.6],
      [c * 6.4, 0, s * 6.4],
      [c * 5.6, 4.5, s * 5.6],
      [c * 2.4, 10, s * 2.4],
    ], (k) => (k === 2 ? 1.3 : 0.85), (k) => (k === 2 ? 1.8 : 0.95), () => [-s, 0, c]);
    // Diagonal floor & ceiling anchoring conduits
    if (i % 2 === 0) {
      m.sweep([[c * 3.0, -9, s * 3.0], [c * 11.5, -16, s * 11.5]], 1.1, 1.1, () => [0, 1, 0]);
      m.sweep([[c * 3.0, 9, s * 3.0], [c * 11.5, 16, s * 11.5]], 1.1, 1.1, () => [0, 1, 0]);
    }
  }
  // Upper & Lower Octagonal Containment Rings
  for (const y of [-6.5, 0, 6.5]) {
    const R = y === 0 ? 7.2 : 5.4, ring = [];
    for (let i = 0; i <= 8; i++) { const a = i / 8 * TAU; ring.push([cos(a) * R, y, sin(a) * R]); }
    m.sweep(ring, 0.9, 1.1, () => [0, 1, 0], false);
  }
  return m;
}

// Mesh 12: Heavy Class-1 Hulk / Lifter Mining Mech (replaces Manta; span along x, forward +z; aux = span coord)
function meshManta() {
  const m = new Mesh();
  // Central armored fuselage & cockpit visor
  m.sweep([[0, 0, -0.55], [0, 0.04, 0.1], [0, 0, 0.62]], (k) => (k === 1 ? 0.52 : 0.28), (k) => (k === 1 ? 0.34 : 0.16), () => [0, 1, 0]);
  // Twin swept shoulder pylons & articulated heavy weapon arms
  for (const sx of [-1, 1]) {
    const n0 = m.p.length / 3;
    // Shoulder wing pod
    m.sweep([[sx * 0.22, 0.02, 0.05], [sx * 0.68, 0.08, -0.05], [sx * 0.95, -0.04, -0.15]], (k) => 0.36 - k * 0.08, (k) => 0.18 - k * 0.03, () => [0, 1, 0]);
    for (let k = n0; k < m.aux.length; k++) m.aux[k] = m.p[k * 3];
    // Forward twin plasma cannon pods
    const n1 = m.p.length / 3;
    m.sweep([[sx * 0.72, -0.06, -0.15], [sx * 0.76, -0.1, 0.35], [sx * 0.76, -0.1, 0.78]], (k) => (k === 2 ? 0.09 : 0.16), (k) => (k === 2 ? 0.09 : 0.16), () => [0, 1, 0]);
    for (let k = n1; k < m.aux.length; k++) m.aux[k] = sx * 0.75;
  }
  // Rear thruster cowling
  const n2 = m.p.length / 3;
  m.sweep([[-0.22, 0, -0.58], [0.22, 0, -0.58]], 0.22, 0.22, () => [0, 1, 0]);
  for (let k = n2; k < m.aux.length; k++) m.aux[k] = 0;
  return m;
}

// Mesh 13: Class-1 Patrol Drone (replaces Fish; nose +x, span along z)
function meshFish() {
  const m = new Mesh();
  // Angular wedge body
  m.sweep([[-0.45, 0, 0], [0.05, 0.02, 0], [0.52, -0.02, 0]], (k) => (k === 1 ? 0.38 : 0.12), (k) => (k === 1 ? 0.26 : 0.08), () => [0, 1, 0]);
  // Swept side stabilizer wings & twin laser tips
  m.sweep([[0.15, 0, -0.52], [-0.08, 0.04, 0], [0.15, 0, 0.52]], (k) => (k === 1 ? 0.32 : 0.14), () => 0.06, () => [0, 1, 0]);
  for (const sz of [-0.46, 0.46]) {
    m.sweep([[-0.15, 0, sz], [0.42, 0, sz]], 0.06, 0.06, () => [0, 1, 0]);
  }
  return m;
}
