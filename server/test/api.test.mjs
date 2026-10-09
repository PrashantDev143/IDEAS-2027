// End-to-end API tests against a throwaway database. Run with: npm test
// Starts the real server on a spare port with ECONOSCOPE_DATA pointing at a temp folder.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4199;
const B = `http://localhost:${PORT}/api`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'econoscope-test-'));
const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let proc;
const tokens = {};

async function call(pathname, { as, method = 'GET', body, headers = {}, raw = false, form } = {}) {
  const h = { ...headers };
  if (as) h.Authorization = `Bearer ${tokens[as]}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(B + pathname, { method, headers: h, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  const type = res.headers.get('content-type') || '';
  const data = raw ? Buffer.from(await res.arrayBuffer()) : type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}
const ok = async (p, o) => { const r = await call(p, o); assert.equal(r.status, 200, `${p} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); return r.data; };

before(async () => {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], { cwd: serverDir, env: { ...process.env, PORT: String(PORT), ECONOSCOPE_DATA: dir, JWT_SECRET: 'test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(`${B}/health`)).ok) break; } catch { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error(`server exited:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const users = { admin: ['admin@econoscope.in', 'admin123'], analyst: ['analyst@econoscope.in', 'analyst123'], field: ['field.north@econoscope.in', 'field123'],
    field2: ['field.south@econoscope.in', 'field123'], planner: ['planner@econoscope.in', 'planner123'], auditor: ['auditor@econoscope.in', 'auditor123'] };
  for (const [k, [email, password]] of Object.entries(users)) {
    const r = await call('/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(r.status, 200, `login ${k}`);
    tokens[k] = r.data.token;
  }
}, { timeout: 180000 });

after(() => {
  proc?.kill();
  setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows may still hold the file */ } }, 300).unref();
});

// ------------------------------------------------------------------ auth
test('auth: bad credentials, missing token and bad token are rejected', async () => {
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 'admin@econoscope.in', password: 'nope' } })).status, 401);
  assert.equal((await call('/auth/login', { method: 'POST', body: {} })).status, 400);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: "x' OR '1'='1", password: "x' OR '1'='1" } })).status, 401);
  assert.equal((await call('/dashboard')).status, 401);
  assert.equal((await call('/dashboard', { headers: { Authorization: 'Bearer junk' } })).status, 401);
  assert.equal((await call('/nope', { as: 'admin' })).status, 404);
  const bad = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400);
});

// ------------------------------------------------------------------ model output invariants
test('model: every scored zone has a confidence band; unscored zones expose nothing', async () => {
  const meta = await ok('/meta', { as: 'analyst' });
  assert.equal(meta.months.length, 36);
  assert.ok(meta.peerGroups.length >= 3 && meta.peerGroups.length <= 6);
  const cells = await ok('/cells', { as: 'analyst' });
  assert.ok(cells.every((c) => c.peer_group_id), 'every zone has a peer group');
  const map = await ok(`/map/${meta.latest}`, { as: 'analyst' });
  assert.equal(map.cells.length, cells.length);
  let insufficient = 0;
  for (const z of map.cells) {
    if (z.insufficient) {
      insufficient++;
      assert.equal(z.tier, 'insufficient');
      assert.equal(z.confidence, null); assert.equal(z.priority, null); assert.equal(z.gap_z, null); assert.equal(z.expected, null, 'no model output for an unscored zone');
      if (z.insufficient_reason === 'suppressed') { assert.equal(z.registered, null, 'small counts are suppressed'); assert.equal(z.expected, null); }
      else assert.ok(z.coverage < meta.thresholds.min_coverage);
    } else {
      assert.ok(['high', 'medium', 'low'].includes(z.tier));
      assert.ok(z.confidence >= 0 && z.confidence <= 100, 'confidence in range');
      assert.ok(z.registered >= meta.thresholds.min_cell_count);
      assert.ok(Math.abs(z.priority - z.gap_z * z.confidence / 100) < 0.02, 'priority = gap x confidence');
      const want = Math.abs(z.gap_abs) < meta.thresholds.min_gap ? 'low' : Math.abs(z.priority) >= meta.thresholds.tier_high ? 'high' : Math.abs(z.priority) >= meta.thresholds.tier_medium ? 'medium' : 'low';
      assert.equal(z.tier, want);
      assert.ok(['hot', 'cold', 'outlier', 'ns'].includes(z.spatial_class));
    }
  }
  assert.ok(insufficient > 10 && insufficient < cells.length / 2, `some but not most zones are insufficient (${insufficient})`);
  assert.ok(map.cells.some((z) => z.insufficient_reason === 'coverage'), 'at least one low-coverage zone for the demo');
});

