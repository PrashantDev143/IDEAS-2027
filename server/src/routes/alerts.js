import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { all, get, run, log, tx } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { applyFeedback, ALERT_TYPES, RECALIBRATING } from '../engine/engine.js';
import { READERS, DISCLAIMER, toCsv } from './core.js';

const r = Router();
const STATUSES = ['open', 'assigned', 'validated', 'dismissed'];
export const OUTCOMES = {
  confirmed: 'Gap confirmed',
  partially_confirmed: 'Partly confirmed',
  legitimately_busy: 'Legitimately busy',
  new_development: 'New development',
  no_gap: 'Nothing unusual found',
  data_issue: 'Data error',
};
// offered alongside every flag: formalisation and support come before anything else
export const OUTREACH_OPTIONS = [
  { title: 'Registration facilitation camp', body: 'Hold a help desk in the zone for Udyam, trade-licence and Shops & Establishments registration.' },
  { title: 'Scheme awareness', body: 'Share credit, insurance and MSME support schemes that open up once a business is on record.' },
  { title: 'Simplified compliance guidance', body: 'Explain composition and threshold rules so small and seasonal units know what actually applies to them.' },
];
const SORTS = {
  priority: 'a.priority_score DESC', confidence: 'a.confidence DESC', recent: 'a.first_detected DESC, a.id DESC',
  gap: 'ABS(a.gap_abs) DESC', updated: 'a.updated_at DESC',
};

