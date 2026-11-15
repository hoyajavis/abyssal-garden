// ============================================================================
// Automated Unit Tests for Descent 6DoF Mine Topology, Traversability & Shaders
// Run via: npm test (or node --test test.mjs)
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mathSrc = readFileSync(path.join(here, 'src', 'math.js'), 'utf8');
const worldSrc = readFileSync(path.join(here, 'src', 'world.js'), 'utf8');
const shadersSrc = readFileSync(path.join(here, 'src', 'shaders.js'), 'utf8');
const mainSrc = readFileSync(path.join(here, 'src', 'main.js'), 'utf8');

// Extract POSES and FLY from main.js
const posesMatch = mainSrc.match(/const POSES = (\[[\s\S]*?\]);/);
const flyMatch = mainSrc.match(/const FLY = new Float32Array\((\[[\s\S]*?\])\);/);
assert.ok(posesMatch, 'POSES array must exist in main.js');
assert.ok(flyMatch, 'FLY spline array must exist in main.js');

// Load math.js + world.js in a sandboxed function
const loadCore = new Function(
  'LV', 'THIN',
  `${mathSrc}\n${worldSrc}\nconst POSES = ${posesMatch[1]};\nconst FLY = new Float32Array(${flyMatch[1]});\n` +
  `return { NX, NY, NZ, VS, OX, OY, OZ, CELLS, CELLW, NCHUNK, MESAS, HOLES, ARCHES, CLEARS, POSES, FLY, ` +
  `primBuffer, buildTerrain, makeWorld, surfaceNets, sampler3, meshChunk, meshLathe, meshCoral, meshTubes, meshFluke, meshShip, meshManta, meshFish, ` +
  `sin, cos, sqrt, min, max, abs, floor, PI, pow, atan2, hypot, exp, round, clamp, mix, sstep, fbm };`
);

const C = loadCore(0, 1);

