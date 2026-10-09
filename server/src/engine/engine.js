// EconoScope model engine — Peer-Normalized Economic–Registration Residual Model
//
//  1. ZONE & AGGREGATE  every input on the same zone grid; missing values stay missing and lower coverage.
//  2. ACTIVITY NOWCAST  inferred activity intensity from independent signals (trained on the survey baseline),
//                       seasonally adjusted per zone. Feeds the Economic Shadow Map.
//  3. PEER GROUPS       k-means on structural traits (built density, tourism, access, distance, land use).
//  4. EXPECTED FOOTPRINT robust regression of registered footprint on independent signals; slopes are shared
//                       statewide, the level is adjusted per peer group with partial pooling.
//  5. RESIDUAL          expected − registered, standardised within the peer group, with a prediction interval.
//  6. SPATIAL TEST      Local Moran's I / Getis-Ord Gi* with permutation p-values (hot spot, cold spot, outlier).
//  7. CHANGE-POINT      is the gap new, growing, stable or shrinking?
//  8. CONFIDENCE        data coverage, signal agreement, model error, residual stability, spatial support.
//  9. PRIORITY          peer-relative gap × confidence, ranked within district; tiers incl. "insufficient data".
// 10. LEARN             field outcomes recalibrate a zone's expected level.

import crypto from 'node:crypto';
import { db, all, get, run, tx, getSettings, listMonths, log } from '../db.js';
import { robustZ, ridge, robustRidge, dot, seasonalIndex, median, mean, clamp } from './stats.js';
import { buildPeerGroups, TRAITS } from './peers.js';
import { localSpatial, changePoint, slope } from './spatial.js';

export const SIGNAL_META = {
  night_light: { label: 'Night-time lights (VIIRS)', category: 'satellite', seasonal: true, corroborating: true },
  built_up: { label: 'Built-up / commercial footprint', category: 'satellite', seasonal: false },
  listings: { label: 'Hospitality listings', category: 'tourism', seasonal: true, minApplicable: 3 },
  footfall: { label: 'Tourist footfall', category: 'tourism', seasonal: true, minApplicable: 70 },
  power_connections: { label: 'Commercial power connections', category: 'enrichment', seasonal: false, enrichment: true },
  digital_points: { label: 'Digital merchant payment points', category: 'enrichment', seasonal: true, enrichment: true },
};
const ALL_SIGNALS = Object.keys(SIGNAL_META);

export const ALERT_TYPES = {
  visibility_gap: { label: 'Visibility gap', dir: 1, kind: 'gap' },
  record_mismatch: { label: 'Record mismatch', dir: -1, kind: 'gap' },
  emerging_hotspot: { label: 'Emerging hotspot', dir: 1, kind: 'change' },
  contraction: { label: 'Activity contraction', dir: -1, kind: 'change' },
  audit_control: { label: 'Random audit sample', dir: 0, kind: 'control' },
};

const EAI_REF_DENSITY = 500; // establishment-equivalents per km2 mapped to index 100
const PEER_POOLING = 30; // partial pooling strength for the peer-group level
const SIGMA_FLOOR = 0.1;
const TIER_ORDER = { high: 0, medium: 1, low: 2 };
const calMonthOf = (label) => Number(label.slice(5, 7));
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

