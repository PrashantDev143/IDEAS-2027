// EconoScope detection engine
//
//  1. NOWCAST   observed activity O(c,t) from satellite / digital / infrastructure / tourism
//               signals, via a ridge model trained on the latest annual survey baseline.
//  2. BASELINE  seasonal index per cell (classical decomposition) -> O_sa, and the normal
//               "observed-to-recorded" ratio kappa learned from the historical baseline window.
//               Expected activity E = kappa * registered * calibration(c) (field feedback).
//  3. DETECT    visibility gaps / record mismatches (robust z of log O_sa/E across cells) and
//               emerging hotspots / contractions (robust z of seasonally-adjusted YoY change).
//  4. EVIDENCE  per-signal agreement, persistence, magnitude and an Isolation Forest score are
//               blended into a transparent confidence score and a validation priority.

import { db, all, get, run, tx, getSettings, listMonths, log } from '../db.js';
import { robustZ, ridge, dot, seasonalIndex, median, mean, clamp } from './stats.js';
import { isolationForest } from './isolationForest.js';

export const SIGNAL_META = {
  night_light: { label: 'Night-time lights (VIIRS)', category: 'satellite', seasonal: true },
  built_up: { label: 'Built-up surface index', category: 'satellite', seasonal: false },
  digital_points: { label: 'Digital merchant payment points', category: 'digital', seasonal: true },
  power_connections: { label: 'Commercial power connections', category: 'infrastructure', seasonal: false },
  listings: { label: 'Hospitality listings', category: 'tourism', seasonal: true, minApplicable: 3 },
  footfall: { label: 'Tourist footfall', category: 'tourism', seasonal: true, minApplicable: 70 },
};
const SIGNALS = Object.keys(SIGNAL_META);
const FEATURE_NAMES = ['intercept', 'ln night_light', 'built_up', 'ln digital_points', 'ln power_connections', 'ln listings', 'ln footfall'];

export const ALERT_TYPES = {
  visibility_gap: { label: 'Visibility gap', dir: 1, kind: 'gap' },
  record_mismatch: { label: 'Record mismatch', dir: -1, kind: 'gap' },
  emerging_hotspot: { label: 'Emerging hotspot', dir: 1, kind: 'change' },
  contraction: { label: 'Activity contraction', dir: -1, kind: 'change' },
};

const EAI_REF_DENSITY = 500; // establishment-equivalents per km2 mapped to EAI 100
const calMonthOf = (label) => Number(label.slice(5, 7));
const features = (o) => [
  1, Math.log1p(o.night_light), o.built_up / 100, Math.log1p(o.digital_points),
  Math.log1p(o.power_connections), Math.log1p(o.listings), Math.log1p(o.footfall),
];

