// Unit tests for the statistical building blocks. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { median, robustZ, ridge, robustRidge, seasonalIndex, mulberry32, dot } from '../src/engine/stats.js';
import { buildPeerGroups } from '../src/engine/peers.js';
import { localSpatial, changePoint, slope } from '../src/engine/spatial.js';

const rnd = mulberry32(1);
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());

test('median and robust z-scores ignore outliers', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  const v = [...Array.from({ length: 50 }, () => gauss()), 40];
  const { z } = robustZ(v);
  assert.ok(z[50] > 10, 'the outlier stands out');
  assert.ok(Math.abs(median(z)) < 1e-9, 'centred on the median');
});

test('ridge recovers a known linear relationship', () => {
  const X = [], y = [];
  for (let i = 0; i < 300; i++) { const a = gauss(), b = gauss(); X.push([1, a, b]); y.push(2 + 3 * a - 1.5 * b + 0.05 * gauss()); }
  const fit = ridge(X, y, 1e-6);
  assert.ok(Math.abs(fit.beta[0] - 2) < 0.03 && Math.abs(fit.beta[1] - 3) < 0.03 && Math.abs(fit.beta[2] + 1.5) < 0.03);
  assert.ok(fit.r2 > 0.99);
});

test('robust ridge is not dragged by contaminated zones', () => {
  const X = [], y = [];
  for (let i = 0; i < 200; i++) { const a = gauss(); X.push([1, a]); y.push(1 + 2 * a + 0.1 * gauss() + (i < 20 ? 3 : 0)); } // 10% shifted up
  const plain = ridge(X, y, 1e-6), robust = robustRidge(X, y, 1e-6);
  assert.ok(Math.abs(robust.beta[0] - 1) < Math.abs(plain.beta[0] - 1), 'robust intercept is closer to the truth');
  assert.ok(Math.abs(robust.beta[0] - 1) < 0.12);
  const flagged = robust.residuals.slice(0, 20).filter((r) => r / robust.scale > 3).length;
  assert.ok(flagged >= 18, 'contaminated zones stay visible as residuals');
});

test('seasonal index finds the seasonal shape and averages to 1', () => {
  const shape = [1.4, 1.2, 1.0, 0.9, 0.9, 0.6, 0.5, 0.6, 0.7, 0.9, 1.1, 1.4];
  const cal = [], series = [];
  for (let t = 0; t < 36; t++) { const m = (t % 12) + 1; cal.push(m); series.push(100 * (1 + 0.01 * t) * shape[m - 1]); }
  const f = seasonalIndex(series, cal);
  assert.ok(Math.abs(f.reduce((a, b) => a + b, 0) / 12 - 1) < 1e-9);
  assert.ok(f[11] > 1.25 && f[6] < 0.65, 'peak and trough recovered');
});

test('peer groups separate structurally different zones and respect the minimum size', () => {
  const rows = [];
  const mk = (id, built, tour, dist, ind = 0) => ({ id, traits: { built_up: built + gauss(), tourism: tour + 0.2 * gauss(), road_access: 0.5, dist_centre_km: dist + gauss(), industrial: ind, extractive: 0 } });
  for (let i = 0; i < 60; i++) rows.push(mk(i, 45, 6, 3));
  for (let i = 60; i < 120; i++) rows.push(mk(i, 5, 1, 25));
  for (let i = 120; i < 150; i++) rows.push(mk(i, 20, 2, 10, 1));
  for (let i = 150; i < 155; i++) rows.push(mk(i, 90, 9, 1)); // too few to stand alone
  const groups = buildPeerGroups(rows, 5);
  assert.ok(groups.every((g) => g.n >= 22), 'no group below the minimum size');
  assert.equal(groups.reduce((s, g) => s + g.n, 0), rows.length, 'every zone belongs to exactly one group');
  const of = (id) => groups.find((g) => g.memberIds.includes(id)).id;
  assert.notEqual(of(0), of(60));
  assert.equal(new Set(rows.slice(120, 150).map((r) => of(r.id))).size, 1, 'industrial zones stay together');
  assert.ok(groups.some((g) => g.name === 'Industrial estates'));
  // deterministic
  assert.deepEqual(buildPeerGroups(rows, 5).map((g) => g.memberIds), groups.map((g) => g.memberIds));
});

test('local spatial statistics find a planted cluster and little else', () => {
  const side = 14, vals = [], nb = [];
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) {
    vals.push(gauss() + (r >= 4 && r <= 7 && c >= 4 && c <= 7 ? 4 : 0));
    const n = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if ((dr || dc) && rr >= 0 && rr < side && cc >= 0 && cc < side) n.push(rr * side + cc);
    }
    nb.push(n);
  }
  vals[0] = NaN; // an insufficient-data zone is skipped, not scored
  const out = localSpatial(vals, nb);
  assert.equal(out[0].cls, null);
  const inner = [5 * side + 5, 5 * side + 6, 6 * side + 5, 6 * side + 6];
  assert.ok(inner.every((i) => out[i].cls === 'hot'), 'cluster core is a hot spot');
  const far = out.filter((o, i) => o.cls === 'hot' && (Math.floor(i / side) > 9 || i % side > 9)).length;
  assert.ok(far <= 3, `few false hot spots away from the cluster (${far})`);
  assert.ok(out.every((o) => o.p === null || (o.p > 0 && o.p <= 1)));
});

test('change-point detection finds a level shift and ignores noise', () => {
  const shift = Array.from({ length: 24 }, (_, i) => (i < 16 ? 0 : 3) + 0.3 * gauss());
  const cp = changePoint(shift);
  assert.ok(Math.abs(cp.index - 16) <= 1, `found at ${cp.index}`);
  assert.ok(cp.shift > 2.4 && Math.abs(cp.t) > 8);
  const flat = Array.from({ length: 24 }, () => 0.3 * gauss());
  assert.ok(Math.abs(changePoint(flat).t) < 4, 'no strong change point in noise');
  assert.equal(changePoint([1, 2, 3]), null, 'too short a series gives no answer');
  assert.ok(slope([0, 1, 2, 3, 4, 5]) > 0.99 && slope([5, 4, NaN, 2, 1, 0]) < -0.9);
  assert.ok(Math.abs(dot([1, 2], [3, 4]) - 11) < 1e-12);
});
