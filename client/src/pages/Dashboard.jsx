import { Link, useNavigate } from 'react-router-dom';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, Cell } from 'recharts';
import { useApi, Loading, ErrorBox, Stat, PriorityBadge, TypeBadge, StatusBadge, Confidence, ChartTip } from '../components/ui.jsx';
import { num, pct, compact, monthShort, monthName, TYPE_META, ACTION_META, ago } from '../lib/format.js';

export default function Dashboard() {
  const { data: d, error, loading } = useApi('/dashboard');
  const nav = useNavigate();
  if (loading && !d) return <Loading />;
  if (error) return <div className="page"><ErrorBox>{error}</ErrorBox></div>;

  const last = d.trend[d.trend.length - 1];
  const yearAgo = d.trend[d.trend.length - 13];
  const open = (d.byStatus.open || 0) + (d.byStatus.assigned || 0);
  const typeData = Object.entries(TYPE_META).map(([k, t]) => ({ type: t.short, n: d.openByType[k] || 0, fill: t.color }));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Overview · {monthName(d.latest)}</div>
          <h1>Goa economic activity monitor</h1>
          <p className="sub">{d.cellsMonitored} grid cells across 12 talukas · seasonally adjusted observed activity compared with official records</p>
        </div>
        <div className="row">
          <Link to="/app/map" className="btn">Open map</Link>
          <Link to="/app/alerts" className="btn primary">Review alerts</Link>
        </div>
      </div>

      <div className="grid g4">
        <Stat accent="amber" label="Observed activity (seasonally adj.)" value={compact(last.observed_sa)}
          hint={<>establishment-equivalents · {pct(last.observed_sa / yearAgo.observed_sa - 1, 1)} YoY</>} />
        <Stat accent="teal" label="Registered establishments" value={compact(last.registered)}
          hint={<>official records · {pct(last.registered / yearAgo.registered - 1, 1)} YoY</>} />
        <Stat accent="orange" label="Activity in flagged gap zones" value={compact(d.unrecordedEstimate)}
          hint="above what records imply, where gap z ≥ 2" />
        <Stat accent="violet" label="Open anomalies" value={num(open)}
          hint={<><span style={{ color: '#ff8a8a' }}>{d.openByPriority.high || 0} high</span> · {d.openByPriority.medium || 0} medium · {d.openByPriority.low || 0} low</>} />
      </div>

      <div className="grid g-2-1">
        <div className="card">
          <div className="card-head">
            <div><h2>Observed vs recorded activity</h2><p className="sub">Statewide totals. Seasonal adjustment removes the tourism cycle, so the trend shows underneath.</p></div>
          </div>
          <div style={{ height: 290 }}>
            <ResponsiveContainer>
              <ComposedChart data={d.trend} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthShort} interval={5} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={compact} width={52} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTip labelFmt={monthName} />} />
                <Legend iconType="plainline" />
                <Area type="monotone" dataKey="observed" name="Observed (raw, seasonal)" stroke="none" fill="rgba(240,180,41,.12)" />
                <Line type="monotone" dataKey="observed_sa" name="Observed (seasonally adj.)" stroke="#f0b429" strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="expected" name="Expected from records" stroke="#2ec4b6" strokeWidth={2} dot={false} strokeDasharray="5 4" />
                <Line type="monotone" dataKey="registered" name="Registered" stroke="#8a8c9a" strokeWidth={1.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Open anomalies by type</h2><p className="sub">{d.validations} field validations so far · precision {d.precision === null ? '—' : pct(d.precision, 0, false)}</p></div></div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={typeData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="type" width={86} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                <Bar dataKey="n" name="Open alerts" radius={[0, 4, 4, 0]} barSize={16} label={{ position: 'right', fill: '#b4b6c2', fontSize: 12 }}>
                  {typeData.map((t) => <Cell key={t.type} fill={t.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="col small" style={{ gap: 6, marginTop: 6 }}>
            {Object.entries(TYPE_META).map(([k, t]) => <div key={k} className="muted"><strong style={{ color: t.color }}>{t.short}:</strong> {t.desc}</div>)}
          </div>
        </div>
      </div>

      <div className="grid g-2-1">
        <div className="card">
          <div className="card-head"><div><h2>Validation priority queue</h2><p className="sub">Ranked by confidence × estimated impact</p></div><Link to="/app/alerts" className="small">All alerts →</Link></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Alert</th><th>Location</th><th>Type</th><th>Priority</th><th>Confidence</th><th>Status</th></tr></thead>
              <tbody>
                {d.topAlerts.map((a) => (
                  <tr key={a.id} className="click" onClick={() => nav(`/app/alerts/${a.id}`)}>
                    <td><code>{a.code}</code></td>
                    <td><div className="strong">{a.name}</div><div className="small muted">{a.taluka}</div></td>
                    <td><TypeBadge t={a.type} /></td>
                    <td><PriorityBadge p={a.priority} /></td>
                    <td><Confidence value={a.confidence} /></td>
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
        <div className="card-head"><div><h2>Taluka summary</h2><p className="sub">{monthName(d.latest)} · observed activity is seasonally adjusted</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Taluka</th><th>District</th><th className="num">Cells</th><th className="num">Activity index</th><th className="num">Observed</th><th className="num">Expected from records</th><th className="num">Gap</th><th className="num">MoM</th><th className="num">Open alerts</th></tr></thead>
            <tbody>
              {d.talukas.map((t) => {
                const gap = t.observed_sa / t.expected - 1;
                return (
                  <tr key={t.taluka}>
                    <td className="strong">{t.taluka}</td><td className="muted">{t.district}</td>
                    <td className="num">{t.cells}</td><td className="num">{num(t.eai, 1)}</td>
                    <td className="num">{num(t.observed_sa)}</td><td className="num">{num(t.expected)}</td>
                    <td className="num" style={{ color: gap > 0.08 ? 'var(--orange)' : gap < -0.08 ? 'var(--violet)' : undefined }}>{pct(gap, 1)}</td>
                    <td className="num">{pct(t.mom, 1)}</td>
                    <td className="num">{t.open_alerts ? <Link to={`/app/alerts?taluka=${t.taluka}`}>{t.open_alerts}</Link> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
