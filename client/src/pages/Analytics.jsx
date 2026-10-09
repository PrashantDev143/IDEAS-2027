import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';
import { useApi, Loading, ErrorBox, ChartTip, Empty } from '../components/ui.jsx';
import { num, pct, calMonth, monthName, TYPE_META, OUTCOME_META, ZONE_META } from '../lib/format.js';

const OUTCOME_COLORS = { confirmed: '#009E73', partial: '#7fd1b9', legitimately_busy: '#E69F00', new_development: '#F0E442', no_gap: '#8a8c9a', data_issue: '#CC79A7' };
const ZONE_COLORS = { coastal: '#E69F00', urban: '#f0b429', industrial: '#56B4E9', mining: '#CC79A7', rural: '#009E73', forest: '#0072B2', heritage: '#D55E00' };

export function MetricTile({ label, value, target, met, hint }) {
  return (
    <div className="card stat" style={{ borderTop: `2px solid ${met === true ? 'var(--green)' : met === false ? '#E69F00' : 'var(--line-2)'}` }}>
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 24 }}>{value}</div>
      <div className="hint">{target && <>Target: {target}. </>}{met === true ? <span style={{ color: 'var(--green)' }}>Met</span> : met === false ? <span style={{ color: '#E69F00' }}>Not yet met</span> : null}{hint ? <> {hint}</> : null}</div>
    </div>
  );
}

