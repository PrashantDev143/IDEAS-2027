import { Link, useNavigate } from 'react-router-dom';
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, Cell } from 'recharts';
import { useApi, Loading, ErrorBox, Stat, TierBadge, TypeBadge, StatusBadge, TrendBadge, SensitiveBadge, Confidence, ChartTip } from '../components/ui.jsx';
import { num, pct, compact, monthShort, monthName, TYPE_META, TIER_META, ACTION_META, ago } from '../lib/format.js';

export default function Dashboard() {
  const { data: d, error, loading } = useApi('/dashboard');
  const nav = useNavigate();
  if (loading && !d) return <Loading />;
  if (error) return <div className="page"><ErrorBox>{error}</ErrorBox></div>;

  const last = d.trend[d.trend.length - 1];
  const open = (d.byStatus.open || 0) + (d.byStatus.assigned || 0);
  const typeData = Object.entries(TYPE_META).filter(([k]) => k !== 'audit_control').map(([k, t]) => ({ type: t.short, n: d.openByType[k] || 0, fill: t.color }));
  const tierData = ['high', 'medium', 'low', 'insufficient'].map((k) => ({ tier: TIER_META[k].label, n: d.tiers[k] || 0, fill: TIER_META[k].color }));
  const scored = d.zones - (d.tiers.insufficient || 0);
  const lift = d.hitRate !== null && d.controlRate ? d.hitRate / d.controlRate : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Overview · {monthName(d.latest)}</div>
          <h1>Where do records and activity diverge?</h1>
          <p className="sub">{d.zones} zones across 12 talukas · each compared with zones of the same kind</p>
        </div>
        <div className="row">
          <Link to="/app/map?mode=shadow" className="btn">Shadow map</Link>
          <Link to="/app/zones" className="btn primary">Plan this month's visits</Link>
        </div>
      </div>

      <div className="grid g4">
        <Stat accent="orange" label="High-priority zones" value={num(d.tiers.high || 0)}
          hint={<>{d.tiers.medium || 0} medium · <Link to="/app/zones?tier=high">see ranked list</Link></>} />
        <Stat accent="amber" label="New or widening gaps" value={num(d.emerging)}
          hint={<Link to="/app/zones?trend=growing">emergence view</Link>} />
        <Stat accent="violet" label="Zones with insufficient data" value={num(d.tiers.insufficient || 0)}
          hint={`${pct(scored / d.zones, 0, false)} of zones carry a score`} />
        <Stat accent="teal" label="Field hit rate vs random" value={lift === null ? '—' : `${num(lift, 1)}×`}
          hint={d.hitRate === null ? 'no validations yet' : <>{pct(d.hitRate, 0, false)} prioritised vs {pct(d.controlRate, 0, false)} control</>} />
      </div>

      <div className="grid g-2-1">
        <div className="card">
          <div className="card-head">
            <div><h2>Registered vs expected footprint</h2><p className="sub">Statewide totals for scored zones. The expected line is what independent signals suggest should be on record.</p></div>
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={d.trend} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthShort} interval={5} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={compact} width={52} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTip labelFmt={monthName} />} />
                <Legend iconType="plainline" />
                <Line type="monotone" dataKey="expected" name="Expected footprint" stroke="#f0b429" strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="registered" name="Registered" stroke="#56B4E9" strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="observed_sa" name="Inferred activity (seasonally adj.)" stroke="#8a8c9a" strokeDasharray="4 3" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="small muted">Statewide the two lines sit close together by design: the model looks for zones that depart from their peers, not for a statewide shortfall. {compact(last.registered)} units on record in {monthName(d.latest)}.</p>
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Zones by priority tier</h2><p className="sub">Priority = peer-relative gap × confidence</p></div></div>
          <div style={{ height: 150 }}>
            <ResponsiveContainer>
              <BarChart data={tierData} layout="vertical" margin={{ left: 10, right: 30 }}>
                <XAxis type="number" hide /><YAxis type="category" dataKey="tier" width={104} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                <Bar dataKey="n" name="Zones" radius={[0, 4, 4, 0]} barSize={15} label={{ position: 'right', fill: '#b4b6c2', fontSize: 12 }}>
                  {tierData.map((t) => <Cell key={t.tier} fill={t.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="divider" style={{ margin: '10px 0' }} />
          <h3 style={{ marginBottom: 4 }}>{open} open flags by type</h3>
          <div style={{ height: 130 }}>
            <ResponsiveContainer>
              <BarChart data={typeData} layout="vertical" margin={{ left: 10, right: 30 }}>
                <XAxis type="number" hide /><YAxis type="category" dataKey="type" width={104} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                <Bar dataKey="n" name="Open flags" radius={[0, 4, 4, 0]} barSize={13} label={{ position: 'right', fill: '#b4b6c2', fontSize: 12 }}>
                  {typeData.map((t) => <Cell key={t.type} fill={t.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid g-2-1">
        <div className="card">
          <div className="card-head"><div><h2>Validation priority queue</h2><p className="sub">Open flags, highest priority first</p></div><Link to="/app/alerts" className="small">All flags →</Link></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Flag</th><th>Zone</th><th>Type</th><th>Tier</th><th>Confidence</th><th>Trend</th><th>Status</th></tr></thead>
              <tbody>
                {d.topAlerts.map((a) => (
                  <tr key={a.id} className="click" onClick={() => nav(`/app/alerts/${a.id}`)}>
                    <td><code>{a.code}</code></td>
                    <td><div className="strong">{a.name}</div><div className="small muted">{a.taluka}{a.sensitive ? <> · <SensitiveBadge /></> : null}</div></td>
                    <td><TypeBadge t={a.type} /></td>
                    <td><TierBadge t={a.priority} /></td>
                    <td><Confidence value={a.confidence} /></td>
                    <td><TrendBadge t={a.gap_trend} /></td>
                    <td><StatusBadge s={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Recent activity</h2></div>
          <div className="timeline">
            {d.recent.map((l) => (
              <div className="item" key={l.id}>
                <div className="pin" />
                <div className="small">
                  <strong>{l.user_name || 'System'}</strong> {ACTION_META[l.action] || l.action}
                  {l.entity === 'alert' && l.entity_id && <> · <Link to={`/app/alerts/${l.entity_id}`}>view</Link></>}
                  <div className="muted">{ago(l.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Taluka summary</h2><p className="sub">{monthName(d.latest)} · registered and expected totals cover scored zones only</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Taluka</th><th>District</th><th className="num">Zones</th><th className="num">High</th><th className="num">Medium</th><th className="num">Insufficient data</th><th className="num">Activity index</th><th className="num">Registered</th><th className="num">Expected</th><th className="num">Coverage</th><th className="num">Open flags</th></tr></thead>
            <tbody>
              {d.talukas.map((t) => (
                <tr key={t.taluka} className="click" onClick={() => nav(`/app/zones?taluka=${t.taluka}`)}>
                  <td className="strong">{t.taluka}</td><td className="muted">{t.district}</td>
                  <td className="num">{t.zones}</td>
                  <td className="num" style={{ color: t.high ? TIER_META.high.color : undefined }}>{t.high || '—'}</td>
                  <td className="num" style={{ color: t.medium ? TIER_META.medium.color : undefined }}>{t.medium || '—'}</td>
                  <td className="num muted">{t.insufficient || '—'}</td>
                  <td className="num">{num(t.eai, 1)}</td>
                  <td className="num">{num(t.registered)}</td><td className="num">{num(t.expected)}</td>
                  <td className="num">{pct(t.coverage, 0, false)}</td>
                  <td className="num">{t.open_alerts || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