// ---------------------------------------------------------------- model
export function computeModel(asOf, settings = getSettings()) {
  const months = listMonths().filter((m) => !asOf || m <= asOf);
  if (months.length < 3) throw new Error('Not enough observation history to build a baseline (need at least 3 months).');
  const T = months.length, t = T - 1;
  const mIdx = Object.fromEntries(months.map((m, i) => [m, i]));
  const cells = all('SELECT * FROM cells ORDER BY id');
  const cIdx = new Map(cells.map((c, i) => [c.id, i]));
  const N = cells.length;
  const SIGNALS = ALL_SIGNALS.filter((s) => !SIGNAL_META[s].enrichment || settings.enrichment?.[s] !== false);
  const METRICS = ['registered', ...SIGNALS];
  const calMonths = months.map(calMonthOf);

  // ---- 1. dense series with an "observed" mask; gaps are filled only for computation, never counted as data
  const raw = {}, mask = {};
  for (const k of METRICS) { raw[k] = cells.map(() => new Array(T).fill(null)); mask[k] = cells.map(() => new Array(T).fill(false)); }
  for (const r of all('SELECT * FROM observations WHERE month <= ?', months[t])) {
    const i = cIdx.get(r.cell_id), ti = mIdx[r.month];
    if (i === undefined || ti === undefined) continue;
    for (const k of METRICS) if (r[k] !== null && r[k] !== undefined) { raw[k][i][ti] = r[k]; mask[k][i][ti] = true; }
  }
  const val = {};
  for (const k of METRICS) {
    val[k] = raw[k].map((series) => {
      const out = series.slice();
      for (let x = 1; x < T; x++) if (out[x] === null) out[x] = out[x - 1];
      for (let x = T - 2; x >= 0; x--) if (out[x] === null) out[x] = out[x + 1];
      return out.map((v) => v ?? 0);
    });
  }
  // coverage: share of values actually observed over the trailing 12 months (registrations count double)
  const coverage = cells.map((_, i) => months.map((__, x) => {
    let have = 0, want = 0;
    for (let k = Math.max(0, x - 11); k <= x; k++) {
      have += 2 * (mask.registered[i][k] ? 1 : 0); want += 2;
      for (const s of SIGNALS) { have += mask[s][i][k] ? 1 : 0; want += 1; }
    }
    return have / want;
  }));
  const insufficient = cells.map((_, i) => months.map((__, x) => {
    if (val.registered[i][x] < settings.min_cell_count) return 'suppressed';
    if (coverage[i][x] < settings.min_coverage) return 'coverage';
    return null;
  }));

  // ---- 2. activity nowcast trained on the latest complete survey year
  const feat = (i, x, src) => [1, ...SIGNALS.map((s) => (s === 'built_up' ? src[s][i][x] / 100 : Math.log1p(Math.max(0, src[s][i][x]))))];
  const surveyRows = all('SELECT cell_id, fy_start, estimate FROM surveys ORDER BY fy_start');
  const fys = [...new Set(surveyRows.map((s) => s.fy_start))]
    .filter((fy) => `${fy + 1}-03` <= months[t])
    .filter((fy) => months.filter((m) => m >= `${fy}-04` && m <= `${fy + 1}-03`).length >= 6);
  if (!fys.length) throw new Error('No survey baseline overlaps the observation window.');
  const fy = fys[fys.length - 1];
  const fyT = months.map((m, x) => [m, x]).filter(([m]) => m >= `${fy}-04` && m <= `${fy + 1}-03`).map(([, x]) => x);
  const survey = new Map(surveyRows.filter((s) => s.fy_start === fy).map((s) => [s.cell_id, s.estimate]));
  const Xn = [], yn = [];
  cells.forEach((c, i) => {
    const s = survey.get(c.id);
    if (!s || s <= 0 || coverage[i][fyT[fyT.length - 1]] < settings.min_coverage) return;
    const f = new Array(SIGNALS.length + 1).fill(0);
    for (const x of fyT) feat(i, x, val).forEach((v, j) => (f[j] += v / fyT.length));
    Xn.push(f); yn.push(Math.log(s));
  });
  const nowcast = ridge(Xn, yn, 1e-4);
  const smear = Math.exp(nowcast.residVar / 2);
  const O = cells.map((_, i) => months.map((__, x) => Math.exp(dot(feat(i, x, val), nowcast.beta)) * smear));
  const SI = O.map((series) => (T >= 13 ? seasonalIndex(series, calMonths) : new Array(12).fill(1)));
  const Osa = O.map((series, i) => series.map((v, x) => v / SI[i][calMonths[x] - 1]));
  const R = val.registered;

  // seasonally adjusted signals (so a busy December is compared like-for-like)
  const sa = {};
  for (const s of SIGNALS) {
    sa[s] = val[s].map((series) => {
      if (!SIGNAL_META[s].seasonal || T < 13) return series;
      const f = seasonalIndex(series.map((v) => v + 1), calMonths);
      return series.map((v, x) => Math.max(0, (v + 1) / f[calMonths[x] - 1] - 1));
    });
  }

  // ---- 3. peer groups from structural traits over the baseline window (stable between runs)
  const base = Math.min(12, T);
  const baseMean = (arr) => mean(arr.slice(0, base));
  const peerRows = cells.map((c, i) => ({
    id: c.id,
    traits: {
      built_up: baseMean(val.built_up[i]),
      tourism: Math.log1p(baseMean(val.footfall?.[i] || [0]) / c.area_km2),
      road_access: c.road_access ?? 0.3,
      dist_centre_km: c.dist_centre_km ?? 10,
      industrial: c.zone === 'industrial' ? 1 : 0,
      extractive: c.zone === 'mining' ? 1 : 0,
    },
  }));
  const groups = buildPeerGroups(peerRows, settings.peer_groups_k);
  const groupOf = new Array(N);
  groups.forEach((g, gi) => g.memberIds.forEach((id) => { groupOf[cIdx.get(id)] = gi; }));

  // ---- 4/5. expected registered footprint and the peer-standardised residual
  const calib = new Map(all('SELECT cell_id, offset FROM cell_calibration').map((r) => [r.cell_id, r.offset]));
  const M = cells.map(() => new Array(T));
  const gapZ = cells.map(() => new Array(T).fill(NaN));
  const chgZ = cells.map(() => new Array(T).fill(NaN));
  const groupStats = groups.map(() => new Array(T));
  let footprint = null;
  const avg3 = (arr, x) => mean([arr[x - 2], arr[x - 1], arr[x]]);
  for (let x = 0; x < T; x++) {
    const ok = cells.map((_, i) => !insufficient[i][x]);
    const rows = cells.map((_, i) => feat(i, x, sa));
    const y = cells.map((_, i) => Math.log1p(R[i][x]));
    const train = cells.map((_, i) => i).filter((i) => ok[i]);
    const fit = robustRidge(train.map((i) => rows[i]), train.map((i) => y[i]), 1e-2);
    if (x === t) footprint = { beta: fit.beta, r2: fit.r2, n: train.length };
    const rawRes = rows.map((r, i) => dot(r, fit.beta) - y[i]);
    groups.forEach((g, gi) => {
      const mem = train.filter((i) => groupOf[i] === gi);
      const offset = mem.length ? (mem.length / (mem.length + PEER_POOLING)) * median(mem.map((i) => rawRes[i])) : 0;
      const resid = mem.map((i) => rawRes[i] - offset - (calib.get(cells[i].id) || 0));
      const med = median(resid) || 0;
      const sigma = mem.length > 3 ? Math.max(1.4826 * median(resid.map((v) => Math.abs(v - med))), SIGMA_FLOOR) : 0.3;
      groupStats[gi][x] = { offset, sigma, n: mem.length };
    });
    const yoy = [], yoyR = [];
    for (let i = 0; i < N; i++) {
      const gs = groupStats[groupOf[i]][x];
      const adj = gs.offset + (calib.get(cells[i].id) || 0);
      const yhat = dot(rows[i], fit.beta) - adj;
      const res = yhat - y[i];
      const expected = Math.max(0, Math.expm1(yhat));
      gapZ[i][x] = ok[i] ? res / gs.sigma : NaN;
      if (x >= 14 && ok[i]) {
        yoy.push(Math.log(avg3(Osa[i], x) / avg3(Osa[i], x - 12)));
        yoyR.push(Math.log((avg3(R[i], x) + 1) / (avg3(R[i], x - 12) + 1)));
      } else { yoy.push(NaN); yoyR.push(NaN); }
      M[i][x] = {
        month: months[x], observed: O[i][x], observed_sa: Osa[i][x], registered: R[i][x],
        expected, exp_lo: Math.max(0, Math.expm1(yhat - 1.96 * gs.sigma)), exp_hi: Math.expm1(yhat + 1.96 * gs.sigma),
        gap_abs: expected - R[i][x], gap_log: res, gap_z: ok[i] ? res / gs.sigma : null,
        seasonal_index: SI[i][calMonths[x] - 1],
        eai: clamp(100 * Math.log1p(Osa[i][x] / cells[i].area_km2) / Math.log1p(EAI_REF_DENSITY), 0, 100),
        coverage: coverage[i][x], insufficient: insufficient[i][x],
      };
    }
    const cz = x >= 14 ? robustZ(yoy, 0.03).z : yoy;
    for (let i = 0; i < N; i++) {
      chgZ[i][x] = cz[i];
      M[i][x].yoy_activity = Number.isFinite(yoy[i]) ? Math.exp(yoy[i]) - 1 : null;
      M[i][x].yoy_registered = Number.isFinite(yoyR[i]) ? Math.exp(yoyR[i]) - 1 : null;
      M[i][x].change_z = Number.isFinite(cz[i]) ? cz[i] : null;
    }
  }

  // ---- 6. spatial significance (queen contiguity on the grid)
  const byRC = new Map(cells.map((c, i) => [`${c.grid_row},${c.grid_col}`, i]));
  const neighbours = cells.map((c) => {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const j = byRC.get(`${c.grid_row + dr},${c.grid_col + dc}`);
      if (j !== undefined) out.push(j);
    }
    return out;
  });
  for (let x = 0; x < T; x++) {
    const sp = localSpatial(gapZ.map((s) => s[x]), neighbours, { seed: 100 + x });
    for (let i = 0; i < N; i++) Object.assign(M[i][x], { spatial_class: sp[i].cls, spatial_p: sp[i].p, gi_z: sp[i].gi });
  }

  // ---- 8/9. evidence, confidence, priority for every zone and month
  const W = settings.weights;
  const wSum = W.agreement + W.coverage + W.stability + W.model + W.spatial;
  const evidenceAt = (x, kind) => {
    const out = {};
    for (const s of SIGNALS) {
      const meta = SIGNAL_META[s];
      const v = new Array(N).fill(NaN), applicable = new Array(N).fill(false);
      for (let i = 0; i < N; i++) {
        const cur = sa[s][i][x];
        let seen = 0;
        for (let k = Math.max(0, x - 5); k <= x; k++) seen += mask[s][i][k] ? 1 : 0;
        const hasData = seen >= Math.min(3, x + 1);
        applicable[i] = hasData && (!meta.minApplicable || cur >= meta.minApplicable) && !insufficient[i][x];
        if (!applicable[i]) continue;
        if (kind === 'gap') v[i] = Math.log((cur + 1) / (R[i][x] + 1));
        else if (x >= 14) v[i] = Math.log((mean([0, 1, 2].map((k) => sa[s][i][x - k])) + 1) / (mean([0, 1, 2].map((k) => sa[s][i][x - 12 - k])) + 1));
      }
      const z = new Array(N).fill(NaN);
      if (kind === 'gap') {
        // each signal is compared with the zone's own peer group
        groups.forEach((g, gi) => {
          const mem = cells.map((_, i) => i).filter((i) => groupOf[i] === gi && Number.isFinite(v[i]));
          if (mem.length < 5) return;
          const rz = robustZ(mem.map((i) => v[i]), 0.08).z;
          mem.forEach((i, k) => { z[i] = rz[k]; });
        });
      } else robustZ(v, 0.03).z.forEach((q, i) => { z[i] = q; });
      out[s] = { z, applicable };
    }
    return out;
  };
  const stabilityOf = (series, x, dir, ref) => {
    let ok = 0, n = 0;
    for (let k = 0; k < 6 && x - k >= 0; k++) { n++; if (Number.isFinite(series[x - k]) && series[x - k] * dir >= 0.5 * Math.abs(ref)) ok++; }
    return { share: n ? ok / n : 0, months: ok };
  };
  const tierOf = (p) => (Math.abs(p) >= settings.tier_high ? 'high' : Math.abs(p) >= settings.tier_medium ? 'medium' : 'low');
  const band = (c) => (c >= 70 ? 'high' : c >= 45 ? 'medium' : 'low');
  const scoreZone = (i, x, ev, zSeries, dir, spatialClass) => {
    const signals = SIGNALS.map((s) => {
      const z = ev[s].z[i];
      const applicable = ev[s].applicable[i] && Number.isFinite(z);
      return {
        signal: s, label: SIGNAL_META[s].label, category: SIGNAL_META[s].category,
        z: applicable ? +z.toFixed(2) : null, applicable, agrees: applicable && z * dir >= 1,
        value: raw[s][i][x], observed: mask[s][i][x],
      };
    });
    const app = signals.filter((s) => s.applicable);
    const agreeing = app.filter((s) => s.agrees);
    const st = stabilityOf(zSeries, x, dir, zSeries[x]);
    const comp = {
      agreement: app.length ? agreeing.length / app.length : 0,
      coverage: clamp((coverage[i][x] - settings.min_coverage) / (1 - settings.min_coverage)),
      stability: st.share,
      model: clamp(1 - groupStats[groupOf[i]][x].sigma / 0.5),
      spatial: spatialClass === undefined ? 0.35 : (dir > 0 && spatialClass === 'hot') || (dir < 0 && spatialClass === 'cold') ? 1 : spatialClass === 'outlier' ? 0.6 : 0.35,
    };
    const confidence = 100 * (W.agreement * comp.agreement + W.coverage * comp.coverage + W.stability * comp.stability + W.model * comp.model + W.spatial * comp.spatial) / wSum;
    return {
      signals, confidence,
      comp: { ...Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, +v.toFixed(3)])), stabilityMonths: st.months, agreeing: agreeing.length, applicable: app.length, weights: W },
      // night lights corroborate; they can never be the only thing behind a flag
      nightLightOnly: agreeing.length > 0 && agreeing.every((s) => SIGNAL_META[s.signal].corroborating),
    };
  };
  const scored = cells.map(() => null); // target-month detail
  for (let x = 0; x < T; x++) {
    const ev = evidenceAt(x, 'gap');
    const byDistrict = {};
    for (let i = 0; i < N; i++) {
      const m = M[i][x];
      if (m.insufficient) { Object.assign(m, { confidence: null, priority: null, tier: 'insufficient', gap_z: null }); continue; }
      const dir = m.gap_z >= 0 ? 1 : -1;
      const sc = scoreZone(i, x, ev, gapZ[i], dir, m.spatial_class);
      m.confidence = sc.confidence;
      m.priority = m.gap_z * sc.confidence / 100;
      // a large σ on a tiny difference is not a priority: below the minimum size a zone stays in the low tier
      m.tier = Math.abs(m.gap_abs) < settings.min_gap_establishments ? 'low' : tierOf(m.priority);
      (byDistrict[cells[i].district] ||= []).push(i);
      if (x === t) scored[i] = sc;
    }
    for (const list of Object.values(byDistrict)) {
      list.sort((a, b) => TIER_ORDER[M[a][x].tier] - TIER_ORDER[M[b][x].tier] || Math.abs(M[b][x].priority) - Math.abs(M[a][x].priority));
      list.forEach((i, k) => { M[i][x].district_rank = k + 1; });
    }
  }

  // ---- 7. change-point on the residual series (latest month)
  for (let i = 0; i < N; i++) {
    const m = M[i][t];
    if (m.insufficient || T < 8) continue;
    const series = gapZ[i].slice(0, T);
    const dir = m.gap_z >= 0 ? 1 : -1;
    const cp = changePoint(series);
    const s6 = slope(series.slice(-6)) * dir;
    const strong = cp && Math.abs(cp.t) >= 4;
    if (strong) m.changepoint_month = months[cp.index];
    if (Math.abs(m.gap_z) < 1) m.gap_trend = 'none';
    else if (strong && cp.shift * dir > 0.8 && t - cp.index <= 6 && Math.abs(cp.before) < 1.2) m.gap_trend = 'new';
    else if (s6 > 0.3) m.gap_trend = 'growing';
    else if (s6 < -0.3) m.gap_trend = 'shrinking';
    else m.gap_trend = 'stable';
  }

  return {
    cells, months, T, t, N, SIGNALS, METRICS, raw, mask, val, sa, O, Osa, R, SI, M, gapZ, chgZ, coverage, insufficient,
    groups, groupOf, groupStats, scored, scoreZone, evidenceAt, tierOf, band, settings,
    model: {
      asOf: months[t], fy, trainedOn: `FY ${fy}-${String(fy + 1).slice(2)}`,
      signals: SIGNALS, features: ['intercept', ...SIGNALS.map((s) => (s === 'built_up' ? s : `ln ${s}`))],
      nowcast: { beta: nowcast.beta, r2: nowcast.r2, n: nowcast.n },
      footprint: { ...footprint, pooling: PEER_POOLING },
      peerGroups: groups.map((g, gi) => ({ id: g.id, name: g.name, n: g.n, sigma: +groupStats[gi][t].sigma.toFixed(3), offset: +groupStats[gi][t].offset.toFixed(3), scored: groupStats[gi][t].n })),
    },
  };
}

