import { db, run, all, get, tx, listMonths } from './db.js';
import { buildCells, generateMonth, surveyEstimate, monthIndex, monthLabel } from './sim/generator.js';

// role: which side of the comparison the layer feeds. priority: P0 = MVP, P2 = optional enrichment.
export const DATASETS = [
  { key: 'registered', name: 'Registered footprint', category: 'official', role: 'Actual (the recorded side)', priority: 'P0', source: 'GST / trade-licence / Shops & Establishments registrations, aggregated to zones', licence: 'Government data-sharing MoU (aggregates only)', access: 'Authorised government data sharing', unit: 'registered units', frequency: 'Monthly', description: 'Count of active registrations per zone. Counts below the minimum cell size are suppressed.' },
  { key: 'survey_estimate', name: 'Survey baseline', category: 'official', role: 'Baseline and calibration', priority: 'P0', source: 'ASUSE / Economic Census estimates, modelled to zones', licence: 'MoSPI open data terms', access: 'Public', unit: 'establishments', frequency: 'Annual (FY)', description: 'Annual establishment estimate. Trains the activity nowcast.' },
  { key: 'night_light', name: 'Night-time lights', category: 'satellite', role: 'Independent activity signal (corroborating only)', priority: 'P0', source: 'VIIRS monthly radiance (NASA Black Marble)', licence: 'NASA open data policy', access: 'Open', unit: 'nW/cm²/sr', frequency: 'Monthly', description: 'Mean radiance. Saturates in dense cores, so it corroborates other signals and never drives a flag alone.' },
  { key: 'built_up', name: 'Built-up / commercial footprint', category: 'satellite', role: 'Independent activity signal', priority: 'P0', source: 'Sentinel-2 imagery, open building footprints, OpenStreetMap shops and amenities', licence: 'Copernicus open licence; ODbL (OSM)', access: 'Open', unit: '% of zone', frequency: 'Monthly', description: 'Share of the zone classified as built-up commercial surface.' },
  { key: 'listings', name: 'Hospitality listings', category: 'tourism', role: 'Seasonal activity signal', priority: 'P0', source: 'Goa Tourism Department: registered hotels and homestays', licence: 'Public register', access: 'Public / authorised', unit: 'listings', frequency: 'Monthly', description: 'Hotels, guest houses and homestays active in the month.' },
  { key: 'footfall', name: 'Tourist footfall', category: 'tourism', role: 'Seasonal activity signal', priority: 'P0', source: 'Goa Tourism Department arrivals, apportioned to zones', licence: 'Public statistics', access: 'Public / authorised', unit: 'visitors / month', frequency: 'Monthly', description: 'Estimated tourist visits. Strongly seasonal; read with the seasonality lens.' },
  { key: 'power_connections', name: 'Commercial electricity connections', category: 'enrichment', role: 'Enrichment signal', priority: 'P2', source: 'State utility, aggregated by zone and tariff class', licence: 'Only if legally shareable in aggregate', access: 'To be agreed with the utility', unit: 'connections', frequency: 'Monthly', description: 'Optional. Can be switched off under Detection settings.' },
  { key: 'digital_points', name: 'Merchant payment points', category: 'enrichment', role: 'Enrichment signal', priority: 'P2', source: 'Aggregated, anonymised merchant acceptance-point counts', licence: 'Only if legally shareable in aggregate', access: 'To be agreed with the provider', unit: 'active points', frequency: 'Monthly', description: 'Optional. Counts of acceptance points only: no transactions, no individual data.' },
];

export function upsertDatasetCatalog(synthetic = true) {
  const st = db.prepare(`INSERT INTO datasets (key, name, category, role, priority, source, licence, access, unit, frequency, description, synthetic, last_updated)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET name=excluded.name, category=excluded.category, role=excluded.role, priority=excluded.priority, source=excluded.source,
      licence=excluded.licence, access=excluded.access, unit=excluded.unit, frequency=excluded.frequency, description=excluded.description`);
  for (const d of DATASETS) st.run(d.key, d.name, d.category, d.role, d.priority, d.source, d.licence, d.access, d.unit, d.frequency, d.description, synthetic ? 1 : 0);
}

// every ingest is versioned with its acquisition date, period and transformation
export function recordVersion(key, period, records, transformation, acquiredOn) {
  const v = (get('SELECT MAX(version) v FROM dataset_versions WHERE key = ?', key)?.v || 0) + 1;
  run('INSERT INTO dataset_versions (key, version, acquired_on, period, records, transformation) VALUES (?,?,?,?,?,?)',
    key, v, acquiredOn || new Date().toISOString().slice(0, 10), period, records, transformation);
  run("UPDATE datasets SET version = ?, last_updated = datetime('now') WHERE key = ?", v, key);
  return v;
}

