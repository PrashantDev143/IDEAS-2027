import { Router } from 'express';
import { all, get, run, log, listMonths } from '../db.js';
import { requireAuth, requireRole, signToken, verifyPassword, publicUser, hashPassword } from '../auth.js';
import { SIGNAL_META, ALERT_TYPES } from '../engine/engine.js';
import { GOA_OUTLINE, TALUKAS } from '../sim/generator.js';

const r = Router();

// ---------------- auth ----------------
r.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const u = get('SELECT * FROM users WHERE email = ?', String(email).toLowerCase().trim());
  if (!u || !u.active || !verifyPassword(password, u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  log(u.id, 'auth.login', 'user', u.id);
  res.json({ token: signToken(u), user: publicUser(u) });
});

r.get('/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

r.post('/auth/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!verifyPassword(current || '', req.user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!next || next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
  log(req.user.id, 'auth.password', 'user', req.user.id);
  res.json({ ok: true });
});

// ---------------- public preview (landing page) ----------------
r.get('/public/preview', (req, res) => {
  const latest = get('SELECT MAX(month) m FROM cell_metrics')?.m;
  const cells = all(`SELECT c.id, c.lat_min, c.lat_max, c.lon_min, c.lon_max, c.area_km2, ROUND(m.eai, 1) eai, ROUND(m.gap_z, 2) gap_z
    FROM cells c JOIN cell_metrics m ON m.cell_id = c.id AND m.month = ?`, latest);
  const stats = get(`SELECT COUNT(*) cells, (SELECT COUNT(*) FROM alerts WHERE status IN ('open','assigned')) open_alerts,
    (SELECT COUNT(*) FROM validations) validations FROM cells`);
  res.json({ latest, cells, stats });
});

// ---------------- meta ----------------
r.get('/meta', requireAuth, (req, res) => {
  const months = listMonths();
  const lastRun = get('SELECT * FROM engine_runs ORDER BY id DESC LIMIT 1');
  res.json({
    months, latest: months[months.length - 1],
    talukas: Object.entries(TALUKAS).map(([name, district]) => ({ name, district })),
    signals: SIGNAL_META, alertTypes: ALERT_TYPES, outline: GOA_OUTLINE,
    lastRun: lastRun && { ...lastRun, model_json: undefined, model: JSON.parse(lastRun.model_json) },
    synthetic: !!get('SELECT 1 FROM datasets WHERE synthetic = 1 LIMIT 1'),
  });
});

// ---------------- cells & map ----------------
r.get('/cells', requireAuth, (req, res) => {
  res.json(all('SELECT id, code, name, taluka, district, zone, lat, lon, lat_min, lat_max, lon_min, lon_max, area_km2, tourism_share FROM cells ORDER BY id'));
});

r.get('/map/:month', requireAuth, (req, res) => {
  const rows = all(`SELECT m.cell_id id, m.eai, m.gap_z, m.gap_abs, m.yoy_activity, m.change_z, m.observed_sa, m.expected, m.registered,
      o.night_light, o.built_up, o.digital_points, o.power_connections, o.listings, o.footfall
    FROM cell_metrics m JOIN observations o ON o.cell_id = m.cell_id AND o.month = m.month WHERE m.month = ?`, req.params.month);
  const alerts = all(`SELECT a.id, a.code, a.cell_id, a.type, a.priority, a.confidence, a.status, c.lat, c.lon, c.name
    FROM alerts a JOIN cells c ON c.id = a.cell_id WHERE a.first_detected <= ? AND (a.status IN ('open','assigned') OR a.last_detected >= ?)`,
    req.params.month, req.params.month);
  res.json({ month: req.params.month, cells: rows, alerts });
});

r.get('/cells/:id', requireAuth, (req, res) => {
  const cell = get('SELECT * FROM cells WHERE id = ?', req.params.id);
  if (!cell) return res.status(404).json({ error: 'Cell not found' });
  const series = all(`SELECT o.*, m.observed, m.observed_sa, m.expected, m.gap_abs, m.gap_z, m.yoy_activity, m.yoy_registered, m.change_z, m.seasonal_index, m.eai
    FROM observations o LEFT JOIN cell_metrics m ON m.cell_id = o.cell_id AND m.month = o.month WHERE o.cell_id = ? ORDER BY o.month`, cell.id);
  const surveys = all('SELECT fy_start, estimate FROM surveys WHERE cell_id = ? ORDER BY fy_start', cell.id);
  const alerts = all('SELECT id, code, type, status, priority, confidence, first_detected, last_detected, outcome FROM alerts WHERE cell_id = ? ORDER BY id DESC', cell.id);
  const calibration = get('SELECT * FROM cell_calibration WHERE cell_id = ?', cell.id);
  res.json({ cell, series, surveys, alerts, calibration });
});

