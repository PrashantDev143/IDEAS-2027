import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.ECONOSCOPE_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, 'econoscope.db');

// bump when the schema changes; a mismatch rebuilds the demo database on start
export const SCHEMA_VERSION = 2;

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export const ROLES = ['admin', 'analyst', 'field_officer', 'planner', 'auditor'];

export const TABLES = ['api_keys', 'peer_group_reviews', 'dataset_versions', 'cell_evidence', 'activity_log', 'validations', 'alerts',
  'cell_metrics', 'cell_calibration', 'engine_runs', 'observations', 'surveys', 'cells', 'peer_groups', 'datasets', 'settings', 'users'];

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','analyst','field_officer','planner','auditor')),
  taluka TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS peer_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  n INTEGER,
  traits_json TEXT
);
CREATE TABLE IF NOT EXISTS cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  taluka TEXT NOT NULL,
  district TEXT NOT NULL,
  zone TEXT NOT NULL,
  lat REAL, lon REAL,
  lat_min REAL, lat_max REAL, lon_min REAL, lon_max REAL,
  area_km2 REAL,
  tourism_share REAL,
  grid_row INTEGER, grid_col INTEGER,
  dist_centre_km REAL, road_access REAL,
  sensitive INTEGER NOT NULL DEFAULT 0,
  peer_group_id INTEGER
);
CREATE TABLE IF NOT EXISTS observations (
  cell_id INTEGER NOT NULL REFERENCES cells(id),
  month TEXT NOT NULL,
  registered REAL, night_light REAL, built_up REAL, digital_points REAL,
  power_connections REAL, listings REAL, footfall REAL,
  PRIMARY KEY (cell_id, month)
);
CREATE TABLE IF NOT EXISTS surveys (
  cell_id INTEGER NOT NULL REFERENCES cells(id),
  fy_start INTEGER NOT NULL,
  estimate REAL NOT NULL,
  PRIMARY KEY (cell_id, fy_start)
);
-- observed / observed_sa: inferred activity intensity (establishment-equivalents)
-- expected: expected REGISTERED footprint predicted from independent signals within the peer group
-- gap_abs = expected - registered ; gap_z = residual standardised within the peer group
CREATE TABLE IF NOT EXISTS cell_metrics (
  cell_id INTEGER NOT NULL REFERENCES cells(id),
  month TEXT NOT NULL,
  observed REAL, observed_sa REAL, registered REAL,
  expected REAL, exp_lo REAL, exp_hi REAL,
  gap_abs REAL, gap_log REAL, gap_z REAL,
  yoy_activity REAL, yoy_registered REAL, change_z REAL,
  seasonal_index REAL, eai REAL,
  coverage REAL, insufficient INTEGER NOT NULL DEFAULT 0, insufficient_reason TEXT,
  confidence REAL, priority REAL, tier TEXT, district_rank INTEGER,
  spatial_class TEXT, spatial_p REAL, gi_z REAL,
  gap_trend TEXT, changepoint_month TEXT,
  PRIMARY KEY (cell_id, month)
);
CREATE INDEX IF NOT EXISTS idx_metrics_month ON cell_metrics(month);
CREATE TABLE IF NOT EXISTS cell_evidence (
  cell_id INTEGER PRIMARY KEY REFERENCES cells(id),
  month TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  cell_id INTEGER NOT NULL REFERENCES cells(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL,
  priority_score REAL,
  confidence REAL NOT NULL,
  first_detected TEXT NOT NULL,
  last_detected TEXT NOT NULL,
  still_active INTEGER NOT NULL DEFAULT 1,
  observed REAL, expected REAL, exp_lo REAL, exp_hi REAL, registered REAL,
  gap_abs REAL, gap_pct REAL, gap_z REAL,
  yoy_activity REAL, yoy_registered REAL, change_z REAL,
  coverage REAL, spatial_class TEXT, gap_trend TEXT, peer_group TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  is_control INTEGER NOT NULL DEFAULT 0,
  outreach_status TEXT NOT NULL DEFAULT 'none',
  signals_json TEXT, confidence_json TEXT, checks_json TEXT, explanation TEXT,
  assigned_to INTEGER REFERENCES users(id),
  outcome TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_cell ON alerts(cell_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE TABLE IF NOT EXISTS validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL REFERENCES alerts(id),
  officer_id INTEGER NOT NULL REFERENCES users(id),
  officer_role TEXT,
  outcome TEXT NOT NULL,
  establishments_found INTEGER,
  unregistered_found INTEGER,
  outreach_offered INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  lat REAL, lon REAL,
  visited_on TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cell_calibration (
  cell_id INTEGER PRIMARY KEY REFERENCES cells(id),
  offset REAL NOT NULL,
  reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS engine_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  cells INTEGER,
  alerts_created INTEGER,
  alerts_updated INTEGER,
  inputs_hash TEXT,
  model_json TEXT,
  triggered_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS datasets (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  role TEXT,
  priority TEXT,
  source TEXT NOT NULL,
  licence TEXT,
  access TEXT,
  unit TEXT,
  frequency TEXT,
  description TEXT,
  synthetic INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  last_updated TEXT
);
CREATE TABLE IF NOT EXISTS dataset_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  version INTEGER NOT NULL,
  acquired_on TEXT NOT NULL,
  period TEXT,
  records INTEGER,
  transformation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- the audit log is append-only
CREATE TRIGGER IF NOT EXISTS activity_log_no_update BEFORE UPDATE ON activity_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS activity_log_no_delete BEFORE DELETE ON activity_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS peer_group_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  k INTEGER NOT NULL,
  reviewed_by INTEGER REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  department TEXT,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used TEXT,
  revoked_at TEXT
);
`;

export function initSchema() {
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
export const schemaVersion = () => db.prepare('PRAGMA user_version').get().user_version;
export function dropAll() {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('DROP TRIGGER IF EXISTS activity_log_no_update; DROP TRIGGER IF EXISTS activity_log_no_delete;');
  for (const t of TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.exec('PRAGMA foreign_keys = ON;');
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function log(userId, action, entity, entityId, details) {
  run('INSERT INTO activity_log (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)',
    userId ?? null, action, entity ?? null, entityId ?? null, details ? JSON.stringify(details) : null);
}

export const DEFAULT_SETTINGS = {
  gap_z_threshold: 2.0, // peer-standardised residual needed to raise a gap flag
  change_z_threshold: 2.5,
  min_gap_establishments: 25,
  min_change_pct: 0.15,
  min_coverage: 0.6, // below this a zone is "insufficient data"
  min_cell_count: 5, // small-cell suppression: registered counts below this are never shown or scored
  peer_groups_k: 6,
  tier_high: 2.0, // priority = |peer-relative gap| x confidence
  tier_medium: 1.1,
  weights: { agreement: 0.3, coverage: 0.2, stability: 0.2, model: 0.15, spatial: 0.15 },
  enrichment: { power_connections: true, digital_points: true }, // P2 signals, only where legally shareable in aggregate
  cooldown_months: 6,
};

export function getSettings() {
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const r of all('SELECT key, value FROM settings')) if (r.key in s) s[r.key] = JSON.parse(r.value);
  return s;
}
export function saveSettings(obj) {
  const st = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  tx(() => { for (const [k, v] of Object.entries(obj)) if (k in DEFAULT_SETTINGS) st.run(k, JSON.stringify(v)); });
}

export function listMonths() {
  return all('SELECT DISTINCT month FROM observations ORDER BY month').map((r) => r.month);
}
