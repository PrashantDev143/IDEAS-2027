import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import GridMap, { LAYERS } from '../components/GridMap.jsx';
import { useMeta } from '../components/Layout.jsx';
import { useApi, Loading, ErrorBox, TypeBadge, TierBadge, SpatialBadge, TrendBadge, SensitiveBadge, Confidence, Seg } from '../components/ui.jsx';
import { ZoneTable } from './Zones.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { num, pct, sigma, monthName, monthShort, ZONE_META } from '../lib/format.js';

const TIER_ORDER = { high: 0, medium: 1, low: 2, insufficient: 3 };

export default function MapPage() {
  const { meta } = useMeta();
  const { user } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const cells = useApi('/cells');
  const [layer, setLayer] = useState(LAYERS[params.get('layer')] ? params.get('layer') : 'gap_z');
  const [mode, setMode] = useState(params.get('mode') === 'shadow' ? 'shadow' : 'map');
  const [month, setMonth] = useState(null);
  const [basemap, setBasemap] = useState('dark');
  const [showAlerts, setShowAlerts] = useState(true);
  const [mapData, setMapData] = useState(null);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState('');
  const [fly, setFly] = useState(null);
  const [view, setView] = useState(null);

  useEffect(() => { if (meta && !month) setMonth(meta.latest); }, [meta, month]);
  useEffect(() => {
    if (!month) return;
    setErr('');
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
  // accessible table view of whatever the map is showing
  const tableRows = useMemo(() => {
    if (!values || !cells.data) return [];
    const byId = new Map(cells.data.map((c) => [c.id, c]));
    const peers = new Map((meta?.peerGroups || []).map((p) => [p.id, p.name]));
    return values.map((v) => { const c = byId.get(v.id); return { ...c, ...v, peer_group: peers.get(c.peer_group_id) }; })
      .sort((a, b) => (a.insufficient - b.insufficient) || TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || Math.abs(b.priority || 0) - Math.abs(a.priority || 0));
  }, [values, cells.data, meta]);

  if (cells.loading || !meta) return <Loading />;
  if (cells.error) return <div className="page"><ErrorBox>{cells.error}</ErrorBox></div>;
  const mapProps = {
    cells: cells.data, values, selectedId: selected?.id, onSelect: select, basemap, outline: meta.outline, flyTo: fly, peerGroups: meta.peerGroups,
    onAlertClick: (a) => nav(`/app/alerts/${a.id}`),
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Activity map · {monthName(month)}</div>
          <h1>{mode === 'shadow' ? 'Economic Shadow Map' : mode === 'table' ? 'Zone table' : LAYERS[layer].label}</h1>
          <p className="sub">{mode === 'shadow' ? 'Inferred activity next to the registered footprint. Look for places where the left map is bright and the right map is not.' : mode === 'table' ? 'The same data as the map, as a sortable table.' : LAYERS[layer].help}</p>
        </div>
        <div style={{ position: 'relative' }}>
          <input className="input" placeholder="Search zone, taluka or code…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 260 }} aria-label="Search zones" />
          {matches.length > 0 && (
            <div className="card" style={{ position: 'absolute', right: 0, top: 42, width: 300, zIndex: 900, padding: 6 }}>
              {matches.map((c) => (
                <button key={c.id} className="btn ghost" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => { select(c); setFly(c); setQuery(''); if (mode === 'table') setMode('map'); }}>
                  <span>{c.name}</span><span className="small muted">{c.taluka}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="map-toolbar">
          <Seg value={mode} onChange={setMode} options={[['map', 'Map'], ['shadow', 'Shadow map'], ['table', 'Table']]} />
          {mode === 'map' && (
            <select className="select" value={layer} onChange={(e) => setLayer(e.target.value)} aria-label="Map layer">
              <optgroup label="Scores">{['gap_z', 'tier', 'confidence', 'spatial_class', 'gap_trend', 'change_z'].map((k) => <option key={k} value={k}>{LAYERS[k].label}</option>)}</optgroup>
              <optgroup label="Activity and records">{['eai', 'eai_raw', 'registered'].map((k) => <option key={k} value={k}>{LAYERS[k].label}</option>)}</optgroup>
              <optgroup label="Context">{['peer', 'coverage', 'night_light', 'footfall'].map((k) => <option key={k} value={k}>{LAYERS[k].label}</option>)}</optgroup>
            </select>
          )}
          {mode !== 'table' && <Seg value={basemap} onChange={setBasemap} options={[['dark', 'Street'], ['satellite', 'Satellite']]} />}
          {mode === 'map' && user.role !== 'field_officer' && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showAlerts} onChange={(e) => setShowAlerts(e.target.checked)} /> Show flags</label>}
          <div className="row" style={{ flex: 1, minWidth: 240, gap: 10 }}>
            <button className="btn sm" disabled={mi <= 0} onClick={() => setMonth(months[mi - 1])} aria-label="Previous month">‹</button>
            <input type="range" min={0} max={months.length - 1} value={Math.max(0, mi)} onChange={(e) => setMonth(months[Number(e.target.value)])} style={{ flex: 1 }} aria-label="Month" />
            <button className="btn sm" disabled={mi >= months.length - 1} onClick={() => setMonth(months[mi + 1])} aria-label="Next month">›</button>
            <span className="strong num" style={{ width: 70 }}>{monthShort(month)}</span>
          </div>
        </div>
      </div>
      <ErrorBox>{err}</ErrorBox>

      {mode === 'table' ? (
        <div className="card">{values ? <ZoneTable rows={tableRows} onPick={(z) => nav(`/app/cells/${z.id}`)} max={150} /> : <Loading />}</div>
      ) : (
        <div className="map-layout">
          {mode === 'shadow' ? (
            <div className="grid g2" style={{ gap: 10 }}>
              <GridMap {...mapProps} layer="eai" showAlerts={false} height={600} view={view} onView={setView} title="Inferred activity intensity" />
              <GridMap {...mapProps} layer="registered" showAlerts={false} height={600} view={view} onView={setView} title="Registered footprint" />
            </div>
          ) : (
            <GridMap {...mapProps} layer={layer} alerts={showAlerts ? mapData?.alerts || [] : []} height={640} />
          )}
          <div className="card side-panel">
            {!selected ? (
              <div className="col" style={{ gap: 14 }}>
                <h2>How to read this map</h2>
                <p className="muted small">Each square is a ~2.7 km zone. The <strong>peer-relative gap</strong> compares what independent signals suggest should be on record with what is on record,
                  against zones of the same kind only. Orange means fewer units on record than expected; blue means more.</p>
                <p className="muted small">Grey zones have <strong>insufficient data</strong>: either too little source coverage or a count too small to show safely. They never get a score.</p>
                <p className="muted small">The <strong>Shadow map</strong> shows inferred activity and the registered footprint side by side. <strong>Table</strong> gives the same data without colour.</p>
                <div className="note-box">A flag means "worth a closer look". It is never a finding about a business or a person.</div>
                {values && <TopList values={values} cells={cells.data} onPick={(c) => { select(c); setFly(c); }} />}
              </div>
            ) : (
              <ZonePanel cell={selected} v={selValues} detail={detail} month={month} onClose={() => { setSelected(null); setParams({}, { replace: true }); }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TopList({ values, cells, onPick }) {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const top = [...values].filter((v) => v.tier === 'high' || v.tier === 'medium').sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || Math.abs(b.priority) - Math.abs(a.priority)).slice(0, 6);
  return (
    <div>
      <div className="strong small" style={{ marginBottom: 6 }}>Highest priority this month</div>
      {top.map((v) => {
        const c = byId.get(v.id);
        return (
          <button key={v.id} className="btn ghost" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => onPick(c)}>
            <span>{c.name} <span className="muted small">{c.taluka}</span></span>
            <span className="num" style={{ color: v.gap_z >= 0 ? '#E69F00' : '#56B4E9' }}>{sigma(v.gap_z)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ZonePanel({ cell, v, detail, month, onClose }) {
  const open = detail?.alerts.filter((a) => ['open', 'assigned'].includes(a.status) && !a.is_control) || [];
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row between" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div>
          <h2>{cell.name}</h2>
          <div className="small muted">{cell.taluka} · {cell.district} · {ZONE_META[cell.zone]} · <code>{cell.code}</code></div>
        </div>
        <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {!v ? <Loading /> : (
        <>
          <div className="row"><TierBadge t={v.tier} />{!v.insufficient && v.spatial_class !== 'ns' && <SpatialBadge c={v.spatial_class} />}<TrendBadge t={v.gap_trend} />{cell.sensitive ? <SensitiveBadge /> : null}</div>
          {v.insufficient ? (
            <div className="note-box small">No score is shown for this zone: {v.insufficient_reason === 'suppressed' ? 'the recorded count is below the minimum cell size, so showing it could point to an individual business.' : `only ${pct(v.coverage, 0, false)} of the expected source data arrived in the last 12 months.`}</div>
          ) : (
            <>
              <Confidence value={v.confidence} />
              <dl className="kv">
                <dt>Registered units</dt><dd>{num(v.registered)}</dd>
                <dt>Expected for its peers</dt><dd>~{num(v.expected)}</dd>
                <dt>Peer-relative gap</dt><dd style={{ color: v.gap_z >= 2 ? '#E69F00' : v.gap_z <= -2 ? '#56B4E9' : undefined }}>{sigma(v.gap_z)}</dd>
                <dt>District rank</dt><dd>#{v.district_rank}</dd>
              </dl>
            </>
          )}
          <dl className="kv">
            <dt>Peer group</dt><dd>{detail?.peer?.name || '…'}</dd>
            <dt>Activity index</dt><dd>{num(v.eai, 1)}</dd>
            <dt>YoY activity</dt><dd>{pct(v.yoy_activity, 1)}</dd>
            <dt>Data coverage</dt><dd>{pct(v.coverage, 0, false)}</dd>
          </dl>
        </>
      )}
      {detail?.evidence && <p className="small muted" style={{ lineHeight: 1.6 }}>{detail.evidence.summary}</p>}
      {open.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <div className="strong small">Open flags</div>
          {open.map((a) => (
            <Link key={a.id} to={`/app/alerts/${a.id}`} className="card row between" style={{ padding: 10, color: 'var(--text)' }}>
              <TypeBadge t={a.type} /><TierBadge t={a.priority} />
            </Link>
          ))}
        </div>
      )}
      <Link className="btn" to={`/app/cells/${cell.id}`}>Open evidence card →</Link>
      <p className="small muted">Scores shown for {monthName(month)}; the summary is for the latest month.</p>
    </div>
  );
}
