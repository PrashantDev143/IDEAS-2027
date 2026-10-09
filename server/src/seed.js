// Rebuilds the demo database: zones, 36 months of synthetic observations, surveys, users,
// a detection history (month-by-month engine runs), sample field validations and control visits.
import fs from 'node:fs';
import { db, DB_PATH, initSchema, dropAll, run, all, get, tx } from './db.js';
import { hashPassword } from './auth.js';
import { buildCells, INITIAL_MONTHS, monthLabel } from './sim/generator.js';
import { upsertDatasetCatalog, insertGeneratedMonth, recordVersion, OBS_COLS } from './datasets.js';
import { runEngine, applyFeedback } from './engine/engine.js';
import { createControlSample } from './audit.js';

export function seed({ quiet = false } = {}) {
  const say = (...a) => !quiet && console.log(...a);
  dropAll();
  initSchema();

  const users = [
    ['Vedant Borker', 'admin@econoscope.in', 'admin123', 'admin', null],
    ['Swayam Prabhu', 'analyst@econoscope.in', 'analyst123', 'analyst', null],
    ['Prashant Goundadkar', 'field.north@econoscope.in', 'field123', 'field_officer', 'Bardez'],
    ['Pratik Murkar', 'field.south@econoscope.in', 'field123', 'field_officer', 'Salcete'],
    ['Demo Planner', 'planner@econoscope.in', 'planner123', 'planner', null],
    ['Demo Auditor', 'auditor@econoscope.in', 'auditor123', 'auditor', null],
  ];
  for (const [name, email, pw, role, taluka] of users)
    run('INSERT INTO users (name, email, password_hash, role, taluka) VALUES (?,?,?,?,?)', name, email, hashPassword(pw), role, taluka);
  say(`users: ${users.length}`);

  const cells = buildCells();
  tx(() => {
    const st = db.prepare(`INSERT INTO cells (code, name, taluka, district, zone, lat, lon, lat_min, lat_max, lon_min, lon_max, area_km2, tourism_share,
      grid_row, grid_col, dist_centre_km, road_access, sensitive) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const c of cells) st.run(c.code, c.name, c.taluka, c.district, c.zone, c.lat, c.lon, c.lat_min, c.lat_max, c.lon_min, c.lon_max, c.area_km2, c.tourism_share,
      c.row, c.col, c.dist_centre_km, c.road_access, c.sensitive);
  });
  say(`zones: ${cells.length}`);

  // surveys are published inside insertGeneratedMonth each March (FY close)
  upsertDatasetCatalog(true);
  tx(() => {
    for (let t = 0; t < INITIAL_MONTHS; t++) insertGeneratedMonth(t);
    const period = `${monthLabel(0)} … ${monthLabel(INITIAL_MONTHS - 1)}`;
    for (const k of OBS_COLS) recordVersion(k, period, get(`SELECT COUNT(${k}) n FROM observations`).n, 'Aggregated to the 2.7 km zone grid (synthetic)', `${monthLabel(INITIAL_MONTHS - 1)}-28`);
    recordVersion('survey_estimate', 'FY 2023-24 … FY 2025-26', get('SELECT COUNT(*) n FROM surveys').n, 'Modelled to zones (synthetic)', '2026-06-30');
  });
  say(`months: ${monthLabel(0)} .. ${monthLabel(INITIAL_MONTHS - 1)}`);
  return cells.length;
}

const hashOf = (s) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 997, 7) / 997;

export function seedHistory({ quiet = false } = {}) {
  const say = (...a) => !quiet && console.log(...a);
  const analyst = get("SELECT id FROM users WHERE role = 'analyst'");
  const officers = all("SELECT id, taluka FROM users WHERE role = 'field_officer'");
  const north = new Set(['Pernem', 'Bardez', 'Tiswadi', 'Bicholim', 'Sattari', 'Ponda']);
  const officerFor = (taluka) => officers[north.has(taluka) ? 0 : 1].id;

  // detection history: run the engine as-of each of the last 8 months
  const histMonths = [];
  for (let t = INITIAL_MONTHS - 8; t < INITIAL_MONTHS; t++) histMonths.push(monthLabel(t));
  histMonths.forEach((m, k) => {
    const r = runEngine({ month: m });
    say(`engine ${m}: ${r.created} new, ${r.updated} updated, ${r.insufficient} insufficient, ${r.suppressedSingleSignal} single-signal suppressed (footprint R²=${r.model.footprint.r2.toFixed(3)})`);
    if (k > 4) return;
    // simulate the field team working through older flags, plus a random control set each cycle
    const q = (order, n) => all(`SELECT a.*, c.taluka, c.zone, c.sensitive csens FROM alerts a JOIN cells c ON c.id = a.cell_id
      WHERE a.status = 'open' AND a.is_control = 0 AND c.sensitive = 0 AND a.first_detected <= ? ORDER BY ${order} LIMIT ${n}`, m);
    const top = q('a.priority_score DESC', 4);
    const weak = q('a.confidence ASC', 2).filter((w) => !top.some((x) => x.id === w.id));
    for (const a of [...top, ...weak]) processHistoricalAlert(a, m, analyst.id, officerFor(a.taluka));
    const { ids } = createControlSample(4, 500 + k);
    for (const id of ids) {
      const a = get('SELECT a.*, c.taluka, c.zone FROM alerts a JOIN cells c ON c.id = a.cell_id WHERE a.id = ?', id);
      processHistoricalAlert(a, m, analyst.id, officerFor(a.taluka));
    }
  });
  // leave current work in progress so dashboards are not empty
  const toAssign = all(`SELECT a.id, c.taluka FROM alerts a JOIN cells c ON c.id = a.cell_id
    WHERE a.status = 'open' AND a.sensitive = 0 ORDER BY a.priority_score DESC LIMIT 5`);
  for (const a of toAssign) {
    run("UPDATE alerts SET status = 'assigned', assigned_to = ?, updated_at = datetime('now') WHERE id = ?", officerFor(a.taluka), a.id);
    run('INSERT INTO activity_log (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)', analyst.id, 'alert.assign', 'alert', a.id,
      JSON.stringify({ assigned_to: officerFor(a.taluka) }));
  }
  const controls = createControlSample(3, 900);
  say(`control sample for the current cycle: ${controls.created}`);
  say('alerts:', all('SELECT status, COUNT(*) n FROM alerts GROUP BY status').map((c) => `${c.status}=${c.n}`).join(' '));
}

function processHistoricalAlert(a, month, analystId, officerId) {
  // deterministic but varied outcomes; higher confidence is confirmed more often, controls rarely
  const h = hashOf(a.code);
  const tourist = a.zone === 'coastal' || a.zone === 'heritage';
  let outcome;
  if (a.is_control) outcome = h < 0.12 ? 'confirmed' : h < 0.2 ? 'partially_confirmed' : h < 0.35 ? 'legitimately_busy' : 'no_gap';
  else if (a.confidence >= 70) outcome = h < 0.74 ? 'confirmed' : h < 0.9 ? 'partially_confirmed' : tourist ? 'legitimately_busy' : 'new_development';
  else if (a.confidence >= 50) outcome = h < 0.5 ? 'confirmed' : h < 0.7 ? 'partially_confirmed' : h < 0.85 ? (tourist ? 'legitimately_busy' : 'new_development') : 'no_gap';
  else outcome = h < 0.25 ? 'confirmed' : h < 0.4 ? 'partially_confirmed' : h < 0.6 ? 'legitimately_busy' : h < 0.85 ? 'no_gap' : 'data_issue';

  // for gap flags the field count is compared with the model's expected footprint (ground-truth accuracy)
  const isGap = a.type === 'visibility_gap' || a.type === 'record_mismatch' || a.is_control;
  const share = outcome === 'confirmed' ? 0.75 + 0.4 * h : outcome === 'partially_confirmed' ? 0.4 : 0.05;
  const found = isGap ? Math.max(0, Math.round(a.registered + (a.gap_abs || 0) * share)) : null;
  const notOnRecord = found !== null ? Math.max(0, found - Math.round(a.registered || 0)) : null;
  const notes = {
    confirmed: 'Field count is well above the recorded footprint. Mostly small hospitality and retail units; registration support leaflets shared and facilitation desk details given.',
    partially_confirmed: 'Some additional activity on the ground, smaller than the model estimate. Several units operate only in season.',
    legitimately_busy: 'Busy for an ordinary reason (market day / tourist season / transit hub). Units seen are on record.',
    new_development: 'New commercial premises opened recently; registrations are in process and not yet in the records.',
    no_gap: 'Ground count matches the records. Nothing unusual found.',
    data_issue: 'Signal anomaly traced to a data artefact. No change in ground activity.',
  };
  run("UPDATE alerts SET status = 'assigned', assigned_to = ? WHERE id = ?", officerId, a.id);
  run('INSERT INTO activity_log (user_id, action, entity, entity_id, details, created_at) VALUES (?,?,?,?,?,?)',
    analystId, 'alert.assign', 'alert', a.id, JSON.stringify({ assigned_to: officerId }), `${month}-10 10:00:00`);
  const cell = get('SELECT lat, lon FROM cells WHERE id = ?', a.cell_id);
  const outreach = ['confirmed', 'partially_confirmed', 'new_development'].includes(outcome) ? 1 : 0;
  run(`INSERT INTO validations (alert_id, officer_id, officer_role, outcome, establishments_found, unregistered_found, outreach_offered, notes, lat, lon, visited_on, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    a.id, officerId, 'field_officer', outcome, found, notOnRecord, outreach, notes[outcome], cell.lat, cell.lon, `${month}-20`, `${month}-20 16:30:00`);
  const status = ['confirmed', 'partially_confirmed'].includes(outcome) ? 'validated' : 'dismissed';
  run('UPDATE alerts SET status = ?, outcome = ?, outreach_status = ?, resolved_at = ?, updated_at = ? WHERE id = ?',
    status, outcome, outreach ? 'offered' : 'none', `${month}-20 16:30:00`, `${month}-20 16:30:00`, a.id);
  run('INSERT INTO activity_log (user_id, action, entity, entity_id, details, created_at) VALUES (?,?,?,?,?,?)',
    officerId, 'alert.validate', 'alert', a.id, JSON.stringify({ outcome }), `${month}-20 16:30:00`);
  applyFeedback(a, outcome);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('src/seed.js')) {
  if (fs.existsSync(DB_PATH)) console.log('Rebuilding', DB_PATH);
  const t0 = Date.now();
  seed();
  seedHistory();
  console.log(`Seed complete in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${DB_PATH}`);
}