// ---------------- dashboard ----------------
r.get('/dashboard', requireAuth, (req, res) => {
  const months = listMonths();
  const latest = months[months.length - 1];
  const prev = months[months.length - 2];
  const trend = all(`SELECT m.month, SUM(m.observed_sa) observed_sa, SUM(m.expected) expected, SUM(m.registered) registered,
      SUM(m.observed) observed, AVG(m.eai) eai, SUM(o.footfall) footfall
    FROM cell_metrics m JOIN observations o ON o.cell_id = m.cell_id AND o.month = m.month GROUP BY m.month ORDER BY m.month`);
  const byStatus = Object.fromEntries(all('SELECT status, COUNT(*) n FROM alerts GROUP BY status').map((x) => [x.status, x.n]));
  const openByPriority = Object.fromEntries(all("SELECT priority, COUNT(*) n FROM alerts WHERE status IN ('open','assigned') GROUP BY priority").map((x) => [x.priority, x.n]));
  const openByType = Object.fromEntries(all("SELECT type, COUNT(*) n FROM alerts WHERE status IN ('open','assigned') GROUP BY type").map((x) => [x.type, x.n]));
  const gap = get(`SELECT SUM(CASE WHEN gap_z >= 2 THEN gap_abs ELSE 0 END) unrecorded, SUM(observed_sa) observed, SUM(registered) registered
    FROM cell_metrics WHERE month = ?`, latest);
  const v = get(`SELECT SUM(outcome IN ('confirmed')) c, SUM(outcome = 'partially_confirmed') p, COUNT(*) n FROM validations`);
  const talukas = all(`SELECT c.taluka, c.district, COUNT(*) cells, ROUND(AVG(m.eai),1) eai, ROUND(SUM(m.observed_sa)) observed_sa,
      ROUND(SUM(m.expected)) expected, SUM(m.registered) registered,
      ROUND(SUM(m.observed_sa) / NULLIF(SUM(p.observed_sa),0) - 1, 4) mom
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id
    LEFT JOIN cell_metrics p ON p.cell_id = m.cell_id AND p.month = ?
    WHERE m.month = ? GROUP BY c.taluka ORDER BY observed_sa DESC`, prev, latest);
  const ta = Object.fromEntries(all(`SELECT c.taluka, COUNT(*) n FROM alerts a JOIN cells c ON c.id = a.cell_id WHERE a.status IN ('open','assigned') GROUP BY c.taluka`).map((x) => [x.taluka, x.n]));
  for (const t of talukas) t.open_alerts = ta[t.taluka] || 0;
  const topAlerts = all(`SELECT a.id, a.code, a.type, a.priority, a.confidence, a.status, a.first_detected, a.gap_abs, a.yoy_activity, c.name, c.taluka
    FROM alerts a JOIN cells c ON c.id = a.cell_id WHERE a.status IN ('open','assigned') ORDER BY a.priority_score DESC LIMIT 8`);
  const recent = all(`SELECT l.*, u.name user_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.action != 'auth.login' ORDER BY l.created_at DESC, l.id DESC LIMIT 10`);
  res.json({
    latest, cellsMonitored: get('SELECT COUNT(*) n FROM cells').n, trend, byStatus, openByPriority, openByType,
    unrecordedEstimate: Math.round(gap?.unrecorded || 0), observedTotal: Math.round(gap?.observed || 0), registeredTotal: gap?.registered || 0,
    precision: v.n ? (v.c + 0.5 * v.p) / v.n : null, validations: v.n, talukas, topAlerts, recent,
  });
});

