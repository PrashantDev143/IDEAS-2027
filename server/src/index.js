import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initSchema, get, schemaVersion, SCHEMA_VERSION, db } from './db.js';

// The demo database is rebuilt when it is empty or was created by an older schema.
const hasCells = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cells'").get();
if (!hasCells || schemaVersion() !== SCHEMA_VERSION || !get('SELECT 1 FROM cells LIMIT 1')) {
  console.log('Building the Goa pilot demo dataset (first run or schema change)...');
  const { seed, seedHistory } = await import('./seed.js');
  seed({ quiet: true });
  seedHistory({ quiet: true });
} else initSchema();

const { default: core } = await import('./routes/core.js');
const { default: alerts } = await import('./routes/alerts.js');
const { default: data } = await import('./routes/data.js');
const { default: governance, publicApi } = await import('./routes/governance.js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/v1', publicApi); // partner API: zone-level outputs only, X-API-Key
app.use('/api', core, alerts, data, governance);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// serve the built client in production
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large (20 MB maximum)' });
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => console.log(`EconoScope API listening on http://localhost:${PORT}`));
