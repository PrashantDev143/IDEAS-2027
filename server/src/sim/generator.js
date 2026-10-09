// Synthetic Goa pilot dataset.
// Every value is a pure function of (cell, month index, metric), so any month can be
// regenerated or "ingested" later without storing generator state.
// This is DEMO data: it is shaped to behave like the real sources described in the
// proposal (registrations, ASUSE-style surveys, VIIRS night lights, tourism, utilities),
// but it is not real data.

export const START_YEAR = 2023;
export const START_MONTH = 9; // t = 0 -> 2023-09
export const INITIAL_MONTHS = 36; // 2023-09 .. 2026-08
export const GRID_STEP = 0.025; // degrees (~2.7 km)

export const SIGNALS = ['night_light', 'built_up', 'digital_points', 'power_connections', 'listings', 'footfall'];
export const OFFICIAL = ['registered'];
export const METRICS = [...OFFICIAL, ...SIGNALS];

export function monthLabel(t) {
  const m0 = START_MONTH - 1 + t;
  const y = START_YEAR + Math.floor(m0 / 12);
  const m = ((m0 % 12) + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
export function monthIndex(label) {
  const [y, m] = label.split('-').map(Number);
  return (y - START_YEAR) * 12 + (m - START_MONTH);
}
export const calMonth = (t) => ((START_MONTH - 1 + t) % 12 + 12) % 12 + 1; // 1..12

// Approximate state outline (lat, lon)
export const GOA_OUTLINE = [
  [15.735, 73.69], [15.70, 73.695], [15.66, 73.705], [15.63, 73.725], [15.60, 73.735], [15.57, 73.735],
  [15.545, 73.745], [15.515, 73.755], [15.495, 73.765], [15.475, 73.79], [15.455, 73.795], [15.43, 73.79],
  [15.405, 73.785], [15.385, 73.80], [15.36, 73.83], [15.335, 73.87], [15.30, 73.90], [15.26, 73.915],
  [15.20, 73.93], [15.14, 73.945], [15.09, 73.915], [15.06, 73.965], [15.02, 74.005], [14.99, 74.025],
  [14.95, 74.045], [14.90, 74.085], [14.90, 74.13], [14.93, 74.20], [14.99, 74.24], [15.06, 74.25],
  [15.12, 74.29], [15.20, 74.33], [15.28, 74.335], [15.36, 74.31], [15.44, 74.28], [15.50, 74.265],
  [15.56, 74.25], [15.62, 74.20], [15.68, 74.15], [15.73, 74.10], [15.78, 74.03], [15.80, 73.96],
  [15.78, 73.88], [15.76, 73.80], [15.745, 73.74],
];

// type: urban | coastal | industrial | heritage | mining | forest | airport
// a: establishments at centre cell, s: spread (km), cov: share of activity captured in registrations,
// tour: tourism share, g: annual growth, lag: months registrations trail activity
const L = (name, lat, lon, taluka, type, a, s, cov, tour, extra = {}) =>
  ({ name, lat, lon, taluka, type, a, s, cov, tour, g: 0.03, lag: 3, ...extra });

export const LOCALITIES = [
  // Pernem
  L('Pernem', 15.721, 73.796, 'Pernem', 'urban', 350, 2, 0.8, 0.1),
  L('Arambol', 15.686, 73.704, 'Pernem', 'coastal', 450, 1.8, 0.42, 0.8, { g: 0.06 }),
  L('Mandrem', 15.659, 73.714, 'Pernem', 'coastal', 250, 1.8, 0.47, 0.8, { g: 0.28, lag: 12 }),
  L('Morjim', 15.630, 73.736, 'Pernem', 'coastal', 300, 1.8, 0.45, 0.8, { g: 0.28, lag: 12 }),
  L('Mopa', 15.733, 73.867, 'Pernem', 'airport', 90, 2.5, 0.62, 0.35, { trend: 'mopa', lag: 10 }),
  // Bardez
  L('Mapusa', 15.594, 73.814, 'Bardez', 'urban', 1700, 2.5, 0.82, 0.15),
  L('Calangute', 15.544, 73.755, 'Bardez', 'coastal', 1500, 2.2, 0.62, 0.75),
  L('Baga', 15.555, 73.752, 'Bardez', 'coastal', 900, 1.5, 0.6, 0.8),
  L('Candolim', 15.518, 73.762, 'Bardez', 'coastal', 900, 1.8, 0.66, 0.75),
  L('Anjuna', 15.573, 73.741, 'Bardez', 'coastal', 700, 1.8, 0.48, 0.8),
  L('Vagator', 15.597, 73.744, 'Bardez', 'coastal', 400, 1.5, 0.5, 0.8),
  L('Siolim', 15.618, 73.761, 'Bardez', 'coastal', 350, 1.8, 0.6, 0.5),
  L('Porvorim', 15.530, 73.823, 'Bardez', 'urban', 900, 2, 0.84, 0.1, { g: 0.12 }),
  L('Pilerne', 15.531, 73.796, 'Bardez', 'industrial', 300, 1.5, 0.8, 0.02),
  L('Tivim', 15.611, 73.870, 'Bardez', 'industrial', 250, 1.8, 0.8, 0.02),
  // Tiswadi
  L('Panaji', 15.491, 73.828, 'Tiswadi', 'urban', 2600, 3, 0.83, 0.3, { g: 0.04 }),
  L('Taleigao', 15.470, 73.815, 'Tiswadi', 'urban', 800, 1.8, 0.83, 0.2),
  L('Dona Paula', 15.456, 73.804, 'Tiswadi', 'coastal', 350, 1.3, 0.72, 0.6),
  L('Old Goa', 15.501, 73.912, 'Tiswadi', 'heritage', 300, 1.8, 0.75, 0.6),
  L('Corlim', 15.496, 73.928, 'Tiswadi', 'industrial', 300, 1.5, 0.8, 0.02),
  // Bicholim
  L('Bicholim', 15.589, 73.949, 'Bicholim', 'urban', 700, 2, 0.8, 0.05),
  L('Sirigao', 15.575, 73.969, 'Bicholim', 'mining', 250, 2, 0.95, 0, { trend: 'mining' }),
  // Sattari
  L('Valpoi', 15.532, 74.137, 'Sattari', 'urban', 350, 2, 0.78, 0.1),
  L('Sanquelim', 15.564, 74.008, 'Sattari', 'urban', 450, 2, 0.8, 0.05),
  L('Pissurlem', 15.554, 74.049, 'Sattari', 'mining', 200, 2, 0.95, 0, { trend: 'mining' }),
  // Ponda
  L('Ponda', 15.403, 74.008, 'Ponda', 'urban', 1400, 3, 0.81, 0.1),
  L('Kundaim', 15.453, 73.990, 'Ponda', 'industrial', 450, 1.8, 0.8, 0.02, { nlSpike: true }),
  L('Usgao', 15.430, 74.070, 'Ponda', 'industrial', 200, 1.8, 0.8, 0.02),
  // Dharbandora
  L('Dharbandora', 15.422, 74.122, 'Dharbandora', 'urban', 200, 2, 0.78, 0.05),
  L('Codli', 15.370, 74.170, 'Dharbandora', 'mining', 260, 2.2, 0.95, 0, { trend: 'mining' }),
  L('Mollem', 15.388, 74.220, 'Dharbandora', 'forest', 60, 3, 0.65, 0.5),
  // Mormugao
  L('Vasco da Gama', 15.398, 73.811, 'Mormugao', 'urban', 1900, 3, 0.84, 0.15),
  L('Bogmalo', 15.370, 73.834, 'Mormugao', 'coastal', 200, 1.3, 0.7, 0.6),
  L('Sancoale', 15.378, 73.868, 'Mormugao', 'industrial', 350, 1.8, 0.8, 0.02),
  // Salcete
  L('Margao', 15.283, 73.986, 'Salcete', 'urban', 2800, 3.5, 0.82, 0.15),
  L('Verna', 15.362, 73.944, 'Salcete', 'industrial', 900, 2.5, 0.8, 0.02, { trend: 'verna', lag: 2 }),
  L('Majorda', 15.309, 73.911, 'Salcete', 'coastal', 300, 1.5, 0.7, 0.7),
  L('Colva', 15.280, 73.922, 'Salcete', 'coastal', 700, 1.8, 0.63, 0.75),
  L('Benaulim', 15.257, 73.929, 'Salcete', 'coastal', 500, 1.8, 0.6, 0.75),
  L('Cavelossim', 15.173, 73.943, 'Salcete', 'coastal', 350, 1.8, 0.68, 0.75),
  L('Cuncolim', 15.178, 73.995, 'Salcete', 'industrial', 400, 1.8, 0.8, 0.02),
  // Quepem
  L('Quepem', 15.213, 74.077, 'Quepem', 'urban', 450, 2, 0.8, 0.05),
  L('Curchorem', 15.263, 74.108, 'Quepem', 'urban', 650, 2, 0.8, 0.05),
  // Sanguem
  L('Sanguem', 15.229, 74.150, 'Sanguem', 'urban', 300, 2, 0.78, 0.05),
  L('Rivona', 15.165, 74.111, 'Sanguem', 'mining', 220, 2, 0.95, 0, { trend: 'mining' }),
  L('Netravali', 15.100, 74.220, 'Sanguem', 'forest', 40, 3, 0.65, 0.5),
  // Canacona
  L('Chaudi', 15.010, 74.048, 'Canacona', 'urban', 400, 1.8, 0.8, 0.3),
  L('Palolem', 15.010, 74.023, 'Canacona', 'coastal', 450, 1.5, 0.46, 0.85),
  L('Agonda', 15.044, 73.986, 'Canacona', 'coastal', 180, 1.5, 0.5, 0.85),
  L('Patnem', 15.001, 74.032, 'Canacona', 'coastal', 150, 1.2, 0.5, 0.85),
  L('Galgibaga', 14.966, 74.050, 'Canacona', 'coastal', 40, 1.5, 0.6, 0.6),
  L('Cotigao', 15.000, 74.140, 'Canacona', 'forest', 30, 3, 0.65, 0.5),
];

export const TALUKAS = {
  Pernem: 'North Goa', Bardez: 'North Goa', Tiswadi: 'North Goa', Bicholim: 'North Goa', Sattari: 'North Goa', Ponda: 'North Goa',
  Dharbandora: 'South Goa', Mormugao: 'South Goa', Salcete: 'South Goa', Quepem: 'South Goa', Sanguem: 'South Goa', Canacona: 'South Goa',
};

// Tourism season (Goa tourist calendar), Jan..Dec
const TOURISM_SEASON = [1.35, 1.2, 1.05, 0.95, 0.9, 0.55, 0.5, 0.55, 0.65, 0.9, 1.15, 1.45];

// ---------- deterministic randomness ----------
function hash(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= 0x9e3779b9; h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rand(...parts) {
  let x = hash(...parts);
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return ((x >>> 0) % 1e9) / 1e9;
}
function gauss(...parts) {
  const u = Math.max(1e-9, rand(...parts, 'u')), v = rand(...parts, 'v');
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const lognoise = (sigma, ...parts) => Math.exp(sigma * gauss(...parts) - sigma * sigma / 2);

// ---------- geometry ----------
function inPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function distKm(lat1, lon1, lat2, lon2) {
  const dy = (lat1 - lat2) * 110.57;
  const dx = (lon1 - lon2) * 111.32 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function direction(fromLat, fromLon, toLat, toLon) {
  const ang = Math.atan2(toLon - fromLon, toLat - fromLat) * 180 / Math.PI;
  return DIRS[Math.round(((ang + 360) % 360) / 45) % 8];
}

// ---------- trends ----------
function locTrend(loc, t) {
  switch (loc.trend) {
    case 'mopa': return 1 + 6 / (1 + Math.exp(-(t - 14) / 5)); // airport-led growth
    case 'verna': return 1 + 0.4 / (1 + Math.exp(-(t - 22) / 3)); // new industrial phase
    case 'mining': return Math.pow(0.78, t / 12);
    default: return Math.pow(1 + loc.g, t / 12);
  }
}
function locRegTrend(loc, t) {
  if (loc.trend === 'mining') return 1; // registrations are rarely cancelled
  return locTrend(loc, t - loc.lag);
}

// ---------- cells ----------
let _cells = null;
export function buildCells() {
  if (_cells) return _cells;
  const cells = [];
  const latMin = 14.9, latMax = 15.8, lonMin = 73.68, lonMax = 74.34;
  let row = 0;
  for (let lat = latMin; lat < latMax; lat += GRID_STEP, row++) {
    let col = 0;
    for (let lon = lonMin; lon < lonMax; lon += GRID_STEP, col++) {
      const clat = +(lat + GRID_STEP / 2).toFixed(4), clon = +(lon + GRID_STEP / 2).toFixed(4);
      if (!inPolygon(clat, clon, GOA_OUTLINE)) continue;
      const areaKm2 = (GRID_STEP * 110.57) * (GRID_STEP * 111.32 * Math.cos(clat * Math.PI / 180));
      const contribs = [];
      let nearest = null, nd = Infinity;
      for (const loc of LOCALITIES) {
        const d = distKm(clat, clon, loc.lat, loc.lon);
        if (d < nd) { nd = d; nearest = loc; }
        const w = loc.a * Math.exp(-(d * d) / (2 * loc.s * loc.s));
        if (w > 0.5) contribs.push({ loc, w });
      }
      const code = `GA-${String(row).padStart(2, '0')}${String(col).padStart(2, '0')}`;
      const forestish = clon > 74.12 && nd > 6;
      const rural = forestish ? 2 + 4 * rand(code, 'rb') : 6 + 14 * rand(code, 'rb');
      const locSum = contribs.reduce((s, c) => s + c.w, 0);
      const dom = contribs.sort((a, b) => b.w - a.w)[0];
      let zone = forestish ? 'forest' : 'rural';
      if (dom && dom.w > rural * 1.5) zone = dom.loc.type === 'airport' ? 'urban' : dom.loc.type;
      const total = locSum + rural;
      const tour = (contribs.reduce((s, c) => s + c.w * c.loc.tour, 0) + rural * (forestish ? 0.2 : 0.05)) / total;
      cells.push({
        code, row, col, lat: clat, lon: clon,
        lat_min: +lat.toFixed(4), lat_max: +(lat + GRID_STEP).toFixed(4),
        lon_min: +lon.toFixed(4), lon_max: +(lon + GRID_STEP).toFixed(4),
        area_km2: +areaKm2.toFixed(2),
        taluka: nearest.taluka, district: TALUKAS[nearest.taluka],
        nearest: nearest.name, nearestKm: nd, zone,
        tourism_share: +tour.toFixed(3),
        // structural traits used for peer grouping (never registration data)
        dist_centre_km: +Math.min(...LOCALITIES.filter((l) => l.type === 'urban' && l.a >= 600).map((l) => distKm(clat, clon, l.lat, l.lon))).toFixed(2),
        road_access: +Math.min(1, 0.12 + 0.2 * Math.log10(1 + total) + 0.12 * rand(code, 'rd')).toFixed(3),
        // informal settlement / insecure tenure marker: field visits need senior sign-off
        sensitive: zone === 'urban' && total > 250 && rand(code, 'sens') < 0.07 ? 1 : 0,
        // patchy source coverage (cloud cover, feeds not yet onboarded)
        _patchy: (forestish && rand(code, 'pt') < 0.45) || (zone === 'rural' && rand(code, 'pt') < 0.07),
        _contribs: contribs, _rural: rural,
        _nlSpike: contribs.some((c) => c.loc.nlSpike && c.w > 0.4 * total),
      });
    }
  }
  // unique-ish human names: the closest cell to each locality takes its name
  const byLoc = {};
  for (const c of cells) (byLoc[c.nearest] ||= []).push(c);
  for (const [name, list] of Object.entries(byLoc)) {
    const loc = LOCALITIES.find((l) => l.name === name);
    list.sort((a, b) => a.nearestKm - b.nearestKm);
    list.forEach((c, i) => {
      c.name = i === 0 ? name : c.nearestKm > 7 ? `${c.taluka} hinterland ${direction(loc.lat, loc.lon, c.lat, c.lon)}` : `${name} ${direction(loc.lat, loc.lon, c.lat, c.lon)}`;
    });
  }
  const seen = {};
  for (const c of cells) { seen[c.name] = (seen[c.name] || 0) + 1; if (seen[c.name] > 1) c.name = `${c.name} ${seen[c.name]}`; }
  _cells = cells;
  return cells;
}

// true activity (establishment-equivalents), trend only
function activity(cell, t) {
  let a = cell._rural * Math.pow(1.02, t / 12);
  for (const { loc, w } of cell._contribs) a += w * locTrend(loc, t);
  return a;
}
function registeredBase(cell, t) {
  let r = cell._rural * 0.72 * Math.pow(1.02, (t - 3) / 12);
  for (const { loc, w } of cell._contribs) r += w * loc.cov * locRegTrend(loc, t);
  return r;
}

export function generateMonth(cell, t) {
  const m = calMonth(t);
  const season = TOURISM_SEASON[m - 1];
  const A = activity(cell, t);
  const As = A * (1 + cell.tourism_share * (season - 1));
  const id = cell.code;
  let nl = 0.35 + 0.012 * Math.pow(As, 0.9) * lognoise(0.12, id, t, 'nl');
  if (cell._nlSpike && t >= 34) nl *= 3.2; // isolated sensor/flare-type spike (single-signal)
  const built = Math.min(95, 2 + 11 * Math.log(1 + A / 40)) * (1 + 0.02 * gauss(id, t, 'bu'));
  const digital = 0.65 * As * Math.pow(1.006, t) * lognoise(0.14, id, t, 'dg');
  const power = 0.85 * A * lognoise(0.08, id, t, 'pw');
  const listings = cell.tourism_share * A * 0.35 * Math.sqrt(season) * lognoise(0.12, id, t, 'ls');
  const footfall = cell.tourism_share * A * 28 * season * lognoise(0.12, id, t, 'ff');
  const registered = registeredBase(cell, t) * lognoise(0.05, id, t, 'rg');
  const out = {
    registered: Math.round(registered),
    night_light: +nl.toFixed(2),
    built_up: +built.toFixed(1),
    digital_points: Math.round(digital),
    power_connections: Math.round(power),
    listings: Math.round(listings),
    footfall: Math.round(footfall),
  };
  if (cell._patchy) {
    // missing values stay missing (NULL): the engine lowers confidence, it never imputes silently
    const monsoon = m >= 6 && m <= 9;
    const miss = (k, p) => { if (rand(id, t, 'miss', k) < p) out[k] = null; };
    miss('night_light', monsoon ? 0.85 : 0.25); miss('built_up', monsoon ? 0.85 : 0.25);
    miss('digital_points', 0.7); miss('power_connections', 0.45); miss('listings', 0.4); miss('footfall', 0.4);
  }
  return out;
}

// Annual (FY Apr–Mar) survey estimate, ASUSE-style, modelled to cell level.
// fyStart = 2024 -> FY 2024-25
export function surveyEstimate(cell, fyStart) {
  const t0 = monthIndex(`${fyStart}-04`);
  let s = 0;
  for (let k = 0; k < 12; k++) s += activity(cell, t0 + k);
  return Math.round((s / 12) * 0.98 * lognoise(0.06, cell.code, fyStart, 'sv'));
}
