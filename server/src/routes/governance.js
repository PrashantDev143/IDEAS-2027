import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, log, tx, getSettings } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { createControlSample } from '../audit.js';
import { READERS, DISCLAIMER, suppress } from './core.js';

const r = Router();
const HIT = "TOTAL(v.outcome = 'confirmed') + 0.5 * TOTAL(v.outcome = 'partially_confirmed')";
const latestMonth = () => get('SELECT MAX(month) m FROM cell_metrics')?.m;

// ---------------- success metrics (PRD section 4) ----------------
export function successMetrics() {
  const latest = latestMonth();
  const rate = (where) => get(`SELECT COUNT(*) n, ${HIT} h FROM validations v JOIN alerts a ON a.id = v.alert_id WHERE ${where}`);
  const top = rate("a.is_control = 0 AND a.priority = 'high'");
  const pri = rate('a.is_control = 0');
  const ctl = rate('a.is_control = 1');
  const pr = (x) => (x.n ? x.h / x.n : null);
  const lift = pr(pri) !== null && pr(ctl) ? pr(pri) / pr(ctl) : null;
  // share of flags in tourist / transit-type zones that field teams marked "legitimately busy", by quarter
  const burden = all(`SELECT substr(v.visited_on, 1, 4) || '-Q' || ((CAST(substr(v.visited_on, 6, 2) AS INT) + 2) / 3) quarter,
      COUNT(*) n, SUM(v.outcome = 'legitimately_busy') busy
    FROM validations v JOIN alerts a ON a.id = v.alert_id JOIN cells c ON c.id = a.cell_id
    WHERE a.is_control = 0 AND (c.zone IN ('coastal', 'heritage') OR c.tourism_share >= 0.3) GROUP BY quarter ORDER BY quarter`);
  // calibration: stated confidence band vs observed confirmation rate
  const bands = all(`SELECT CASE WHEN a.confidence >= 70 THEN 'high' WHEN a.confidence >= 45 THEN 'medium' ELSE 'low' END band,
      COUNT(*) n, ${HIT} h, AVG(a.confidence) stated
    FROM validations v JOIN alerts a ON a.id = v.alert_id WHERE a.is_control = 0 GROUP BY band`)
    .map((b) => ({ band: b.band, n: b.n, observed: b.h / b.n, stated: b.stated / 100, diff: b.h / b.n - b.stated / 100, within: Math.abs(b.h / b.n - b.stated / 100) <= 0.1 }));
  const flags = get(`SELECT COUNT(*) n, SUM(explanation IS NOT NULL AND explanation != '' AND signals_json != '[]' AND coverage IS NOT NULL AND peer_group IS NOT NULL) complete
    FROM alerts WHERE is_control = 0`);
  const dataMonth = get('SELECT MAX(month) m FROM observations').m;
  const users = get("SELECT COUNT(*) n FROM users WHERE active = 1 AND role != 'admin'").n;
  const month = new Date().toISOString().slice(0, 7);
  const active = get(`SELECT COUNT(DISTINCT l.user_id) n FROM activity_log l JOIN users u ON u.id = l.user_id
    WHERE u.role != 'admin' AND substr(l.created_at, 1, 7) = ? AND l.action NOT IN ('auth.login')`, month).n;
  return {
    latest,
    hitRate: { topTier: pr(top), topN: top.n, prioritised: pr(pri), n: pri.n, control: pr(ctl), controlN: ctl.n },
    lift: { value: lift, target: 1.5, met: lift !== null && lift > 1.5 },
    falsePositiveBurden: burden.map((b) => ({ quarter: b.quarter, n: b.n, share: b.n ? b.busy / b.n : null })),
    calibration: { bands, target: 0.1, met: bands.length > 0 && bands.every((b) => b.within) },
    explainability: { share: flags.n ? flags.complete / flags.n : null, n: flags.n, target: 1 },
    freshness: { dataMonth, scoredMonth: latest, upToDate: dataMonth === latest },
    adoption: { activeThisMonth: active, trainedUsers: users, share: users ? active / users : null },
    formalisation: { measurable: false, note: 'Needs real post-visit registration data from a pilot partner. The demo dataset is synthetic and does not react to visits, so this is not reported.' },
  };
}
r.get('/metrics', requireAuth, requireRole(...READERS), (req, res) => res.json(successMetrics()));