test('model: ranks are within district and the planted scenarios are found', async () => {
  for (const district of ['North Goa', 'South Goa']) {
    const z = (await ok(`/zones?district=${encodeURIComponent(district)}&sort=rank`, { as: 'analyst' })).rows.filter((r) => !r.insufficient);
    assert.deepEqual(z.map((r) => r.district_rank), z.map((_, i) => i + 1), 'ranks are 1..n with no gaps');
    const ord = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < z.length; i++) assert.ok(ord[z[i - 1].tier] < ord[z[i].tier] || (z[i - 1].tier === z[i].tier && Math.abs(z[i - 1].priority) >= Math.abs(z[i].priority) - 1e-9), 'ranked by tier, then priority');
    assert.ok(z.filter((r) => r.tier !== 'low').every((r) => Math.abs(r.gap_abs) >= 25), 'no high or medium tier on a tiny difference');
    assert.ok(z.every((r) => r.exp_lo <= r.expected && r.expected <= r.exp_hi), 'expected sits inside its range');
  }
  const by = Object.fromEntries((await ok('/zones', { as: 'analyst' })).rows.map((r) => [r.name, r]));
  for (const n of ['Mandrem', 'Morjim', 'Arambol']) assert.ok(by[n].gap_z > 2.5 && by[n].tier !== 'low', `${n} stands out from its peers (${by[n].gap_z})`);
  for (const n of ['Calangute', 'Panaji', 'Margao']) assert.ok(Math.abs(by[n].gap_z) < 2, `${n} is busy but in line with its peers (${by[n].gap_z})`);
  assert.ok(by.Rivona.gap_z < -2 && by.Rivona.spatial_class === 'cold', 'mining belt: records ahead of activity, clustered');
});

test('model: a run is reproducible and atomic', async () => {
  const a = await call('/engine/run', { as: 'analyst', method: 'POST' });
  assert.equal(a.status, 200);
  const z1 = (await ok('/zones', { as: 'analyst' })).rows;
  const b = await ok('/engine/runs', { as: 'analyst' });
  await call('/engine/run', { as: 'analyst', method: 'POST' });
  const z2 = (await ok('/zones', { as: 'analyst' })).rows;
  const c = await ok('/engine/runs', { as: 'analyst' });
  assert.equal(c[0].inputs_hash, b[0].inputs_hash, 'same inputs give the same hash');
  assert.deepEqual(z2.map((r) => [r.code, r.priority, r.tier, r.confidence]), z1.map((r) => [r.code, r.priority, r.tier, r.confidence]), 'same inputs give the same scores');
  assert.equal(a.data.created, 0, 're-running the same month raises no duplicate flags');
});