// ---------------------------------------------------------------- wording (never states or implies wrongdoing)
const pct = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const fmt = (x) => Math.round(x).toLocaleString('en-IN');
const TREND_TXT = { new: 'The gap is new.', growing: 'The gap is widening.', shrinking: 'The gap is narrowing.', stable: 'The gap is long-standing and stable.', none: '' };
const SPATIAL_TXT = {
  hot: 'Neighbouring zones show the same pattern (a statistically significant cluster).',
  cold: 'Neighbouring zones show the same pattern (a statistically significant cluster).',
  outlier: 'The zone stands out from its neighbours (a significant spatial outlier).',
  ns: 'The pattern is not spatially significant on its own.',
};
const CAVEAT = ' Common ordinary causes include new development, seasonal trade, survey lag and informal-but-legal activity. This is an anomaly to validate, not a finding about any business or person.';

function signalText(sc) {
  const names = sc.signals.filter((s) => s.agrees).map((s) => s.label.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()));
  if (!names.length) return 'No single signal clearly agrees on its own, so treat this as a data-quality check first.';
  return `${names.length} of ${sc.comp.applicable} independent signals agree (${names.join(', ')}).${names.length === 1 ? ' Only one signal supports it, so check the data source before planning a visit.' : ''}`;
}

function explain(type, cell, m, sc, peer) {
  const where = `${cell.name} (${cell.taluka} taluka)`;
  const cov = `Data coverage ${Math.round(m.coverage * 100)}%.`;
  const hold = `held for ${sc.comp.stabilityMonths} of the last 6 months`;
  switch (type) {
    case 'visibility_gap':
      return `Independent activity signals in ${where} point to a registered footprint of about ${fmt(m.expected)} units (likely range ${fmt(m.exp_lo)}–${fmt(m.exp_hi)}) for a zone of its kind (peer group: ${peer.name}, ${peer.n} zones). ${fmt(m.registered)} units are on record, ${fmt(m.gap_abs)} fewer than expected and ${m.gap_z.toFixed(1)}σ beyond its peers. ${signalText(sc)} The gap has ${hold}. ${TREND_TXT[m.gap_trend] || ''} ${SPATIAL_TXT[m.spatial_class] || ''} ${cov}${CAVEAT}`;
    case 'record_mismatch':
      return `Official records for ${where} list ${fmt(m.registered)} units, but independent signals point to only about ${fmt(m.expected)} (likely range ${fmt(m.exp_lo)}–${fmt(m.exp_hi)}) for a zone of its kind (peer group: ${peer.name}, ${peer.n} zones). That is ${Math.abs(m.gap_z).toFixed(1)}σ below its peers; some recorded units may be dormant, relocated or closed. ${signalText(sc)} The difference has ${hold}. ${TREND_TXT[m.gap_trend] || ''} ${SPATIAL_TXT[m.spatial_class] || ''} ${cov}${CAVEAT}`;
    case 'emerging_hotspot':
      return `Seasonally adjusted activity in ${where} grew ${Math.round(Math.abs(m.yoy_activity) * 100)}% year-on-year, while registrations changed ${pct(m.yoy_registered ?? 0)}. ${signalText(sc)} Growth has ${hold}.${m.yoy_activity - (m.yoy_registered ?? 0) > 0.15 ? ' Registrations are lagging the observed expansion.' : ' Registrations are broadly keeping pace.'} ${cov}${CAVEAT}`;
    case 'contraction':
      return `Seasonally adjusted activity in ${where} declined ${Math.round(Math.abs(m.yoy_activity) * 100)}% year-on-year, while registrations changed ${pct(m.yoy_registered ?? 0)}. ${signalText(sc)} The decline has ${hold}. ${cov}${CAVEAT}`;
    default: return '';
  }
}

