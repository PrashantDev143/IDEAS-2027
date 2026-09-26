import { Router } from 'express';
import { all, get, run, log, tx } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { applyFeedback, ALERT_TYPES } from '../engine/engine.js';

const r = Router();
const STATUSES = ['open', 'assigned', 'validated', 'dismissed'];
export const OUTCOMES = {
  confirmed: 'Confirmed on ground',
  partially_confirmed: 'Partially confirmed',
  explained: 'Explained by known factor',
  false_positive: 'No anomaly found',
  data_issue: 'Data quality issue',
};
const SORTS = {
  priority: 'a.priority_score DESC', confidence: 'a.confidence DESC', recent: 'a.first_detected DESC, a.id DESC',
  gap: 'ABS(a.gap_abs) DESC', updated: 'a.updated_at DESC',
};

function buildFilter(q, user) {
  const where = [], p = [];
  if (q.status) { const s = String(q.status).split(',').filter((x) => STATUSES.includes(x)); if (s.length) { where.push(`a.status IN (${s.map(() => '?').join(',')})`); p.push(...s); } }
  if (q.type && ALERT_TYPES[q.type]) { where.push('a.type = ?'); p.push(q.type); }
  if (q.priority) { where.push('a.priority = ?'); p.push(q.priority); }
  if (q.taluka) { where.push('c.taluka = ?'); p.push(q.taluka); }
  if (q.minConfidence) { where.push('a.confidence >= ?'); p.push(Number(q.minConfidence)); }
  if (q.q) { where.push('(c.name LIKE ? OR a.code LIKE ? OR c.code LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  if (q.mine === '1' || user.role === 'field_officer') { where.push('a.assigned_to = ?'); p.push(user.id); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', p };
}

const LIST_SQL = `SELECT a.id, a.code, a.cell_id, a.type, a.status, a.priority, a.priority_score, a.confidence, a.first_detected, a.last_detected,
  a.still_active, a.observed, a.expected, a.registered, a.gap_abs, a.gap_pct, a.yoy_activity, a.yoy_registered, a.outcome, a.updated_at,
  c.name, c.code cell_code, c.taluka, c.district, c.zone, c.lat, c.lon, u.name assignee
  FROM alerts a JOIN cells c ON c.id = a.cell_id LEFT JOIN users u ON u.id = a.assigned_to`;

r.get('/alerts', requireAuth, (req, res) => {
  const { sql, p } = buildFilter(req.query, req.user);
  const order = SORTS[req.query.sort] || SORTS.priority;
  const limit = Math.min(500, Number(req.query.limit) || 200);
  const rows = all(`${LIST_SQL} ${sql} ORDER BY ${order} LIMIT ${limit}`, ...p);
  const total = get(`SELECT COUNT(*) n FROM alerts a JOIN cells c ON c.id = a.cell_id ${sql}`, ...p).n;
  res.json({ total, rows });
});

r.get('/alerts/export.csv', requireAuth, (req, res) => {
  const { sql, p } = buildFilter(req.query, req.user);
  const rows = all(`${LIST_SQL} ${sql} ORDER BY a.priority_score DESC`, ...p);
  const cols = ['code', 'type', 'status', 'priority', 'confidence', 'name', 'cell_code', 'taluka', 'district', 'lat', 'lon', 'first_detected', 'last_detected',
    'observed', 'expected', 'registered', 'gap_abs', 'gap_pct', 'yoy_activity', 'yoy_registered', 'outcome', 'assignee'];
  const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const round = (v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v);
  const body = [cols.join(','), ...rows.map((x) => cols.map((c) => esc(round(x[c]))).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="econoscope-alerts.csv"');
  res.send(body);
});

r.get('/alerts/:id', requireAuth, (req, res) => {
  const a = get(`${LIST_SQL} WHERE a.id = ?`, req.params.id);
  if (!a) return res.status(404).json({ error: 'Alert not found' });
  const full = get('SELECT signals_json, confidence_json, explanation, assigned_to, resolved_at, created_at, gap_z, change_z FROM alerts WHERE id = ?', a.id);
  if (req.user.role === 'field_officer' && full.assigned_to !== req.user.id) return res.status(403).json({ error: 'This alert is not assigned to you' });
  const series = all(`SELECT m.month, m.observed, m.observed_sa, m.expected, m.registered, m.gap_z, m.change_z, m.eai, o.night_light, o.digital_points, o.footfall, o.listings, o.power_connections, o.built_up
    FROM cell_metrics m JOIN observations o ON o.cell_id = m.cell_id AND o.month = m.month WHERE m.cell_id = ? ORDER BY m.month`, a.cell_id);
  const validations = all(`SELECT v.*, u.name officer FROM validations v JOIN users u ON u.id = v.officer_id WHERE v.alert_id = ? ORDER BY v.created_at DESC`, a.id);
  const history = all(`SELECT l.*, u.name user_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.entity = 'alert' AND l.entity_id = ? ORDER BY l.created_at DESC, l.id DESC`, a.id);
  const cell = get('SELECT * FROM cells WHERE id = ?', a.cell_id);
  const neighbours = all(`SELECT c.id, c.name, ROUND(m.gap_z, 2) gap_z, ROUND(m.change_z, 2) change_z, ROUND(m.eai, 1) eai FROM cells c
    JOIN cell_metrics m ON m.cell_id = c.id AND m.month = ? WHERE c.id != ? AND ABS(c.lat - ?) < 0.03 AND ABS(c.lon - ?) < 0.03`, a.last_detected, a.cell_id, cell.lat, cell.lon);
  res.json({
    ...a, ...full, cell, signals: JSON.parse(full.signals_json || '[]'), confidenceBreakdown: JSON.parse(full.confidence_json || '{}'),
    signals_json: undefined, confidence_json: undefined, series, validations, history, neighbours,
  });
});

r.patch('/alerts/:id', requireAuth, requireRole('admin', 'analyst'), (req, res) => {
  const a = get('SELECT * FROM alerts WHERE id = ?', req.params.id);
  if (!a) return res.status(404).json({ error: 'Alert not found' });
  const { status, assigned_to, note, outcome } = req.body || {};
  const changes = {};
  tx(() => {
    if (assigned_to !== undefined) {
      if (assigned_to !== null) {
        const officer = get("SELECT id, role FROM users WHERE id = ? AND active = 1", assigned_to);
        if (!officer || officer.role !== 'field_officer') throw Object.assign(new Error('Alerts can only be assigned to an active field officer'), { status: 400 });
      }
      run("UPDATE alerts SET assigned_to = ?, status = ?, updated_at = datetime('now') WHERE id = ?", assigned_to, assigned_to ? 'assigned' : 'open', a.id);
      changes.assigned_to = assigned_to; changes.status = assigned_to ? 'assigned' : 'open';
      log(req.user.id, assigned_to ? 'alert.assign' : 'alert.unassign', 'alert', a.id, { assigned_to });
    }
    if (status && status !== changes.status) {
      if (!STATUSES.includes(status)) throw Object.assign(new Error('Invalid status'), { status: 400 });
      if (status === 'dismissed') {
        const o = outcome && OUTCOMES[outcome] ? outcome : 'false_positive';
        run("UPDATE alerts SET status = 'dismissed', outcome = ?, resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", o, a.id);
        const offset = applyFeedback(a, o);
        log(req.user.id, 'alert.dismiss', 'alert', a.id, { outcome: o, note, calibration: offset });
      } else if (status === 'open') {
        run("UPDATE alerts SET status = 'open', assigned_to = NULL, outcome = NULL, resolved_at = NULL, updated_at = datetime('now') WHERE id = ?", a.id);
        log(req.user.id, 'alert.reopen', 'alert', a.id, { note });
      } else {
        run("UPDATE alerts SET status = ?, updated_at = datetime('now') WHERE id = ?", status, a.id);
        log(req.user.id, 'alert.status', 'alert', a.id, { status, note });
      }
    } else if (note) log(req.user.id, 'alert.note', 'alert', a.id, { note });
  });
  res.json({ ok: true });
});

r.post('/alerts/:id/validations', requireAuth, (req, res) => {
  const a = get('SELECT * FROM alerts WHERE id = ?', req.params.id);
  if (!a) return res.status(404).json({ error: 'Alert not found' });
  if (req.user.role === 'field_officer' && a.assigned_to !== req.user.id) return res.status(403).json({ error: 'This alert is not assigned to you' });
  if (!['open', 'assigned'].includes(a.status)) return res.status(409).json({ error: 'This alert has already been closed' });
  const { outcome, establishments_found, unregistered_found, notes, lat, lon, visited_on } = req.body || {};
  if (!OUTCOMES[outcome]) return res.status(400).json({ error: 'A valid outcome is required' });
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const found = num(establishments_found), unreg = num(unregistered_found);
  if ([found, unreg].some((v) => v !== null && (!Number.isInteger(v) || v < 0))) return res.status(400).json({ error: 'Counts must be whole numbers ≥ 0' });
  if (unreg !== null && found !== null && unreg > found) return res.status(400).json({ error: 'Unregistered units cannot exceed establishments found' });
  let offset = null;
  tx(() => {
    run(`INSERT INTO validations (alert_id, officer_id, outcome, establishments_found, unregistered_found, notes, lat, lon, visited_on)
         VALUES (?,?,?,?,?,?,?,?,?)`, a.id, req.user.id, outcome, found, unreg, notes || null, num(lat), num(lon), visited_on || new Date().toISOString().slice(0, 10));
    const status = ['confirmed', 'partially_confirmed'].includes(outcome) ? 'validated' : 'dismissed';
    run("UPDATE alerts SET status = ?, outcome = ?, resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", status, outcome, a.id);
    offset = applyFeedback(a, outcome);
    log(req.user.id, 'alert.validate', 'alert', a.id, { outcome, establishments_found: found, calibration: offset });
  });
  res.status(201).json({ ok: true, calibration: offset });
});

r.get('/outcomes', requireAuth, (req, res) => res.json(OUTCOMES));

export default r;