// ------------------------------------------------------------------ evidence card & wording
test('evidence: every zone has a card; wording never accuses', async () => {
  const zones = (await ok('/zones', { as: 'analyst' })).rows;
  const sample = [zones.find((z) => z.tier === 'high'), zones.find((z) => z.tier === 'low'), zones.find((z) => z.insufficient_reason === 'suppressed'), zones.find((z) => z.insufficient_reason === 'coverage')];
  const banned = /illegal|evasion|evad|non-compliant|unlawful|fraud|violat|offender|defaulter/i;
  for (const z of sample) {
    const d = await ok(`/cells/${z.id}`, { as: 'analyst' });
    assert.ok(d.evidence.summary.length > 40);
    assert.ok(!banned.test(d.evidence.summary), d.evidence.summary);
    assert.ok(d.peer?.name && d.evidence.sources.length >= 5);
    assert.equal(d.lens.length, 2);
    if (z.insufficient) { assert.match(d.evidence.summary, /Insufficient data/); assert.equal(d.evidence.signals.length, 0); assert.equal(d.series.at(-1).expected, null); assert.equal(d.series.at(-1).gap_z, null); }
    else { assert.ok(d.evidence.signals.length >= 4 && d.evidence.confidence.weights); }
    if (z.insufficient_reason === 'suppressed') assert.ok(d.series.every((s) => s.registered === null), 'suppressed in the whole series');
  }
  const flags = (await ok('/alerts?status=&limit=500&control=all', { as: 'analyst' })).rows;
  assert.ok(flags.length > 30);
  for (const f of flags.slice(0, 60)) {
    const d = await ok(`/alerts/${f.id}`, { as: 'analyst' });
    assert.ok(!banned.test(d.explanation), d.explanation);
    assert.ok(d.checks.length >= 2 && d.outreachOptions.length >= 2);
    if (!d.is_control) {
      assert.ok(d.peer_group && d.coverage >= 0.6 && d.signals.length >= 4, 'full decomposition and coverage note');
      const agreeing = d.signals.filter((s) => s.agrees);
      assert.ok(agreeing.length >= 1 && !agreeing.every((s) => s.signal === 'night_light'), 'never driven by night lights alone');
    }
  }
  assert.equal((await call('/cells/999999', { as: 'analyst' })).status, 404);
  assert.equal((await call('/alerts/999999', { as: 'analyst' })).status, 404);
});

// ------------------------------------------------------------------ roles
test('roles: each role can do exactly what it should', async () => {
  const expectStatus = async (who, p, want, opts = {}) => assert.equal((await call(p, { as: who, ...opts })).status, want, `${who} ${opts.method || 'GET'} ${p}`);
  for (const who of ['admin', 'analyst', 'planner', 'auditor']) for (const p of ['/dashboard', '/zones', '/analytics', '/governance', '/metrics', '/datasets', '/notifications', '/alerts']) await expectStatus(who, p, 200);
  for (const p of ['/dashboard', '/zones', '/analytics', '/governance', '/metrics', '/datasets', '/zones/export.csv', '/alerts/export.csv', '/alerts/export.pdf', '/activity', '/users', '/api-keys']) await expectStatus('field', p, 403);
  for (const who of ['planner', 'auditor', 'field']) {
    await expectStatus(who, '/engine/run', 403, { method: 'POST' });
    await expectStatus(who, '/audit-sample', 403, { method: 'POST', body: { n: 2 } });
    await expectStatus(who, '/settings', 403, { method: 'PUT', body: { gap_z_threshold: 3 } });
    await expectStatus(who, '/users', 403, { method: 'POST', body: {} });
  }
  await expectStatus('analyst', '/engine/ingest-next', 403, { method: 'POST' });
  await expectStatus('analyst', '/activity', 403);
  await expectStatus('analyst', '/users', 403);
  await expectStatus('analyst', '/users?role=field_officer', 200);
  await expectStatus('auditor', '/activity', 200);
  await expectStatus('auditor', '/users', 200);
  await expectStatus('planner', '/activity', 403);
  await expectStatus('analyst', '/api-keys', 403);
  // field officers only ever see their own tasks
  const mine = (await ok('/alerts?status=', { as: 'field' })).rows;
  assert.ok(mine.length > 0 && mine.every((a) => a.assignee === 'Prashant Goundadkar'));
  const other = (await ok('/alerts?status=assigned', { as: 'field2' })).rows[0];
  await expectStatus('field', `/alerts/${other.id}`, 403);
  await expectStatus('field', `/alerts/${other.id}/validations`, 403, { method: 'POST', body: { outcome: 'confirmed' } });
  const map = await ok('/map/2026-08', { as: 'field' });
  const mineIds = new Set(mine.map((a) => a.id));
  assert.ok(map.alerts.every((a) => mineIds.has(a.id)), 'map shows a field officer only their own flags');
});