export function suggestedChecks(type, cell) {
  const tourism = cell.tourism_share >= 0.3;
  const base = {
    visibility_gap: [
      'Walk the main commercial streets and count operating establishments by type.',
      'Note how many display a trade licence, GST or Shops & Establishments number.',
      tourism ? 'Record which units are seasonal (shacks, rentals, homestays) and their operating months.' : 'Look for recent construction or newly opened commercial premises.',
      'Offer registration support: share the nearest facilitation desk and Udyam / trade-licence guidance.',
    ],
    record_mismatch: [
      'Check a sample of recorded premises: operating, closed, relocated or converted to another use.',
      'Ask the local body whether records for this area were recently cleaned or migrated.',
      'Note any industry-wide reason for the decline (closures, shutdowns, road changes).',
    ],
    emerging_hotspot: [
      'Identify what is driving the growth: new infrastructure, a market, tourism or housing.',
      'Count newly opened establishments and note whether they are aware of registration steps.',
      'Flag infrastructure pressure for planners: parking, waste, water, power.',
    ],
    contraction: [
      'Identify the cause of decline: closures, relocation, seasonal pause or access changes.',
      'Count shuttered premises versus those still operating.',
      'Note whether support programmes would help remaining businesses.',
    ],
    audit_control: [
      'Random control visit: count operating establishments exactly as for a prioritised zone.',
      'Record the outcome even if nothing unusual is found; this is what calibrates the model.',
    ],
  }[type] || [];
  return cell.sensitive ? ['Sensitive zone: confirm senior sign-off and visit with community liaison.', ...base] : base;
}

