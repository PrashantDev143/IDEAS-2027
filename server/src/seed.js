// Rebuilds the demo database: cells, 36 months of synthetic observations, surveys,
// users, a detection history (month-by-month engine runs) and sample field validations.
import fs from 'node:fs';
import { db, DB_PATH, initSchema, run, all, get, tx } from './db.js';
import { hashPassword } from './auth.js';
import { buildCells, INITIAL_MONTHS, monthLabel } from './sim/generator.js';
import { upsertDatasetCatalog, insertGeneratedMonth } from './datasets.js';
import { runEngine, applyFeedback } from './engine/engine.js';

export function seed({ quiet = false } = {}) {
  const say = (...a) => !quiet && console.log(...a);
  db.exec(`DROP TABLE IF EXISTS activity_log; DROP TABLE IF EXISTS validations; DROP TABLE IF EXISTS alerts;
    DROP TABLE IF EXISTS cell_metrics; DROP TABLE IF EXISTS cell_calibration; DROP TABLE IF EXISTS engine_runs;
    DROP TABLE IF EXISTS observations; DROP TABLE IF EXISTS surveys; DROP TABLE IF EXISTS cells;
    DROP TABLE IF EXISTS datasets; DROP TABLE IF EXISTS settings; DROP TABLE IF EXISTS users;`);
  initSchema();

  const users = [
    ['Vedant Borker', 'admin@econoscope.in', 'admin123', 'admin', null],
    ['Swayam Prabhu', 'analyst@econoscope.in', 'analyst123', 'analyst', null],
    ['Prashant Goundadkar', 'field.north@econoscope.in', 'field123', 'field_officer', 'Bardez'],
    ['Pratik Murkar', 'field.south@econoscope.in', 'field123', 'field_officer', 'Salcete'],
  ];
  for (const [name, email, pw, role, taluka] of users)
    run('INSERT INTO users (name, email, password_hash, role, taluka) VALUES (?,?,?,?,?)', name, email, hashPassword(pw), role, taluka);
  say(`users: ${users.length}`);

  const cells = buildCells();
  tx(() => {
    const st = db.prepare(`INSERT INTO cells (code, name, taluka, district, zone, lat, lon, lat_min, lat_max, lon_min, lon_max, area_km2, tourism_share)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const c of cells) st.run(c.code, c.name, c.taluka, c.district, c.zone, c.lat, c.lon, c.lat_min, c.lat_max, c.lon_min, c.lon_max, c.area_km2, c.tourism_share);
  });
  say(`cells: ${cells.length}`);

  // surveys are published inside insertGeneratedMonth each March (FY close)
  tx(() => { for (let t = 0; t < INITIAL_MONTHS; t++) insertGeneratedMonth(t); });
  upsertDatasetCatalog(true);
  say(`months: ${monthLabel(0)} .. ${monthLabel(INITIAL_MONTHS - 1)}`);
  return cells.length;
}

export function seedHistory({ quiet = false } = {}) {
  const say = (...a) => !quiet && console.log(...a);
  const analyst = get("SELECT id FROM users WHERE role = 'analyst'");
  const officers = all("SELECT id, taluka FROM users WHERE role = 'field_officer'");
  const north = new Set(['Pernem', 'Bardez', 'Tiswadi', 'Bicholim', 'Sattari', 'Ponda']);
  const officerFor = (taluka) => officers[north.has(taluka) ? 0 : 1].id;

  // detection history: run the engine as-of each month from Jan 2026
  const histMonths = [];
  for (let t = INITIAL_MONTHS - 8; t < INITIAL_MONTHS; t++) histMonths.push(monthLabel(t));
  for (const m of histMonths) {
    const r = runEngine({ month: m });
    say(`engine ${m}: ${r.created} new, ${r.updated} updated  (model R²=${r.model.r2.toFixed(3)}, κ=${r.model.kappa.toFixed(3)})`);

    // simulate the field team working through older alerts
    if (m <= histMonths[4]) {
      const q = (order, n) => all(`SELECT a.*, c.taluka FROM alerts a JOIN cells c ON c.id = a.cell_id
        WHERE a.status = 'open' AND a.first_detected <= ? ORDER BY ${order} LIMIT ${n}`, m);
      const top = q('a.priority_score DESC', 3);
      const weak = q('a.confidence ASC', 2).filter((w) => !top.some((x) => x.id === w.id));
      const open = [...top, ...weak];
      for (const a of open) processHistoricalAlert(a, m, analyst.id, officerFor(a.taluka));
    }
  }
  // assign a few current alerts so field dashboards aren't empty
  const toAssign = all(`SELECT a.id, c.taluka FROM alerts a JOIN cells c ON c.id = a.cell_id
    WHERE a.status = 'open' ORDER BY a.priority_score DESC LIMIT 5`);
  for (const a of toAssign) {
    run("UPDATE alerts SET status = 'assigned', assigned_to = ?, updated_at = datetime('now') WHERE id = ?", officerFor(a.taluka), a.id);
    run('INSERT INTO activity_log (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)', analyst.id, 'alert.assign', 'alert', a.id,
      JSON.stringify({ assigned_to: officerFor(a.taluka) }));
  }
  const counts = all('SELECT status, COUNT(*) n FROM alerts GROUP BY status');
  say('alerts:', counts.map((c) => `${c.status}=${c.n}`).join(' '));
}

function processHistoricalAlert(a, month, analystId, officerId) {
  // deterministic but varied outcomes, weighted by confidence (higher confidence -> more often confirmed)
  const h = [...a.code].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % 997, 7) / 997;
  const agreement = JSON.parse(a.confidence_json).agreement;
  let outcome;
  if (agreement < 0.34) outcome = h < 0.6 ? 'data_issue' : 'false_positive';
  else if (a.confidence >= 65) outcome = h < 0.72 ? 'confirmed' : h < 0.9 ? 'partially_confirmed' : 'explained';
  else outcome = h < 0.45 ? 'confirmed' : h < 0.65 ? 'partially_confirmed' : h < 0.85 ? 'explained' : 'false_positive';

  // for gap alerts, the field count is compared with the model estimate (ground-truth accuracy)
  const gap = Math.round(a.gap_abs || 0);
  const share = outcome === 'confirmed' ? 0.75 + 0.4 * h : outcome === 'partially_confirmed' ? 0.4 : 0.05;
  const isGap = a.type === 'visibility_gap' || a.type === 'record_mismatch';
  const found = isGap ? Math.max(0, Math.round(a.expected + gap * share)) : null;
  const unreg = a.type === 'visibility_gap' ? Math.max(0, found - Math.round(a.registered || 0)) : 0;
  const notesByOutcome = {
    confirmed: 'Field survey confirms substantially more operating units than on record. Mostly small hospitality and retail units; owners informed about registration support.',
    partially_confirmed: 'Some additional activity observed on ground, smaller than the model estimate. Several units are seasonal.',
    explained: 'Pattern explained by a known factor (event season / recent registration drive not yet reflected in records).',
    false_positive: 'No material difference from records found on the ground.',
    data_issue: 'Signal anomaly traced to a data artefact (sensor/flare glare). No change in ground activity.',
  };
  run("UPDATE alerts SET status = 'assigned', assigned_to = ? WHERE id = ?", officerId, a.id);
  run('INSERT INTO activity_log (user_id, action, entity, entity_id, details, created_at) VALUES (?,?,?,?,?,?)',
    analystId, 'alert.assign', 'alert', a.id, JSON.stringify({ assigned_to: officerId }), `${month}-10 10:00:00`);
  const cell = get('SELECT lat, lon FROM cells WHERE id = ?', a.cell_id);
  run(`INSERT INTO validations (alert_id, officer_id, outcome, establishments_found, unregistered_found, notes, lat, lon, visited_on, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    a.id, officerId, outcome, found, unreg, notesByOutcome[outcome],
    cell.lat, cell.lon, `${month}-20`, `${month}-20 16:30:00`);
  const status = ['confirmed', 'partially_confirmed'].includes(outcome) ? 'validated' : 'dismissed';
  run("UPDATE alerts SET status = ?, outcome = ?, resolved_at = ?, updated_at = ? WHERE id = ?", status, outcome, `${month}-20 16:30:00`, `${month}-20 16:30:00`, a.id);
  run('INSERT INTO activity_log (user_id, action, entity, entity_id, details, created_at) VALUES (?,?,?,?,?,?)',
    officerId, 'alert.validate', 'alert', a.id, JSON.stringify({ outcome }), `${month}-20 16:30:00`);
  applyFeedback({ ...a, last_detected: a.last_detected }, outcome);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('src/seed.js')) {
  if (fs.existsSync(DB_PATH)) console.log('Rebuilding', DB_PATH);
  const t0 = Date.now();
  seed();
  seedHistory();
  console.log(`Seed complete in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${DB_PATH}`);
}