// Exact CPU port of the WGSL W_DENS density function in shaders.js
function createDensityEvaluator() {
  const { MESAS, ARCHES, HOLES, CLEARS, clamp, max, min, abs, sqrt, floor, mix } = C;

  const ss = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const fract = (x) => x - floor(x);
  const h31 = (px, py, pz) => {
    let qx = fract(px * 0.1031), qy = fract(py * 0.1030), qz = fract(pz * 0.0973);
    const d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
    qx += d; qy += d; qz += d;
    return fract((qx + qy) * qz);
  };
  const h33 = (px, py, pz) => {
    let qx = fract(px * 0.1031), qy = fract(py * 0.1030), qz = fract(pz * 0.0973);
    const d = qx * (qy + 33.33) + qy * (qx + 33.33) + qz * (qz + 33.33);
    qx += d; qy += d; qz += d;
    return [fract((qx + qy) * qz), fract((qx + qx) * qy), fract((qy + qx) * qx)];
  };
  const vn = (px, py, pz) => {
    const ix = floor(px), iy = floor(py), iz = floor(pz);
    const fx = px - ix, fy = py - iy, fz = pz - iz;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    const a = mix(mix(h31(ix, iy, iz), h31(ix + 1, iy, iz), ux), mix(h31(ix, iy + 1, iz), h31(ix + 1, iy + 1, iz), ux), uy);
    const b = mix(mix(h31(ix, iy, iz + 1), h31(ix + 1, iy, iz + 1), ux), mix(h31(ix, iy + 1, iz + 1), h31(ix + 1, iy + 1, iz + 1), ux), uy);
    return mix(a, b, uz);
  };
  const fbm3 = (px, py, pz, n) => {
    let a = 0.5, s = 0, qx = px, qy = py, qz = pz;
    for (let i = 0; i < n; i++) {
      s += a * vn(qx, qy, qz);
      qx = qx * 2.03 + 17.1; qy = qy * 2.03 + 31.7; qz = qz * 2.03 + 5.3;
      a *= 0.5;
    }
    return s / (1 - 2 * a);
  };
  const wor = (px, py, pz) => {
    const ix = floor(px), iy = floor(py), iz = floor(pz);
    const fx = px - ix, fy = py - iy, fz = pz - iz;
    let d = 9;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const h = h33(ix + x, iy + y, iz + z);
          const rx = x + h[0] - fx, ry = y + h[1] - fy, rz = z + h[2] - fz;
          const l2 = rx * rx + ry * ry + rz * rz;
          if (l2 < d) d = l2;
        }
      }
    }
    return sqrt(d);
  };
  const smax = (a, b, k) => {
    const h = max(k - abs(a - b), 0) / k;
    return max(a, b) + h * h * k * 0.25;
  };
  const smin = (a, b, k) => -smax(-a, -b, k);
  const seg2 = (px, pz, ax, az, bx, bz) => {
    const pax = px - ax, paz = pz - az, bax = bx - ax, baz = bz - az;
    const h = clamp((pax * bax + paz * baz) / max(bax * bax + baz * baz, 1e-4), 0, 1);
    return Math.hypot(pax - bax * h, paz - baz * h);
  };
  const octSeg = (px, py, pz, ax, ay, az, bx, by, bz, rw, rh) => {
    const bax = bx - ax, bay = by - ay, baz = bz - az;
    const l2 = max(bax * bax + bay * bay + baz * baz, 1e-4);
    const h = clamp(((px - ax) * bax + (py - ay) * bay + (pz - az) * baz) / l2, 0, 1);
    const dx = px - (ax + bax * h), dy = py - (ay + bay * h), dz = pz - (az + baz * h);
    const l = sqrt(l2);
    const tx = bax / l, ty = bay / l, tz = baz / l;
    const upx = abs(ty) > 0.92 ? 1 : 0, upy = abs(ty) > 0.92 ? 0 : 1, upz = 0;
    let rtx = ty * upz - tz * upy, rty = tz * upx - tx * upz, rtz = tx * upy - ty * upx;
    const rl = Math.hypot(rtx, rty, rtz) || 1; rtx /= rl; rty /= rl; rtz /= rl;
    const u2x = rty * tz - rtz * ty, u2y = rtz * tx - rtx * tz, u2z = rtx * ty - rty * tx;
    const lx = abs(dx * rtx + dy * rty + dz * rtz) - rw;
    const ly = abs(dx * u2x + dy * u2y + dz * u2z) - rh;
    const lz = abs(dx * tx + dy * ty + dz * tz) - min(rw, rh);
    const box2 = max(lx, ly);
    const oct2 = max(box2, (lx + ly) * 0.74 + min(rw, rh) * 0.18);
    return max(oct2, lz);
  };

  // Smooth geometric SDF (without high-frequency wall noise) and full noisy SDF
  const dens = (px, py, pz, withNoise = true) => {
    const wx = withNoise ? fbm3(px * 0.045 + 11, py * 0.045 + 11, pz * 0.045 + 11, 3) - 0.5 : 0;
    const wy = withNoise ? fbm3(px * 0.045 + 47, py * 0.045 + 47, pz * 0.045 + 47, 3) - 0.5 : 0;
    const wz = withNoise ? fbm3(px * 0.045 + 83, py * 0.045 + 83, pz * 0.045 + 83, 3) - 0.5 : 0;
    let d = 24;
    let rgh = 1;
    for (const m of MESAS) {
      const ws = clamp(m[7] * 2.4, 0.15, 1.25);
      const qx = px + wx * 3.4 * ws, qy = py + wy * 2.4 * ws, qz = pz + wz * 3.4 * ws;
      const lx = abs(qx - m[0]) - m[3], ly = abs(qy - m[1]) - m[4], lz = abs(qz - m[2]) - m[5];
      const box3 = max(lx, max(ly, lz));
      const chm = max(box3, (lx + ly + lz) * 0.62 + min(m[3], m[4]) * m[6]);
      d = smin(d, chm, 2.4);
      rgh = mix(rgh, m[7], ss(6, -2, chm));
    }
    for (const h of HOLES) {
      const bax = h[3] - h[0], bay_ = h[4] - h[1], baz = h[5] - h[2];
      const bl = Math.hypot(bax, bay_, baz) || 1;
      const sProj = (px - h[0]) * (bax / bl) + (py - h[1]) * (bay_ / bl) + (pz - h[2]) * (baz / bl);
      const bay = (abs(fract(sProj * 0.125) - 0.5) >= 0.22 ? 1 : 0) * 0.32;
      const td = octSeg(px, py, pz, h[0], h[1], h[2], h[3], h[4], h[5], h[6] + bay, h[7] + bay * 0.5);
      d = smin(d, td, 0.55);
      rgh = mix(rgh, 0.025, ss(1.8, -0.4, td));
    }
    let clr = 0;
    for (const c of CLEARS) {
      clr = max(clr, 1 - ss(0, c[5], seg2(px, pz, c[0], c[1], c[2], c[3]) - c[4]));
    }
    for (const a of ARCHES) {
      const pil = octSeg(px, py, pz, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[6]);
      d = smax(d, -pil, 0.4);
      rgh = mix(rgh, 0.015, ss(1.5, -0.2, pil));
    }
    if (withNoise) {
      const rk = clamp(rgh * (1 - clr * 0.75), 0.015, 1);
      d += rk * ((0.5 - wor(px * 0.18 + wx * 1.5, py * 0.18 + wy * 1.5, pz * 0.18 + wz * 1.5)) * 2.8 +
                 (0.5 - wor(px * 0.42 + 7, py * 0.42 + 7, pz * 0.42 + 7)) * 1.1 +
                 (fbm3(px * 0.28, py * 0.28, pz * 0.28, 3) - 0.5) * 1.6);
      d += mix(0.18, 0.45, rk) * (abs(fract(py * 0.25) - 0.5) - 0.25);
    }
    d = smax(d, -54.5 - py, 1.5);
    d = smax(d, py + 1.5, 1.5);
    return d;
  };

  return { dens, octSeg };
}

