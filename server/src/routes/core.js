import { Router } from 'express';
import { all, get, run, log, listMonths, getSettings, ROLES } from '../db.js';
import { requireAuth, requireRole, signToken, verifyPassword, publicUser, hashPassword } from '../auth.js';
import { SIGNAL_META, ALERT_TYPES, TRAITS } from '../engine/engine.js';
import { GOA_OUTLINE, TALUKAS } from '../sim/generator.js';

const r = Router();
export const READERS = ['admin', 'analyst', 'planner', 'auditor']; // everyone except field officers
export const DISCLAIMER = 'Scores are zone-level anomalies to validate. They are not findings about any business or person, and must not be used as inspection quotas.';

// Small-cell suppression: where the recorded count is below the minimum cell size, nothing that
// could point to an individual business leaves the API.
export function suppress(row) {
  if (!row) return row;
  // an unscored zone shows no model output at all: "insufficient data" is the whole answer
  if (row.insufficient_reason) for (const k of ['expected', 'exp_lo', 'exp_hi', 'gap_abs', 'gap_z']) if (k in row) row[k] = null;
  if (row.insufficient_reason === 'suppressed') {
    for (const k of ['registered', 'yoy_registered']) if (k in row) row[k] = null;
    row.suppressed = true;
  }
  return row;
}
const csvCell = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const toCsv = (cols, rows, notes = []) => [...notes.map((n) => `# ${n}`), cols.join(','), ...rows.map((x) => cols.map((c) => csvCell(typeof x[c] === 'number' && !Number.isInteger(x[c]) ? Math.round(x[c] * 1000) / 1000 : x[c])).join(','))].join('\n');

// ---------------- auth ----------------
r.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const u = get('SELECT * FROM users WHERE email = ?', String(email).toLowerCase().trim());
  if (!u || !u.active || !verifyPassword(String(password), u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
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
  const cells = all(`SELECT c.id, c.lat_min, c.lat_max, c.lon_min, c.lon_max, c.area_km2, ROUND(m.eai, 1) eai, ROUND(m.gap_z, 2) gap_z, m.insufficient
    FROM cells c JOIN cell_metrics m ON m.cell_id = c.id AND m.month = ?`, latest);
  const stats = get(`SELECT COUNT(*) cells, (SELECT COUNT(*) FROM alerts WHERE status IN ('open','assigned') AND is_control = 0) open_alerts,
    (SELECT COUNT(*) FROM validations) validations FROM cells`);
  res.json({ latest, cells, stats });
});

// ---------------- meta ----------------
r.get('/meta', requireAuth, (req, res) => {
  const months = listMonths();
  const lastRun = get('SELECT * FROM engine_runs ORDER BY id DESC LIMIT 1');
  const s = getSettings();
  res.json({
    months, latest: months[months.length - 1],
    talukas: Object.entries(TALUKAS).map(([name, district]) => ({ name, district })),
    districts: [...new Set(Object.values(TALUKAS))],
    signals: SIGNAL_META, alertTypes: ALERT_TYPES, traits: TRAITS, outline: GOA_OUTLINE, roles: ROLES,
    peerGroups: all('SELECT id, name, description, n FROM peer_groups ORDER BY id'),
    thresholds: { gap_z: s.gap_z_threshold, change_z: s.change_z_threshold, min_coverage: s.min_coverage, min_cell_count: s.min_cell_count, min_gap: s.min_gap_establishments, tier_high: s.tier_high, tier_medium: s.tier_medium },
    lastRun: lastRun && { ...lastRun, model_json: undefined, model: JSON.parse(lastRun.model_json) },
    synthetic: !!get('SELECT 1 FROM datasets WHERE synthetic = 1 LIMIT 1'),
    disclaimer: DISCLAIMER,
  });
});