// ---------------- analytics ----------------
r.get('/analytics', requireAuth, (req, res) => {
  const byType = all(`SELECT a.type, COUNT(*) n, SUM(v.outcome='confirmed') confirmed, SUM(v.outcome='partially_confirmed') partial,
      SUM(v.outcome='explained') explained, SUM(v.outcome='false_positive') false_positive, SUM(v.outcome='data_issue') data_issue
    FROM validations v JOIN alerts a ON a.id = v.alert_id GROUP BY a.type`);
  const calibration = all(`SELECT CAST(a.confidence / 20 AS INT) * 20 band, COUNT(*) n,
      SUM(v.outcome='confirmed') + 0.5 * SUM(v.outcome='partially_confirmed') hits
    FROM validations v JOIN alerts a ON a.id = v.alert_id GROUP BY band ORDER BY band`);
  const groundTruth = all(`SELECT a.code, c.name, a.type, ROUND(a.observed) estimated, v.establishments_found found, a.registered, v.outcome
    FROM validations v JOIN alerts a ON a.id = v.alert_id JOIN cells c ON c.id = a.cell_id WHERE v.establishments_found IS NOT NULL ORDER BY v.created_at DESC`);
  const seasonality = all(`SELECT c.zone, CAST(substr(m.month, 6, 2) AS INT) cal_month, ROUND(AVG(m.seasonal_index), 3) si
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id GROUP BY c.zone, cal_month ORDER BY c.zone, cal_month`);
  const latest = get('SELECT MAX(month) m FROM cell_metrics').m;
  const growth = all(`SELECT c.taluka, ROUND(SUM(m.observed_sa)) observed_sa,
      ROUND(AVG(m.yoy_activity), 4) yoy_activity, ROUND(AVG(m.yoy_registered), 4) yoy_registered
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id WHERE m.month = ? GROUP BY c.taluka ORDER BY yoy_activity DESC`, latest);
  const zones = all(`SELECT c.zone, COUNT(*) cells, ROUND(SUM(m.observed_sa)) observed_sa, ROUND(SUM(m.expected)) expected, SUM(m.registered) registered
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id WHERE m.month = ? GROUP BY c.zone ORDER BY observed_sa DESC`, latest);
  const runs = all('SELECT id, month, started_at, duration_ms, cells, alerts_created, alerts_updated, model_json FROM engine_runs ORDER BY id DESC LIMIT 1')
    .map((x) => ({ ...x, model: JSON.parse(x.model_json), model_json: undefined }));
  const calibratedCells = all(`SELECT k.cell_id, c.name, c.taluka, ROUND(k.offset, 3) offset, k.reason, k.updated_at
    FROM cell_calibration k JOIN cells c ON c.id = k.cell_id ORDER BY k.updated_at DESC`);
  res.json({ byType, calibration, groundTruth, seasonality, growth, zones, model: runs[0]?.model, calibratedCells, latest });
});

// ---------------- activity ----------------
r.get('/activity', requireAuth, requireRole('admin', 'analyst'), (req, res) => {
  res.json(all(`SELECT l.*, u.name user_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC, l.id DESC LIMIT 200`));
});

// ---------------- users ----------------
const ROLES = ['admin', 'analyst', 'field_officer'];
r.get('/users', requireAuth, requireRole('admin', 'analyst'), (req, res) => {
  const role = req.query.role;
  const rows = role ? all('SELECT * FROM users WHERE role = ? AND active = 1 ORDER BY name', role) : all('SELECT * FROM users ORDER BY role, name');
  const load = Object.fromEntries(all("SELECT assigned_to, COUNT(*) n FROM alerts WHERE status = 'assigned' GROUP BY assigned_to").map((x) => [x.assigned_to, x.n]));
  res.json(rows.map((u) => ({ ...publicUser(u), open_tasks: load[u.id] || 0 })));
});

r.post('/users', requireAuth, requireRole('admin'), (req, res) => {
  const { name, email, password, role, taluka } = req.body || {};
  if (!name || !email || !password || !ROLES.includes(role)) return res.status(400).json({ error: 'name, email, password and a valid role are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (get('SELECT 1 FROM users WHERE email = ?', email.toLowerCase())) return res.status(409).json({ error: 'A user with this email already exists' });
  const x = run('INSERT INTO users (name, email, password_hash, role, taluka) VALUES (?,?,?,?,?)', name.trim(), email.toLowerCase().trim(), hashPassword(password), role, taluka || null);
  log(req.user.id, 'user.create', 'user', Number(x.lastInsertRowid), { email, role });
  res.status(201).json(publicUser(get('SELECT * FROM users WHERE id = ?', x.lastInsertRowid)));
});

r.patch('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const { name, role, taluka, active, password } = req.body || {};
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (u.id === req.user.id && (active === false || (role && role !== 'admin'))) return res.status(400).json({ error: 'You cannot demote or deactivate your own account' });
  if (password && password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  run('UPDATE users SET name = ?, role = ?, taluka = ?, active = ? WHERE id = ?',
    name ?? u.name, role ?? u.role, taluka === undefined ? u.taluka : taluka || null, active === undefined ? u.active : active ? 1 : 0, u.id);
  if (password) run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), u.id);
  log(req.user.id, 'user.update', 'user', u.id, { role, active, taluka, passwordReset: !!password });
  res.json(publicUser(get('SELECT * FROM users WHERE id = ?', u.id)));
});

export default r;
