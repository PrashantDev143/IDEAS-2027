import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ResponsiveContainer, ComposedChart, LineChart, Line, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';
import { useApi, Loading, ErrorBox, TypeBadge, StatusBadge, TierBadge, SpatialBadge, TrendBadge, SensitiveBadge, Confidence, ChartTip, Empty, Seg } from '../components/ui.jsx';
import { useMeta } from '../components/Layout.jsx';
import { SignalEvidence, ConfidenceBreakdown } from '../components/Evidence.jsx';
import { num, pct, sigma, monthName, monthShort, calMonth, confBand, ZONE_META, OUTCOME_META, SOURCE_LABEL, SPATIAL_META } from '../lib/format.js';

const SIGNALS = [
  ['night_light', 'Night-time lights', 'nW/cm²/sr', '#f0b429'],
  ['built_up', 'Built-up footprint', '% of zone', '#CC79A7'],
  ['listings', 'Hospitality listings', 'listings', '#E69F00'],
  ['footfall', 'Tourist footfall', 'visitors / month', '#D55E00'],
  ['power_connections', 'Commercial power (enrichment)', 'connections', '#009E73'],
  ['digital_points', 'Payment points (enrichment)', 'active points', '#56B4E9'],
];

export default function CellDetail() {
  const { id } = useParams();
  const { meta } = useMeta();
  const { data: d, error, loading } = useApi(`/cells/${id}`);
  const [season, setSeason] = useState('sa');
  if (loading && !d) return <Loading />;
  if (error) return <div className="page"><ErrorBox>{error}</ErrorBox></div>;
  const { cell, series, surveys, alerts, calibration, peer, evidence, lens } = d;
  const last = series[series.length - 1];
  const insufficient = !!last.insufficient;
  const si = series.slice(-12).map((s) => ({ n: Number(s.month.slice(5)), m: calMonth(Number(s.month.slice(5))), si: s.seasonal_index })).sort((a, b) => a.n - b.n);
  const chart = series.map((s) => ({ ...s, band: s.exp_lo === null ? null : [s.exp_lo, s.exp_hi] }));
  const tourism = cell.tourism_share >= 0.3;
  const [peak, off] = lens;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row small" style={{ marginBottom: 6 }}><Link to={`/app/map?cell=${cell.id}`}>← Map</Link><span className="muted">/</span><code>{cell.code}</code></div>
          <div className="eyebrow">Zone evidence card · {monthName(last.month)}</div>
          <h1>{cell.name}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            <TierBadge t={last.tier} />{!insufficient && <SpatialBadge c={last.spatial_class} />}<TrendBadge t={last.gap_trend} />{cell.sensitive ? <SensitiveBadge /> : null}
            <span className="small muted">{cell.taluka} taluka · {cell.district} · {ZONE_META[cell.zone]} · {cell.area_km2} km²</span>
          </div>
        </div>
      </div>

      <div className="grid g-2-1">
        <div className="card">
          <div className="card-head"><h2>Plain-language summary</h2></div>
          <p className="explain">{evidence?.summary}</p>
          {evidence?.checks?.length > 0 && <>
            <h3 style={{ margin: '14px 0 6px' }}>If a visit is planned, check</h3>
            <ul className="l-list small" style={{ marginTop: 0 }}>{evidence.checks.map((c) => <li key={c}>{c}</li>)}</ul>
          </>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Confidence</h2>{!insufficient && <strong style={{ font: '700 26px var(--serif)' }}>{Math.round(last.confidence)}</strong>}</div>
          {insufficient ? <p className="small muted">No confidence band is given because no score is shown. "Insufficient data" is a valid answer.</p> : <>
            <Confidence value={last.confidence} /><div className="small muted" style={{ margin: '4px 0 10px' }}>{confBand(last.confidence)} confidence band</div>
            <ConfidenceBreakdown comp={evidence?.confidence} />
          </>}
        </div>
      </div>

      <div className="grid g4">
        <div className="card stat"><div className="label">Registered units</div><div className="value">{last.registered === null ? '< min' : num(last.registered)}</div><div className="hint">{last.registered === null ? `suppressed below ${meta?.thresholds.min_cell_count}` : `YoY ${pct(last.yoy_registered, 1)}`}</div></div>
        <div className="card stat"><div className="label">Expected for its peer group</div><div className="value">{last.expected === null ? '—' : `~${num(last.expected)}`}</div><div className="hint">{last.expected === null ? 'not shown: insufficient data' : `likely range ${num(last.exp_lo)}–${num(last.exp_hi)}`}</div></div>
        <div className="card stat"><div className="label">Peer-relative gap</div><div className="value" style={{ color: last.gap_z >= 2 ? '#E69F00' : last.gap_z <= -2 ? '#56B4E9' : undefined }}>{insufficient ? '—' : sigma(last.gap_z)}</div>
          <div className="hint">{insufficient ? 'insufficient data' : `priority ${num(last.priority, 2)} · district rank #${last.district_rank}`}</div></div>
        <div className="card stat"><div className="label">Data coverage (12 months)</div><div className="value">{pct(last.coverage, 0, false)}</div><div className="hint">minimum for a score: {pct(meta?.thresholds.min_coverage, 0, false)}</div></div>
      </div>

      <div className="grid g-2-1">
        <div className="card">
          <div className="card-head"><div><h2>Registered vs expected footprint</h2><p className="sub">The shaded band is the likely range for a zone of this kind. A registered line that stays below the band is a persistent gap.</p></div></div>
          {series.every((s) => s.expected === null) ? <Empty>No model output is shown for this zone.</Empty> : (
            <div style={{ height: 270 }}>
              <ResponsiveContainer>
                <ComposedChart data={chart} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthShort} interval={5} tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(x) => num(x)} />
                  <Tooltip content={<ChartTip labelFmt={monthName} fmt={(v) => (Array.isArray(v) ? `${num(v[0])}–${num(v[1])}` : num(v))} />} />
                  <Legend iconType="plainline" />
                  <Area dataKey="band" name="Likely range" stroke="none" fill="rgba(240,180,41,.14)" />
                  <Line dataKey="expected" name="Expected footprint" stroke="#f0b429" strokeWidth={2} dot={false} />
                  <Line dataKey="registered" name="Registered" stroke="#56B4E9" strokeWidth={2.2} dot={false} />
                  {last.changepoint_month && <ReferenceLine x={last.changepoint_month} stroke="#CC79A7" strokeDasharray="4 3" label={{ value: 'change point', fill: '#CC79A7', fontSize: 10, position: 'insideTopRight' }} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <div style={{ height: 130, marginTop: 8 }}>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthShort} interval={5} tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} domain={[-6, 6]} allowDataOverflow />
                <Tooltip content={<ChartTip labelFmt={monthName} fmt={(v) => sigma(v, 2)} />} />
                <ReferenceLine y={0} stroke="#373845" />
                <ReferenceLine y={meta?.thresholds.gap_z} stroke="#E69F00" strokeDasharray="3 3" />
                <ReferenceLine y={-meta?.thresholds.gap_z} stroke="#56B4E9" strokeDasharray="3 3" />
                <Line dataKey="gap_z" name="Peer-relative gap" stroke="#ecedf1" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="small muted">Peer-relative gap over time. Dashed lines are the ±{meta?.thresholds.gap_z}σ flag thresholds.{last.gap_trend && last.gap_trend !== 'none' ? ` Change-point analysis reads the gap as ${last.gap_trend}.` : ''}</p>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2>Peer group</h2></div>
            {peer ? <>
              <div className="strong">{peer.name}</div>
              <p className="small muted">{peer.description}</p>
              <dl className="kv" style={{ marginTop: 10 }}>
                <dt>Zones in the group</dt><dd>{peer.n} ({peer.stats?.n} scored)</dd>
                <dt>Average registered</dt><dd>{num(peer.stats?.avg_registered)}</dd>
                <dt>Typical spread (σ)</dt><dd>{num(peer.traits.sigma, 2)}</dd>
                <dt>Peers ≥ 1σ below expected</dt><dd>{peer.stats?.above}</dd>
                <dt>Peers ≥ 1σ above expected</dt><dd>{peer.stats?.below}</dd>
              </dl>
              <p className="small muted" style={{ marginTop: 8 }}>Grouped on built density, tourism intensity, road access, distance to a market centre and land use. Registration data is never used to form peer groups.</p>
            </> : <Empty>Peer groups are assigned on the next engine run.</Empty>}
          </div>
          <div className="card">
            <div className="card-head"><h2>Spatial context</h2></div>
            {insufficient ? <p className="small muted">Not tested: no score for this zone.</p> : <>
              <SpatialBadge c={last.spatial_class} />
              <p className="small muted" style={{ marginTop: 8 }}>{SPATIAL_META[last.spatial_class]?.desc}. Permutation p-value {num(last.spatial_p, 3)}; Getis-Ord Gi* z = {num(last.gi_z, 2)}.</p>
            </>}
          </div>
        </div>
      </div>

      {!insufficient && evidence?.signals?.length > 0 && (
        <div className="card">
          <div className="card-head"><div><h2>Signal decomposition</h2><p className="sub">How each independent source compares with the zone's peers, per registered unit. Bars past ±1σ in the direction of the gap count as agreeing. Night lights only corroborate; they can never raise a flag alone.</p></div></div>
          <SignalEvidence signals={evidence.signals} color={last.gap_z >= 0 ? '#E69F00' : '#56B4E9'} />
        </div>
      )}

      <div className="grid g-2-1">
        <div className="card">
          <div className="card-head">
            <div><h2>Seasonality lens</h2><p className="sub">{tourism ? 'A tourism zone: compare like-for-like periods before acting.' : 'Low tourism share: season has little effect here.'}</p></div>
            <Seg value={season} onChange={setSeason} options={[['sa', 'Seasonally adjusted'], ['raw', 'Raw'], ['both', 'Both']]} />
          </div>
          <div style={{ height: 230 }}>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthShort} interval={5} tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(x) => num(x)} />
                <Tooltip content={<ChartTip labelFmt={monthName} />} />
                <Legend iconType="plainline" />
                {season !== 'sa' && <Line dataKey="observed" name="Inferred activity (raw)" stroke="#E69F00" strokeWidth={season === 'raw' ? 2.2 : 1.2} dot={false} />}
                {season !== 'raw' && <Line dataKey="observed_sa" name="Inferred activity (seasonally adj.)" stroke="#f0b429" strokeWidth={2.2} dot={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="table-wrap" style={{ marginTop: 10 }}><table>
            <thead><tr><th>Baseline (last 24 months)</th><th className="num">Inferred activity</th><th className="num">Tourist footfall / mo</th><th className="num">Hospitality listings</th><th className="num">Peer-relative gap</th></tr></thead>
            <tbody>
              <tr><td className="strong">Peak season (Nov–Feb)</td><td className="num">{num(peak.observed)}</td><td className="num">{num(peak.footfall)}</td><td className="num">{num(peak.listings)}</td><td className="num">{sigma(peak.gap_z)}</td></tr>
              <tr><td className="strong">Off season (Jun–Sep)</td><td className="num">{num(off.observed)}</td><td className="num">{num(off.footfall)}</td><td className="num">{num(off.listings)}</td><td className="num">{sigma(off.gap_z)}</td></tr>
              <tr><td className="muted">Peak ÷ off</td><td className="num muted">{off.observed ? `${num(peak.observed / off.observed, 2)}×` : '—'}</td><td className="num muted">{off.footfall ? `${num(peak.footfall / off.footfall, 2)}×` : '—'}</td><td className="num muted">{off.listings ? `${num(peak.listings / off.listings, 2)}×` : '—'}</td><td /></tr>
            </tbody>
          </table></div>
          <p className="small muted" style={{ marginTop: 6 }}>The gap is computed on seasonally adjusted signals, so it should be similar in both seasons. A gap that appears only in peak season points to seasonal trade rather than a standing difference.</p>
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Seasonal profile</h2><p className="sub">Monthly factor (1.0 = average month)</p></div></div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={si} margin={{ top: 5, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="m" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 10 }} />
                <YAxis tickLine={false} axisLine={false} domain={[0, 'auto']} />
                <ReferenceLine y={1} stroke="#8a8c9a" strokeDasharray="3 3" />
                <Tooltip content={<ChartTip fmt={(v) => num(v, 2)} />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                <Bar dataKey="si" name="Seasonal factor" fill="#56B4E9" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="divider" style={{ margin: '12px 0' }} />
          <h3 style={{ marginBottom: 8 }}>Data coverage by source</h3>
          {evidence?.sources.map((s) => (
            <div key={s.key} className="row between small" style={{ padding: '3px 0' }}>
              <span>{SOURCE_LABEL[s.key] || s.key}</span>
              <span className="row" style={{ gap: 8 }}><span className="conf" style={{ minWidth: 70 }}><span className="bar"><i style={{ width: `${s.share * 100}%`, background: s.share >= 0.8 ? 'var(--green)' : s.share >= 0.5 ? 'var(--amber)' : '#D55E00' }} /></span></span><span className="num" style={{ width: 36, textAlign: 'right' }}>{pct(s.share, 0, false)}</span></span>
            </div>
          ))}
          <p className="small muted" style={{ marginTop: 6 }}>Share of the last 12 monthly values actually received. Missing values lower confidence; they are never filled in silently.</p>
          {surveys.length > 0 && <p className="small muted">Survey baselines: {surveys.map((s) => `FY ${s.fy_start}-${String(s.fy_start + 1).slice(2)}: ${num(s.estimate)}`).join(' · ')}</p>}
          {calibration && <div className="note-box small" style={{ marginTop: 10 }}>Baseline recalibrated from field feedback: offset {num(calibration.offset, 3)} ({calibration.reason.replace(/_/g, ' ')}).</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Independent signals</h2><p className="sub">Raw monthly values from each source. Gaps in a line are months with no data.</p></div></div>
        <div className="grid g3">
          {SIGNALS.map(([k, label, unit, color]) => (
            <div key={k}>
              <div className="row between small"><strong>{label}</strong><span className="muted">{last[k] === null ? 'no data' : `${num(last[k], k === 'night_light' || k === 'built_up' ? 1 : 0)} ${unit}`}</span></div>
              <div style={{ height: 100 }}>
                <ResponsiveContainer>
                  <LineChart data={series} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                    <XAxis dataKey="month" hide /><YAxis hide domain={['auto', 'auto']} />
                    <Tooltip content={<ChartTip labelFmt={monthName} fmt={(v) => num(v, 1)} />} />
                    <Line dataKey={k} name={label} stroke={color} dot={false} strokeWidth={1.8} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Flag history</h2></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Flag</th><th>Type</th><th>Tier</th><th className="num">Confidence</th><th>Detected</th><th>Status</th></tr></thead>
            <tbody>{alerts.map((a) => (
              <tr key={a.id}><td><Link to={`/app/alerts/${a.id}`}><code>{a.code}</code></Link></td><td><TypeBadge t={a.type} /></td><td><TierBadge t={a.priority} /></td>
                <td className="num">{Math.round(a.confidence)}</td><td className="small">{monthShort(a.first_detected)} → {monthShort(a.last_detected)}</td>
                <td><StatusBadge s={a.status} />{a.outcome && <span className="small muted"> {OUTCOME_META[a.outcome]}</span>}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      <p className="small muted">{d.disclaimer}</p>
    </div>
  );
}
