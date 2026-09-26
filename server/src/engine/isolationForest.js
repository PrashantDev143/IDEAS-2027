// Minimal Isolation Forest (Liu, Ting & Zhou, 2008) with a seeded RNG for reproducible scores.

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EULER = 0.5772156649;
function c(n) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n;
}

function buildTree(data, depth, maxDepth, rnd) {
  if (depth >= maxDepth || data.length <= 1) return { size: data.length };
  const dims = data[0].length;
  for (let attempt = 0; attempt < dims; attempt++) {
    const f = Math.floor(rnd() * dims);
    let lo = Infinity, hi = -Infinity;
    for (const x of data) { if (x[f] < lo) lo = x[f]; if (x[f] > hi) hi = x[f]; }
    if (hi - lo < 1e-12) continue;
    const split = lo + rnd() * (hi - lo);
    const left = [], right = [];
    for (const x of data) (x[f] < split ? left : right).push(x);
    return { f, split, left: buildTree(left, depth + 1, maxDepth, rnd), right: buildTree(right, depth + 1, maxDepth, rnd) };
  }
  return { size: data.length };
}

function pathLength(x, node, depth) {
  if (node.size !== undefined) return depth + c(node.size);
  return pathLength(x, x[node.f] < node.split ? node.left : node.right, depth + 1);
}

// Returns anomaly scores in (0, 1]; ~0.5 is normal, > 0.6 is unusual.
export function isolationForest(X, { trees = 150, sampleSize = 256, seed = 42 } = {}) {
  const rnd = mulberry32(seed);
  const n = X.length;
  const psi = Math.min(sampleSize, n);
  const maxDepth = Math.ceil(Math.log2(psi));
  const forest = [];
  for (let t = 0; t < trees; t++) {
    const sample = [];
    for (let i = 0; i < psi; i++) sample.push(X[Math.floor(rnd() * n)]);
    forest.push(buildTree(sample, 0, maxDepth, rnd));
  }
  const cn = c(psi);
  return X.map((x) => {
    let h = 0;
    for (const tree of forest) h += pathLength(x, tree, 0);
    return Math.pow(2, -(h / forest.length) / cn);
  });
}
