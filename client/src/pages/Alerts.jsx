import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMeta } from '../components/Layout.jsx';
import { useApi, Loading, ErrorBox, Empty, PriorityBadge, TypeBadge, StatusBadge, Confidence, useToast } from '../components/ui.jsx';
import { download } from '../lib/api.js';
import { num, pct, monthShort, TYPE_META, OUTCOME_META } from '../lib/format.js';

const FILTERS = ['status', 'type', 'priority', 'taluka', 'q', 'minConfidence', 'sort'];

export default function Alerts() {
  const { meta } = useMeta();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'open,assigned';
  const qs = new URLSearchParams();
  for (const k of FILTERS) { const v = k === 'status' ? status : params.get(k); if (v) qs.set(k, v); }
  const { data, error, loading } = useApi(`/alerts?${qs}`);

  const set = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v === '' || v === null) n.delete(k); else n.set(k, v); if (k === 'status' && v === '') n.set('status', ''); return n; }, { replace: true });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Alerts</div>
          <h1>Anomaly register</h1>
          <p className="sub">Each alert is a location where observed activity is changing or differs from official records, with its evidence.</p>
        </div>
        <button className="btn" onClick={() => download(`/alerts/export.csv?${qs}`, 'econoscope-alerts.csv').catch((e) => toast(e.message))}>⤓ Export CSV</button>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="row">
          <div className="seg">
            {[['open,assigned', 'Active'], ['open', 'Open'], ['assigned', 'Assigned'], ['validated', 'Validated'], ['dismissed', 'Dismissed'], ['', 'All']].map(([v, l]) => (
              <button key={l} className={status === v ? 'on' : ''} onClick={() => set('status', v)}>{l}</button>
            ))}
          </div>
          <select className="select" value={params.get('type') || ''} onChange={(e) => set('type', e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {Object.entries(TYPE_META).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
          <select className="select" value={params.get('priority') || ''} onChange={(e) => set('priority', e.target.value)} aria-label="Priority">
            <option value="">Any priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
          <select className="select" value={params.get('taluka') || ''} onChange={(e) => set('taluka', e.target.value)} aria-label="Taluka">
            <option value="">All talukas</option>
            {meta?.talukas.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
          <select className="select" value={params.get('minConfidence') || ''} onChange={(e) => set('minConfidence', e.target.value)} aria-label="Minimum confidence">
            <option value="">Any confidence</option><option value="70">≥ 70</option><option value="50">≥ 50</option><option value="30">≥ 30</option>
          </select>
          <input className="input" placeholder="Search place or code" defaultValue={params.get('q') || ''} onKeyDown={(e) => e.key === 'Enter' && set('q', e.currentTarget.value)} onBlur={(e) => set('q', e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <select className="select" value={params.get('sort') || 'priority'} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
            <option value="priority">Sort: priority</option><option value="confidence">Sort: confidence</option><option value="gap">Sort: gap size</option><option value="recent">Sort: newest</option><option value="updated">Sort: last updated</option>
          </select>
        </div>
      </div>

      <div className="card">
        {loading && !data ? <Loading /> : error ? <ErrorBox>{error}</ErrorBox> : !data.rows.length ? <Empty>No alerts match these filters.</Empty> : (
          <>
            <div className="small muted" style={{ marginBottom: 8 }}>{data.total} alert{data.total === 1 ? '' : 's'}</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Alert</th><th>Location</th><th>Type</th><th>Priority</th><th>Confidence</th><th className="num">Observed</th><th className="num">Expected</th><th className="num">Gap / YoY</th><th>Detected</th><th>Status</th></tr></thead>
                <tbody>
                  {data.rows.map((a) => {
                    const isChange = a.type === 'emerging_hotspot' || a.type === 'contraction';
                    return (
                      <tr key={a.id} className="click" onClick={() => nav(`/app/alerts/${a.id}`)}>
                        <td><code>{a.code}</code>{!a.still_active && ['open', 'assigned'].includes(a.status) && <div className="small muted" title="Condition not seen in the latest run">not recurring</div>}</td>
                        <td><div className="strong">{a.name}</div><div className="small muted">{a.taluka}</div></td>
                        <td><TypeBadge t={a.type} /></td>
                        <td><PriorityBadge p={a.priority} /></td>
                        <td><Confidence value={a.confidence} /></td>
                        <td className="num">{num(a.observed)}</td>
                        <td className="num">{num(a.expected)}</td>
                        <td className="num">{isChange ? pct(a.yoy_activity) : `${a.gap_abs > 0 ? '+' : ''}${num(a.gap_abs)} (${pct(a.gap_pct)})`}</td>
                        <td className="small">{monthShort(a.first_detected)}{a.last_detected !== a.first_detected && <span className="muted"> → {monthShort(a.last_detected)}</span>}</td>
                        <td><StatusBadge s={a.status} />{a.assignee && a.status === 'assigned' && <div className="small muted">{a.assignee}</div>}{a.outcome && <div className="small muted">{OUTCOME_META[a.outcome]}</div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
