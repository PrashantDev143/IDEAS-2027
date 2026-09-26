import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.ECONOSCOPE_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, 'econoscope.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','analyst','field_officer')),
  taluka TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  tourism_share REAL
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
CREATE TABLE IF NOT EXISTS cell_metrics (
  cell_id INTEGER NOT NULL REFERENCES cells(id),
  month TEXT NOT NULL,
  observed REAL, observed_sa REAL, expected REAL, registered REAL,
  gap_abs REAL, gap_log REAL, gap_z REAL,
  yoy_activity REAL, yoy_registered REAL, change_z REAL,
  seasonal_index REAL, eai REAL,
  PRIMARY KEY (cell_id, month)
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
  observed REAL, expected REAL, registered REAL,
  gap_abs REAL, gap_pct REAL, gap_z REAL,
  yoy_activity REAL, yoy_registered REAL, change_z REAL,
  signals_json TEXT, confidence_json TEXT, explanation TEXT,
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
  outcome TEXT NOT NULL,
  establishments_found INTEGER,
  unregistered_found INTEGER,
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
  model_json TEXT,
  triggered_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS datasets (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  unit TEXT,
  frequency TEXT,
  description TEXT,
  synthetic INTEGER NOT NULL DEFAULT 1,
  last_updated TEXT
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
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function initSchema() {
  db.exec(SCHEMA);
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
  gap_z_threshold: 2.5,
  change_z_threshold: 2.5,
  min_gap_establishments: 25,
  min_change_pct: 0.15,
  weights: { agreement: 0.35, magnitude: 0.25, persistence: 0.2, isolation: 0.2 },
  cooldown_months: 6,
};

export function getSettings() {
  const s = { ...DEFAULT_SETTINGS };
  for (const r of all('SELECT key, value FROM settings')) s[r.key] = JSON.parse(r.value);
  return s;
}
export function saveSettings(obj) {
  const st = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  tx(() => { for (const [k, v] of Object.entries(obj)) if (k in DEFAULT_SETTINGS) st.run(k, JSON.stringify(v)); });
}

export function listMonths() {
  return all('SELECT DISTINCT month FROM observations ORDER BY month').map((r) => r.month);
}