// ---------------------------------------------------------------- model
export function computeModel(asOf) {
  const months = listMonths().filter((m) => !asOf || m <= asOf);
  if (months.length < 3) throw new Error('Not enough observation history to build a baseline (need >= 3 months).');
  const T = months.length;
  const mIdx = Object.fromEntries(months.map((m, i) => [m, i]));
  const cells = all('SELECT * FROM cells ORDER BY id');
  const cIdx = new Map(cells.map((c, i) => [c.id, i]));
  const N = cells.length;

  // raw observations -> dense arrays
  const obs = cells.map(() => new Array(T).fill(null));
  for (const r of all('SELECT * FROM observations WHERE month <= ? ORDER BY month', months[T - 1])) {
    const ci = cIdx.get(r.cell_id), ti = mIdx[r.month];
    if (ci !== undefined && ti !== undefined) obs[ci][ti] = r;
  }
  // forward-fill gaps so a missing upload doesn't break the series
  for (let i = 0; i < N; i++) for (let t = 0; t < T; t++) {
    if (!obs[i][t]) obs[i][t] = t > 0 && obs[i][t - 1] ? { ...obs[i][t - 1], month: months[t], _filled: true } : null;
  }
  for (let i = 0; i < N; i++) for (let t = T - 1; t >= 0; t--) if (!obs[i][t] && obs[i][t + 1]) obs[i][t] = { ...obs[i][t + 1], _filled: true };

  // ---- 1. nowcast model trained on latest complete survey FY
  const lastMonth = months[T - 1];
  const surveyRows = all('SELECT cell_id, fy_start, estimate FROM surveys ORDER BY fy_start');
  const fys = [...new Set(surveyRows.map((s) => s.fy_start))]
    .filter((fy) => `${fy + 1}-03` <= lastMonth)
    .filter((fy) => months.filter((m) => m >= `${fy}-04` && m <= `${fy + 1}-03`).length >= 6);
  if (!fys.length) throw new Error('No survey baseline overlaps the observation window.');
  const fy = fys[fys.length - 1];
  const fyMonths = months.map((m, t) => [m, t]).filter(([m]) => m >= `${fy}-04` && m <= `${fy + 1}-03`).map(([, t]) => t);
  const survey = new Map(surveyRows.filter((s) => s.fy_start === fy).map((s) => [s.cell_id, s.estimate]));
  const X = [], y = [];
  cells.forEach((c, i) => {
    const s = survey.get(c.id);
    if (!s || s <= 0) return;
    const f = new Array(FEATURE_NAMES.length).fill(0);
    let k = 0;
    for (const t of fyMonths) if (obs[i][t]) { features(obs[i][t]).forEach((v, j) => (f[j] += v)); k++; }
    if (!k) return;
    X.push(f.map((v) => v / k)); y.push(Math.log(s));
  });
  const fit = ridge(X, y, 1e-4);
  const smear = Math.exp(fit.residVar / 2);

  // ---- 2. observed activity + seasonal adjustment
  const calMonths = months.map(calMonthOf);
  const O = obs.map((row) => row.map((o) => (o ? Math.exp(dot(features(o), fit.beta)) * smear : NaN)));
  const SI = O.map((series) => (T >= 13 ? seasonalIndex(series, calMonths) : new Array(12).fill(1)));
  const Osa = O.map((series, i) => series.map((v, t) => v / SI[i][calMonths[t] - 1]));
  const R = obs.map((row) => row.map((o) => (o ? o.registered : NaN)));

  // seasonal adjustment for individual signals (evidence)
  const sigSA = {};
  for (const s of SIGNALS) {
    sigSA[s] = obs.map((row) => {
      const series = row.map((o) => (o ? o[s] : NaN));
      if (!SIGNAL_META[s].seasonal || T < 13) return series;
      const f = seasonalIndex(series.map((v) => v + 1), calMonths);
      return series.map((v, t) => (v + 1) / f[calMonths[t] - 1] - 1);
    });
  }

  // kappa: normal observed/recorded ratio during the baseline window (first 12 months)
  const base = Math.min(12, T);
  const ratios = [];
  for (let i = 0; i < N; i++) {
    const r = [];
    for (let t = 0; t < base; t++) if (R[i][t] > 5) r.push(Osa[i][t] / R[i][t]);
    if (r.length) ratios.push(median(r));
  }
  const kappa = median(ratios);
  const calib = new Map(all('SELECT cell_id, offset FROM cell_calibration').map((r) => [r.cell_id, r.offset]));

  // ---- 3. metrics per month
  const metrics = cells.map(() => new Array(T));
  const gapZ = cells.map(() => new Array(T).fill(NaN));
  const chgZ = cells.map(() => new Array(T).fill(NaN));
  const avg3 = (arr, t) => mean([arr[t - 2], arr[t - 1], arr[t]]);
  for (let t = 0; t < T; t++) {
    const gl = [], yoy = [], yoyR = [];
    for (let i = 0; i < N; i++) {
      const E = kappa * R[i][t] * Math.exp(calib.get(cells[i].id) || 0);
      gl.push(Math.log((Osa[i][t] + 1) / (E + 1)));
      if (t >= 14) {
        yoy.push(Math.log(avg3(Osa[i], t) / avg3(Osa[i], t - 12)));
        yoyR.push(Math.log((avg3(R[i], t) + 1) / (avg3(R[i], t - 12) + 1)));
      } else { yoy.push(NaN); yoyR.push(NaN); }
      metrics[i][t] = { E };
    }
    const gz = robustZ(gl, 0.05).z;
    const cz = t >= 14 ? robustZ(yoy, 0.03).z : yoy;
    for (let i = 0; i < N; i++) {
      const E = metrics[i][t].E;
      const density = Osa[i][t] / cells[i].area_km2;
      gapZ[i][t] = gz[i]; chgZ[i][t] = cz[i];
      metrics[i][t] = {
        month: months[t],
        observed: O[i][t], observed_sa: Osa[i][t], expected: E, registered: R[i][t],
        gap_abs: Osa[i][t] - E, gap_log: gl[i], gap_z: gz[i],
        yoy_activity: Number.isFinite(yoy[i]) ? Math.exp(yoy[i]) - 1 : null,
        yoy_registered: Number.isFinite(yoyR[i]) ? Math.exp(yoyR[i]) - 1 : null,
        change_z: Number.isFinite(cz[i]) ? cz[i] : null,
        seasonal_index: SI[i][calMonths[t] - 1],
        eai: clamp(100 * Math.log1p(density) / Math.log1p(EAI_REF_DENSITY), 0, 100),
      };
    }
  }

  return {
    cells, months, T, N, obs, O, Osa, R, sigSA, SI, metrics, gapZ, chgZ, kappa, calib,
    model: {
      fy, trainedOn: `FY ${fy}-${String(fy + 1).slice(2)}`, features: FEATURE_NAMES,
      beta: fit.beta, r2: fit.r2, n: fit.n, smear, kappa, asOf: lastMonth,
    },
  };
}