// ------------------------------------------------------------------ workflow
test('workflow: assign -> validate -> feedback recalibrates the zone', async () => {
  const open = (await ok('/alerts?status=open&type=visibility_gap&sort=confidence', { as: 'analyst' })).rows.filter((a) => !a.sensitive);
  const a = open[0];
  assert.equal((await call(`/alerts/${a.id}`, { as: 'planner', method: 'PATCH', body: { assigned_to: 3 } })).status, 403, 'planner cannot assign');
  assert.equal((await call(`/alerts/${a.id}`, { as: 'analyst', method: 'PATCH', body: { assigned_to: 2 } })).status, 400, 'only field officers can be assigned');
  assert.equal((await call(`/alerts/${a.id}`, { as: 'analyst', method: 'PATCH', body: { assigned_to: 99999 } })).status, 400);
  assert.equal((await call(`/alerts/${a.id}`, { as: 'analyst', method: 'PATCH', body: { status: 'validated' } })).status, 400, 'cannot jump to validated');
  assert.equal((await call(`/alerts/${a.id}`, { as: 'analyst', method: 'PATCH', body: { assigned_to: 3, note: 'check the beach road' } })).status, 200);
  const post = (body, who = 'field') => call(`/alerts/${a.id}/validations`, { as: who, method: 'POST', body });
  assert.equal((await post({ outcome: 'made_up' })).status, 400);
  assert.equal((await post({ outcome: 'confirmed', establishments_found: 5, unregistered_found: 9 })).status, 400);
  assert.equal((await post({ outcome: 'confirmed', establishments_found: -1 })).status, 400);
  assert.equal((await post({ outcome: 'confirmed', establishments_found: 2.5 })).status, 400);
  assert.equal((await post({ outcome: 'confirmed', lat: 95, lon: 74 })).status, 400);
  assert.equal((await post({ outcome: 'confirmed', visited_on: '2999-01-01' })).status, 400);
  assert.equal((await post({ outcome: 'confirmed' }, 'planner')).status, 403);
  const before = (await ok(`/cells/${a.cell_id}`, { as: 'analyst' }));
  const done = await post({ outcome: 'legitimately_busy', establishments_found: Math.round(a.registered), unregistered_found: 0, outreach_offered: true, notes: 'weekly market', lat: 15.6, lon: 73.74 });
  assert.equal(done.status, 201);
  assert.equal(done.data.recalibrated, true);
  assert.equal((await post({ outcome: 'confirmed' })).status, 409, 'a closed flag cannot be validated twice');
  const after1 = await ok(`/alerts/${a.id}`, { as: 'analyst' });
  assert.equal(after1.status, 'dismissed'); assert.equal(after1.outcome, 'legitimately_busy'); assert.equal(after1.outreach_status, 'offered');
  assert.equal(after1.validations[0].officer_role, 'field_officer');
  assert.ok(after1.history.some((h) => h.action === 'alert.validate') && after1.history.some((h) => h.action === 'alert.assign'));
  await call('/engine/run', { as: 'analyst', method: 'POST' });
  const afterRun = await ok(`/cells/${a.cell_id}`, { as: 'analyst' });
  const z0 = before.series.at(-1).gap_z, z1 = afterRun.series.at(-1).gap_z;
  assert.ok(Math.abs(z1) < 0.6 && Math.abs(z1) < Math.abs(z0), `gap recalibrated from ${z0} to ${z1}`);
  assert.ok(afterRun.calibration && afterRun.calibration.reason.includes('legitimately_busy'));
  const again = (await ok('/alerts?status=open,assigned&type=visibility_gap', { as: 'analyst' })).rows.filter((x) => x.cell_id === a.cell_id);
  assert.equal(again.length, 0, 'the same pattern is not flagged again');
});

