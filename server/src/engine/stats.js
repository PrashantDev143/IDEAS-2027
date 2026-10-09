export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

export function median(a) {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Robust z-scores (median / MAD), with a floor on the scale so near-constant inputs don't explode.
export function robustZ(values, floor = 0.02) {
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  const scale = Math.max(1.4826 * mad, floor);
  return { z: values.map((v) => (Number.isFinite(v) ? (v - med) / scale : NaN)), med, scale };
}

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

// Ridge regression via normal equations (small feature count). X rows must include the intercept column.
export function ridge(X, y, lambda = 1e-3) {
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xi = X[i];
    for (let j = 0; j < p; j++) {
      b[j] += xi[j] * y[i];
      for (let k = 0; k < p; k++) A[j][k] += xi[j] * xi[k];
    }
  }
  for (let j = 1; j < p; j++) A[j][j] += lambda * X.length;
  const beta = solve(A, b);
  const pred = X.map((xi) => dot(xi, beta));
  const ym = mean(y);
  const ssTot = y.reduce((s, v) => s + (v - ym) ** 2, 0);
  const ssRes = y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
  const residVar = ssRes / Math.max(1, y.length - p);
  return { beta, r2: 1 - ssRes / ssTot, residVar, n: y.length };
}

export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (M[i][i] || 1e-12));
}

// Classical multiplicative seasonal index from a monthly series.
// series: array of values; calMonths: parallel array of calendar months (1..12).
// Returns 12 factors averaging 1 (index 0 = January). Needs >= 13 points for a centred MA.
export function seasonalIndex(series, calMonths) {
  const n = series.length;
  const ratios = Array.from({ length: 12 }, () => []);
  for (let i = 6; i < n - 6; i++) {
    let s = 0;
    for (let k = -6; k <= 6; k++) s += (k === -6 || k === 6 ? 0.5 : 1) * series[i + k];
    const cma = s / 12;
    if (cma > 0) ratios[calMonths[i] - 1].push(series[i] / cma);
  }
  let f = ratios.map((r) => (r.length ? mean(r) : 1));
  const avg = mean(f);
  f = f.map((x) => x / avg);
  return f;
}

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

// Robust ridge regression: ordinary ridge, then Huber-style reweighting so a few anomalous zones
// cannot drag the "expected" line towards themselves.
export function robustRidge(X, y, lambda = 1e-2, iters = 2) {
  let w = new Array(y.length).fill(1);
  let fit = null;
  for (let it = 0; it <= iters; it++) {
    const Xw = X.map((r, i) => r.map((v) => v * Math.sqrt(w[i])));
    const yw = y.map((v, i) => v * Math.sqrt(w[i]));
    fit = ridge(Xw, yw, lambda);
    const res = X.map((r, i) => y[i] - dot(r, fit.beta));
    const { z, scale } = robustZ(res, 0.05);
    fit.scale = scale;
    fit.residuals = res;
    w = z.map((v) => (Math.abs(v) <= 1.5 ? 1 : 1.5 / Math.abs(v)));
  }
  const ym = mean(y);
  const ssTot = y.reduce((s, v) => s + (v - ym) ** 2, 0) || 1;
  fit.r2 = 1 - fit.residuals.reduce((s, v) => s + v * v, 0) / ssTot;
  return fit;
}
