import { Router } from 'express';
import multer from 'multer';
import { all, get, log, getSettings, saveSettings, DEFAULT_SETTINGS } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { runEngine } from '../engine/engine.js';
import { ingestNextMonth, importObservationsCsv } from '../datasets.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

r.get('/datasets', requireAuth, (req, res) => {
  const counts = get('SELECT COUNT(*) n, MIN(month) first, MAX(month) last FROM observations');
  const surveys = get('SELECT COUNT(*) n, MIN(fy_start) first, MAX(fy_start) last FROM surveys');
  res.json({
    datasets: all('SELECT * FROM datasets ORDER BY category, name').map((d) => ({
      ...d,
      records: d.key === 'survey_estimate' ? surveys.n : counts.n,
      coverage: d.key === 'survey_estimate' ? `FY ${surveys.first}-${String(surveys.last + 1).slice(2)} … FY ${surveys.last}-${String(surveys.last + 1).slice(2)}` : `${counts.first} … ${counts.last}`,
    })),
  });
});

r.get('/datasets/template.csv', requireAuth, (req, res) => {
  const cells = all('SELECT code FROM cells ORDER BY id LIMIT 3');
  const last = get('SELECT MAX(month) m FROM observations').m;
  const lines = ['cell_code,month,metric,value'];
  for (const c of cells) lines.push(`${c.code},${last},registered,120`, `${c.code},${last},night_light,4.2`);
  lines.push(`${cells[0].code},2025-04,survey_estimate,165`);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="econoscope-upload-template.csv"');
  res.send(lines.join('\n'));
});

r.get('/datasets/cells.csv', requireAuth, (req, res) => {
  const rows = all('SELECT code, name, taluka, district, zone, lat, lon, lat_min, lat_max, lon_min, lon_max, area_km2 FROM cells ORDER BY id');
  const cols = Object.keys(rows[0]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="econoscope-cells.csv"');
  res.send([cols.join(','), ...rows.map((x) => cols.map((c) => (/[",]/.test(String(x[c])) ? `"${x[c]}"` : x[c])).join(','))].join('\n'));
});

r.post('/datasets/upload', requireAuth, requireRole('admin', 'analyst'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a CSV file in the "file" field' });
  const result = importObservationsCsv(req.file.buffer.toString('utf8'));
  log(req.user.id, 'data.upload', 'dataset', null, { file: req.file.originalname, accepted: result.accepted, rejected: result.rejected });
  res.json(result);
});

r.post('/engine/run', requireAuth, requireRole('admin', 'analyst'), (req, res) => {
  res.json(runEngine({ userId: req.user.id }));
});

r.post('/engine/ingest-next', requireAuth, requireRole('admin'), (req, res) => {
  const month = ingestNextMonth();
  log(req.user.id, 'data.ingest', 'dataset', null, { month, source: 'simulated feeds' });
  const result = runEngine({ userId: req.user.id });
  res.json({ ingested: month, ...result });
});

r.get('/engine/runs', requireAuth, (req, res) => {
  res.json(all(`SELECT e.id, e.month, e.started_at, e.duration_ms, e.cells, e.alerts_created, e.alerts_updated, e.model_json, u.name triggered_by
    FROM engine_runs e LEFT JOIN users u ON u.id = e.triggered_by ORDER BY e.id DESC LIMIT 30`).map((x) => {
    const m = JSON.parse(x.model_json);
    return { ...x, model_json: undefined, r2: m.r2, kappa: m.kappa, trainedOn: m.trainedOn };
  }));
});

r.get('/settings', requireAuth, (req, res) => res.json({ settings: getSettings(), defaults: DEFAULT_SETTINGS }));

r.put('/settings', requireAuth, requireRole('admin'), (req, res) => {
  const s = req.body || {};
  const num = (v, lo, hi) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;
  if (s.gap_z_threshold !== undefined && !num(s.gap_z_threshold, 1, 6)) return res.status(400).json({ error: 'gap_z_threshold must be between 1 and 6' });
  if (s.change_z_threshold !== undefined && !num(s.change_z_threshold, 1, 6)) return res.status(400).json({ error: 'change_z_threshold must be between 1 and 6' });
  if (s.min_gap_establishments !== undefined && !num(s.min_gap_establishments, 0, 5000)) return res.status(400).json({ error: 'min_gap_establishments must be between 0 and 5000' });
  if (s.min_change_pct !== undefined && !num(s.min_change_pct, 0, 2)) return res.status(400).json({ error: 'min_change_pct must be between 0 and 2' });
  if (s.cooldown_months !== undefined && !num(s.cooldown_months, 0, 24)) return res.status(400).json({ error: 'cooldown_months must be between 0 and 24' });
  if (s.weights) {
    const w = s.weights;
    if (!['agreement', 'magnitude', 'persistence', 'isolation'].every((k) => num(w[k], 0, 1))) return res.status(400).json({ error: 'Each weight must be between 0 and 1' });
    if (w.agreement + w.magnitude + w.persistence + w.isolation <= 0) return res.status(400).json({ error: 'At least one weight must be positive' });
  }
  const clean = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (s[k] !== undefined) clean[k] = k === 'weights'
    ? Object.fromEntries(Object.entries(s.weights).map(([a, b]) => [a, Number(b)])) : Number(s[k]);
  saveSettings(clean);
  log(req.user.id, 'settings.update', 'settings', null, clean);
  res.json({ settings: getSettings() });
});

export default r;