test('workflow: close without visit, reopen, outreach referral', async () => {
  const a = (await ok('/alerts?status=open&sort=recent', { as: 'analyst' })).rows.find((x) => !x.sensitive);
  assert.equal((await call(`/alerts/${a.id}`, { as: 'planner', method: 'PATCH', body: { outreach_status: 'referred' } })).status, 200, 'planner can refer for outreach');
  assert.equal((await call(`/alerts/${a.id}`, { as: 'auditor', method: 'PATCH', body: { outreach_status: 'referred' } })).status, 403, 'auditor is read-only');
  assert.equal((await call(`/alerts/${a.id}`, { as: 'planner', method: 'PATCH', body: { outreach_status: 'bogus' } })).status, 400);
  assert.equal((await call(`/alerts/${a.id}`, { as: 'planner', method: 'PATCH', body: { status: 'dismissed' } })).status, 403);
  assert.equal((await call(`/alerts/${a.id}`, { as: 'analyst', method: 'PATCH', body: { status: 'dismissed', outcome: 'confirmed', note: 'x' } })).status, 200);
  let d = await ok(`/alerts/${a.id}`, { as: 'analyst' });
  assert.equal(d.status, 'dismissed'); assert.equal(d.outcome, 'no_gap', 'a desk close can never record a confirmation'); assert.equal(d.outreach_status, 'referred');
  assert.equal((await call(`/alerts/${a.id}`, { as: 'analyst', method: 'PATCH', body: { assigned_to: 3 } })).status, 409, 'cannot assign a closed flag');
  assert.equal((await call(`/alerts/${a.id}`, { as: 'analyst', method: 'PATCH', body: { status: 'open' } })).status, 200);
  d = await ok(`/alerts/${a.id}`, { as: 'analyst' });
  assert.equal(d.status, 'open'); assert.equal(d.outcome, null);
});

test('guardrail: sensitive zones need administrator sign-off before a visit', async () => {
  const gov = await ok('/governance', { as: 'auditor' });
  assert.ok(gov.sensitive.length > 0);
  let s = (await ok('/alerts?status=open,assigned&control=all&limit=500', { as: 'admin' })).rows.find((a) => a.sensitive);
  if (!s) return; // no open flag in a sensitive zone in this dataset
  assert.equal((await call(`/alerts/${s.id}`, { as: 'analyst', method: 'PATCH', body: { assigned_to: 3 } })).status, 403);
  assert.equal((await call(`/alerts/${s.id}`, { as: 'admin', method: 'PATCH', body: { assigned_to: 3 } })).status, 200);
  const d = await ok(`/alerts/${s.id}`, { as: 'admin' });
  assert.ok(d.history.some((h) => h.action === 'alert.signoff'), 'sign-off is recorded');
  assert.ok(d.checks[0].startsWith('Sensitive zone'));
});

// ------------------------------------------------------------------ control sample & metrics
test('audit sample: random controls are drawn across tiers and feed the lift metric', async () => {
  assert.equal((await call('/audit-sample', { as: 'analyst', method: 'POST', body: { n: 0 } })).status, 400);
  assert.equal((await call('/audit-sample', { as: 'analyst', method: 'POST', body: { n: 500 } })).status, 400);
  const r = await call('/audit-sample', { as: 'analyst', method: 'POST', body: { n: 6 } });
  assert.equal(r.status, 201); assert.equal(r.data.created, 6);
  const drawn = [];
  for (const id of r.data.ids) drawn.push(await ok(`/alerts/${id}`, { as: 'analyst' }));
  assert.ok(drawn.every((d) => d.is_control === 1 && d.type === 'audit_control' && !d.sensitive));
  assert.equal(new Set(drawn.map((d) => d.cell_id)).size, 6, 'no zone drawn twice');
  const normal = (await ok('/alerts?status=open', { as: 'analyst' })).rows;
  assert.ok(normal.every((a) => !a.is_control), 'controls stay out of the prioritised register');
  assert.ok((await ok('/alerts?control=1&status=open', { as: 'analyst' })).rows.length >= 6);
  const m = await ok('/metrics', { as: 'auditor' });
  assert.ok(m.hitRate.controlN > 0 && m.hitRate.n > 0);
  assert.ok(m.lift.value > 1.5, `prioritised visits beat random controls (lift ${m.lift.value})`);
  assert.ok(m.hitRate.topTier > m.hitRate.control);
  assert.equal(m.explainability.share, 1, 'every flag is fully explained');
  assert.equal(m.freshness.upToDate, true);
  assert.equal(m.formalisation.measurable, false);
  for (const b of m.calibration.bands) assert.ok(Math.abs(b.observed - b.stated - b.diff) < 1e-9);
});