export default function Analytics() {
  const { data: d, error, loading } = useApi('/analytics');
  if (loading && !d) return <Loading />;
  if (error) return <div className="page"><ErrorBox>{error}</ErrorBox></div>;

  const m = d.metrics, model = d.model;
  const byType = d.byType.map((t) => ({ ...t, label: TYPE_META[t.type]?.short }));
  const calib = m.calibration.bands.map((b) => ({ band: `${b.band} band`, observed: b.observed, stated: b.stated, n: b.n }));
  const gt = d.groundTruth.filter((g) => g.found !== null && ['confirmed', 'partially_confirmed'].includes(g.outcome));
  const mape = gt.length ? gt.reduce((s, g) => s + Math.abs(g.expected - g.found) / Math.max(1, g.found), 0) / gt.length : null;
  const zones = [...new Set(d.seasonality.map((s) => s.zone))];
  const seas = Array.from({ length: 12 }, (_, i) => {
    const row = { m: calMonth(i + 1) };
    for (const z of zones) row[z] = d.seasonality.find((s) => s.zone === z && s.cal_month === i + 1)?.si;
    return row;
  });
  const compare = [{ name: 'Prioritised visits', rate: m.hitRate.prioritised, n: m.hitRate.n }, { name: 'Random controls', rate: m.hitRate.control, n: m.hitRate.controlN }];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Analytics & model</div>
          <h1>Is the model working?</h1>
          <p className="sub">Measured the only way it can be without direct ground truth: field outcomes, a random control sample, and calibration of the confidence bands</p>
        </div>
      </div>

      <div className="grid g4">
        <MetricTile label="Lift over random controls" value={m.lift.value === null ? '—' : `${num(m.lift.value, 2)}×`} target="> 1.5×" met={m.lift.value === null ? null : m.lift.met} />
        <MetricTile label="Hit rate, high tier" value={pct(m.hitRate.topTier, 0, false)} hint={`${m.hitRate.topN} visits; partial counts as half`} />
        <MetricTile label="Calibration" value={m.calibration.bands.length ? `${m.calibration.bands.filter((b) => b.within).length}/${m.calibration.bands.length} bands` : '—'} target="within ±10 points" met={m.calibration.bands.length ? m.calibration.met : null} />
        <MetricTile label="Count error vs field counts" value={mape === null ? '—' : pct(mape, 1, false)} hint="expected footprint vs establishments counted" />
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><div><h2>Does the ranking beat chance?</h2><p className="sub">Share of visits where field teams confirmed a real difference, prioritised zones against the randomised control sample</p></div></div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={compare} margin={{ top: 16, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => pct(v, 0, false)} domain={[0, 1]} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip fmt={(v) => pct(v, 0, false)} />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                <Bar dataKey="rate" name="Confirmation rate" fill="#56B4E9" radius={[3, 3, 0, 0]} barSize={70} label={{ position: 'top', fill: '#b4b6c2', fontSize: 12, formatter: (v) => pct(v, 0, false) }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="small muted">{m.hitRate.n} prioritised and {m.hitRate.controlN} control visits so far. Control zones are drawn from the <Link to="/app/governance">governance page</Link>.</p>
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Confidence calibration</h2><p className="sub">Stated confidence against the observed confirmation rate. The two bars should be within 10 points.</p></div></div>
          {calib.length === 0 ? <Empty>No validations yet.</Empty> : (
            <div style={{ height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={calib} margin={{ top: 16, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="band" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => pct(v, 0, false)} domain={[0, 1]} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip fmt={(v) => pct(v, 0, false)} />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Legend />
                  <Bar dataKey="stated" name="Stated confidence" fill="#8a8c9a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="observed" name="Observed confirmation" fill="#009E73" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><div><h2>Field outcomes by flag type</h2><p className="sub">What field teams recorded</p></div></div>
          {byType.length === 0 ? <Empty>No validations yet.</Empty> : (
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={byType} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Legend />
                  <Bar dataKey="confirmed" stackId="a" name="Gap confirmed" fill={OUTCOME_COLORS.confirmed} />
                  <Bar dataKey="partial" stackId="a" name="Partly confirmed" fill={OUTCOME_COLORS.partial} />
                  <Bar dataKey="legitimately_busy" stackId="a" name="Legitimately busy" fill={OUTCOME_COLORS.legitimately_busy} />
                  <Bar dataKey="new_development" stackId="a" name="New development" fill={OUTCOME_COLORS.new_development} />
                  <Bar dataKey="no_gap" stackId="a" name="Nothing unusual" fill={OUTCOME_COLORS.no_gap} />
                  <Bar dataKey="data_issue" stackId="a" name="Data error" fill={OUTCOME_COLORS.data_issue} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Seasonality by zone type</h2><p className="sub">Learned seasonal index of inferred activity (1.0 = average month)</p></div></div>
          <div style={{ height: 260 }}>
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
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Peer groups and the expected-footprint model</h2><p className="sub">Slopes are shared statewide; each peer group gets its own level (partially pooled) and its own spread σ, which is what a zone's gap is measured against.</p></div></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Peer group</th><th className="num">Zones</th><th className="num">Scored</th><th className="num">Spread σ</th><th className="num">Level offset</th><th className="num">Registered</th><th className="num">Expected</th><th className="num">High</th><th className="num">Medium</th></tr></thead>
          <tbody>{d.peers.map((p) => (
            <tr key={p.id}><td><div className="strong">{p.name}</div><div className="small muted">{`Built-up ${num(p.centroid.built_up)}%, tourism ${num(p.centroid.tourism, 1)}, ${num(p.centroid.dist_centre_km)} km to centre`}</div></td>
              <td className="num">{p.n}</td><td className="num">{p.scored}</td><td className="num">{num(p.sigma, 2)}</td><td className="num">{num(p.offset, 2)}</td>
              <td className="num">{num(p.registered)}</td><td className="num">{num(p.expected)}</td><td className="num">{p.high || '—'}</td><td className="num">{p.medium || '—'}</td></tr>
          ))}</tbody>
        </table></div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-head"><div><h2>Field counts vs model</h2><p className="sub">Establishments counted on visits against the expected footprint</p></div></div>
          {d.groundTruth.length === 0 ? <Empty>No field counts yet.</Empty> : (
            <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}><table>
              <thead><tr><th>Flag</th><th>Zone</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">On record</th><th>Outcome</th></tr></thead>
              <tbody>{d.groundTruth.map((g) => (
                <tr key={g.code}><td><code>{g.code}</code></td><td>{g.name}</td><td className="num">{num(g.expected)}</td><td className="num strong">{num(g.found)}</td><td className="num muted">{num(g.registered)}</td><td className="small">{OUTCOME_META[g.outcome]}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Model card</h2><p className="sub">As of {monthName(model?.asOf)} · inputs hash <code>{model?.inputsHash}</code></p></div></div>
          {model && <>
            <dl className="kv">
              <dt>Expected-footprint fit (R²)</dt><dd>{num(model.footprint.r2, 3)}</dd>
              <dt>Zones used to fit</dt><dd>{model.footprint.n}</dd>
              <dt>Activity nowcast fit (R²)</dt><dd>{num(model.nowcast.r2, 3)} · {model.trainedOn}</dd>
              <dt>Zones with insufficient data</dt><dd>{model.insufficient}</dd>
              <dt>Flags held back (single signal)</dt><dd>{model.suppressedSingleSignal}</dd>
            </dl>
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Signal</th><th className="num">Footprint coefficient</th><th className="num">Nowcast coefficient</th></tr></thead>
              <tbody>{model.features.map((f, i) => <tr key={f}><td><code>{f}</code></td><td className="num">{num(model.footprint.beta[i], 3)}</td><td className="num">{num(model.nowcast.beta[i], 3)}</td></tr>)}</tbody>
            </table>
            <p className="small muted" style={{ marginTop: 6 }}>Signals move together, so individual coefficients should not be read on their own. Every published score can be reproduced from the stored inputs, settings and this hash.</p>
          </>}
          <div className="divider" style={{ margin: '14px 0' }} />
          <h3 style={{ marginBottom: 8 }}>Zones recalibrated from field feedback ({d.calibratedCells.length})</h3>
          {d.calibratedCells.length === 0 ? <p className="small muted">None yet.</p> : (
            <div className="col" style={{ gap: 6, maxHeight: 130, overflowY: 'auto' }}>
              {d.calibratedCells.map((c) => <div key={c.cell_id} className="row between small"><Link to={`/app/cells/${c.cell_id}`}>{c.name}</Link><span className="muted">{c.reason.replace(/_/g, ' ')}</span></div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