function buildFilter(q, user) {
  const where = [], p = [];
  const mine = q.mine === '1' || user.role === 'field_officer';
  if (q.status) { const s = String(q.status).split(',').filter((x) => STATUSES.includes(x)); if (s.length) { where.push(`a.status IN (${s.map(() => '?').join(',')})`); p.push(...s); } }
  if (q.type && ALERT_TYPES[q.type]) { where.push('a.type = ?'); p.push(q.type); }
  if (q.priority) { where.push('a.priority = ?'); p.push(q.priority); }
  if (q.taluka) { where.push('c.taluka = ?'); p.push(q.taluka); }
  if (q.district) { where.push('c.district = ?'); p.push(q.district); }
  if (q.trend) { where.push('a.gap_trend = ?'); p.push(q.trend); }
  if (q.minConfidence) { where.push('a.confidence >= ?'); p.push(Number(q.minConfidence)); }
  if (q.q) { where.push('(c.name LIKE ? OR a.code LIKE ? OR c.code LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  if (mine) { where.push('a.assigned_to = ?'); p.push(user.id); }
  // control visits live in their own list unless asked for (or assigned to you)
  if (q.control === '1') where.push('a.is_control = 1');
  else if (!mine && q.control !== 'all') where.push('a.is_control = 0');
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', p };
}

const LIST_SQL = `SELECT a.id, a.code, a.cell_id, a.type, a.status, a.priority, a.priority_score, a.confidence, a.first_detected, a.last_detected,
  a.still_active, a.observed, a.expected, a.exp_lo, a.exp_hi, a.registered, a.gap_abs, a.gap_pct, a.gap_z, a.yoy_activity, a.yoy_registered,
  a.coverage, a.spatial_class, a.gap_trend, a.peer_group, a.sensitive, a.is_control, a.outreach_status, a.outcome, a.updated_at,
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

// ---- validation list export. Never per officer: scores are not inspection targets.
const reasonOf = (a) => (a.explanation || '').split('. ').slice(0, 2).join('. ').replace(/\s+/g, ' ').trim() + '.';
function exportRows(req) {
  const { sql, p } = buildFilter({ ...req.query, mine: undefined }, { ...req.user, role: 'analyst' });
  return all(`SELECT a.code, a.type, a.priority tier, a.priority_score, a.confidence, a.coverage, c.name zone, c.code zone_code, c.taluka, c.district,
      a.peer_group, a.registered, a.expected, a.exp_lo, a.exp_hi, a.gap_z, a.spatial_class, a.gap_trend, a.first_detected, a.last_detected,
      a.status, a.sensitive, a.explanation, a.checks_json
    FROM alerts a JOIN cells c ON c.id = a.cell_id ${sql} ORDER BY c.district, a.priority_score DESC`, ...p)
    .map((a) => ({
      ...a, type: ALERT_TYPES[a.type]?.label || a.type, confidence_band: a.confidence >= 70 ? 'high' : a.confidence >= 45 ? 'medium' : 'low',
      reason: reasonOf(a), suggested_checks: JSON.parse(a.checks_json || '[]').join(' | '), sensitive: a.sensitive ? 'yes - senior sign-off required' : '',
    }));
}

r.get('/alerts/export.csv', requireAuth, requireRole(...READERS), (req, res) => {
  const rows = exportRows(req);
  const cols = ['code', 'zone', 'zone_code', 'taluka', 'district', 'type', 'tier', 'priority_score', 'confidence', 'confidence_band', 'coverage', 'peer_group',
    'registered', 'expected', 'exp_lo', 'exp_hi', 'gap_z', 'spatial_class', 'gap_trend', 'first_detected', 'last_detected', 'status', 'sensitive', 'reason', 'suggested_checks'];
  log(req.user.id, 'export.validation_list', 'alert', null, { format: 'csv', rows: rows.length, filters: req.query });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="econoscope-validation-list.csv"');
  res.send(toCsv(cols, rows, ['EconoScope validation list', DISCLAIMER, 'Outreach first: offer registration support alongside every validation visit.']));
});

const ascii = (s) => String(s ?? '').replace(/σ/g, ' sigma').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[’‘]/g, "'").replace(/…/g, '...').replace(/[^\x20-\x7E\n]/g, '');
r.get('/alerts/export.pdf', requireAuth, requireRole(...READERS), (req, res) => {
  const rows = exportRows(req).slice(0, 80);
  log(req.user.id, 'export.validation_list', 'alert', null, { format: 'pdf', rows: rows.length, filters: req.query });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="econoscope-validation-list.pdf"');
  const doc = new PDFDocument({ size: 'A4', margin: 46 });
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(17).text('EconoScope validation list');
  doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Generated ${new Date().toISOString().slice(0, 10)} by ${ascii(req.user.name)} - ${rows.length} zone flag(s)`);
  doc.moveDown(0.6).fillColor('#8a4b00').font('Helvetica-Bold').fontSize(9).text(ascii(DISCLAIMER));
  doc.font('Helvetica').text('Outreach first: offer registration support alongside every validation visit. Enforcement decisions sit with officials, outside EconoScope.');
  doc.fillColor('#000');
  if (!rows.length) doc.moveDown().fontSize(11).text('No flags match the selected filters.');
  for (const a of rows) {
    if (doc.y > 660) doc.addPage();
    doc.moveDown(0.9);
    doc.font('Helvetica-Bold').fontSize(11).text(ascii(`${a.zone} - ${a.taluka}, ${a.district}`), { continued: true }).font('Helvetica').fontSize(9).fillColor('#555').text(`   ${a.code}`);
    doc.fillColor('#000').fontSize(9).text(ascii(`${a.type} | priority tier: ${a.tier} | confidence ${Math.round(a.confidence)}/100 (${a.confidence_band}) | data coverage ${Math.round((a.coverage || 0) * 100)}% | peer group: ${a.peer_group || '-'}`));
    doc.text(ascii(`Registered ${Math.round(a.registered)} | expected ${Math.round(a.expected)} (range ${Math.round(a.exp_lo)}-${Math.round(a.exp_hi)}) | peer-relative gap ${a.gap_z?.toFixed(1)} sigma${a.sensitive ? ' | SENSITIVE ZONE: senior sign-off required' : ''}`));
    doc.moveDown(0.25).font('Helvetica-Oblique').text(ascii(`Why: ${a.reason}`), { width: 500 });
    doc.font('Helvetica');
    for (const c of JSON.parse(a.checks_json || '[]')) doc.text(ascii(`[ ] ${c}`), { indent: 10, width: 490 });
  }
  doc.end();
});

