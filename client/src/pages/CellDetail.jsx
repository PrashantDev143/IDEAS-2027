import { Link, useParams } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';
import { useApi, Loading, ErrorBox, TypeBadge, StatusBadge, PriorityBadge, ChartTip, Empty } from '../components/ui.jsx';
import { num, pct, monthName, monthShort, calMonth, ZONE_META, OUTCOME_META } from '../lib/format.js';

const SIGNALS = [
  ['night_light', 'Night-time lights', 'nW/cm²/sr', '#f0b429'],
  ['digital_points', 'Digital payment points', 'active points', '#5aa9f0'],
  ['power_connections', 'Commercial power connections', 'connections', '#2ec4b6'],
  ['built_up', 'Built-up surface', '% of cell', '#9d8cf2'],
  ['listings', 'Hospitality listings', 'listings', '#f28c28'],
  ['footfall', 'Tourist footfall', 'visitors / month', '#ef5b5b'],
];

export default function CellDetail() {
  const { id } = useParams();
  const { data: d, error, loading } = useApi(`/cells/${id}`);
  if (loading && !d) return <Loading />;
  if (error) return <div className="page"><ErrorBox>{error}</ErrorBox></div>;
  const { cell, series, surveys, alerts, calibration } = d;
  const last = series[series.length - 1];
  const si = series.slice(-12).map((s) => ({ n: Number(s.month.slice(5)), m: calMonth(Number(s.month.slice(5))), si: s.seasonal_index })).sort((a, b) => a.n - b.n);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row small" style={{ marginBottom: 6 }}><Link to={`/app/map?cell=${cell.id}`}>← Map</Link><span className="muted">/</span><code>{cell.code}</code></div>
          <h1>{cell.name}</h1>
          <p className="sub">{cell.taluka} taluka · {cell.district} · {ZONE_META[cell.zone]} · {cell.area_km2} km² · tourism share {pct(cell.tourism_share, 0, false)}</p>
        </div>
      </div>

      <div className="grid g4">
        <div className="card stat"><div className="label">Activity index ({monthShort(last.month)})</div><div className="value">{num(last.eai, 1)}</div></div>
        <div className="card stat"><div className="label">Observed (seasonally adj.)</div><div className="value">{num(last.observed_sa)}</div><div className="hint">YoY {pct(last.yoy_activity, 1)}</div></div>
        <div className="card stat"><div className="label">Registered units</div><div className="value">{num(last.registered)}</div><div className="hint">YoY {pct(last.yoy_registered, 1)}</div></div>
        <div className="card stat"><div className="label">Visibility gap</div><div className="value" style={{ color: last.gap_z >= 2.5 ? 'var(--orange)' : last.gap_z <= -2.5 ? 'var(--violet)' : undefined }}>{last.gap_z > 0 ? '+' : ''}{num(last.gap_z, 1)}σ</div><div className="hint">{num(last.gap_abs)} establishment-eq. vs expected</div></div>
      </div>

      <div className="grid g-2-1">
        <div className="card">
          <div className="card-head"><div><h2>Observed vs recorded activity</h2><p className="sub">Monthly nowcast from signals, seasonally adjusted, against the level implied by registrations</p></div></div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthShort} interval={5} tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(x) => num(x)} />
                <Tooltip content={<ChartTip labelFmt={monthName} />} />
                <Legend iconType="plainline" />
                <Line dataKey="observed" name="Observed (raw)" stroke="rgba(240,180,41,.4)" dot={false} />
                <Line dataKey="observed_sa" name="Observed (seasonally adj.)" stroke="#f0b429" strokeWidth={2.2} dot={false} />
                <Line dataKey="expected" name="Expected from records" stroke="#2ec4b6" strokeDasharray="5 4" strokeWidth={2} dot={false} />
                <Line dataKey="registered" name="Registered" stroke="#8a8c9a" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Seasonal profile</h2><p className="sub">Monthly factor (1.0 = average month)</p></div></div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={si} margin={{ top: 5, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="m" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 10 }} />
                <YAxis tickLine={false} axisLine={false} domain={[0, 'auto']} />
                <ReferenceLine y={1} stroke="#8a8c9a" strokeDasharray="3 3" />
                <Tooltip content={<ChartTip fmt={(v) => num(v, 2)} />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                <Bar dataKey="si" name="Seasonal factor" fill="#2ec4b6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="divider" style={{ margin: '12px 0' }} />
          <h3 style={{ marginBottom: 8 }}>Survey baselines</h3>
          <table><tbody>{surveys.map((s) => <tr key={s.fy_start}><td>FY {s.fy_start}-{String(s.fy_start + 1).slice(2)}</td><td className="num">{num(s.estimate)} establishments</td></tr>)}</tbody></table>
          {calibration && <div className="note-box small" style={{ marginTop: 12 }}>Baseline recalibrated from field feedback: offset {num(calibration.offset, 3)} ({calibration.reason}).</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Independent signals</h2><p className="sub">Raw monthly values from each source</p></div></div>
        <div className="grid g3">
          {SIGNALS.map(([k, label, unit, color]) => (
            <div key={k}>
              <div className="row between small"><strong>{label}</strong><span className="muted">{num(last[k], k === 'night_light' || k === 'built_up' ? 1 : 0)} {unit}</span></div>
              <div style={{ height: 110 }}>
                <ResponsiveContainer>
                  <LineChart data={series} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                    <XAxis dataKey="month" hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip content={<ChartTip labelFmt={monthName} fmt={(v) => num(v, 1)} />} />
                    <Line dataKey={k} name={label} stroke={color} dot={false} strokeWidth={1.8} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Alert history</h2></div>
        {alerts.length === 0 ? <Empty>No anomalies have been raised for this cell.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Alert</th><th>Type</th><th>Priority</th><th className="num">Confidence</th><th>Detected</th><th>Status</th></tr></thead>
            <tbody>{alerts.map((a) => (
              <tr key={a.id}><td><Link to={`/app/alerts/${a.id}`}><code>{a.code}</code></Link></td><td><TypeBadge t={a.type} /></td><td><PriorityBadge p={a.priority} /></td>
                <td className="num">{Math.round(a.confidence)}</td><td className="small">{monthShort(a.first_detected)} → {monthShort(a.last_detected)}</td>
                <td><StatusBadge s={a.status} />{a.outcome && <span className="small muted"> {OUTCOME_META[a.outcome]}</span>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