test('governance: bias tables add up; peer review is recorded', async () => {
  const g = await ok('/governance', { as: 'auditor' });
  for (const rows of [g.byZone, g.byQuality, g.byPeer]) {
    assert.equal(rows.reduce((s, r) => s + r.zones, 0), g.overall.zones);
    assert.equal(rows.reduce((s, r) => s + r.scored, 0), g.overall.scored);
    assert.equal(rows.reduce((s, r) => s + r.flagged, 0), g.overall.flagged);
  }
  const below = g.byQuality.find((r) => r.grp === 'Below minimum');
  assert.ok(below && below.flagged === 0 && below.scored === 0, 'poor data gives no score, not more flags');
  assert.equal(g.release.peerGroupsReviewed, false);
  assert.equal((await call('/governance/peer-review', { as: 'analyst', method: 'POST', body: { note: 'looks fine to me overall' } })).status, 403);
  assert.equal((await call('/governance/peer-review', { as: 'auditor', method: 'POST', body: { note: 'ok' } })).status, 400);
  assert.equal((await call('/governance/peer-review', { as: 'auditor', method: 'POST', body: { note: 'Checked traits and group membership against the map.' } })).status, 201);
  assert.equal((await ok('/governance', { as: 'auditor' })).release.peerGroupsReviewed, true);
});

// ------------------------------------------------------------------ exports
test('exports: carry the disclaimer, reasons and checks; never per officer; are logged', async () => {
  const csv = (await call('/alerts/export.csv?status=open,assigned', { as: 'analyst' })).data;
  const lines = csv.split('\n');
  assert.ok(lines[1].includes('not findings about any business or person') && lines[1].includes('inspection quotas'));
  const header = lines.find((l) => l.startsWith('code,'));
  for (const c of ['confidence', 'confidence_band', 'coverage', 'reason', 'suggested_checks', 'peer_group']) assert.ok(header.split(',').includes(c), c);
  assert.ok(!/assignee|officer/.test(header), 'no per-officer column');
  assert.ok(!csv.includes('Prashant') && !csv.includes('Pratik'), 'no officer names in an export');
  assert.ok(!/illegal|evasion|non-compliant/i.test(csv));
  const mine = (await call('/alerts/export.csv?mine=1', { as: 'admin' })).data.split('\n').length;
  const allRows = (await call('/alerts/export.csv', { as: 'admin' })).data.split('\n').length;
  assert.equal(mine, allRows, 'the "mine" filter is ignored for exports');
  const pdf = await call('/alerts/export.pdf?priority=high', { as: 'planner', raw: true });
  assert.equal(pdf.status, 200); assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.data.length > 3000);
  const empty = await call('/alerts/export.pdf?q=zzzz-no-such-zone', { as: 'planner', raw: true });
  assert.equal(empty.data.subarray(0, 5).toString(), '%PDF-');
  const zones = (await call('/zones/export.csv?tier=insufficient', { as: 'analyst' })).data.split('\n').filter((l) => /^GA-/.test(l));
  assert.ok(zones.length > 10 && zones.every((l) => /insufficient/.test(l)));
  const log = await ok('/activity?action=export', { as: 'auditor' });
  assert.ok(log.filter((l) => l.action === 'export.validation_list').length >= 4 && log.some((l) => l.action === 'export.zones'));
  assert.ok(log.every((l) => l.user_name), 'every export is traceable to a user');
});

test('audit log: views are logged and the log is append-only', async () => {
  const z = (await ok('/zones?tier=medium', { as: 'planner' })).rows[0];
  await ok(`/cells/${z.id}`, { as: 'planner' });
  const log = await ok('/activity?action=zone.view', { as: 'auditor' });
  assert.ok(log.some((l) => l.entity_id === z.id && l.user_name === 'Demo Planner'));
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'econoscope.db'));
  assert.throws(() => db.exec('DELETE FROM activity_log'), /append-only/);
  assert.throws(() => db.exec("UPDATE activity_log SET action = 'x'"), /append-only/);
  db.close();
});

