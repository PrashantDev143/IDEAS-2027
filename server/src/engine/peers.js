// Peer-group builder: k-means on standardised structural traits.
// Traits never include registration data, so a zone's peers are "places that look like it",
// not "places that register like it".
import { mean, sd, mulberry32 } from './stats.js';

export const TRAITS = [
  { key: 'built_up', label: 'Built-up density', unit: '% of zone' },
  { key: 'tourism', label: 'Tourism intensity', unit: 'ln visitors / km²' },
  { key: 'road_access', label: 'Road & transit access', unit: 'index 0–1' },
  { key: 'dist_centre_km', label: 'Distance to market centre', unit: 'km' },
  { key: 'industrial', label: 'Industrial land use', unit: 'share' },
  { key: 'extractive', label: 'Mining land use', unit: 'share' },
];

const dist2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);

// rows: [{ id, traits: { key: value } }]
export function buildPeerGroups(rows, k, minSize = 22, seed = 11) {
  const keys = TRAITS.map((t) => t.key);
  const mu = keys.map((key) => mean(rows.map((r) => r.traits[key])));
  const sg = keys.map((key) => sd(rows.map((r) => r.traits[key])) || 1);
  const X = rows.map((r) => keys.map((key, j) => (r.traits[key] - mu[j]) / sg[j]));
  const rnd = mulberry32(seed);

  // k-means++ initialisation
  let cents = [X[Math.floor(rnd() * X.length)]];
  while (cents.length < k) {
    const d = X.map((x) => Math.min(...cents.map((c) => dist2(x, c))));
    let r = rnd() * d.reduce((s, v) => s + v, 0), i = 0;
    while (i < d.length - 1 && (r -= d[i]) > 0) i++;
    cents.push(X[i]);
  }
  let assign = new Array(X.length).fill(0);
  const nearest = (x, cs) => cs.reduce((best, c, j) => (dist2(x, c) < dist2(x, cs[best]) ? j : best), 0);
  for (let it = 0; it < 40; it++) {
    assign = X.map((x) => nearest(x, cents));
    cents = cents.map((c, j) => {
      const m = X.filter((_, i) => assign[i] === j);
      return m.length ? keys.map((_, d) => mean(m.map((x) => x[d]))) : c;
    });
  }
  // fold groups that are too small to support a regression into their nearest neighbour
  for (;;) {
    const sizes = cents.map((_, j) => assign.filter((a) => a === j).length);
    const small = sizes.findIndex((n) => n > 0 && n < minSize);
    if (small < 0 || sizes.filter((n) => n > 0).length <= 2) break;
    const others = cents.map((c, j) => (j !== small && sizes[j] > 0 ? dist2(c, cents[small]) : Infinity));
    const target = others.indexOf(Math.min(...others));
    assign = assign.map((a) => (a === small ? target : a));
    const m = X.filter((_, i) => assign[i] === target);
    cents[target] = keys.map((_, d) => mean(m.map((x) => x[d])));
  }
  const used = [...new Set(assign)].sort((a, b) => a - b);
  const groups = used.map((j, idx) => {
    const members = rows.filter((_, i) => assign[i] === j);
    const centroid = Object.fromEntries(keys.map((key) => [key, +mean(members.map((r) => r.traits[key])).toFixed(3)]));
    return { id: idx + 1, n: members.length, centroid, memberIds: members.map((r) => r.id) };
  });
  nameGroups(groups);
  return groups;
}

function nameGroups(groups) {
  const maxTour = Math.max(...groups.map((g) => g.centroid.tourism));
  const taken = new Set();
  for (const g of groups) {
    const c = g.centroid;
    let name;
    if (c.extractive > 0.4) name = 'Mining belt';
    else if (c.industrial > 0.4) name = 'Industrial estates';
    else if (c.built_up > 30) name = c.tourism > 0.8 * maxTour ? 'Urban & tourism core' : 'Dense urban core';
    else if (c.built_up > 12) name = c.tourism > 0.8 * maxTour ? 'Tourism villages' : 'Towns & peri-urban';
    else if (c.dist_centre_km > 20) name = 'Remote interior & forest';
    else name = 'Rural hinterland';
    let unique = name, n = 2;
    while (taken.has(unique)) unique = `${name} ${n++}`;
    taken.add(unique);
    g.name = unique;
    g.description = `Built-up ${c.built_up.toFixed(0)}%, tourism intensity ${c.tourism.toFixed(1)}, road access ${c.road_access.toFixed(2)}, about ${c.dist_centre_km.toFixed(0)} km from a market centre.`;
  }
}