// ---------------------------------------------------------------- evidence
function signalEvidence(M, t, kind) {
  // returns z[signal][cellIdx] and applicability
  const out = {};
  for (const s of SIGNALS) {
    const meta = SIGNAL_META[s];
    const vals = [], applicable = [];
    for (let i = 0; i < M.N; i++) {
      const cur = M.sigSA[s][i][t];
      const ok = !meta.minApplicable || cur >= meta.minApplicable;
      applicable.push(ok);
      if (!ok) { vals.push(NaN); continue; }
      if (kind === 'gap') vals.push(Math.log((cur + 1) / (M.R[i][t] + 1)));
      else if (t >= 14) {
        const a = mean([0, 1, 2].map((k) => M.sigSA[s][i][t - k]));
        const b = mean([0, 1, 2].map((k) => M.sigSA[s][i][t - 12 - k]));
        vals.push(Math.log((a + 1) / (b + 1)));
      } else vals.push(NaN);
    }
    out[s] = { z: robustZ(vals, kind === 'gap' ? 0.05 : 0.03).z, applicable };
  }
  return out;
}

const pct = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const fmt = (x) => Math.round(x).toLocaleString('en-IN');

function explain(type, cell, m, ev, conf) {
  const agreeing = ev.filter((e) => e.agrees).map((e) => e.label.toLowerCase());
  const applicable = ev.filter((e) => e.applicable).length;
  const persistTxt = `${conf.persistenceMonths} of the last 6 months`;
  const signalTxt = agreeing.length
    ? `${agreeing.length} of ${applicable} independent signals agree (${agreeing.join(', ')}).`
    : `No individual signal clearly agrees on its own; treat as a data-quality check.`;
  const single = agreeing.length <= 1 ? ' The pattern is driven largely by a single signal, so verify the data source before deploying a field team.' : '';
  const where = `${cell.name} (${cell.taluka} taluka)`;
  const tail = ' This is an economic-activity anomaly for validation, not a finding of any unlawful activity.';
  switch (type) {
    case 'visibility_gap':
      return `Observed activity in ${where} is estimated at ~${fmt(m.observed_sa)} establishment-equivalents (seasonally adjusted), ${pct(m.observed_sa / m.expected - 1)} above the ~${fmt(m.expected)} that official records (${fmt(m.registered)} registered units) would normally imply. ${signalTxt} The gap has held for ${persistTxt}.${single}${tail}`;
    case 'record_mismatch':
      return `Official records for ${where} list ${fmt(m.registered)} registered units, but observed signals point to only ~${fmt(m.observed_sa)} establishment-equivalents — ${pct(m.observed_sa / m.expected - 1)} versus the expected ~${fmt(m.expected)}. Registered units may be dormant, relocated or closed. ${signalTxt} Persisted for ${persistTxt}.${single}${tail}`;
    case 'emerging_hotspot':
      return `Seasonally adjusted activity in ${where} grew ${Math.round(Math.abs(m.yoy_activity) * 100)}% year-on-year, while registrations changed ${pct(m.yoy_registered ?? 0)}. ${signalTxt} Growth has been sustained for ${persistTxt}.${m.yoy_activity - (m.yoy_registered ?? 0) > 0.15 ? ' Formal registrations are lagging the observed expansion.' : ' Registrations are broadly keeping pace (formal expansion).'}${single}${tail}`;
    case 'contraction':
      return `Seasonally adjusted activity in ${where} declined ${Math.round(Math.abs(m.yoy_activity) * 100)}% year-on-year while registrations changed ${pct(m.yoy_registered ?? 0)}. ${signalTxt} Decline sustained for ${persistTxt}.${single}${tail}`;
    default: return '';
  }
}

