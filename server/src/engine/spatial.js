// Local spatial statistics on the peer-standardised residual.
// Local Moran's I (Anselin 1995) and Getis-Ord Gi* with a conditional permutation test,
// so an isolated noisy zone is separated from a real cluster or outlier.
import { mean, sd, mulberry32 } from './stats.js';

// values: array (NaN = excluded); neighbours: array of index arrays (queen contiguity)
export function localSpatial(values, neighbours, { perms = 199, seed = 3, alpha = 0.05 } = {}) {
  const idx = values.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  const pos = new Map(idx.map((i, p) => [i, p]));
  const vals = idx.map((i) => values[i]);
  const mu = mean(vals), s = sd(vals) || 1;
  const z = values.map((v) => (Number.isFinite(v) ? (v - mu) / s : NaN));
  const rnd = mulberry32(seed);
  const n = idx.length;
  return values.map((v, i) => {
    if (!Number.isFinite(v)) return { cls: null, p: null, gi: null, moran: null };
    const nb = neighbours[i].filter((j) => Number.isFinite(values[j]));
    if (nb.length < 2) return { cls: 'ns', p: 1, gi: 0, moran: 0 };
    const k = nb.length;
    const lag = mean(nb.map((j) => z[j]));
    const moran = z[i] * lag;
    // Gi*: standardised local sum including the zone itself
    const w = k + 1;
    const sum = z[i] + nb.reduce((a, j) => a + z[j], 0);
    const gi = sum / Math.sqrt((w * (n - w)) / (n - 1));
    // conditional permutation: hold zone i fixed, draw its neighbourhood from everyone else
    let extreme = 0;
    for (let p = 0; p < perms; p++) {
      let acc = 0;
      for (let q = 0; q < k; q++) {
        let j = idx[Math.floor(rnd() * n)];
        if (j === i) j = idx[(pos.get(i) + 1) % n];
        acc += z[j];
      }
      if (Math.abs(acc / k) >= Math.abs(lag)) extreme++;
    }
    const pval = (extreme + 1) / (perms + 1);
    let cls = 'ns';
    if (pval <= alpha) {
      if (z[i] > 0 && lag > 0) cls = 'hot';
      else if (z[i] < 0 && lag < 0) cls = 'cold';
      else if (Math.abs(z[i]) >= 1) cls = 'outlier';
    }
    return { cls, p: +pval.toFixed(3), gi: +gi.toFixed(2), moran: +moran.toFixed(2) };
  });
}

// Single change point in a series: the split with the largest mean shift (one level of binary segmentation).
export function changePoint(series, minSeg = 3) {
  const pts = series.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 2 * minSeg + 2) return null;
  const x = pts.map((p) => p[1]);
  let best = null;
  for (let c = minSeg; c <= x.length - minSeg; c++) {
    const a = x.slice(0, c), b = x.slice(c);
    const ma = mean(a), mb = mean(b);
    const ss = a.reduce((t, v) => t + (v - ma) ** 2, 0) + b.reduce((t, v) => t + (v - mb) ** 2, 0);
    const pooled = Math.sqrt(ss / (x.length - 2)) || 1e-6;
    const t = (mb - ma) / (pooled * Math.sqrt(1 / a.length + 1 / b.length));
    if (!best || Math.abs(t) > Math.abs(best.t)) best = { index: pts[c][0], shift: mb - ma, before: ma, after: mb, t };
  }
  return best;
}

export function slope(series) {
  const pts = series.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 3) return 0;
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
  const den = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0) || 1;
  return pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / den;
}
