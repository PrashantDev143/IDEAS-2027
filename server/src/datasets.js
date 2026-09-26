import { db, run, all, tx, listMonths } from './db.js';
import { buildCells, generateMonth, surveyEstimate, monthIndex, monthLabel } from './sim/generator.js';

export const DATASETS = [
  { key: 'registered', name: 'Business registrations', category: 'official', source: 'Udyam / GST / Shops & Establishments registers (aggregated)', unit: 'registered units', frequency: 'Monthly', description: 'Active registered establishments located in each cell. Forms the official-records side of the comparison.' },
  { key: 'survey_estimate', name: 'Survey baseline (ASUSE-style)', category: 'official', source: 'Annual Survey of Unincorporated Sector Enterprises, modelled to cell level', unit: 'establishments', frequency: 'Annual (FY)', description: 'Annual establishment estimate. Used to train the signal-to-activity nowcast model.' },
  { key: 'night_light', name: 'Night-time lights', category: 'satellite', source: 'VIIRS Day/Night Band monthly composites', unit: 'nW/cm²/sr', frequency: 'Monthly', description: 'Mean night-time radiance. A strong proxy for commercial and residential intensity.' },
  { key: 'built_up', name: 'Built-up surface index', category: 'satellite', source: 'Sentinel-2 derived built-up classification', unit: '% of cell', frequency: 'Monthly', description: 'Share of cell area classified as built-up surface.' },
  { key: 'digital_points', name: 'Digital merchant payment points', category: 'digital', source: 'Aggregated merchant QR / POS counts (authorised, anonymised)', unit: 'active points', frequency: 'Monthly', description: 'Count of active merchant payment acceptance points. No transaction or personal data.' },
  { key: 'power_connections', name: 'Commercial power connections', category: 'infrastructure', source: 'Electricity Department, commercial tariff connections', unit: 'connections', frequency: 'Monthly', description: 'Live commercial/LT-II tariff connections in each cell.' },
  { key: 'listings', name: 'Hospitality listings', category: 'tourism', source: 'Department of Tourism registrations + public listing aggregates', unit: 'listings', frequency: 'Monthly', description: 'Hotels, guest houses, homestays and rental listings active in the month.' },
  { key: 'footfall', name: 'Tourist footfall', category: 'tourism', source: 'Department of Tourism arrivals, spatially apportioned', unit: 'visitors / month', frequency: 'Monthly', description: 'Estimated tourist visits. Statewide totals are calibrated to ~1 crore annual arrivals.' },
];

export function upsertDatasetCatalog(synthetic = true) {
  const st = db.prepare(`INSERT INTO datasets (key, name, category, source, unit, frequency, description, synthetic, last_updated)
    VALUES (?,?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET name=excluded.name, category=excluded.category, source=excluded.source, unit=excluded.unit,
      frequency=excluded.frequency, description=excluded.description`);
  for (const d of DATASETS) st.run(d.key, d.name, d.category, d.source, d.unit, d.frequency, d.description, synthetic ? 1 : 0);
}

const OBS_COLS = ['registered', 'night_light', 'built_up', 'digital_points', 'power_connections', 'listings', 'footfall'];

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

// Simulated "continuous monitoring": pull the next month from the (synthetic) source feeds
export function ingestNextMonth() {
  const months = listMonths();
  const next = monthIndex(months[months.length - 1]) + 1;
  let label;
  tx(() => {
    label = insertGeneratedMonth(next);
    run("UPDATE datasets SET last_updated = datetime('now') WHERE synthetic = 1 AND key != 'survey_estimate'");
    if (label.endsWith('-03')) run("UPDATE datasets SET last_updated = datetime('now') WHERE key = 'survey_estimate'");
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
// metric may be any observation column or survey_estimate (month = FY start, e.g. 2025-04)
export function importObservationsCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('File is empty');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (n) => header.indexOf(n);
  const [ci, mi, ki, vi] = ['cell_code', 'month', 'metric', 'value'].map(col);
  if ([ci, mi, ki, vi].some((x) => x < 0)) throw new Error('Header must contain: cell_code, month, metric, value');
  const ids = new Map(all('SELECT id, code FROM cells').map((r) => [r.code, r.id]));
  const errors = [];
  let accepted = 0;
  const touched = new Set();
  tx(() => {
    for (let r = 1; r < rows.length; r++) {
      const line = rows[r];
      const code = line[ci]?.trim(), month = line[mi]?.trim(), metric = line[ki]?.trim().toLowerCase(), value = Number(line[vi]);
      const bad = (msg) => errors.length < 50 && errors.push(`Row ${r + 1}: ${msg}`);
      if (!ids.has(code)) { bad(`unknown cell_code "${code}"`); continue; }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { bad(`month must be YYYY-MM, got "${month}"`); continue; }
      if (!Number.isFinite(value) || value < 0) { bad(`value must be a non-negative number`); continue; }
      const id = ids.get(code);
      if (metric === 'survey_estimate') {
        run('INSERT OR REPLACE INTO surveys (cell_id, fy_start, estimate) VALUES (?,?,?)', id, Number(month.slice(0, 4)), value);
      } else if (OBS_COLS.includes(metric)) {
        run('INSERT OR IGNORE INTO observations (cell_id, month) VALUES (?, ?)', id, month);
        run(`UPDATE observations SET ${metric} = ? WHERE cell_id = ? AND month = ?`, value, id, month);
      } else { bad(`unknown metric "${metric}"`); continue; }
      touched.add(metric); accepted++;
    }
    // back-fill any columns left NULL on freshly created rows from the previous month
    for (const c of OBS_COLS) {
      run(`UPDATE observations SET ${c} = (SELECT o2.${c} FROM observations o2 WHERE o2.cell_id = observations.cell_id
           AND o2.month < observations.month AND o2.${c} IS NOT NULL ORDER BY o2.month DESC LIMIT 1) WHERE ${c} IS NULL`);
    }
    for (const k of touched) run("UPDATE datasets SET last_updated = datetime('now'), synthetic = 0 WHERE key = ?", k);
  });
  return { accepted, rejected: rows.length - 1 - accepted, errors, metrics: [...touched] };
}