// ------------------------------------------------------------------ data & settings
test('data: upload validates rows, versions the dataset, and missing data lowers coverage', async () => {
  const before = (await ok('/datasets', { as: 'analyst' })).datasets.find((d) => d.key === 'registered');
  const csv = 'cell_code,month,metric,value\nGA-0314,2026-09,registered,200\nBAD,2026-09,registered,1\nGA-0314,2026-9,night_light,3\nGA-0314,2026-09,foo,3\nGA-0314,2026-09,night_light,-4\nGA-0314,2026-09,built_up,\n';
  const form = new FormData(); form.append('file', new Blob([csv], { type: 'text/csv' }), 'sept.csv');
  const r = await call('/datasets/upload', { as: 'analyst', method: 'POST', form });
  assert.equal(r.status, 200); assert.equal(r.data.accepted, 1); assert.equal(r.data.rejected, 5); assert.equal(r.data.errors.length, 5);
  const f2 = new FormData(); f2.append('file', new Blob(['a,b\n1,2\n']), 'bad.csv');
  assert.equal((await call('/datasets/upload', { as: 'analyst', method: 'POST', form: f2 })).status, 400);
  assert.equal((await call('/datasets/upload', { as: 'analyst', method: 'POST' })).status, 400);
  const f3 = new FormData(); f3.append('file', new Blob([csv]), 'x.csv');
  assert.equal((await call('/datasets/upload', { as: 'planner', method: 'POST', form: f3 })).status, 403);
  const after1 = (await ok('/datasets', { as: 'analyst' })).datasets.find((d) => d.key === 'registered');
  assert.equal(after1.version, before.version + 1); assert.equal(after1.synthetic, 0); assert.match(after1.versions[0].transformation, /sept\.csv/);
  // a new month with data for one zone only: the run must still complete, and coverage must fall elsewhere
  const run = await call('/engine/run', { as: 'analyst', method: 'POST' });
  assert.equal(run.status, 200); assert.equal(run.data.month, '2026-09');
  const z = (await ok('/zones?q=GA-0314', { as: 'analyst' })).rows[0];
  assert.equal(z.month, '2026-09');
  const other = (await ok('/zones?q=Panaji', { as: 'analyst' })).rows.find((x) => x.name === 'Panaji');
  assert.ok(other.coverage < 1 && other.coverage > 0.85, `one missing month lowers coverage (${other.coverage})`);
});

test('data: ingesting the next month re-scores and stays fresh', async () => {
  const r = await call('/engine/ingest-next', { as: 'admin', method: 'POST' });
  assert.equal(r.status, 200); assert.equal(r.data.ingested, '2026-10'); assert.equal(r.data.month, '2026-10');
  assert.equal((await ok('/meta', { as: 'field' })).latest, '2026-10');
  assert.equal((await ok('/metrics', { as: 'analyst' })).freshness.upToDate, true);
  const n = await ok('/notifications', { as: 'planner' });
  assert.equal(n.month, '2026-10');
});

test('settings: validated, admin only, and they change the next run', async () => {
  const put = (body, who = 'admin') => call('/settings', { as: who, method: 'PUT', body });
  assert.equal((await put({ gap_z_threshold: 99 })).status, 400);
  assert.equal((await put({ min_cell_count: 2.5 })).status, 400);
  assert.equal((await put({ tier_medium: 5, tier_high: 2 })).status, 400);
  assert.equal((await put({ weights: { agreement: 0, coverage: 0, stability: 0, model: 0, spatial: 0 } })).status, 400);
  assert.equal((await put({ weights: { agreement: 2 } })).status, 400);
  assert.equal((await put({ peer_groups_k: 4 }, 'analyst')).status, 403);
  const before = (await ok('/zones', { as: 'analyst' })).rows.filter((z) => z.insufficient).length;
  assert.equal((await put({ min_cell_count: 12, enrichment: { power_connections: false, digital_points: false } })).status, 200);
  assert.equal((await call('/engine/run', { as: 'admin', method: 'POST' })).status, 200);
  const after1 = (await ok('/zones', { as: 'analyst' })).rows.filter((z) => z.insufficient).length;
  assert.ok(after1 > before, `raising the minimum cell size suppresses more zones (${before} -> ${after1})`);
  const model = (await ok('/analytics', { as: 'analyst' })).model;
  assert.deepEqual(model.signals, ['night_light', 'built_up', 'listings', 'footfall'], 'enrichment signals switched off');
  const ds = (await ok('/datasets', { as: 'analyst' })).datasets;
  assert.equal(ds.find((d) => d.key === 'power_connections').enabled, false);
  assert.equal((await put({ min_cell_count: 5, enrichment: { power_connections: true, digital_points: true } })).status, 200);
  assert.equal((await call('/engine/run', { as: 'admin', method: 'POST' })).status, 200);
});