// ---------------- analytics & model ----------------
r.get('/analytics', requireAuth, requireRole(...READERS), (req, res) => {
  const latest = latestMonth();
  const byType = all(`SELECT a.type, COUNT(*) n, SUM(v.outcome='confirmed') confirmed, SUM(v.outcome='partially_confirmed') partial,
      SUM(v.outcome='legitimately_busy') legitimately_busy, SUM(v.outcome='new_development') new_development, SUM(v.outcome='no_gap') no_gap, SUM(v.outcome='data_issue') data_issue
    FROM validations v JOIN alerts a ON a.id = v.alert_id GROUP BY a.type`);
  const groundTruth = all(`SELECT a.code, c.name, a.type, a.is_control, ROUND(a.expected) expected, v.establishments_found found, a.registered, v.outcome
    FROM validations v JOIN alerts a ON a.id = v.alert_id JOIN cells c ON c.id = a.cell_id WHERE v.establishments_found IS NOT NULL ORDER BY v.created_at DESC`);
  const seasonality = all(`SELECT c.zone, CAST(substr(m.month, 6, 2) AS INT) cal_month, ROUND(AVG(m.seasonal_index), 3) si
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id GROUP BY c.zone, cal_month ORDER BY c.zone, cal_month`);
  const growth = all(`SELECT c.taluka, ROUND(AVG(m.yoy_activity), 4) yoy_activity, ROUND(AVG(m.yoy_registered), 4) yoy_registered
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id WHERE m.month = ? AND m.insufficient = 0 GROUP BY c.taluka ORDER BY yoy_activity DESC`, latest);
  const peers = all(`SELECT p.id, p.name, p.n, p.traits_json, SUM(m.insufficient = 0) scored, SUM(m.tier = 'high') high, SUM(m.tier = 'medium') medium,
      ROUND(SUM(CASE WHEN m.insufficient = 0 THEN m.registered END)) registered, ROUND(SUM(CASE WHEN m.insufficient = 0 THEN m.expected END)) expected
    FROM peer_groups p JOIN cells c ON c.peer_group_id = p.id JOIN cell_metrics m ON m.cell_id = c.id AND m.month = ? GROUP BY p.id ORDER BY p.id`, latest)
    .map((p) => ({ ...p, ...JSON.parse(p.traits_json), traits_json: undefined }));
  const model = get('SELECT model_json, inputs_hash, month FROM engine_runs ORDER BY id DESC LIMIT 1');
  const calibratedCells = all(`SELECT k.cell_id, c.name, c.taluka, ROUND(k.offset, 3) offset, k.reason, k.updated_at
    FROM cell_calibration k JOIN cells c ON c.id = k.cell_id ORDER BY k.updated_at DESC`);
  res.json({ latest, byType, groundTruth, seasonality, growth, peers, calibratedCells, metrics: successMetrics(),
    model: model && { ...JSON.parse(model.model_json), inputsHash: model.inputs_hash } });
});

