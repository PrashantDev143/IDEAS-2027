import { Router } from 'express';
import multer from 'multer';
import { all, get, log, getSettings, saveSettings, DEFAULT_SETTINGS } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { runEngine } from '../engine/engine.js';
import { ingestNextMonth, importObservationsCsv } from '../datasets.js';
import { READERS } from './core.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

r.get('/datasets', requireAuth, requireRole(...READERS), (req, res) => {
  const total = get('SELECT COUNT(*) n, MIN(month) first, MAX(month) last FROM observations');
  const surveys = get('SELECT COUNT(*) n, MIN(fy_start) first, MAX(fy_start) last FROM surveys');
  const fy = (y) => `FY ${y}-${String(y + 1).slice(2)}`;
  const settings = getSettings();
  res.json({
    datasets: all('SELECT * FROM datasets ORDER BY priority, category, name').map((d) => {
      const isSurvey = d.key === 'survey_estimate';
      const have = isSurvey ? surveys.n : get(`SELECT COUNT(${d.key}) n FROM observations`).n;
      const latest = all('SELECT version, acquired_on, period, records, transformation FROM dataset_versions WHERE key = ? ORDER BY version DESC LIMIT 4', d.key);
      return {
        ...d, records: have, completeness: isSurvey ? 1 : total.n ? have / total.n : 0,
        coverage: isSurvey ? `${fy(surveys.first)} … ${fy(surveys.last)}` : `${total.first} … ${total.last}`,
        enabled: d.category !== 'enrichment' || settings.enrichment?.[d.key] !== false, versions: latest,
      };
    }),
  });
});

r.get('/datasets/template.csv', requireAuth, requireRole(...READERS), (req, res) => {
  const cells = all('SELECT code FROM cells ORDER BY id LIMIT 3');
  const last = get('SELECT MAX(month) m FROM observations').m;
  const lines = ['cell_code,month,metric,value'];
  for (const c of cells) lines.push(`${c.code},${last},registered,120`, `${c.code},${last},night_light,4.2`);
  lines.push(`${cells[0].code},2025-04,survey_estimate,165`);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="econoscope-upload-template.csv"');
  res.send(lines.join('\n'));
});

r.get('/datasets/cells.csv', requireAuth, requireRole(...READERS), (req, res) => {
  const rows = all('SELECT code, name, taluka, district, zone, lat, lon, lat_min, lat_max, lon_min, lon_max, area_km2 FROM cells ORDER BY id');
  const cols = Object.keys(rows[0]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="econoscope-zones.csv"');
  res.send([cols.join(','), ...rows.map((x) => cols.map((c) => (/[",]/.test(String(x[c])) ? `"${x[c]}"` : x[c])).join(','))].join('\n'));
});

r.post('/datasets/upload', requireAuth, requireRole('admin', 'analyst'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a CSV file in the "file" field' });
  const result = importObservationsCsv(req.file.buffer.toString('utf8'), req.file.originalname);
  log(req.user.id, 'data.upload', 'dataset', null, { file: req.file.originalname, accepted: result.accepted, rejected: result.rejected });
  res.json(result);
});

r.post('/engine/run', requireAuth, requireRole('admin', 'analyst'), (req, res) => {
  res.json(runEngine({ userId: req.user.id }));
});

r.post('/engine/ingest-next', requireAuth, requireRole('admin'), (req, res) => {
  const month = ingestNextMonth();
  log(req.user.id, 'data.ingest', 'dataset', null, { month, source: 'simulated feeds' });
  res.json({ ingested: month, ...runEngine({ userId: req.user.id }) });
});

r.get('/engine/runs', requireAuth, requireRole(...READERS), (req, res) => {
  res.json(all(`SELECT e.id, e.month, e.started_at, e.duration_ms, e.cells, e.alerts_created, e.alerts_updated, e.inputs_hash, e.model_json, u.name triggered_by
    FROM engine_runs e LEFT JOIN users u ON u.id = e.triggered_by ORDER BY e.id DESC LIMIT 30`).map((x) => {
    const m = JSON.parse(x.model_json);
    return { ...x, model_json: undefined, r2: m.footprint?.r2, trainedOn: m.trainedOn, insufficient: m.insufficient, suppressedSingleSignal: m.suppressedSingleSignal, peerGroups: m.peerGroups?.length };
  }));
});

r.get('/settings', requireAuth, requireRole(...READERS), (req, res) => res.json({ settings: getSettings(), defaults: DEFAULT_SETTINGS }));

const RANGES = {
  gap_z_threshold: [1, 6], change_z_threshold: [1, 6], min_gap_establishments: [0, 5000], min_change_pct: [0, 2], min_coverage: [0.1, 1],
  min_cell_count: [1, 50], peer_groups_k: [2, 10], tier_high: [0.5, 10], tier_medium: [0.1, 10], cooldown_months: [0, 24],
};
const INTS = ['min_cell_count', 'peer_groups_k', 'cooldown_months'];
r.put('/settings', requireAuth, requireRole('admin'), (req, res) => {
  const s = req.body || {};
  const clean = {};
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    if (s[k] === undefined) continue;
    const v = Number(s[k]);
    if (!Number.isFinite(v) || v < lo || v > hi || (INTS.includes(k) && !Number.isInteger(v))) return res.status(400).json({ error: `${k} must be ${INTS.includes(k) ? 'a whole number ' : ''}between ${lo} and ${hi}` });
    clean[k] = v;
  }
  const cur = getSettings();
  if ((clean.tier_medium ?? cur.tier_medium) >= (clean.tier_high ?? cur.tier_high)) return res.status(400).json({ error: 'The medium tier threshold must be below the high tier threshold' });
  if (s.weights !== undefined) {
    const keys = Object.keys(DEFAULT_SETTINGS.weights);
    const w = Object.fromEntries(keys.map((k) => [k, Number(s.weights?.[k])]));
    if (!keys.every((k) => Number.isFinite(w[k]) && w[k] >= 0 && w[k] <= 1)) return res.status(400).json({ error: 'Each confidence weight must be between 0 and 1' });
    if (keys.reduce((a, k) => a + w[k], 0) <= 0) return res.status(400).json({ error: 'At least one confidence weight must be positive' });
    clean.weights = w;
  }
  if (s.enrichment !== undefined) clean.enrichment = Object.fromEntries(Object.keys(DEFAULT_SETTINGS.enrichment).map((k) => [k, s.enrichment?.[k] !== false]));
  saveSettings(clean);
  log(req.user.id, 'settings.update', 'settings', null, clean);
  res.json({ settings: getSettings() });
});

export default r;