// ---------------- zones & map ----------------
r.get('/cells', requireAuth, (req, res) => {
  res.json(all(`SELECT id, code, name, taluka, district, zone, lat, lon, lat_min, lat_max, lon_min, lon_max, area_km2, tourism_share,
    sensitive, peer_group_id FROM cells ORDER BY id`));
});

r.get('/map/:month', requireAuth, (req, res) => {
  const rows = all(`SELECT m.cell_id id, m.eai, m.observed, m.observed_sa, m.registered, m.expected, m.gap_abs, m.gap_z, m.yoy_activity, m.change_z,
      m.coverage, m.insufficient, m.insufficient_reason, m.confidence, m.priority, m.tier, m.district_rank, m.spatial_class, m.gap_trend,
      o.night_light, o.built_up, o.listings, o.footfall
    FROM cell_metrics m JOIN observations o ON o.cell_id = m.cell_id AND o.month = m.month WHERE m.month = ?`, req.params.month).map(suppress);
  const mine = req.user.role === 'field_officer' ? 'AND a.assigned_to = ?' : '';
  const alerts = all(`SELECT a.id, a.code, a.cell_id, a.type, a.priority, a.confidence, a.status, c.lat, c.lon, c.name
    FROM alerts a JOIN cells c ON c.id = a.cell_id
    WHERE a.is_control = 0 AND a.first_detected <= ? AND (a.status IN ('open','assigned') OR a.last_detected >= ?) ${mine}`,
    ...[req.params.month, req.params.month, ...(mine ? [req.user.id] : [])]);
  res.json({ month: req.params.month, cells: rows, alerts });
});