export function zoneSummary(cell, m, sc, peer, settings) {
  if (m.insufficient === 'suppressed') return `Insufficient data. Fewer than ${settings.min_cell_count} registered units are on record here, so counts are suppressed and no priority is shown; a score could point to an individual business.`;
  if (m.insufficient === 'coverage') return `Insufficient data. Only ${Math.round(m.coverage * 100)}% of the expected source values were received over the last 12 months (minimum ${Math.round(settings.min_coverage * 100)}%). No priority is shown; missing data lowers confidence and is never filled in silently.`;
  const rel = Math.abs(m.gap_z) < 1 ? 'in line with' : m.gap_z > 0 ? 'below' : 'above';
  const head = `${cell.name} has ${fmt(m.registered)} registered units, ${rel} the ~${fmt(m.expected)} (range ${fmt(m.exp_lo)}–${fmt(m.exp_hi)}) that independent signals suggest for its peer group (${peer.name}).`;
  if (Math.abs(m.gap_z) < 1) return `${head} No anomaly: the zone looks like its peers. Confidence ${Math.round(m.confidence)}/100, coverage ${Math.round(m.coverage * 100)}%.`;
  if (Math.abs(m.gap_abs) < settings.min_gap_establishments) return `${head} That is ${m.gap_z > 0 ? '+' : ''}${m.gap_z.toFixed(1)}σ relative to its peers, but the difference is only ${fmt(Math.abs(m.gap_abs))} units, below the minimum size of ${settings.min_gap_establishments}, so the zone stays in the low tier. Confidence ${Math.round(m.confidence)}/100.`;
  return `${head} The peer-relative gap is ${m.gap_z > 0 ? '+' : ''}${m.gap_z.toFixed(1)}σ with confidence ${Math.round(m.confidence)}/100 (${m.tier} priority). ${signalText(sc)} ${TREND_TXT[m.gap_trend] || ''} ${SPATIAL_TXT[m.spatial_class] || ''}${CAVEAT}`;
}

