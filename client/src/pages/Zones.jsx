import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMeta } from '../components/Layout.jsx';
import { useApi, Loading, ErrorBox, Empty, TierBadge, SpatialBadge, TrendBadge, SensitiveBadge, Confidence, useToast } from '../components/ui.jsx';
import { download } from '../lib/api.js';
import { num, pct, sigma, monthName, TIER_META, TREND_META, SPATIAL_META } from '../lib/format.js';

const FILTERS = ['month', 'district', 'taluka', 'tier', 'peer', 'trend', 'spatial', 'direction', 'q', 'sort'];

// Ranked table of zones. Also used as the accessible "table view" of the map.
export function ZoneTable({ rows, onPick, max = 200 }) {
  if (!rows.length) return <Empty>No zones match these filters.</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>
          <th className="num" title="Rank within district by priority">Rank</th><th>Zone</th><th>Peer group</th><th>Tier</th>
          <th className="num" title="Expected minus registered footprint, standardised within the peer group">Peer-relative gap</th>
          <th>Confidence</th><th className="num">Registered</th><th className="num">Expected (range)</th><th className="num">Coverage</th><th>Pattern</th>
        </tr></thead>
        <tbody>
          {rows.slice(0, max).map((z) => (
            <tr key={z.id} className="click" onClick={() => onPick(z)}>
              <td className="num muted">{z.insufficient ? '—' : z.district_rank}</td>
              <td><div className="strong">{z.name}</div><div className="small muted">{z.taluka} · {z.district}{z.sensitive ? <> · <SensitiveBadge /></> : null}</div></td>
              <td className="small">{z.peer_group}</td>
              <td><TierBadge t={z.tier} /></td>
              <td className="num" style={{ color: z.gap_z >= 2 ? '#E69F00' : z.gap_z <= -2 ? '#56B4E9' : undefined }}>{z.insufficient ? '—' : sigma(z.gap_z)}</td>
              <td>{z.insufficient ? <span className="small muted">{z.insufficient_reason === 'suppressed' ? 'small count' : 'low coverage'}</span> : <Confidence value={z.confidence} />}</td>
              <td className="num">{z.registered === null ? <span className="muted" title="Suppressed: below the minimum cell size">&lt; min</span> : num(z.registered)}</td>
              <td className="num">{z.expected === null ? '—' : <>{num(z.expected)} <span className="muted small">({num(z.exp_lo)}–{num(z.exp_hi)})</span></>}</td>
              <td className="num">{pct(z.coverage, 0, false)}</td>
              <td><div className="row" style={{ gap: 4 }}>{!z.insufficient && z.spatial_class !== 'ns' && <SpatialBadge c={z.spatial_class} />}<TrendBadge t={z.gap_trend} /></div></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="small muted" style={{ marginTop: 8 }}>Showing the first {max} of {rows.length}. Narrow the filters or export the full list.</p>}
    </div>
  );
}

export default function Zones() {
  const { meta } = useMeta();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const qs = new URLSearchParams();
  for (const k of FILTERS) if (params.get(k)) qs.set(k, params.get(k));
  const { data, error, loading } = useApi(`/zones?${qs}`);
  const set = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const sel = (k, label, options) => (
    <select className="select" value={params.get(k) || ''} onChange={(e) => set(k, e.target.value)} aria-label={label}>
      <option value="">{label}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const counts = data ? data.rows.reduce((a, z) => ({ ...a, [z.tier]: (a[z.tier] || 0) + 1 }), {}) : {};

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Zone priorities · {monthName(data?.month || meta?.latest)}</div>
          <h1>Where to look first</h1>
          <p className="sub">Every zone ranked within its district by peer-relative gap × confidence. Zones without enough data show no score.</p>
        </div>
        <button className="btn" onClick={() => download(`/zones/export.csv?${qs}`, `econoscope-zones-${data?.month}.csv`).catch((e) => toast(e.message))}>⤓ Export CSV</button>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="row">
          {sel('district', 'All districts', (meta?.districts || []).map((d) => [d, d]))}
          {sel('taluka', 'All talukas', (meta?.talukas || []).filter((t) => !params.get('district') || t.district === params.get('district')).map((t) => [t.name, t.name]))}
          {sel('tier', 'Any tier', Object.entries(TIER_META).filter(([k]) => k !== 'control').map(([k, t]) => [k, t.label]))}
          {sel('peer', 'Any peer group', (meta?.peerGroups || []).map((p) => [p.id, p.name]))}
          {sel('direction', 'Either direction', [['above', 'Fewer on record than expected'], ['below', 'More on record than expected']])}
          {sel('trend', 'Any trend', Object.entries(TREND_META).filter(([k]) => k !== 'none').map(([k, t]) => [k, t.label]))}
          {sel('spatial', 'Any spatial pattern', Object.entries(SPATIAL_META).map(([k, t]) => [k, t.label]))}
          {sel('month', 'Latest month', [...(meta?.months || [])].reverse().map((m) => [m, monthName(m)]))}
          <input className="input" placeholder="Search zone or code" defaultValue={params.get('q') || ''} onKeyDown={(e) => e.key === 'Enter' && set('q', e.currentTarget.value)} onBlur={(e) => set('q', e.target.value)} style={{ flex: 1, minWidth: 150 }} />
          <select className="select" value={params.get('sort') || 'priority'} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
            <option value="priority">Sort: priority</option><option value="rank">Sort: district rank</option><option value="gap">Sort: gap</option>
            <option value="confidence">Sort: confidence</option><option value="activity">Sort: activity</option><option value="coverage">Sort: lowest coverage</option><option value="name">Sort: name</option>
          </select>
        </div>
      </div>

      <div className="card">
        {loading && !data ? <Loading /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <>
            <div className="row small muted" style={{ marginBottom: 10 }}>
              <span>{data.total} zones</span>
              {['high', 'medium', 'low', 'insufficient'].map((t) => counts[t] ? <span key={t}>· {counts[t]} {TIER_META[t].label.toLowerCase()}</span> : null)}
            </div>
            <ZoneTable rows={data.rows} onPick={(z) => nav(`/app/cells/${z.id}`)} />
          </>
        )}
      </div>
      <p className="small muted">{meta?.disclaimer}</p>
    </div>
  );
}