// ------------------------------------------------------------------ users & partner API
test('users: create, validate, update, disable', async () => {
  const post = (body) => call('/users', { as: 'admin', method: 'POST', body });
  assert.equal((await post({ name: 'T', email: 'not-an-email', password: 'password1', role: 'planner' })).status, 400);
  assert.equal((await post({ name: 'T', email: 't@x.in', password: 'short', role: 'planner' })).status, 400);
  assert.equal((await post({ name: 'T', email: 't@x.in', password: 'password1', role: 'superuser' })).status, 400);
  assert.equal((await post({ name: 'T', email: 'ADMIN@econoscope.in', password: 'password1', role: 'planner' })).status, 409);
  const u = await post({ name: 'Test Planner', email: 'T@X.in', password: 'password1', role: 'planner' });
  assert.equal(u.status, 201); assert.equal(u.data.email, 't@x.in'); assert.ok(!('password_hash' in u.data));
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 't@x.in', password: 'password1' } })).status, 200);
  assert.equal((await call('/users/1', { as: 'admin', method: 'PATCH', body: { role: 'analyst' } })).status, 400, 'cannot demote yourself');
  assert.equal((await call(`/users/${u.data.id}`, { as: 'admin', method: 'PATCH', body: { active: false } })).status, 200);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 't@x.in', password: 'password1' } })).status, 401, 'disabled accounts cannot sign in');
  const list = await ok('/users', { as: 'admin' });
  assert.ok(list.every((x) => !('password_hash' in x)));
});

test('partner API: key required, zone-level only, suppressed, revocable', async () => {
  const v1 = (p, key) => fetch(`http://localhost:${PORT}/api/v1${p}`, { headers: key ? { 'X-API-Key': key } : {} });
  assert.equal((await v1('/zones')).status, 401);
  assert.equal((await v1('/zones', 'esk_wrong')).status, 401);
  assert.equal((await call('/api-keys', { as: 'admin', method: 'POST', body: { name: '' } })).status, 400);
  const k = await call('/api-keys', { as: 'admin', method: 'POST', body: { name: 'Planning dashboard', department: 'TCP' } });
  assert.equal(k.status, 201); assert.match(k.data.key, /^esk_[0-9a-f]{48}$/);
  const listed = await ok('/api-keys', { as: 'admin' });
  assert.ok(!JSON.stringify(listed).includes(k.data.key), 'the key is never stored or listed in clear');
  const res = await v1('/zones?district=North%20Goa', k.data.key);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.disclaimer && body.zones.length > 100 && body.zones.every((z) => z.district === 'North Goa'));
  const keys = new Set(body.zones.flatMap((z) => Object.keys(z)));
  for (const banned of ['id', 'lat', 'lon', 'signals', 'assignee', 'name_of_business']) assert.ok(!keys.has(banned), banned);
  const sup = body.zones.find((z) => z.insufficient_reason === 'suppressed');
  assert.ok(sup && sup.registered === null && sup.expected_registered === null && sup.peer_relative_gap === null && sup.tier === 'insufficient');
  const one = await v1(`/zones/${body.zones[0].code}`, k.data.key);
  assert.equal(one.status, 200); assert.ok((await one.json()).history.length >= 36);
  assert.equal((await v1('/zones/NOPE', k.data.key)).status, 404);
  assert.equal((await call(`/api-keys/${k.data.id}`, { as: 'admin', method: 'DELETE' })).status, 200);
  assert.equal((await v1('/zones', k.data.key)).status, 401, 'a revoked key stops working');
});