r.get('/alerts/:id', requireAuth, (req, res) => {
  const a = get(`${LIST_SQL} WHERE a.id = ?`, req.params.id);
  if (!a) return res.status(404).json({ error: 'Flag not found' });
  const full = get('SELECT signals_json, confidence_json, checks_json, explanation, assigned_to, resolved_at, created_at, change_z FROM alerts WHERE id = ?', a.id);
  if (req.user.role === 'field_officer' && full.assigned_to !== req.user.id) return res.status(403).json({ error: 'This flag is not assigned to you' });
  const series = all(`SELECT m.month, m.observed, m.observed_sa, m.registered, m.expected, m.exp_lo, m.exp_hi, m.gap_z, m.change_z, m.eai, m.coverage
    FROM cell_metrics m WHERE m.cell_id = ? ORDER BY m.month`, a.cell_id);
  const validations = all(`SELECT v.*, u.name officer FROM validations v JOIN users u ON u.id = v.officer_id WHERE v.alert_id = ? ORDER BY v.created_at DESC`, a.id);
  const history = all(`SELECT l.*, u.name user_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.entity = 'alert' AND l.entity_id = ? AND l.action != 'alert.view' ORDER BY l.created_at DESC, l.id DESC`, a.id);
  const cell = get('SELECT * FROM cells WHERE id = ?', a.cell_id);
  const neighbours = all(`SELECT c.id, ROUND(m.gap_z, 2) gap_z, ROUND(m.change_z, 2) change_z, ROUND(m.eai, 1) eai, m.insufficient, m.tier, m.spatial_class FROM cells c
    JOIN cell_metrics m ON m.cell_id = c.id AND m.month = ? WHERE ABS(c.lat - ?) < 0.09 AND ABS(c.lon - ?) < 0.09`, a.last_detected, cell.lat, cell.lon);
  log(req.user.id, 'alert.view', 'alert', a.id);
  res.json({
    ...a, ...full, cell, signals: JSON.parse(full.signals_json || '[]'), confidenceBreakdown: JSON.parse(full.confidence_json || '{}'),
    checks: JSON.parse(full.checks_json || '[]'), signals_json: undefined, confidence_json: undefined, checks_json: undefined,
    series, validations, history, neighbours, outreachOptions: OUTREACH_OPTIONS, disclaimer: DISCLAIMER,
  });
});

r.patch('/alerts/:id', requireAuth, requireRole('admin', 'analyst', 'planner'), (req, res) => {
  const a = get('SELECT * FROM alerts WHERE id = ?', req.params.id);
  if (!a) return res.status(404).json({ error: 'Flag not found' });
  const { status, assigned_to, note, outcome, outreach_status } = req.body || {};
  const fail = (msg, code = 400) => { throw Object.assign(new Error(msg), { status: code }); };
  // planners and formalisation leads work on outreach only
  if (req.user.role === 'planner' && (status !== undefined || assigned_to !== undefined)) return res.status(403).json({ error: 'You do not have permission for this action' });
  const changes = {};
  tx(() => {
    if (outreach_status !== undefined) {
      if (!['none', 'referred', 'offered'].includes(outreach_status)) fail('Invalid outreach status');
      run("UPDATE alerts SET outreach_status = ?, updated_at = datetime('now') WHERE id = ?", outreach_status, a.id);
      log(req.user.id, 'alert.outreach', 'alert', a.id, { outreach_status, note });
    }
    if (assigned_to !== undefined) {
      if (!['open', 'assigned'].includes(a.status)) fail('This flag is already closed', 409);
      if (assigned_to !== null) {
        const officer = get('SELECT id, role FROM users WHERE id = ? AND active = 1', assigned_to);
        if (!officer || officer.role !== 'field_officer') fail('Flags can only be assigned to an active field officer');
        // informal settlements / insecure tenure: no field visit without senior sign-off
        if (a.sensitive && req.user.role !== 'admin') fail('This is a sensitive zone. A field visit needs senior (administrator) sign-off.', 403);
        if (a.sensitive) log(req.user.id, 'alert.signoff', 'alert', a.id, { note: note || 'Senior sign-off for a sensitive zone' });
      }
      run("UPDATE alerts SET assigned_to = ?, status = ?, updated_at = datetime('now') WHERE id = ?", assigned_to, assigned_to ? 'assigned' : 'open', a.id);
      changes.status = assigned_to ? 'assigned' : 'open';
      log(req.user.id, assigned_to ? 'alert.assign' : 'alert.unassign', 'alert', a.id, { assigned_to, note });
    }
    if (status && status !== changes.status) {
      if (!STATUSES.includes(status)) fail('Invalid status');
      if (status === 'dismissed') {
        if (!['open', 'assigned'].includes(a.status)) fail('This flag is already closed', 409);
        const o = outcome && OUTCOMES[outcome] && !['confirmed', 'partially_confirmed'].includes(outcome) ? outcome : 'no_gap';
        run("UPDATE alerts SET status = 'dismissed', outcome = ?, resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", o, a.id);
        const offset = applyFeedback(a, o);
        log(req.user.id, 'alert.dismiss', 'alert', a.id, { outcome: o, note, calibration: offset });
      } else if (status === 'open') {
        run("UPDATE alerts SET status = 'open', assigned_to = NULL, outcome = NULL, resolved_at = NULL, updated_at = datetime('now') WHERE id = ?", a.id);
        log(req.user.id, 'alert.reopen', 'alert', a.id, { note });
      } else fail('Use assignment or a field validation to move a flag to this status');
    } else if (note && outreach_status === undefined && assigned_to === undefined) log(req.user.id, 'alert.note', 'alert', a.id, { note });
  });
  res.json({ ok: true });
});

