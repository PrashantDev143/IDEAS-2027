import { useState, Fragment } from 'react';
import { useApi, Loading, ErrorBox, useToast } from '../components/ui.jsx';
import { useMeta } from '../components/Layout.jsx';
import { api, download } from '../lib/api.js';
import { useAuth, can } from '../lib/auth.jsx';
import { num, pct, monthName, ago } from '../lib/format.js';

const CAT_COLORS = { official: '#56B4E9', satellite: '#f0b429', tourism: '#E69F00', enrichment: '#CC79A7' };

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
  const [open, setOpen] = useState(null);
  const canRun = can(user, 'admin', 'analyst');

  const act = async (kind) => {
    setBusy(kind); setErr('');
    try {
      const r = await api(kind === 'ingest' ? '/engine/ingest-next' : '/engine/run', { method: 'POST' });
      toast(`${kind === 'ingest' ? `Ingested ${monthName(r.ingested)}. ` : ''}Scores published for ${monthName(r.month)}: ${r.created} new flag(s), ${r.updated} updated, ${r.insufficient} zones with insufficient data.`);
      runs.reload(); ds.reload(); refreshMeta();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const doUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy('upload'); setErr(''); setUpload(null);
    try {
      const form = new FormData(); form.append('file', file);
      setUpload(await api('/datasets/upload', { method: 'POST', form })); ds.reload(); refreshMeta();
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Data & pipeline</div>
          <h1>Sources, provenance and model runs</h1>
          <p className="sub">A monthly batch: ingest and zone → model engine → portal. Scores are published only when a run completes in full.</p>
        </div>
        {canRun && <div className="row">
          <button className="btn" disabled={!!busy} onClick={() => act('run')}>{busy === 'run' ? 'Running…' : '▶ Run model engine'}</button>
          {can(user, 'admin') && <button className="btn primary" disabled={!!busy} onClick={() => act('ingest')} title="Pulls the next month from the simulated source feeds and re-scores">{busy === 'ingest' ? 'Ingesting…' : '⇣ Ingest next month'}</button>}
        </div>}
      </div>
      <ErrorBox>{err}</ErrorBox>

      <div className="card">
        <div className="card-head"><div><h2>Data catalogue</h2><p className="sub">Everything is aggregated to zones before it reaches the model. No individually identifiable mobility, financial or biometric data is ever ingested.</p></div></div>
        {ds.loading && !ds.data ? <Loading /> : ds.error ? <ErrorBox>{ds.error}</ErrorBox> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Layer</th><th>Role</th><th>Priority</th><th>Source and licence</th><th>Coverage</th><th className="num">Completeness</th><th>Version</th><th>Status</th></tr></thead>
            <tbody>{ds.data.datasets.map((d) => (
              <Fragment key={d.key}>
                <tr className="click" onClick={() => setOpen(open === d.key ? null : d.key)}>
                  <td><div className="strong">{d.name}</div><div className="small muted" style={{ maxWidth: 300 }}>{d.description}</div></td>
                  <td><span className="badge" style={{ color: CAT_COLORS[d.category], borderColor: 'currentColor' }}>{d.category}</span><div className="small muted">{d.role}</div></td>
                  <td>{d.priority}{!d.enabled && <div className="small" style={{ color: '#E69F00' }}>switched off</div>}</td>
                  <td className="small" style={{ maxWidth: 280 }}>{d.source}<div className="muted">{d.licence} · {d.access}</div></td>
                  <td className="small">{d.coverage}<div className="muted">{d.frequency}</div></td>
                  <td className="num">{pct(d.completeness, 1, false)}<div className="small muted">{num(d.records)} values</div></td>
                  <td className="small">v{d.version}<div className="muted">{ago(d.last_updated)}</div></td>
                  <td>{d.synthetic ? <span className="synthetic-pill">synthetic</span> : <span className="badge s-validated">uploaded</span>}</td>
                </tr>
                {open === d.key && <tr><td colSpan={8} style={{ background: 'var(--bg-2)' }}>
                  <div className="small strong" style={{ marginBottom: 4 }}>Version history</div>
                  {d.versions.map((v) => <div key={v.version} className="small muted">v{v.version} · acquired {v.acquired_on} · period {v.period} · {num(v.records)} values · {v.transformation}</div>)}
                </td></tr>}
              </Fragment>
            ))}</tbody>
          </table></div>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>Completeness below 100% means some zones sent no value for some months. Those gaps lower confidence and are never filled in silently. Click a row for its version history.</p>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><div><h2>Upload real data</h2><p className="sub">Long-format CSV of zone aggregates: <code>cell_code, month, metric, value</code></p></div></div>
          {canRun ? (
            <form className="col" style={{ gap: 12 }} onSubmit={doUpload}>
              <p className="small muted">
                Metrics: <code>registered</code>, <code>night_light</code>, <code>built_up</code>, <code>listings</code>, <code>footfall</code>, <code>power_connections</code>, <code>digital_points</code>,
                or <code>survey_estimate</code> (month = FY start, e.g. <code>2025-04</code>). Upload zone totals only, never individual records. Anything you do not supply stays missing.
              </p>
              <div className="row">
                <button type="button" className="btn sm" onClick={() => download('/datasets/template.csv', 'econoscope-upload-template.csv').catch((e) => toast(e.message))}>Template CSV</button>
                <button type="button" className="btn sm" onClick={() => download('/datasets/cells.csv', 'econoscope-zones.csv').catch((e) => toast(e.message))}>Zone reference</button>
              </div>
              <input className="input" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files[0])} aria-label="CSV file" />
              <button className="btn primary" disabled={!file || !!busy} style={{ alignSelf: 'flex-start' }}>{busy === 'upload' ? 'Uploading…' : 'Upload & validate'}</button>
              {upload && (
                <div className={upload.rejected ? 'error-box' : 'ok-box'}>
                  Accepted {num(upload.accepted)} row(s){upload.rejected ? `, rejected ${num(upload.rejected)}` : ''}. {upload.metrics.length ? `New version recorded for: ${upload.metrics.join(', ')}.` : ''}
                  {upload.errors.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{upload.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>}
                  {upload.accepted > 0 && <div style={{ marginTop: 6 }}>Run the model engine to publish new scores.</div>}
                </div>
              )}
            </form>
          ) : <p className="small muted">Analysts and administrators upload data and run the engine.</p>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Pipeline</h2></div>
          <div className="timeline">
            {[['Data sources', 'Registrations, survey baseline, night lights, built-up footprint, tourism. Optional: power, payment points.'],
              ['Ingest and zone', 'Validate and version each upload, aggregate to zones, suppress small counts, store provenance.'],
              ['Model engine', 'Peer groups → expected footprint → residual with range → Local Moran / Gi* → change-point → confidence.'],
              ['Government portal', 'Shadow map, peer-relative heatmap, evidence cards, validation exports, alerts, audit log.'],
              ['Field validation', 'Visit, verify, offer support, record the outcome. Outcomes recalibrate the model.']].map(([t, d]) => (
              <div className="item" key={t}><div className="pin" /><div><div className="strong">{t}</div><div className="small muted">{d}</div></div></div>
            ))}
          </div>
          <p className="small muted">Enforcement decisions stay with officials, outside EconoScope.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Model runs</h2><p className="sub">Most recent first. The inputs hash makes every published score reproducible.</p></div></div>
        {runs.loading && !runs.data ? <Loading /> : runs.error ? <ErrorBox>{runs.error}</ErrorBox> : (
          <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>Data month</th><th>Ran</th><th>By</th><th className="num">Zones</th><th className="num">New flags</th><th className="num">Updated</th><th className="num">Insufficient</th><th className="num">Held back</th><th className="num">Fit R²</th><th>Inputs hash</th><th className="num">Time</th></tr></thead>
            <tbody>{runs.data.map((r) => (
              <tr key={r.id}><td className="muted">{r.id}</td><td className="strong">{monthName(r.month)}</td><td className="small muted">{ago(r.started_at)}</td><td className="small">{r.triggered_by || 'scheduled'}</td>
                <td className="num">{r.cells}</td><td className="num">{r.alerts_created}</td><td className="num">{r.alerts_updated}</td><td className="num">{r.insufficient ?? '—'}</td><td className="num">{r.suppressedSingleSignal ?? '—'}</td>
                <td className="num">{num(r.r2, 3)}</td><td><code className="muted">{r.inputs_hash}</code></td><td className="num small">{num(r.duration_ms / 1000, 1)} s</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
