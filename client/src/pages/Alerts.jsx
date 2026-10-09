import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMeta } from '../components/Layout.jsx';
import { useApi, Loading, ErrorBox, Empty, TierBadge, TypeBadge, StatusBadge, TrendBadge, SpatialBadge, SensitiveBadge, Confidence, useToast } from '../components/ui.jsx';
import { download } from '../lib/api.js';
import { num, pct, sigma, monthShort, TYPE_META, OUTCOME_META, TREND_META } from '../lib/format.js';

const FILTERS = ['status', 'type', 'priority', 'district', 'taluka', 'trend', 'q', 'minConfidence', 'sort', 'control'];

export default function Alerts() {
  const { meta } = useMeta();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'open,assigned';
  const control = params.get('control') === '1';
  const qs = new URLSearchParams();
  for (const k of FILTERS) { const v = k === 'status' ? status : params.get(k); if (v) qs.set(k, v); }
  const { data, error, loading } = useApi(`/alerts?${qs}`);
  const set = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v === '' || v === null) n.delete(k); else n.set(k, v); if (k === 'status' && v === '') n.set('status', ''); return n; }, { replace: true });
  const exp = (fmt) => download(`/alerts/export.${fmt}?${qs}`, `econoscope-validation-list.${fmt}`).catch((e) => toast(e.message));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Flags</div>
          <h1>{control ? 'Random audit sample' : 'Anomaly register'}</h1>
          <p className="sub">{control ? 'Zones drawn at random across all tiers. Their outcomes show whether the ranking beats chance.' : 'Zones where the registered footprint differs from what independent signals suggest, or where activity is changing fast.'}</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => exp('csv')} title="Validation list with reasons and suggested checks">⤓ CSV</button>
          <button className="btn" onClick={() => exp('pdf')} title="Printable validation list">⤓ PDF</button>
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="row">
          <div className="seg">
            {[['open,assigned', 'Active'], ['open', 'Open'], ['assigned', 'Assigned'], ['validated', 'Validated'], ['dismissed', 'Closed'], ['', 'All']].map(([v, l]) => (
              <button key={l} className={status === v ? 'on' : ''} onClick={() => set('status', v)}>{l}</button>
            ))}
          </div>
          <div className="seg">
            <button className={!control ? 'on' : ''} onClick={() => set('control', '')}>Prioritised</button>
            <button className={control ? 'on' : ''} onClick={() => set('control', '1')}>Control sample</button>
          </div>
          {!control && <>
            <select className="select" value={params.get('type') || ''} onChange={(e) => set('type', e.target.value)} aria-label="Type">
              <option value="">All types</option>
              {Object.entries(TYPE_META).filter(([k]) => k !== 'audit_control').map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
            <select className="select" value={params.get('priority') || ''} onChange={(e) => set('priority', e.target.value)} aria-label="Tier">
              <option value="">Any tier</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
            <select className="select" value={params.get('trend') || ''} onChange={(e) => set('trend', e.target.value)} aria-label="Gap trend" title="Emergence: gaps that are new or widening">
              <option value="">Any trend</option>{['new', 'growing', 'stable', 'shrinking'].map((k) => <option key={k} value={k}>{TREND_META[k].label}</option>)}
            </select>
          </>}
          <select className="select" value={params.get('district') || ''} onChange={(e) => set('district', e.target.value)} aria-label="District">
            <option value="">All districts</option>{meta?.districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="select" value={params.get('taluka') || ''} onChange={(e) => set('taluka', e.target.value)} aria-label="Taluka">
            <option value="">All talukas</option>{meta?.talukas.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
          <select className="select" value={params.get('minConfidence') || ''} onChange={(e) => set('minConfidence', e.target.value)} aria-label="Minimum confidence">
            <option value="">Any confidence</option><option value="70">High band (70+)</option><option value="45">Medium band and up (45+)</option>
          </select>
          <input className="input" placeholder="Search zone or code" defaultValue={params.get('q') || ''} onKeyDown={(e) => e.key === 'Enter' && set('q', e.currentTarget.value)} onBlur={(e) => set('q', e.target.value)} style={{ flex: 1, minWidth: 140 }} />
          <select className="select" value={params.get('sort') || 'priority'} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
            <option value="priority">Sort: priority</option><option value="confidence">Sort: confidence</option><option value="gap">Sort: gap size</option><option value="recent">Sort: newest</option><option value="updated">Sort: last updated</option>
          </select>
        </div>
      </div>

      <div className="card">
        {loading && !data ? <Loading /> : error ? <ErrorBox>{error}</ErrorBox> : !data.rows.length ? <Empty>No flags match these filters.</Empty> : (
          <>
            <div className="small muted" style={{ marginBottom: 8 }}>{data.total} {control ? 'control visit' : 'flag'}{data.total === 1 ? '' : 's'}</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Flag</th><th>Zone</th><th>Type</th><th>Tier</th><th>Confidence</th><th className="num">Registered</th><th className="num">Expected</th><th className="num">Gap / YoY</th><th>Pattern</th><th>Detected</th><th>Status</th></tr></thead>
                <tbody>
                  {data.rows.map((a) => {
                    const isChange = a.type === 'emerging_hotspot' || a.type === 'contraction';
                    return (
                      <tr key={a.id} className="click" onClick={() => nav(`/app/alerts/${a.id}`)}>
                        <td><code>{a.code}</code>{!a.still_active && ['open', 'assigned'].includes(a.status) && !a.is_control && <div className="small muted" title="Condition not seen in the latest run">not recurring</div>}</td>
                        <td><div className="strong">{a.name}</div><div className="small muted">{a.taluka}{a.sensitive ? <> · <SensitiveBadge /></> : null}</div></td>
                        <td><TypeBadge t={a.type} /></td>
                        <td><TierBadge t={a.priority} /></td>
                        <td><Confidence value={a.confidence} /></td>
                        <td className="num">{num(a.registered)}</td>
                        <td className="num">{num(a.expected)} <span className="small muted">({num(a.exp_lo)}–{num(a.exp_hi)})</span></td>
                        <td className="num">{isChange ? pct(a.yoy_activity) : sigma(a.gap_z)}</td>
                        <td><div className="row" style={{ gap: 4 }}>{a.spatial_class && a.spatial_class !== 'ns' && <SpatialBadge c={a.spatial_class} />}{!a.is_control && <TrendBadge t={a.gap_trend} />}</div></td>
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
      <p className="small muted">{meta?.disclaimer} Exports are never broken down by officer.</p>
    </div>
  );
}