export const OBS_COLS = ['registered', 'night_light', 'built_up', 'digital_points', 'power_connections', 'listings', 'footfall'];

export function insertGeneratedMonth(t) {
  const cells = buildCells();
  const ids = new Map(all('SELECT id, code FROM cells').map((r) => [r.code, r.id]));
  const label = monthLabel(t);
  const st = db.prepare(`INSERT OR REPLACE INTO observations (cell_id, month, ${OBS_COLS.join(',')}) VALUES (?,?,${OBS_COLS.map(() => '?').join(',')})`);
  for (const c of cells) {
    const o = generateMonth(c, t);
    st.run(ids.get(c.code), label, ...OBS_COLS.map((k) => o[k]));
  }
  // publish a survey once its FY closes (annual dissemination)
  if (label.endsWith('-03')) {
    const fy = Number(label.slice(0, 4)) - 1;
    const sv = db.prepare('INSERT OR REPLACE INTO surveys (cell_id, fy_start, estimate) VALUES (?,?,?)');
    for (const c of cells) sv.run(ids.get(c.code), fy, surveyEstimate(c, fy));
  }
  return label;
}

// Simulated monthly feed: pull the next month from the (synthetic) sources
export function ingestNextMonth() {
  const months = listMonths();
  const next = monthIndex(months[months.length - 1]) + 1;
  let label;
  tx(() => {
    label = insertGeneratedMonth(next);
    for (const k of OBS_COLS) {
      const n = get(`SELECT COUNT(${k}) n FROM observations WHERE month = ?`, label).n;
      recordVersion(k, label, n, 'Aggregated to the 2.7 km zone grid (synthetic feed)');
    }
    if (label.endsWith('-03')) recordVersion('survey_estimate', `FY ${Number(label.slice(0, 4)) - 1}`, get('SELECT COUNT(*) n FROM cells').n, 'Modelled to zones (synthetic)');
  });
  return label;
}

// ---------------- CSV ingest (real data path) ----------------
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

// Long format: cell_code, month (YYYY-MM), metric, value
// metric may be any observation column or survey_estimate (month = FY start, e.g. 2025-04).
// Only zone-level aggregates are accepted; values that are not supplied stay missing.
export function importObservationsCsv(text, filename = 'upload') {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) throw Object.assign(new Error('File is empty'), { status: 400 });
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const [ci, mi, ki, vi] = ['cell_code', 'month', 'metric', 'value'].map((n) => header.indexOf(n));
  if ([ci, mi, ki, vi].some((x) => x < 0)) throw Object.assign(new Error('Header must contain: cell_code, month, metric, value'), { status: 400 });
  const ids = new Map(all('SELECT id, code FROM cells').map((r) => [r.code, r.id]));
  const errors = [];
  let accepted = 0;
  const touched = {};
  tx(() => {
    for (let r = 1; r < rows.length; r++) {
      const line = rows[r];
      const code = line[ci]?.trim(), month = line[mi]?.trim(), metric = line[ki]?.trim().toLowerCase(), rawValue = line[vi]?.trim();
      const value = Number(rawValue);
      const bad = (msg) => errors.length < 50 && errors.push(`Row ${r + 1}: ${msg}`);
      if (!ids.has(code)) { bad(`unknown cell_code "${code}"`); continue; }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) { bad(`month must be YYYY-MM, got "${month}"`); continue; }
      if (rawValue === '' || rawValue === undefined || !Number.isFinite(value) || value < 0) { bad('value must be a non-negative number'); continue; }
      const id = ids.get(code);
      if (metric === 'survey_estimate') {
        run('INSERT OR REPLACE INTO surveys (cell_id, fy_start, estimate) VALUES (?,?,?)', id, Number(month.slice(0, 4)), value);
      } else if (OBS_COLS.includes(metric)) {
        run('INSERT OR IGNORE INTO observations (cell_id, month) VALUES (?, ?)', id, month);
        run(`UPDATE observations SET ${metric} = ? WHERE cell_id = ? AND month = ?`, value, id, month);
      } else { bad(`unknown metric "${metric}"`); continue; }
      (touched[metric] ||= { n: 0, months: new Set() }).n++;
      touched[metric].months.add(month);
      accepted++;
    }
    for (const [k, v] of Object.entries(touched)) {
      const ms = [...v.months].sort();
      recordVersion(k, ms.length > 1 ? `${ms[0]} … ${ms[ms.length - 1]}` : ms[0], v.n, `CSV upload: ${filename}`);
      run('UPDATE datasets SET synthetic = 0 WHERE key = ?', k);
    }
  });
  return { accepted, rejected: rows.length - 1 - accepted, errors, metrics: Object.keys(touched) };
}