// ---------------- bias & coverage, governance ----------------
r.get('/governance', requireAuth, requireRole(...READERS), (req, res) => {
  const latest = latestMonth();
  const s = getSettings();
  const overall = get(`SELECT COUNT(*) zones, SUM(insufficient = 0) scored, SUM(tier IN ('high', 'medium')) flagged FROM cell_metrics WHERE month = ?`, latest);
  const overallRate = overall.scored ? overall.flagged / overall.scored : 0;
  const withReview = (rows) => rows.map((x) => {
    const rate = x.scored ? x.flagged / x.scored : null;
    const confirm = x.validated ? x.hits / x.validated : null;
    // a zone type flagged far more often than average, with no field confirmation behind it, blocks release
    const skewed = rate !== null && x.scored >= 10 && rate > Math.max(2 * overallRate, 0.15) && !(confirm !== null && confirm >= 0.5);
    return { ...x, rate, confirmRate: confirm, skewed };
  });
  const VAL = `LEFT JOIN (SELECT a.cell_id, COUNT(*) n, ${HIT} h FROM validations v JOIN alerts a ON a.id = v.alert_id WHERE a.is_control = 0 GROUP BY a.cell_id) x ON x.cell_id = c.id`;
  const byZone = withReview(all(`SELECT c.zone grp, COUNT(*) zones, SUM(m.insufficient = 0) scored, SUM(m.tier IN ('high','medium')) flagged, SUM(m.tier = 'high') high,
      SUM(m.insufficient) insufficient, ROUND(AVG(m.coverage), 3) coverage, TOTAL(x.n) validated, TOTAL(x.h) hits
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id ${VAL} WHERE m.month = ? GROUP BY c.zone ORDER BY zones DESC`, latest));
  const byQuality = withReview(all(`SELECT CASE WHEN m.coverage >= 0.95 THEN 'Complete (95%+)' WHEN m.coverage >= 0.8 THEN 'Good (80–95%)' WHEN m.coverage >= ? THEN 'Partial' ELSE 'Below minimum' END grp,
      COUNT(*) zones, SUM(m.insufficient = 0) scored, SUM(m.tier IN ('high','medium')) flagged, SUM(m.tier = 'high') high,
      SUM(m.insufficient) insufficient, ROUND(AVG(m.coverage), 3) coverage, TOTAL(x.n) validated, TOTAL(x.h) hits
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id ${VAL} WHERE m.month = ? GROUP BY grp ORDER BY coverage DESC`, s.min_coverage, latest));
  const byPeer = withReview(all(`SELECT p.name grp, COUNT(*) zones, SUM(m.insufficient = 0) scored, SUM(m.tier IN ('high','medium')) flagged, SUM(m.tier = 'high') high,
      SUM(m.insufficient) insufficient, ROUND(AVG(m.coverage), 3) coverage, TOTAL(x.n) validated, TOTAL(x.h) hits
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id JOIN peer_groups p ON p.id = c.peer_group_id ${VAL} WHERE m.month = ? GROUP BY p.id ORDER BY p.id`, latest));
  const peerGroups = all('SELECT * FROM peer_groups ORDER BY id').map((p) => ({ ...p, ...JSON.parse(p.traits_json), traits_json: undefined }));
  const review = get(`SELECT pr.*, u.name reviewer FROM peer_group_reviews pr LEFT JOIN users u ON u.id = pr.reviewed_by WHERE pr.k = ? ORDER BY pr.id DESC LIMIT 1`, s.peer_groups_k);
  const sensitive = all(`SELECT c.id, c.name, c.taluka, m.tier, (SELECT COUNT(*) FROM alerts a WHERE a.cell_id = c.id AND a.status IN ('open','assigned')) open_flags
    FROM cells c JOIN cell_metrics m ON m.cell_id = c.id AND m.month = ? WHERE c.sensitive = 1 ORDER BY c.name`, latest);
  const insufficient = all(`SELECT insufficient_reason reason, COUNT(*) n FROM cell_metrics WHERE month = ? AND insufficient = 1 GROUP BY 1`, latest);
  const lastRun = get('SELECT model_json FROM engine_runs ORDER BY id DESC LIMIT 1');
  const skew = [...byZone, ...byQuality, ...byPeer].filter((x) => x.skewed).map((x) => x.grp);
  res.json({
    latest, overall: { ...overall, rate: overallRate }, byZone, byQuality, byPeer, peerGroups, peerReview: review || null, sensitive, insufficient,
    suppressedSingleSignal: lastRun ? JSON.parse(lastRun.model_json).suppressedSingleSignal : 0,
    release: { peerGroupsReviewed: !!review, skewedGroups: skew, ready: !!review && skew.length === 0 },
    settings: { min_coverage: s.min_coverage, min_cell_count: s.min_cell_count, peer_groups_k: s.peer_groups_k },
  });
});

r.post('/governance/peer-review', requireAuth, requireRole('admin', 'auditor'), (req, res) => {
  const note = String(req.body?.note || '').trim();
  if (note.length < 10) return res.status(400).json({ error: 'Add a short review note (at least 10 characters) describing what was checked' });
  const k = getSettings().peer_groups_k;
  const x = run('INSERT INTO peer_group_reviews (k, reviewed_by, note) VALUES (?,?,?)', k, req.user.id, note);
  log(req.user.id, 'governance.peer_review', 'peer_groups', Number(x.lastInsertRowid), { k, note });
  res.status(201).json({ ok: true });
});

// ---------------- randomised audit sample ----------------
r.get('/audit-sample', requireAuth, requireRole(...READERS), (req, res) => {
  res.json(all(`SELECT a.id, a.code, a.status, a.outcome, a.first_detected, a.confidence, a.gap_z, c.name, c.taluka, u.name assignee
    FROM alerts a JOIN cells c ON c.id = a.cell_id LEFT JOIN users u ON u.id = a.assigned_to WHERE a.is_control = 1 ORDER BY a.id DESC LIMIT 60`));
});
r.post('/audit-sample', requireAuth, requireRole('admin', 'analyst'), (req, res) => {
  const n = Number(req.body?.n);
  if (!Number.isInteger(n) || n < 1 || n > 30) return res.status(400).json({ error: 'Sample size must be a whole number from 1 to 30' });
  let out;
  tx(() => { out = createControlSample(n); });
  log(req.user.id, 'audit.sample', 'alert', null, { month: out.month, created: out.created });
  res.status(201).json(out);
});