r.post('/alerts/:id/validations', requireAuth, requireRole('admin', 'analyst', 'field_officer'), (req, res) => {
  const a = get('SELECT * FROM alerts WHERE id = ?', req.params.id);
  if (!a) return res.status(404).json({ error: 'Flag not found' });
  if (req.user.role === 'field_officer' && a.assigned_to !== req.user.id) return res.status(403).json({ error: 'This flag is not assigned to you' });
  if (!['open', 'assigned'].includes(a.status)) return res.status(409).json({ error: 'This flag has already been closed' });
  const { outcome, establishments_found, unregistered_found, outreach_offered, notes, lat, lon, visited_on } = req.body || {};
  if (!OUTCOMES[outcome]) return res.status(400).json({ error: 'A valid outcome is required' });
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const found = num(establishments_found), unreg = num(unregistered_found), la = num(lat), lo = num(lon);
  if ([found, unreg].some((v) => v !== null && (!Number.isInteger(v) || v < 0))) return res.status(400).json({ error: 'Counts must be whole numbers of 0 or more' });
  if (unreg !== null && found !== null && unreg > found) return res.status(400).json({ error: 'Units not on record cannot exceed establishments counted' });
  if ((la !== null && !(la >= -90 && la <= 90)) || (lo !== null && !(lo >= -180 && lo <= 180))) return res.status(400).json({ error: 'Coordinates are out of range' });
  if (visited_on && !/^\d{4}-\d{2}-\d{2}$/.test(visited_on)) return res.status(400).json({ error: 'Visit date must be YYYY-MM-DD' });
  if (visited_on && visited_on > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Visit date cannot be in the future' });
  let offset = null;
  tx(() => {
    run(`INSERT INTO validations (alert_id, officer_id, officer_role, outcome, establishments_found, unregistered_found, outreach_offered, notes, lat, lon, visited_on)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`, a.id, req.user.id, req.user.role, outcome, found, unreg, outreach_offered ? 1 : 0, notes?.trim() || null, la, lo,
      visited_on || new Date().toISOString().slice(0, 10));
    const status = ['confirmed', 'partially_confirmed'].includes(outcome) ? 'validated' : 'dismissed';
    run(`UPDATE alerts SET status = ?, outcome = ?, outreach_status = CASE WHEN ? THEN 'offered' ELSE outreach_status END,
         resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, status, outcome, outreach_offered ? 1 : 0, a.id);
    offset = applyFeedback(a, outcome);
    log(req.user.id, 'alert.validate', 'alert', a.id, { outcome, establishments_found: found, outreach_offered: !!outreach_offered, calibration: offset });
  });
  res.status(201).json({ ok: true, calibration: offset, recalibrated: RECALIBRATING.includes(outcome) && offset !== null });
});

r.get('/outcomes', requireAuth, (req, res) => res.json(OUTCOMES));

export default r;
