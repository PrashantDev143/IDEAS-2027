import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initSchema, get } from './db.js';
import core from './routes/core.js';
import alerts from './routes/alerts.js';
import data from './routes/data.js';

initSchema();
if (!get('SELECT 1 FROM cells LIMIT 1')) {
  console.log('Empty database - seeding the Goa pilot demo dataset...');
  const { seed, seedHistory } = await import('./seed.js');
  seed();
  seedHistory();
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', core, alerts, data);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// serve the built client in production
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : err.message || 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => console.log(`EconoScope API listening on http://localhost:${PORT}`));