// ---------------------------------------------------------------- run
let seqCache = null;
export function nextCode(month, tag = 'ES') {
  const prefix = `${tag}-${month.replace('-', '')}-`;
  if (!seqCache || seqCache.prefix !== prefix) {
    const r = get('SELECT code FROM alerts WHERE code LIKE ? ORDER BY code DESC LIMIT 1', `${prefix}%`);
    seqCache = { prefix, n: r ? Number(r.code.slice(prefix.length)) : 0 };
  }
  seqCache.n += 1;
  return `${prefix}${String(seqCache.n).padStart(4, '0')}`;
}

const monthDiff = (a, b) => {
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return (ya - yb) * 12 + (ma - mb);
};

function inputsHash(month, settings) {
  const s = get(`SELECT COUNT(*) n, TOTAL(registered) a, TOTAL(night_light) b, TOTAL(built_up) c, TOTAL(digital_points) d,
    TOTAL(power_connections) e, TOTAL(listings) f, TOTAL(footfall) g FROM observations WHERE month <= ?`, month);
  const c = get('SELECT COUNT(*) n, TOTAL(offset) o FROM cell_calibration');
  return crypto.createHash('sha1').update(JSON.stringify([s, c, settings])).digest('hex').slice(0, 16);
}

export function runEngine({ month, userId = null } = {}) {
  const started = Date.now();
  const settings = getSettings();
  const E = computeModel(month, settings);
  const { t, M, cells, groups, groupOf } = E;
  const target = E.months[t];
  seqCache = null;
  const chgEv = t >= 14 ? E.evidenceAt(t, 'change') : null;
  const peerOf = (i) => groups[groupOf[i]];

  const candidates = [];
  let suppressedSingle = 0;
  for (let i = 0; i < E.N; i++) {
    const m = M[i][t];
    if (m.insufficient) continue;
    const sc = E.scored[i];
    if (Math.abs(m.gap_abs) >= settings.min_gap_establishments && Math.abs(m.gap_z) >= settings.gap_z_threshold) {
      if (sc.nightLightOnly || sc.comp.agreeing === 0) suppressedSingle++;
      else candidates.push({ i, type: m.gap_z > 0 ? 'visibility_gap' : 'record_mismatch', sc, confidence: m.confidence, priority: Math.abs(m.priority), tier: m.tier });
    }
    if (chgEv && m.yoy_activity !== null) {
      const changeAbs = Math.abs(mean([0, 1, 2].map((k) => E.Osa[i][t - k])) - mean([0, 1, 2].map((k) => E.Osa[i][t - 12 - k])));
      const z = E.chgZ[i][t];
      const up = z >= settings.change_z_threshold && m.yoy_activity >= settings.min_change_pct;
      const down = z <= -settings.change_z_threshold && m.yoy_activity <= -settings.min_change_pct * 0.8;
      if (changeAbs >= settings.min_gap_establishments && (up || down)) {
        const cs = E.scoreZone(i, t, chgEv, E.chgZ[i], up ? 1 : -1);
        if (cs.nightLightOnly || cs.comp.agreeing === 0) { suppressedSingle++; continue; }
        const pr = Math.abs(z) * cs.confidence / 100;
        candidates.push({ i, type: up ? 'emerging_hotspot' : 'contraction', sc: cs, confidence: cs.confidence, priority: pr, tier: E.tierOf(pr) });
      }
    }
  }

  let created = 0, updated = 0;
  tx(() => {
    // peer groups (documented, reviewable)
    run('UPDATE cells SET peer_group_id = NULL');
    run('DELETE FROM peer_groups');
    groups.forEach((g, gi) => {
      run('INSERT INTO peer_groups (id, name, description, n, traits_json) VALUES (?,?,?,?,?)', g.id, g.name, g.description, g.n,
        JSON.stringify({ centroid: g.centroid, sigma: E.groupStats[gi][t].sigma, offset: E.groupStats[gi][t].offset, scored: E.groupStats[gi][t].n }));
    });
    const setPeer = db.prepare('UPDATE cells SET peer_group_id = ? WHERE id = ?');
    cells.forEach((c, i) => setPeer.run(peerOf(i).id, c.id));

    const seen = new Set();
    for (const c of candidates) {
      const cell = cells[c.i], m = M[c.i][t], peer = peerOf(c.i);
      const existing = get('SELECT * FROM alerts WHERE cell_id = ? AND type = ? AND is_control = 0 ORDER BY id DESC LIMIT 1', cell.id, c.type);
      const vals = [
        c.tier, r3(c.priority), +c.confidence.toFixed(1), target, m.observed_sa, m.expected, m.exp_lo, m.exp_hi, m.registered,
        m.gap_abs, m.registered > 0 ? m.expected / m.registered - 1 : null, m.gap_z, m.yoy_activity, m.yoy_registered, m.change_z,
        m.coverage, m.spatial_class, m.gap_trend ?? null, peer.name, cell.sensitive ? 1 : 0,
        JSON.stringify(c.sc.signals), JSON.stringify(c.sc.comp), JSON.stringify(suggestedChecks(c.type, cell)), explain(c.type, cell, m, c.sc, peer),
      ];
      if (existing && ['open', 'assigned'].includes(existing.status)) {
        run(`UPDATE alerts SET priority=?, priority_score=?, confidence=?, last_detected=?, observed=?, expected=?, exp_lo=?, exp_hi=?, registered=?,
             gap_abs=?, gap_pct=?, gap_z=?, yoy_activity=?, yoy_registered=?, change_z=?, coverage=?, spatial_class=?, gap_trend=?, peer_group=?, sensitive=?,
             signals_json=?, confidence_json=?, checks_json=?, explanation=?, still_active=1, updated_at=datetime('now') WHERE id=?`, ...vals, existing.id);
        seen.add(existing.id); updated++;
        continue;
      }
      if (existing && monthDiff(target, existing.last_detected) <= settings.cooldown_months) continue;
      const r = run(`INSERT INTO alerts (code, cell_id, type, status, priority, priority_score, confidence, first_detected, last_detected,
             observed, expected, exp_lo, exp_hi, registered, gap_abs, gap_pct, gap_z, yoy_activity, yoy_registered, change_z,
             coverage, spatial_class, gap_trend, peer_group, sensitive, signals_json, confidence_json, checks_json, explanation)
             VALUES (?,?,?,'open',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        nextCode(target), cell.id, c.type, c.tier, r3(c.priority), +c.confidence.toFixed(1), target, ...vals.slice(3));
      seen.add(Number(r.lastInsertRowid)); created++;
    }
    const pending = all("SELECT id FROM alerts WHERE status IN ('open','assigned') AND is_control = 0 AND last_detected < ?", target);
    for (const p of pending) if (!seen.has(p.id)) run('UPDATE alerts SET still_active = 0 WHERE id = ?', p.id);

    // scores are published atomically: either the whole run lands or none of it
    run('DELETE FROM cell_metrics');
    const st = db.prepare(`INSERT INTO cell_metrics (cell_id, month, observed, observed_sa, registered, expected, exp_lo, exp_hi, gap_abs, gap_log, gap_z,
      yoy_activity, yoy_registered, change_z, seasonal_index, eai, coverage, insufficient, insufficient_reason, confidence, priority, tier, district_rank,
      spatial_class, spatial_p, gi_z, gap_trend, changepoint_month) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (let i = 0; i < E.N; i++) for (let x = 0; x < E.T; x++) {
      const m = M[i][x];
      st.run(cells[i].id, m.month, r3(m.observed), r3(m.observed_sa), m.registered, r3(m.expected), r3(m.exp_lo), r3(m.exp_hi), r3(m.gap_abs), r3(m.gap_log), r3(m.gap_z),
        r3(m.yoy_activity), r3(m.yoy_registered), r3(m.change_z), r3(m.seasonal_index), r3(m.eai), r3(m.coverage), m.insufficient ? 1 : 0, m.insufficient || null,
        r3(m.confidence), r3(m.priority), m.tier, m.district_rank ?? null, m.insufficient ? null : m.spatial_class, m.insufficient ? null : m.spatial_p,
        m.insufficient ? null : m.gi_z, m.gap_trend ?? null, m.changepoint_month ?? null);
    }
    // evidence card for every zone (latest month)
    run('DELETE FROM cell_evidence');
    const ev = db.prepare('INSERT INTO cell_evidence (cell_id, month, json) VALUES (?,?,?)');
    for (let i = 0; i < E.N; i++) {
      const m = M[i][t], sc = E.scored[i], peer = peerOf(i);
      const from = Math.max(0, t - 11);
      const sources = E.METRICS.map((k) => {
        let seen12 = 0;
        for (let x = from; x <= t; x++) seen12 += E.mask[k][i][x] ? 1 : 0;
        return { key: k, share: +(seen12 / (t - from + 1)).toFixed(2) };
      });
      ev.run(cells[i].id, target, JSON.stringify({
        summary: zoneSummary(cells[i], m, sc, peer, settings),
        signals: sc?.signals || [], confidence: sc?.comp || null, confidenceBand: sc ? E.band(sc.confidence) : null,
        sources, checks: m.insufficient || Math.abs(m.gap_z) < 1 ? [] : suggestedChecks(m.gap_z > 0 ? 'visibility_gap' : 'record_mismatch', cells[i]),
      }));
    }
    run(`INSERT INTO engine_runs (month, started_at, duration_ms, cells, alerts_created, alerts_updated, inputs_hash, model_json, triggered_by)
         VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
      target, Date.now() - started, E.N, created, updated, inputsHash(target, settings),
      JSON.stringify({ ...E.model, settings, suppressedSingleSignal: suppressedSingle, insufficient: M.filter((s) => s[t].insufficient).length }), userId);
  });
  if (userId) log(userId, 'engine.run', 'engine', null, { month: target, created, updated });
  return {
    month: target, cells: E.N, candidates: candidates.length, created, updated, suppressedSingleSignal: suppressedSingle,
    insufficient: M.filter((s) => s[t].insufficient).length, durationMs: Date.now() - started, model: E.model,
  };
}

// Ground-truth feedback: when a gap flag turns out to be ordinary (legitimately busy, new development,
// nothing found), the zone's expected level is recalibrated so the same pattern is not raised again.
export const RECALIBRATING = ['legitimately_busy', 'new_development', 'no_gap'];
export function applyFeedback(alert, outcome) {
  if (ALERT_TYPES[alert.type]?.kind !== 'gap' || !RECALIBRATING.includes(outcome)) return null;
  const cm = get('SELECT gap_log FROM cell_metrics WHERE cell_id = ? AND month = ?', alert.cell_id, alert.last_detected);
  if (!cm || cm.gap_log === null) return null;
  const prev = get('SELECT offset FROM cell_calibration WHERE cell_id = ?', alert.cell_id)?.offset || 0;
  const offset = prev + cm.gap_log;
  run(`INSERT INTO cell_calibration (cell_id, offset, reason) VALUES (?,?,?)
       ON CONFLICT(cell_id) DO UPDATE SET offset = excluded.offset, reason = excluded.reason, updated_at = datetime('now')`,
    alert.cell_id, offset, `${outcome} on ${alert.code}`);
  return offset;
}

export { TRAITS };