// ---------------- partner API keys (zone-level outputs only) ----------------
const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');
r.get('/api-keys', requireAuth, requireRole('admin'), (req, res) => {
  res.json(all(`SELECT k.id, k.name, k.department, k.prefix, k.created_at, k.last_used, k.revoked_at, u.name created_by
    FROM api_keys k LEFT JOIN users u ON u.id = k.created_by ORDER BY k.id DESC`));
});
r.post('/api-keys', requireAuth, requireRole('admin'), (req, res) => {
  const name = String(req.body?.name || '').trim(), department = String(req.body?.department || '').trim();
  if (!name || !department) return res.status(400).json({ error: 'Name and department are required' });
  const key = `esk_${crypto.randomBytes(24).toString('hex')}`;
  const x = run('INSERT INTO api_keys (name, department, prefix, key_hash, created_by) VALUES (?,?,?,?,?)', name, department, key.slice(0, 10), hashKey(key), req.user.id);
  log(req.user.id, 'apikey.create', 'api_key', Number(x.lastInsertRowid), { name, department });
  res.status(201).json({ id: Number(x.lastInsertRowid), key, note: 'Copy this key now. It is stored hashed and cannot be shown again.' });
});
r.delete('/api-keys/:id', requireAuth, requireRole('admin'), (req, res) => {
  const k = get('SELECT * FROM api_keys WHERE id = ?', req.params.id);
  if (!k) return res.status(404).json({ error: 'Key not found' });
  run("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL", k.id);
  log(req.user.id, 'apikey.revoke', 'api_key', k.id, { name: k.name });
  res.json({ ok: true });
});

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  const row = key && get('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL', hashKey(String(key)));
  if (!row) return res.status(401).json({ error: 'A valid X-API-Key header is required' });
  run("UPDATE api_keys SET last_used = datetime('now') WHERE id = ?", row.id);
  req.apiKey = row;
  next();
}
const V1_SQL = `SELECT c.code, c.name, c.taluka, c.district, p.name peer_group, m.month, ROUND(m.eai, 1) activity_index, m.registered,
    ROUND(m.expected) expected_registered, ROUND(m.exp_lo) expected_low, ROUND(m.exp_hi) expected_high, ROUND(m.gap_z, 2) peer_relative_gap,
    ROUND(m.confidence) confidence, ROUND(m.priority, 2) priority, m.tier, m.district_rank, ROUND(m.coverage, 2) coverage, m.insufficient_reason,
    m.spatial_class, m.gap_trend
  FROM cell_metrics m JOIN cells c ON c.id = m.cell_id LEFT JOIN peer_groups p ON p.id = c.peer_group_id`;
const v1Row = (x) => { suppress(x); if (x.insufficient_reason) { x.expected_registered = x.expected_low = x.expected_high = x.peer_relative_gap = null; } return x; };
export const publicApi = Router();
publicApi.get('/zones', requireApiKey, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : latestMonth();
  const where = ['m.month = ?'], p = [month];
  if (req.query.district) { where.push('c.district = ?'); p.push(req.query.district); }
  if (req.query.taluka) { where.push('c.taluka = ?'); p.push(req.query.taluka); }
  if (req.query.tier) { where.push('m.tier = ?'); p.push(req.query.tier); }
  const zones = all(`${V1_SQL} WHERE ${where.join(' AND ')} ORDER BY c.district, m.district_rank IS NULL, m.district_rank`, ...p).map(v1Row);
  log(null, 'api.zones', 'api_key', req.apiKey.id, { month, rows: zones.length });
  res.json({ month, disclaimer: DISCLAIMER, count: zones.length, zones });
});
publicApi.get('/zones/:code', requireApiKey, (req, res) => {
  const rows = all(`${V1_SQL} WHERE c.code = ? ORDER BY m.month`, req.params.code).map(v1Row);
  if (!rows.length) return res.status(404).json({ error: 'Zone not found' });
  log(null, 'api.zone', 'api_key', req.apiKey.id, { code: req.params.code });
  res.json({ disclaimer: DISCLAIMER, zone: rows[rows.length - 1], history: rows.map((x) => ({ month: x.month, tier: x.tier, peer_relative_gap: x.peer_relative_gap, confidence: x.confidence, coverage: x.coverage })) });
});

export default r;