// ---------------------------------------------------------------- run
let seqCache = null;
function nextCode(month) {
  const prefix = `ES-${month.replace('-', '')}-`;
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

export function runEngine({ month, userId = null, persistMetrics = true } = {}) {
  const started = Date.now();
  const settings = getSettings();
  const M = computeModel(month);
  const t = M.T - 1;
  const target = M.months[t];
  seqCache = null;

  const gapEv = signalEvidence(M, t, 'gap');
  const chgEv = t >= 14 ? signalEvidence(M, t, 'change') : null;

  // isolation forest over the current month's multivariate profile
  const clip = (v) => (Number.isFinite(v) ? Math.max(-8, Math.min(8, v)) : 0);
  const Xiso = M.cells.map((_, i) => [
    clip(M.gapZ[i][t]), clip(M.chgZ[i][t]),
    ...SIGNALS.map((s) => clip(gapEv[s].z[i])),
    ...(chgEv ? SIGNALS.map((s) => clip(chgEv[s].z[i])) : []),
  ]);
  const iso = isolationForest(Xiso, { seed: 7 });

  const W = settings.weights;
  const candidates = [];
  for (let i = 0; i < M.N; i++) {
    const m = M.metrics[i][t];
    const checks = [];
    if (Math.abs(m.gap_abs) >= settings.min_gap_establishments) {
      if (M.gapZ[i][t] >= settings.gap_z_threshold) checks.push(['visibility_gap', M.gapZ[i], settings.gap_z_threshold, gapEv]);
      if (M.gapZ[i][t] <= -settings.gap_z_threshold) checks.push(['record_mismatch', M.gapZ[i], settings.gap_z_threshold, gapEv]);
    }
    const changeAbs = t >= 14 ? Math.abs(mean([0, 1, 2].map((k) => M.Osa[i][t - k])) - mean([0, 1, 2].map((k) => M.Osa[i][t - 12 - k]))) : 0;
    if (chgEv && m.yoy_activity !== null && changeAbs >= settings.min_gap_establishments) {
      if (M.chgZ[i][t] >= settings.change_z_threshold && m.yoy_activity >= settings.min_change_pct) checks.push(['emerging_hotspot', M.chgZ[i], settings.change_z_threshold, chgEv]);
      if (M.chgZ[i][t] <= -settings.change_z_threshold && m.yoy_activity <= -settings.min_change_pct * 0.8) checks.push(['contraction', M.chgZ[i], settings.change_z_threshold, chgEv]);
    }
    for (const [type, zSeries, thr, ev] of checks) {
      const dir = ALERT_TYPES[type].dir;
      const evidence = SIGNALS.map((s) => {
        const z = ev[s].z[i];
        const applicable = ev[s].applicable[i] && Number.isFinite(z);
        return {
          signal: s, label: SIGNAL_META[s].label, category: SIGNAL_META[s].category,
          z: applicable ? +z.toFixed(2) : null, applicable, agrees: applicable && z * dir >= 1,
          value: M.obs[i][t]?.[s] ?? null,
        };
      });
      const nApp = evidence.filter((e) => e.applicable).length || 1;
      const agreement = evidence.filter((e) => e.agrees).length / nApp;
      let persistMonths = 0;
      for (let k = 0; k < 6 && t - k >= 0; k++) if (Number.isFinite(zSeries[t - k]) && zSeries[t - k] * dir >= 0.75 * thr) persistMonths++;
      const persistence = persistMonths / 6;
      const magnitude = clamp(Math.abs(zSeries[t]) / (3 * thr));
      const isolation = clamp((iso[i] - 0.45) / 0.2);
      const confidence = 100 * (W.agreement * agreement + W.magnitude * magnitude + W.persistence * persistence + W.isolation * isolation)
        / (W.agreement + W.magnitude + W.persistence + W.isolation);
      const impact = ALERT_TYPES[type].kind === 'gap'
        ? Math.abs(m.gap_abs)
        : Math.abs(mean([0, 1, 2].map((k) => M.Osa[i][t - k])) - mean([0, 1, 2].map((k) => M.Osa[i][t - 12 - k])));
      const impactN = clamp(Math.log10(1 + impact) / Math.log10(1 + 500));
      const priorityScore = confidence * (0.4 + 0.6 * impactN);
      const priority = priorityScore >= 50 ? 'high' : priorityScore >= 30 ? 'medium' : 'low';
      const conf = {
        agreement: +agreement.toFixed(3), magnitude: +magnitude.toFixed(3), persistence: +persistence.toFixed(3),
        isolation: +isolation.toFixed(3), iso_raw: +iso[i].toFixed(3), persistenceMonths: persistMonths,
        impact: Math.round(impact), weights: W,
      };
      candidates.push({
        cell: M.cells[i], type, m, evidence, conf, confidence: +confidence.toFixed(1), priority, priorityScore: +priorityScore.toFixed(1),
      });
    }
  }

  let created = 0, updated = 0;
  tx(() => {
    const seen = new Set();
    for (const c of candidates) {
      const existing = get('SELECT * FROM alerts WHERE cell_id = ? AND type = ? ORDER BY id DESC LIMIT 1', c.cell.id, c.type);
      const explanation = explain(c.type, c.cell, c.m, c.evidence, c.conf);
      const gapPct = c.m.expected > 0 ? c.m.observed_sa / c.m.expected - 1 : null;
      const vals = [
        c.priority, c.priorityScore, c.confidence, target, c.m.observed_sa, c.m.expected, c.m.registered,
        c.m.gap_abs, gapPct, c.m.gap_z, c.m.yoy_activity, c.m.yoy_registered, c.m.change_z,
        JSON.stringify(c.evidence), JSON.stringify(c.conf), explanation,
      ];
      if (existing && ['open', 'assigned'].includes(existing.status)) {
        run(`UPDATE alerts SET priority=?, priority_score=?, confidence=?, last_detected=?, observed=?, expected=?, registered=?,
             gap_abs=?, gap_pct=?, gap_z=?, yoy_activity=?, yoy_registered=?, change_z=?, signals_json=?, confidence_json=?,
             explanation=?, still_active=1, updated_at=datetime('now') WHERE id=?`, ...vals, existing.id);
        seen.add(existing.id); updated++;
        continue;
      }
      if (existing && monthDiff(target, existing.last_detected) <= settings.cooldown_months) continue;
      const r = run(`INSERT INTO alerts (code, cell_id, type, status, priority, priority_score, confidence, first_detected, last_detected,
             observed, expected, registered, gap_abs, gap_pct, gap_z, yoy_activity, yoy_registered, change_z, signals_json, confidence_json, explanation)
             VALUES (?,?,?,'open',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        nextCode(target), c.cell.id, c.type, c.priority, c.priorityScore, c.confidence, target, ...vals.slice(3));
      seen.add(Number(r.lastInsertRowid)); created++;
    }
    // alerts still awaiting action whose condition did not recur this month
    const pending = all("SELECT id FROM alerts WHERE status IN ('open','assigned') AND last_detected < ?", target);
    for (const p of pending) if (!seen.has(p.id)) run('UPDATE alerts SET still_active = 0 WHERE id = ?', p.id);

    if (persistMetrics) {
      run('DELETE FROM cell_metrics');
      const st = db.prepare(`INSERT INTO cell_metrics (cell_id, month, observed, observed_sa, expected, registered, gap_abs, gap_log, gap_z,
        yoy_activity, yoy_registered, change_z, seasonal_index, eai) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const r2 = (x) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
      for (let i = 0; i < M.N; i++) for (let k = 0; k < M.T; k++) {
        const m = M.metrics[i][k];
        st.run(M.cells[i].id, m.month, r2(m.observed), r2(m.observed_sa), r2(m.expected), m.registered, r2(m.gap_abs), r2(m.gap_log),
          r2(m.gap_z), r2(m.yoy_activity), r2(m.yoy_registered), r2(m.change_z), r2(m.seasonal_index), r2(m.eai));
      }
    }
    run(`INSERT INTO engine_runs (month, started_at, duration_ms, cells, alerts_created, alerts_updated, model_json, triggered_by)
         VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?)`,
      target, Date.now() - started, M.N, created, updated, JSON.stringify({ ...M.model, settings }), userId);
  });
  if (userId) log(userId, 'engine.run', 'engine', null, { month: target, created, updated });
  return { month: target, cells: M.N, candidates: candidates.length, created, updated, durationMs: Date.now() - started, model: M.model };
}

// Ground-truth feedback: explained / false-positive outcomes recalibrate the cell's expected level
export function applyFeedback(alert, outcome) {
  if (ALERT_TYPES[alert.type]?.kind !== 'gap') return null;
  if (!['false_positive', 'explained'].includes(outcome)) return null;
  const cm = get('SELECT gap_log FROM cell_metrics WHERE cell_id = ? AND month = ?', alert.cell_id, alert.last_detected);
  if (!cm) return null;
  const med = get('SELECT gap_log FROM cell_metrics WHERE month = ? ORDER BY gap_log LIMIT 1 OFFSET (SELECT COUNT(*)/2 FROM cells)', alert.last_detected);
  const prev = get('SELECT offset FROM cell_calibration WHERE cell_id = ?', alert.cell_id)?.offset || 0;
  const offset = prev + (cm.gap_log - (med?.gap_log ?? 0));
  run(`INSERT INTO cell_calibration (cell_id, offset, reason) VALUES (?,?,?)
       ON CONFLICT(cell_id) DO UPDATE SET offset = excluded.offset, reason = excluded.reason, updated_at = datetime('now')`,
    alert.cell_id, offset, `${outcome} on ${alert.code}`);
  return offset;
}
