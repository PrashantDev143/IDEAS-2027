import { useState } from 'react';
import { useApi, Loading, ErrorBox, useToast } from '../components/ui.jsx';
import { useMeta } from '../components/Layout.jsx';
import { api, download } from '../lib/api.js';
import { useAuth, can } from '../lib/auth.jsx';
import { num, monthName, ago } from '../lib/format.js';

const CAT_COLORS = { official: '#2ec4b6', satellite: '#f0b429', digital: '#5aa9f0', infrastructure: '#9d8cf2', tourism: '#f28c28' };

export default function DataPage() {
  const { user } = useAuth();
  const { refreshMeta } = useMeta();
  const toast = useToast();
  const ds = useApi('/datasets');
  const runs = useApi('/engine/runs');
  const [busy, setBusy] = useState('');
  const [file, setFile] = useState(null);
  const [upload, setUpload] = useState(null);
  const [err, setErr] = useState('');

  const act = async (kind) => {
    setBusy(kind); setErr('');
    try {
      const r = await api(kind === 'ingest' ? '/engine/ingest-next' : '/engine/run', { method: 'POST' });
      toast(`${kind === 'ingest' ? `Ingested ${monthName(r.ingested)}. ` : ''}Engine run for ${monthName(r.month)}: ${r.created} new alert(s), ${r.updated} updated in ${r.durationMs} ms.`);
      runs.reload(); ds.reload(); refreshMeta();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };

  const doUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy('upload'); setErr(''); setUpload(null);
    try {
      const form = new FormData(); form.append('file', file);
      const r = await api('/datasets/upload', { method: 'POST', form });
      setUpload(r); ds.reload(); refreshMeta();
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Data & pipeline</div>
          <h1>Sources, ingestion and detection runs</h1>
          <p className="sub">Collect → map & model → detect. Every run retrains the nowcast, recomputes baselines and updates alerts.</p>
        </div>
        <div className="row">
          <button className="btn" disabled={!!busy} onClick={() => act('run')}>{busy === 'run' ? 'Running…' : '▶ Run detection engine'}</button>
          {can(user, 'admin') && <button className="btn primary" disabled={!!busy} onClick={() => act('ingest')} title="Pulls the next month from the (simulated) source feeds and runs detection">{busy === 'ingest' ? 'Ingesting…' : '⇣ Ingest next month'}</button>}
        </div>
      </div>
      <ErrorBox>{err}</ErrorBox>

      <div className="card">
        <div className="card-head"><div><h2>Data catalogue</h2><p className="sub">Layers are aggregated to the 2.7 km grid. No personal or transaction-level data is stored.</p></div></div>
        {ds.loading && !ds.data ? <Loading /> : ds.error ? <ErrorBox>{ds.error}</ErrorBox> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Dataset</th><th>Category</th><th>Source</th><th>Frequency</th><th>Coverage</th><th className="num">Records</th><th>Updated</th><th>Status</th></tr></thead>
            <tbody>{ds.data.datasets.map((d) => (
              <tr key={d.key}>
                <td><div className="strong">{d.name}</div><div className="small muted" style={{ maxWidth: 320 }}>{d.description}</div></td>
                <td><span className="badge" style={{ color: CAT_COLORS[d.category], borderColor: 'currentColor' }}>{d.category}</span></td>
                <td className="small">{d.source}</td><td className="small">{d.frequency}</td><td className="small">{d.coverage}</td>
                <td className="num">{num(d.records)}</td><td className="small muted">{ago(d.last_updated)}</td>
                <td>{d.synthetic ? <span className="synthetic-pill">synthetic</span> : <span className="badge s-validated">uploaded</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><div><h2>Upload real data</h2><p className="sub">Long-format CSV: <code>cell_code, month, metric, value</code></p></div></div>
          <form className="col" style={{ gap: 12 }} onSubmit={doUpload}>
            <p className="small muted">
              Metrics: <code>registered</code>, <code>night_light</code>, <code>built_up</code>, <code>digital_points</code>, <code>power_connections</code>, <code>listings</code>, <code>footfall</code>,
              or <code>survey_estimate</code> (month = FY start, e.g. <code>2025-04</code>). Rows for a new month create that month; missing metrics carry forward from the previous month.
            </p>
            <div className="row">
              <button type="button" className="btn sm" onClick={() => download('/datasets/template.csv', 'econoscope-upload-template.csv').catch((e) => toast(e.message))}>Template CSV</button>
              <button type="button" className="btn sm" onClick={() => download('/datasets/cells.csv', 'econoscope-cells.csv').catch((e) => toast(e.message))}>Grid cell reference</button>
            </div>
            <input className="input" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files[0])} aria-label="CSV file" />
            <button className="btn primary" disabled={!file || !!busy} style={{ alignSelf: 'flex-start' }}>{busy === 'upload' ? 'Uploading…' : 'Upload & validate'}</button>
            {upload && (
              <div className={upload.rejected ? 'error-box' : 'ok-box'}>
                Accepted {num(upload.accepted)} row(s){upload.rejected ? `, rejected ${num(upload.rejected)}` : ''}. {upload.metrics.length ? `Updated: ${upload.metrics.join(', ')}.` : ''}
                {upload.errors.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{upload.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>}
                {upload.accepted > 0 && <div style={{ marginTop: 6 }}>Run the detection engine to apply the new data.</div>}
              </div>
            )}
          </form>
        </div>
        <div className="card">
          <div className="card-head"><h2>Pipeline</h2></div>
          <div className="timeline">
            {[['Collect', 'Registrations, survey baselines, VIIRS night lights, built-up index, payment points, power connections, tourism.'],
              ['Nowcast', 'Ridge model trained on the latest survey FY maps signals to establishment-equivalents in every cell and month.'],
              ['Baseline', 'Seasonal index per cell (centred moving average) → seasonally adjusted activity. κ = normal observed/recorded ratio.'],
              ['Detect', 'Robust z-scores for visibility gap and YoY change, Isolation Forest on the multivariate profile, signal agreement and persistence.'],
              ['Validate', 'Priority queue → field teams → outcomes recalibrate cell baselines and measure precision.']].map(([t, d]) => (
              <div className="item" key={t}><div className="pin" /><div><div className="strong">{t}</div><div className="small muted">{d}</div></div></div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Engine runs</h2><p className="sub">Most recent first</p></div></div>
        {runs.loading && !runs.data ? <Loading /> : runs.error ? <ErrorBox>{runs.error}</ErrorBox> : (
          <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>Data month</th><th>Ran</th><th>By</th><th className="num">Cells</th><th className="num">New alerts</th><th className="num">Updated</th><th className="num">Model R²</th><th className="num">κ</th><th>Trained on</th><th className="num">Time</th></tr></thead>
            <tbody>{runs.data.map((r) => (
              <tr key={r.id}><td className="muted">{r.id}</td><td className="strong">{monthName(r.month)}</td><td className="small muted">{ago(r.started_at)}</td><td className="small">{r.triggered_by || 'seed / scheduler'}</td>
                <td className="num">{r.cells}</td><td className="num">{r.alerts_created}</td><td className="num">{r.alerts_updated}</td><td className="num">{num(r.r2, 3)}</td><td className="num">{num(r.kappa, 3)}</td><td className="small">{r.trainedOn}</td><td className="num small">{r.duration_ms} ms</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