// Zone evidence card
r.get('/cells/:id', requireAuth, (req, res) => {
  const cell = get('SELECT * FROM cells WHERE id = ?', req.params.id);
  if (!cell) return res.status(404).json({ error: 'Zone not found' });
  const series = all(`SELECT o.month, o.night_light, o.built_up, o.digital_points, o.power_connections, o.listings, o.footfall,
      m.observed, m.observed_sa, m.registered, m.expected, m.exp_lo, m.exp_hi, m.gap_abs, m.gap_z, m.yoy_activity, m.yoy_registered, m.change_z,
      m.seasonal_index, m.eai, m.coverage, m.insufficient, m.insufficient_reason, m.confidence, m.priority, m.tier, m.district_rank,
      m.spatial_class, m.spatial_p, m.gi_z, m.gap_trend, m.changepoint_month
    FROM observations o LEFT JOIN cell_metrics m ON m.cell_id = o.cell_id AND m.month = o.month WHERE o.cell_id = ? ORDER BY o.month`, cell.id).map(suppress);
  const latest = series[series.length - 1];
  const ev = get('SELECT month, json FROM cell_evidence WHERE cell_id = ?', cell.id);
  const peer = cell.peer_group_id ? get('SELECT * FROM peer_groups WHERE id = ?', cell.peer_group_id) : null;
  const peerStats = peer && latest ? get(`SELECT COUNT(*) n, ROUND(AVG(m.registered)) avg_registered, ROUND(AVG(m.expected)) avg_expected,
      ROUND(AVG(m.eai), 1) avg_eai, SUM(m.gap_z >= 1) above, SUM(m.gap_z <= -1) below
    FROM cells c JOIN cell_metrics m ON m.cell_id = c.id AND m.month = ? WHERE c.peer_group_id = ? AND m.insufficient = 0`, latest.month, peer.id) : null;
  // seasonality lens: like-for-like peak (Nov–Feb) and off-season (Jun–Sep) baselines over the last 24 months
  const recent = series.slice(-24);
  const avg = (rows, k) => { const v = rows.map((x) => x[k]).filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const inSeason = (x, list) => list.includes(Number(x.month.slice(5)));
  const lens = [['peak', [11, 12, 1, 2]], ['off', [6, 7, 8, 9]]].map(([key, list]) => {
    const rows = recent.filter((x) => inSeason(x, list));
    return { key, months: rows.length, observed: avg(rows, 'observed'), footfall: avg(rows, 'footfall'), listings: avg(rows, 'listings'), registered: avg(rows, 'registered'), expected: avg(rows, 'expected'), gap_z: avg(rows, 'gap_z') };
  });
  const alerts = req.user.role === 'field_officer' ? [] : all(`SELECT id, code, type, status, priority, confidence, first_detected, last_detected, outcome, is_control
    FROM alerts WHERE cell_id = ? ORDER BY id DESC`, cell.id);
  log(req.user.id, 'zone.view', 'zone', cell.id);
  res.json({
    cell, series, alerts, peer: peer && { ...peer, traits: JSON.parse(peer.traits_json), traits_json: undefined, stats: peerStats },
    evidence: ev ? { month: ev.month, ...JSON.parse(ev.json) } : null, lens,
    surveys: all('SELECT fy_start, estimate FROM surveys WHERE cell_id = ? ORDER BY fy_start', cell.id),
    calibration: get('SELECT * FROM cell_calibration WHERE cell_id = ?', cell.id),
    disclaimer: DISCLAIMER,
  });
});

// Ranked zones: monthly prioritisation (rank is within district)
const ZONE_SORTS = { priority: "CASE m.tier WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, ABS(m.priority) DESC", gap: 'm.gap_z DESC', confidence: 'm.confidence DESC', rank: 'c.district, m.district_rank', activity: 'm.eai DESC', coverage: 'm.coverage ASC', name: 'c.name' };
function zoneQuery(q) {
  const month = q.month || get('SELECT MAX(month) m FROM cell_metrics')?.m;
  const where = ['m.month = ?'], p = [month];
  if (q.district) { where.push('c.district = ?'); p.push(q.district); }
  if (q.taluka) { where.push('c.taluka = ?'); p.push(q.taluka); }
  if (q.tier) { where.push('m.tier = ?'); p.push(q.tier); }
  if (q.peer) { where.push('c.peer_group_id = ?'); p.push(Number(q.peer)); }
  if (q.trend) { where.push('m.gap_trend = ?'); p.push(q.trend); }
  if (q.spatial) { where.push('m.spatial_class = ?'); p.push(q.spatial); }
  if (q.direction === 'above') where.push('m.gap_z > 0');
  if (q.direction === 'below') where.push('m.gap_z < 0');
  if (q.q) { where.push('(c.name LIKE ? OR c.code LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`); }
  const sql = `SELECT c.id, c.code, c.name, c.taluka, c.district, c.zone, c.sensitive, p.name peer_group, m.month, m.eai, m.observed_sa, m.registered, m.expected,
      m.exp_lo, m.exp_hi, m.gap_abs, m.gap_z, m.confidence, m.priority, m.tier, m.district_rank, m.coverage, m.insufficient, m.insufficient_reason,
      m.spatial_class, m.spatial_p, m.gap_trend, m.yoy_activity
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id LEFT JOIN peer_groups p ON p.id = c.peer_group_id
    WHERE ${where.join(' AND ')} ORDER BY m.insufficient, ${ZONE_SORTS[q.sort] || ZONE_SORTS.priority}`;
  return { month, sql, p };
}
r.get('/zones', requireAuth, requireRole(...READERS), (req, res) => {
  const { month, sql, p } = zoneQuery(req.query);
  const limit = Math.min(600, Number(req.query.limit) || 600);
  const rows = all(`${sql} LIMIT ${limit}`, ...p).map(suppress);
  res.json({ month, total: rows.length, rows });
});
r.get('/zones/export.csv', requireAuth, requireRole(...READERS), (req, res) => {
  const { month, sql, p } = zoneQuery(req.query);
  const rows = all(sql, ...p).map(suppress).map((x) => ({ ...x, confidence_band: x.confidence === null ? '' : x.confidence >= 70 ? 'high' : x.confidence >= 45 ? 'medium' : 'low' }));
  const cols = ['code', 'name', 'taluka', 'district', 'peer_group', 'tier', 'district_rank', 'priority', 'gap_z', 'confidence', 'confidence_band', 'coverage',
    'registered', 'expected', 'exp_lo', 'exp_hi', 'spatial_class', 'gap_trend', 'insufficient_reason'];
  log(req.user.id, 'export.zones', 'zone', null, { month, rows: rows.length, filters: req.query });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="econoscope-zones-${month}.csv"`);
  res.send(toCsv(cols, rows, [`EconoScope zone priorities, ${month}`, DISCLAIMER, 'Rank is within district. Insufficient-data zones carry no score.']));
});

// ---------------- dashboard ----------------
r.get('/dashboard', requireAuth, requireRole(...READERS), (req, res) => {
  const months = listMonths();
  const latest = get('SELECT MAX(month) m FROM cell_metrics').m;
  const trend = all(`SELECT m.month, SUM(CASE WHEN m.insufficient = 0 THEN m.registered END) registered, SUM(CASE WHEN m.insufficient = 0 THEN m.expected END) expected,
      SUM(m.observed_sa) observed_sa, SUM(m.observed) observed, AVG(m.eai) eai, SUM(o.footfall) footfall
    FROM cell_metrics m JOIN observations o ON o.cell_id = m.cell_id AND o.month = m.month GROUP BY m.month ORDER BY m.month`);
  const tiers = Object.fromEntries(all('SELECT tier, COUNT(*) n FROM cell_metrics WHERE month = ? GROUP BY tier', latest).map((x) => [x.tier, x.n]));
  const byStatus = Object.fromEntries(all('SELECT status, COUNT(*) n FROM alerts WHERE is_control = 0 GROUP BY status').map((x) => [x.status, x.n]));
  const openByPriority = Object.fromEntries(all("SELECT priority, COUNT(*) n FROM alerts WHERE status IN ('open','assigned') AND is_control = 0 GROUP BY priority").map((x) => [x.priority, x.n]));
  const openByType = Object.fromEntries(all("SELECT type, COUNT(*) n FROM alerts WHERE status IN ('open','assigned') AND is_control = 0 GROUP BY type").map((x) => [x.type, x.n]));
  const emerging = get("SELECT COUNT(*) n FROM cell_metrics WHERE month = ? AND gap_trend IN ('new','growing') AND gap_z >= 1.5", latest).n;
  const hits = (ctl) => get(`SELECT COUNT(*) n, TOTAL(v.outcome = 'confirmed') + 0.5 * TOTAL(v.outcome = 'partially_confirmed') h
    FROM validations v JOIN alerts a ON a.id = v.alert_id WHERE a.is_control = ?`, ctl);
  const pri = hits(0), ctl = hits(1);
  const talukas = all(`SELECT c.taluka, c.district, COUNT(*) zones, ROUND(AVG(m.eai), 1) eai, SUM(m.insufficient) insufficient,
      SUM(CASE WHEN m.insufficient = 0 THEN m.registered END) registered, ROUND(SUM(CASE WHEN m.insufficient = 0 THEN m.expected END)) expected,
      SUM(m.tier = 'high') high, SUM(m.tier = 'medium') medium, ROUND(AVG(m.coverage), 3) coverage
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id WHERE m.month = ? GROUP BY c.taluka ORDER BY high DESC, medium DESC`, latest);
  const ta = Object.fromEntries(all(`SELECT c.taluka, COUNT(*) n FROM alerts a JOIN cells c ON c.id = a.cell_id WHERE a.status IN ('open','assigned') AND a.is_control = 0 GROUP BY c.taluka`).map((x) => [x.taluka, x.n]));
  for (const t of talukas) t.open_alerts = ta[t.taluka] || 0;
  const topAlerts = all(`SELECT a.id, a.code, a.type, a.priority, a.priority_score, a.confidence, a.status, a.first_detected, a.gap_trend, a.sensitive, c.name, c.taluka
    FROM alerts a JOIN cells c ON c.id = a.cell_id WHERE a.status IN ('open','assigned') AND a.is_control = 0 ORDER BY a.priority_score DESC LIMIT 8`);
  const recent = all(`SELECT l.*, u.name user_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.action NOT IN ('auth.login', 'zone.view', 'alert.view') ORDER BY l.created_at DESC, l.id DESC LIMIT 10`);
  res.json({
    latest, dataThrough: months[months.length - 1], zones: get('SELECT COUNT(*) n FROM cells').n, tiers, trend, byStatus, openByPriority, openByType, emerging,
    hitRate: pri.n ? pri.h / pri.n : null, controlRate: ctl.n ? ctl.h / ctl.n : null, validations: pri.n, controls: ctl.n,
    talukas, topAlerts, recent,
  });
});

// in-app notifications: flags raised or newly emerging in the latest run
r.get('/notifications', requireAuth, requireRole(...READERS), (req, res) => {
  const latest = get('SELECT MAX(month) m FROM cell_metrics')?.m;
  const rows = all(`SELECT a.id, a.code, a.type, a.priority, a.confidence, a.gap_trend, a.first_detected, c.name, c.taluka,
      CASE WHEN a.first_detected = ? THEN 'new' ELSE 'emerging' END reason
    FROM alerts a JOIN cells c ON c.id = a.cell_id
    WHERE a.is_control = 0 AND a.status IN ('open','assigned') AND (a.first_detected = ? OR (a.last_detected = ? AND a.gap_trend IN ('new','growing')))
    ORDER BY a.priority_score DESC LIMIT 25`, latest, latest, latest);
  res.json({ month: latest, rows });
});

// ---------------- activity ----------------
r.get('/activity', requireAuth, requireRole('admin', 'auditor'), (req, res) => {
  const where = [], p = [];
  if (req.query.action) { where.push('l.action LIKE ?'); p.push(`${req.query.action}%`); }
  if (req.query.user) { where.push('l.user_id = ?'); p.push(Number(req.query.user)); }
  res.json(all(`SELECT l.*, u.name user_name, u.role user_role FROM activity_log l LEFT JOIN users u ON u.id = l.user_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.created_at DESC, l.id DESC LIMIT 300`, ...p));
});

// ---------------- users ----------------
r.get('/users', requireAuth, requireRole('admin', 'analyst', 'auditor'), (req, res) => {
  const role = req.query.role;
  if (req.user.role === 'analyst' && role !== 'field_officer') return res.status(403).json({ error: 'You do not have permission for this action' });
  const rows = role ? all('SELECT * FROM users WHERE role = ? AND active = 1 ORDER BY name', role) : all('SELECT * FROM users ORDER BY role, name');
  const load = Object.fromEntries(all("SELECT assigned_to, COUNT(*) n FROM alerts WHERE status = 'assigned' GROUP BY assigned_to").map((x) => [x.assigned_to, x.n]));
  res.json(rows.map((u) => ({ ...publicUser(u), open_tasks: load[u.id] || 0 })));
});

r.post('/users', requireAuth, requireRole('admin'), (req, res) => {
  const { name, email, password, role, taluka } = req.body || {};
  if (!name?.trim() || !email || !password || !ROLES.includes(role)) return res.status(400).json({ error: 'name, email, password and a valid role are required' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (get('SELECT 1 FROM users WHERE email = ?', email.toLowerCase().trim())) return res.status(409).json({ error: 'A user with this email already exists' });
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
    name?.trim() || u.name, role ?? u.role, taluka === undefined ? u.taluka : taluka || null, active === undefined ? u.active : active ? 1 : 0, u.id);
  if (password) run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), u.id);
  log(req.user.id, 'user.update', 'user', u.id, { role, active, taluka, passwordReset: !!password });
  res.json(publicUser(get('SELECT * FROM users WHERE id = ?', u.id)));
});

export default r;
