import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';
import { useApi, Loading, ErrorBox, ChartTip, Empty } from '../components/ui.jsx';
import { num, pct, calMonth, monthName, TYPE_META, OUTCOME_META, ZONE_META } from '../lib/format.js';

const OUTCOME_COLORS = { confirmed: '#3ecf8e', partial: '#a6e3c4', explained: '#f0b429', false_positive: '#ef5b5b', data_issue: '#8a8c9a' };
const ZONE_COLORS = { coastal: '#f28c28', urban: '#f0b429', industrial: '#5aa9f0', mining: '#9d8cf2', rural: '#2ec4b6', forest: '#3ecf8e', heritage: '#ef5b5b' };

export default function Analytics() {
  const { data: d, error, loading } = useApi('/analytics');
  if (loading && !d) return <Loading />;
  if (error) return <div className="page"><ErrorBox>{error}</ErrorBox></div>;

  const byType = d.byType.map((t) => ({ ...t, label: TYPE_META[t.type]?.short }));
  const totalV = d.byType.reduce((s, t) => s + t.n, 0);
  const hits = d.byType.reduce((s, t) => s + t.confirmed + 0.5 * t.partial, 0);
  const calib = d.calibration.map((c) => ({ band: `${c.band}–${c.band + 20}`, rate: c.n ? c.hits / c.n : 0, n: c.n }));
  const gt = d.groundTruth.filter((g) => g.found !== null && ['confirmed', 'partially_confirmed'].includes(g.outcome));
  const mape = gt.length ? gt.reduce((s, g) => s + Math.abs(g.estimated - g.found) / Math.max(1, g.found), 0) / gt.length : null;

  const zones = [...new Set(d.seasonality.map((s) => s.zone))];
  const seas = Array.from({ length: 12 }, (_, i) => {
    const row = { m: calMonth(i + 1) };
    for (const z of zones) row[z] = d.seasonality.find((s) => s.zone === z && s.cal_month === i + 1)?.si;
    return row;
  });
  const m = d.model;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Analytics & model</div>
          <h1>Is the model working?</h1>
          <p className="sub">Detection quality measured against field ground truth, plus the structure of the baseline model</p>
        </div>
      </div>

      <div className="grid g4">
        <div className="card stat accent-teal"><div className="label">Field-validated precision</div><div className="value">{totalV ? pct(hits / totalV, 0, false) : '—'}</div><div className="hint">{totalV} validations · partial counts as ½</div></div>
        <div className="card stat accent-amber"><div className="label">Ground-truth count error (MAPE)</div><div className="value">{mape === null ? '—' : pct(mape, 1, false)}</div><div className="hint">model estimate vs establishments counted</div></div>
        <div className="card stat accent-orange"><div className="label">Nowcast model fit (R²)</div><div className="value">{m ? num(m.r2, 3) : '—'}</div><div className="hint">trained on {m?.trainedOn} survey baseline · n={m?.n}</div></div>
        <div className="card stat accent-violet"><div className="label">Normal observed/recorded ratio κ</div><div className="value">{m ? num(m.kappa, 3) : '—'}</div><div className="hint">learned from baseline window</div></div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><div><h2>Validation outcomes by alert type</h2><p className="sub">What field teams found</p></div></div>
          {byType.length === 0 ? <Empty>No validations yet.</Empty> : (
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={byType} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Legend />
                  <Bar dataKey="confirmed" stackId="a" name="Confirmed" fill={OUTCOME_COLORS.confirmed} />
                  <Bar dataKey="partial" stackId="a" name="Partial" fill={OUTCOME_COLORS.partial} />
                  <Bar dataKey="explained" stackId="a" name="Explained" fill={OUTCOME_COLORS.explained} />
                  <Bar dataKey="false_positive" stackId="a" name="False positive" fill={OUTCOME_COLORS.false_positive} />
                  <Bar dataKey="data_issue" stackId="a" name="Data issue" fill={OUTCOME_COLORS.data_issue} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Confidence calibration</h2><p className="sub">Share of alerts confirmed on the ground, by confidence band. It should rise with confidence.</p></div></div>
          {calib.length === 0 ? <Empty>No validations yet.</Empty> : (
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={calib} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="band" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => pct(v, 0, false)} domain={[0, 1]} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip fmt={(v, k) => (k === 'rate' ? pct(v, 0, false) : num(v))} />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Bar dataKey="rate" name="Confirmed rate" fill="#2ec4b6" radius={[3, 3, 0, 0]} label={{ position: 'top', fill: '#8a8c9a', fontSize: 11, formatter: (v) => pct(v, 0, false) }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><div><h2>Seasonality by zone</h2><p className="sub">Learned seasonal index of observed activity (1.0 = average month)</p></div></div>
          <div style={{ height: 270 }}>
            <ResponsiveContainer>
              <LineChart data={seas} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="m" tickLine={false} axisLine={false} />
                <YAxis domain={['auto', 'auto']} tickLine={false} axisLine={false} />
                <ReferenceLine y={1} stroke="#373845" />
                <Tooltip content={<ChartTip fmt={(v) => num(v, 3)} />} />
                <Legend />
                {zones.map((z) => <Line key={z} dataKey={z} name={ZONE_META[z]} stroke={ZONE_COLORS[z] || '#fff'} dot={false} strokeWidth={z === 'coastal' ? 2.5 : 1.5} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Growth by taluka</h2><p className="sub">{monthName(d.latest)} · average YoY: observed activity vs registrations</p></div></div>
          <div style={{ height: 270 }}>
            <ResponsiveContainer>
              <BarChart data={d.growth} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="taluka" tickLine={false} axisLine={false} interval={0} angle={-35} textAnchor="end" height={60} tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(v) => pct(v, 0)} tickLine={false} axisLine={false} />
                <ReferenceLine y={0} stroke="#373845" />
                <Tooltip content={<ChartTip fmt={(v) => pct(v, 1)} />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                <Legend />
                <Bar dataKey="yoy_activity" name="Observed activity" fill="#f0b429" radius={[2, 2, 0, 0]} />
                <Bar dataKey="yoy_registered" name="Registrations" fill="#2ec4b6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><div><h2>Ground truth vs model</h2><p className="sub">Establishments counted by field teams vs the model's observed estimate</p></div></div>
          {d.groundTruth.length === 0 ? <Empty>No field counts yet.</Empty> : (
            <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}><table>
              <thead><tr><th>Alert</th><th>Location</th><th className="num">Model</th><th className="num">Counted</th><th className="num">Registered</th><th>Outcome</th></tr></thead>
              <tbody>{d.groundTruth.map((g) => (
                <tr key={g.code}><td><code>{g.code}</code></td><td>{g.name}</td><td className="num">{num(g.estimated)}</td><td className="num strong">{num(g.found)}</td><td className="num muted">{num(g.registered)}</td><td className="small">{OUTCOME_META[g.outcome]}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Nowcast model</h2><p className="sub">Ridge regression: ln(survey establishments) ~ signals · as of {monthName(m?.asOf)}</p></div></div>
          {m && (
            <table>
              <thead><tr><th>Feature</th><th className="num">Coefficient</th></tr></thead>
              <tbody>{m.features.map((f, i) => <tr key={f}><td><code>{f}</code></td><td className="num">{num(m.beta[i], 4)}</td></tr>)}</tbody>
            </table>
          )}
          <div className="divider" style={{ margin: '14px 0' }} />
          <h3 style={{ marginBottom: 8 }}>Feedback-calibrated cells ({d.calibratedCells.length})</h3>
          {d.calibratedCells.length === 0 ? <p className="small muted">No recalibrations yet. When an alert is dismissed as explained or a false positive, that cell's baseline is adjusted.</p> : (
            <div className="col" style={{ gap: 6, maxHeight: 150, overflowY: 'auto' }}>
              {d.calibratedCells.map((c) => <div key={c.cell_id} className="row between small"><Link to={`/app/cells/${c.cell_id}`}>{c.name}</Link><span className="muted">{c.reason} · offset {num(c.offset, 3)}</span></div>)}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Zone comparison</h2><p className="sub">{monthName(d.latest)} · observed activity vs level implied by records</p></div></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Zone</th><th className="num">Cells</th><th className="num">Observed</th><th className="num">Expected</th><th className="num">Registered</th><th className="num">Gap</th></tr></thead>
          <tbody>{d.zones.map((z) => (
            <tr key={z.zone}><td className="strong">{ZONE_META[z.zone]}</td><td className="num">{z.cells}</td><td className="num">{num(z.observed_sa)}</td><td className="num">{num(z.expected)}</td><td className="num">{num(z.registered)}</td>
              <td className="num" style={{ color: z.observed_sa / z.expected - 1 > 0.08 ? 'var(--orange)' : z.observed_sa / z.expected - 1 < -0.08 ? 'var(--violet)' : undefined }}>{pct(z.observed_sa / z.expected - 1, 1)}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}
