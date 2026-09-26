import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import GridMap, { LAYERS } from '../components/GridMap.jsx';
import { useMeta } from '../components/Layout.jsx';
import { useApi, Loading, ErrorBox, TypeBadge, PriorityBadge, ChartTip, Seg } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { num, pct, monthName, monthShort, ZONE_META } from '../lib/format.js';

export default function MapPage() {
  const { meta } = useMeta();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const cells = useApi('/cells');
  const [layer, setLayer] = useState(params.get('layer') || 'eai');
  const [month, setMonth] = useState(null);
  const [basemap, setBasemap] = useState('dark');
  const [showAlerts, setShowAlerts] = useState(true);
  const [mapData, setMapData] = useState(null);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState('');
  const [fly, setFly] = useState(null);

  useEffect(() => { if (meta && !month) setMonth(meta.latest); }, [meta, month]);
  useEffect(() => {
    if (!month) return;
    api(`/map/${month}`).then(setMapData).catch((e) => setErr(e.message));
  }, [month]);
  useEffect(() => {
    const id = Number(params.get('cell'));
    if (id && cells.data && !selected) {
      const c = cells.data.find((x) => x.id === id);
      if (c) { setSelected(c); setFly(c); }
    }
  }, [params, cells.data, selected]);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    api(`/cells/${selected.id}`).then(setDetail).catch(() => {});
  }, [selected]);

  const select = (c) => {
    setSelected(c);
    setParams((p) => { const n = new URLSearchParams(p); n.set('cell', c.id); return n; }, { replace: true });
  };

  const months = meta?.months || [];
  const mi = months.indexOf(month);
  const values = mapData?.cells;
  const selValues = useMemo(() => values?.find((v) => v.id === selected?.id), [values, selected]);
  const matches = useMemo(() => {
    if (!query || !cells.data) return [];
    const q = query.toLowerCase();
    return cells.data.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.taluka.toLowerCase().includes(q)).slice(0, 8);
  }, [query, cells.data]);

  if (cells.loading || !meta) return <Loading />;
  if (cells.error) return <div className="page"><ErrorBox>{cells.error}</ErrorBox></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Activity map</div>
          <h1>Spatial activity & anomalies</h1>
          <p className="sub">{LAYERS[layer].label} · {monthName(month)} · click a cell for its evidence</p>
        </div>
        <div style={{ position: 'relative' }}>
          <input className="input" placeholder="Search locality, taluka or cell code…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 280 }} aria-label="Search cells" />
          {matches.length > 0 && (
            <div className="card" style={{ position: 'absolute', right: 0, top: 42, width: 300, zIndex: 900, padding: 6 }}>
              {matches.map((c) => (
                <button key={c.id} className="btn ghost" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => { select(c); setFly(c); setQuery(''); }}>
                  <span>{c.name}</span><span className="small muted">{c.taluka}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="map-toolbar">
          <select className="select" value={layer} onChange={(e) => setLayer(e.target.value)} aria-label="Map layer">
            {Object.entries(LAYERS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}
          </select>
          <Seg value={basemap} onChange={setBasemap} options={[['dark', 'Street'], ['satellite', 'Satellite']]} />
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showAlerts} onChange={(e) => setShowAlerts(e.target.checked)} /> Show anomalies</label>
          <div className="row" style={{ flex: 1, minWidth: 260, gap: 10 }}>
            <button className="btn sm" disabled={mi <= 0} onClick={() => setMonth(months[mi - 1])} aria-label="Previous month">‹</button>
            <input type="range" min={0} max={months.length - 1} value={Math.max(0, mi)} onChange={(e) => setMonth(months[Number(e.target.value)])} style={{ flex: 1 }} aria-label="Month" />
            <button className="btn sm" disabled={mi >= months.length - 1} onClick={() => setMonth(months[mi + 1])} aria-label="Next month">›</button>
            <span className="strong num" style={{ width: 70 }}>{monthShort(month)}</span>
          </div>
        </div>
      </div>
      <ErrorBox>{err}</ErrorBox>

      <div className="map-layout">
        <GridMap cells={cells.data} values={values} layer={layer} alerts={showAlerts ? mapData?.alerts || [] : []} selectedId={selected?.id}
          onSelect={select} onAlertClick={(a) => nav(`/app/alerts/${a.id}`)} basemap={basemap} outline={meta.outline} flyTo={fly} height={640} />
        <div className="card side-panel">
          {!selected ? (
            <div className="col" style={{ gap: 14 }}>
              <h2>How to read this map</h2>
              <p className="muted small">Each square is a ~2.7 km cell. <strong>Activity index</strong> shows seasonally adjusted observed activity density.
                <strong> Visibility gap</strong> compares observed activity with what official records imply: orange means activity exceeds records, teal means records exceed activity.
                <strong> YoY change</strong> highlights emerging hotspots and contraction zones.</p>
              <p className="muted small">Circles mark anomalies. Their colour shows the type and their size shows the validation priority. Drag the slider to replay any month since {monthName(months[0])}.</p>
              <div className="note-box">An anomaly means "investigate / validate". It is never a finding of unlawful activity.</div>
              {mapData && <TopList values={values} cells={cells.data} onPick={(c) => { select(c); setFly(c); }} />}
            </div>
          ) : (
            <CellPanel cell={selected} v={selValues} detail={detail} month={month} onClose={() => { setSelected(null); setParams({}, { replace: true }); }} />
          )}
        </div>
      </div>
    </div>
  );
}

function TopList({ values, cells, onPick }) {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const top = [...values].filter((v) => v.gap_z !== null).sort((a, b) => b.gap_z - a.gap_z).slice(0, 6);
  return (
    <div>
      <div className="strong small" style={{ marginBottom: 6 }}>Largest visibility gaps this month</div>
      {top.map((v) => {
        const c = byId.get(v.id);
        return (
          <button key={v.id} className="btn ghost" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => onPick(c)}>
            <span>{c.name} <span className="muted small">{c.taluka}</span></span>
            <span className="num" style={{ color: 'var(--orange)' }}>+{num(v.gap_z, 1)}σ</span>
          </button>
        );
      })}
    </div>
  );
}

function CellPanel({ cell, v, detail, month, onClose }) {
  const series = detail?.series || [];
  const open = detail?.alerts.filter((a) => ['open', 'assigned'].includes(a.status)) || [];
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2>{cell.name}</h2>
          <div className="small muted">{cell.taluka} · {cell.district} · {ZONE_META[cell.zone]} · <code>{cell.code}</code></div>
        </div>
        <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {v ? (
        <dl className="kv">
          <dt>Activity index</dt><dd>{num(v.eai, 1)}</dd>
          <dt>Observed (seasonally adj.)</dt><dd>{num(v.observed_sa)}</dd>
          <dt>Expected from records</dt><dd>{num(v.expected)}</dd>
          <dt>Registered units</dt><dd>{num(v.registered)}</dd>
          <dt>Visibility gap</dt><dd style={{ color: v.gap_z >= 2 ? 'var(--orange)' : v.gap_z <= -2 ? 'var(--violet)' : undefined }}>{num(v.gap_abs)} ({v.gap_z > 0 ? '+' : ''}{num(v.gap_z, 1)}σ)</dd>
          <dt>YoY activity</dt><dd>{pct(v.yoy_activity, 1)}</dd>
          <dt>Night lights</dt><dd>{num(v.night_light, 1)} nW</dd>
          <dt>Tourist footfall</dt><dd>{num(v.footfall)}</dd>
        </dl>
      ) : <Loading />}
      {series.length > 0 && (
        <div style={{ height: 170 }}>
          <ResponsiveContainer>
            <LineChart data={series} margin={{ top: 5, right: 4, left: -14, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthShort} interval={8} tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} tickFormatter={(x) => num(x)} />
              <Tooltip content={<ChartTip labelFmt={monthName} />} />
              <Line dataKey="observed" name="Observed (raw)" stroke="rgba(240,180,41,.35)" dot={false} />
              <Line dataKey="observed_sa" name="Observed (SA)" stroke="#f0b429" strokeWidth={2} dot={false} />
              <Line dataKey="expected" name="Expected" stroke="#2ec4b6" strokeDasharray="4 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {open.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <div className="strong small">Open anomalies</div>
          {open.map((a) => (
            <Link key={a.id} to={`/app/alerts/${a.id}`} className="card row between" style={{ padding: 10, color: 'var(--text)' }}>
              <TypeBadge t={a.type} /><PriorityBadge p={a.priority} />
            </Link>
          ))}
        </div>
      )}
      <Link className="btn" to={`/app/cells/${cell.id}`}>Full cell profile →</Link>
      <p className="small muted">Showing {monthName(month)}.</p>
    </div>
  );
}