const { dens } = createDensityEvaluator();

describe('Descent 6DoF Subterranean Mine — Traversability & Integrity Suite', () => {
  test('1. Primitive Buffer & Chamber/Tunnel Definitions are well-formed', () => {
    const pb = C.primBuffer();
    const expectedFloats = (C.MESAS.length + C.ARCHES.length + C.HOLES.length + C.CLEARS.length) * 8;
    assert.equal(pb.length, expectedFloats, 'primBuffer float count must match 8 floats per primitive');
    assert.ok(C.MESAS.length >= 9, 'At least 9 subterranean chambers defined');
    assert.ok(C.HOLES.length >= 16, 'At least 16 6DoF tunnel segments defined');
  });

  test('2. All 6 Preset Viewpoints (POSES) have ample 6DoF ship clearance', () => {
    const CR = 0.55; // Pyro-GX collision radius
    C.POSES.forEach((p, idx) => {
      const [x, y, z, tx, ty, tz] = p;
      const d = dens(x, y, z, true);
      assert.ok(
        d < -CR * 2,
        `Viewpoint ${idx + 1} at [${x}, ${y}, ${z}] must be in open space with >2x ship radius clearance (got d=${d.toFixed(2)})`
      );
      const lookDist = Math.hypot(tx - x, ty - y, tz - z);
      assert.ok(lookDist > 5, `Viewpoint ${idx + 1} look target must be non-degenerate (dist=${lookDist.toFixed(2)})`);
    });
  });

  test('3. Every Tunnel Segment (HOLES) is continuously traversable from endpoint A to endpoint B', () => {
    const CR = 0.55;
    C.HOLES.forEach((h, idx) => {
      const [ax, ay, az, bx, by, bz, rw, rh] = h;
      assert.ok(rw >= 5.0 && rh >= 5.0, `Tunnel ${idx} cross-section must comfortably fit the ship`);
      const samples = 24;
      for (let s = 0; s <= samples; s++) {
        const u = s / samples;
        const px = C.mix(ax, bx, u), py = C.mix(ay, by, u), pz = C.mix(az, bz, u);
        // Check that centerline is clear of rock (and not blocked by any ARCHES pillar)
        const d = dens(px, py, pz, true);
        assert.ok(
          d < -CR * 2,
          `Tunnel ${idx} blocked at u=${u.toFixed(2)} [${px.toFixed(1)}, ${py.toFixed(1)}, ${pz.toFixed(1)}]: d=${d.toFixed(2)}`
        );
      }
    });
  });

  test('4. Full Chamber-to-Chamber Graph Connectivity (BFS + 3D Voxel Flood-Fill)', () => {
    // Verify that all 9 chambers (MESAS) belong to a single connected 3D navigable component
    // by stepping through a coarse 3D grid (2m step) inside the carved volume.
    const step = 2.0;
    const key = (ix, iy, iz) => `${ix},${iy},${iz}`;
    const toGrid = (x, y, z) => [Math.round(x / step), Math.round(y / step), Math.round(z / step)];

    // Start flood-fill from Chamber 0 (Reactor Core Cavern, offset slightly from central reactor pillar)
    const startPt = [0, -28, 20];
    assert.ok(dens(...startPt, false) < -1.0, 'Start point in Reactor Cavern must be open');

    const startG = toGrid(...startPt);
    const visited = new Set([key(...startG)]);
    const queue = [startG];
    const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

    while (queue.length > 0) {
      const [ix, iy, iz] = queue.shift();
      for (const [dx, dy, dz] of dirs) {
        const nx = ix + dx, ny = iy + dy, nz = iz + dz;
        const k = key(nx, ny, nz);
        if (visited.has(k)) continue;
        const wx = nx * step, wy = ny * step, wz = nz * step;
        if (Math.abs(wx) > 100 || Math.abs(wz) > 110 || wy < -54 || wy > -2) continue;
        if (dens(wx, wy, wz, false) < -0.8) {
          visited.add(k);
          queue.push([nx, ny, nz]);
        }
      }
    }

    // Check that every single chamber (MESAS) is reached by the 3D flood-fill
    C.MESAS.forEach((m, idx) => {
      const [cx, cy, cz] = m;
      const g = toGrid(cx, cy, cz);
      // Check center or a 2m-adjacent cell in case a center pylon sits at the exact center
      const reached = visited.has(key(...g)) || dirs.some(([dx, dy, dz]) => visited.has(key(g[0] + dx * 2, g[1] + dy, g[2] + dz * 2)));
      assert.ok(reached, `Chamber ${idx} at [${cx}, ${cy}, ${cz}] must be reachable from the Central Reactor Core via 6DoF tunnels`);
    });
  });

  test('5. 60-Second Scripted Fly-Through Spline (FLY) is 100% Collision-Free', () => {
    const FLY = C.FLY;
    const FLYN = FLY.length / 6;
    const P6 = new Float64Array(6);
    const evalSpline = (s) => {
      let i = Math.floor(s) | 0;
      if (i > FLYN - 2) i = FLYN - 2;
      const u = s - i;
      const i0 = (i > 0 ? i - 1 : 0) * 6, i1 = i * 6, i2 = (i + 1) * 6, i3 = (i + 2 < FLYN ? i + 2 : FLYN - 1) * 6;
      for (let o = 0; o < 6; o++) {
        const a = FLY[i0 + o], b = FLY[i1 + o], c = FLY[i2 + o], d = FLY[i3 + o];
        P6[o] = 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
      }
      return [P6[0], P6[1], P6[2]];
    };

    const N = 600; // every 0.1s along the 60s path
    let minClearance = Infinity, worstPt = null, worstIdx = 0;
    for (let k = 0; k <= N; k++) {
      const s = (k / N) * (FLYN - 1);
      const [x, y, z] = evalSpline(s);
      const d = dens(x, y, z, true);
      if (-d < minClearance) {
        minClearance = -d;
        worstPt = [x, y, z];
        worstIdx = k;
      }
      assert.ok(
        d < -0.55,
        `FLY path collides with rock at step ${k}/${N} (s=${s.toFixed(2)}, pos=[${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}], d=${d.toFixed(2)})`
      );
    }
    assert.ok(minClearance > 0.55, `Minimum clearance along 60s fly-through is ${minClearance.toFixed(2)}m at step ${worstIdx} (${worstPt.map(v=>v.toFixed(1))})`);
  });

  test('6. Wall-Sliding Collision Physics pushes ship out of rock and zeroes inward velocity', () => {
    // Test gradient repulsion along a tunnel wall
    // North arterial tunnel runs along X=0, Y=-32, Z=-45 with halfWidth=8.5
    // Near the right wall (X = +8.2, Y = -32, Z = -45), d approaches 0 and gradient points toward +X
    const px = 8.2, py = -32, pz = -45, e = 0.375;
    const gx = dens(px + e, py, pz, false) - dens(px - e, py, pz, false);
    const gy = dens(px, py + e, pz, false) - dens(px, py - e, pz, false);
    const gz = dens(px, py, pz + e, false) - dens(px, py, pz - e, false);
    const l = Math.hypot(gx, gy, gz);
    assert.ok(l > 0.1, 'Wall SDF gradient must be non-zero at tunnel boundary');
    assert.ok(gx / l > 0.85, `East wall normal must point into the rock (+X), got nx=${(gx / l).toFixed(2)}`);
  });

  test('7. All Procedural Meshes generate valid, NaN-free geometry and indices', () => {
    const builders = [
      ['meshChunk(1,3)', () => C.meshChunk(1, 3).build()],
      ['meshLathe(canister)', () => C.meshLathe([[0, 0, 0.5], [0.4, 0, 0.6], [0.4, 1, 1], [0, 1, 0.7]], 8, 0.1, 4).build()],
      ['meshCoral(0 - crystal)', () => C.meshCoral(0).build()],
      ['meshCoral(1 - turret)', () => C.meshCoral(1).build()],
      ['meshTubes(manifold)', () => C.meshTubes().build()],
      ['meshFluke(bulkhead)', () => C.meshFluke()],
      ['meshShip(reactor)', () => C.meshShip().build()],
      ['meshManta(hulk mech)', () => C.meshManta().build()],
      ['meshFish(patrol drone)', () => C.meshFish().build()],
    ];
    for (const [name, fn] of builders) {
      const m = fn();
      assert.ok(m.nv > 0 && m.ib.length > 0 && m.ib.length % 3 === 0, `${name} must have non-empty triangles`);
      const vf = new Float32Array(m.vb);
      for (let k = 0; k < m.nv; k++) {
        assert.ok(
          Number.isFinite(vf[k * 4]) && Number.isFinite(vf[k * 4 + 1]) && Number.isFinite(vf[k * 4 + 2]),
          `${name} vertex ${k} contains NaN/Infinity`
        );
      }
      for (let i = 0; i < m.ib.length; i++) {
        assert.ok(m.ib[i] < m.nv, `${name} index ${i} (${m.ib[i]}) out of bounds (nv=${m.nv})`);
      }
    }
  });

  test('8. WGSL Shader Sources have balanced delimiters and required entry points', () => {
    const wgslBlocks = [...shadersSrc.matchAll(/\/\*wgsl\*\/`([^`]*)`/g)].map((m) => m[1]);
    assert.ok(wgslBlocks.length >= 10, 'All WGSL shader blocks must be marked with /*wgsl*/');
    for (let idx = 0; idx < wgslBlocks.length; idx++) {
      const code = wgslBlocks[idx];
      let braces = 0, parens = 0;
      for (const ch of code) {
        if (ch === '{') braces++;
        else if (ch === '}') braces--;
        else if (ch === '(') parens++;
        else if (ch === ')') parens--;
        assert.ok(braces >= 0 && parens >= 0, `WGSL block ${idx} has unbalanced closing delimiter`);
      }
      assert.equal(braces, 0, `WGSL block ${idx} has unbalanced curly braces`);
      assert.equal(parens, 0, `WGSL block ${idx} has unbalanced parentheses`);
    }
  });

  test('9. Sub-Stepping collide() Simulation slides along tunnel walls and never tunnels into rock', () => {
    // Simulate a ship starting inside the North Arterial Tunnel (x=0, y=-32, z=-45)
    // and thrusting diagonally into the East tunnel wall (+X, -Z) at high afterburner speed (28 m/s).
    const CR = 0.55;
    let cx = 5.0, cy = -32.0, cz = -45.0;
    let vx = 24.0, vy = 2.0, vz = -15.0;
    const dt = 1 / 60;
    const CE = [0, 0, 0, 0.375, 0, 0, -0.375, 0, 0, 0, 0.375, 0, 0, -0.375, 0, 0, 0, 0.375, 0, 0, -0.375];
    const CS = new Float64Array(7);
    const sd = (j) => {
      CS[j] = dens(cx + CE[j * 3], cy + CE[j * 3 + 1], cz + CE[j * 3 + 2], true);
    };

    for (let frame = 0; frame < 90; frame++) {
      const mx = vx * dt, my = vy * dt, mz = vz * dt;
      const n = Math.floor(Math.hypot(mx, my, mz) / 0.4) + 1;
      for (let i = 0; i < n; i++) {
        cx += mx / n; cy += my / n; cz += mz / n;
        for (let k = 0; k < 2; k++) {
          sd(0);
          const s = CS[0] + CR;
          if (s <= 0) break;
          for (let j = 1; j < 7; j++) sd(j);
          let gx = CS[1] - CS[2], gy = CS[3] - CS[4], gz = CS[5] - CS[6];
          const l = Math.hypot(gx, gy, gz);
          if (l < 0.075) break;
          gx /= l; gy /= l; gz /= l;
          const vn = vx * gx + vy * gy + vz * gz;
          cx -= gx * s; cy -= gy * s; cz -= gz * s;
          if (vn > 0) { vx -= gx * vn; vy -= gy * vn; vz -= gz * vn; }
        }
      }
      // After collision resolution each frame, the ship center must never penetrate into solid rock (d > 0)
      const dAfter = dens(cx, cy, cz, true);
      assert.ok(dAfter < 0, `Ship penetrated solid rock on frame ${frame}: pos=[${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}], d=${dAfter.toFixed(3)}`);
    }
    // Verify the ship slid forward along the -Z tunnel while being stopped along +X by the wall
    assert.ok(cz < -55, `Ship should slide smoothly along the tunnel (-Z), got cz=${cz.toFixed(2)}`);
    assert.ok(cx < 9.0, `Ship should be constrained by East tunnel wall, got cx=${cx.toFixed(2)}`);
  });

  test("10. layout:'auto' WGSL shaders statically use all declared @binding variables", () => {
    const autoShaders = ['W_WATER', 'W_RAYS', 'W_RBLUR', 'W_POST'];
    for (const name of autoShaders) {
      const m = shadersSrc.match(new RegExp(`const ${name}\\s*=([\\s\\S]*?\`;)\\n`));
      assert.ok(m, `${name} must be defined in shaders.js`);
      const block = m[1];
      const bindings = [...block.matchAll(/@binding\(\d+\)\s*var(?:<[^>]+>)?\s+(\w+)\s*:/g)];
      assert.ok(bindings.length > 0, `${name} should declare at least one binding`);
      for (const [, varName] of bindings) {
        // Check that varName appears at least twice (declaration + usage) in the shader block
        const uses = block.match(new RegExp(`\\b${varName}\\b`, 'g')) || [];
        assert.ok(uses.length >= 2, `${name} declares @binding var '${varName}' but never uses it (causes layout:'auto' mismatch)`);
      }
    }
  });
});
