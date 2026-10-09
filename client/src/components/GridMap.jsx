import { useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Rectangle, CircleMarker, Polygon, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { num, pct, sigma, TYPE_META, TIER_META, SPATIAL_META, TREND_META } from '../lib/format.js';

const GOA_CENTER = [15.35, 74.02];

// ----- colour ramps (colour-blind safe: sequential dark→yellow, diverging blue↔orange) -----
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const i = Math.min(n - 1, Math.floor(t * n));
  const f = t * n - i;
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(lerp(v, b[k], f))).join(',')})`;
}
const SEQ = ['#1d1f2a', '#3b2f4a', '#7a3b52', '#c2553d', '#f28c28', '#f0b429', '#fff1b8'];
const DIV = ['#0072B2', '#56B4E9', '#a9d3ee', '#2a2b34', '#f3c98b', '#E69F00', '#D55E00'];
const INSUFFICIENT = '#33343d';
const PEER_COLORS = ['#E69F00', '#56B4E9', '#CC79A7', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#b4b6c2', '#8fbbd6', '#f3c98b'];

const seq = (label, short, get, max, fmt, hi, needsScore = false, help = '') => ({
  label, short, get, needsScore, help, fmt,
  color: (v) => ramp(SEQ, Math.log1p(v) / Math.log1p(max)),
  legend: { kind: 'ramp', stops: SEQ, lo: '0', hi },
});
const cat = (label, short, get, meta, help) => ({
  label, short, get, needsScore: true, help, fmt: (v) => meta[v]?.label || v,
  color: (v) => meta[v]?.color || INSUFFICIENT,
  legend: { kind: 'cat', items: Object.entries(meta).filter(([k]) => k !== 'control' && k !== 'insufficient' && k !== 'none').map(([, m]) => [m.color, m.label, m.desc]) },
});

export const LAYERS = {
  eai: { ...seq('Activity intensity (inferred, seasonally adjusted)', 'Activity index', (c) => c.eai, 0, (v) => num(v, 1), '90+', false, 'How much economic activity the independent signals suggest, with the tourist season removed.'), color: (v) => ramp(SEQ, v / 90) },
  eai_raw: seq('Activity intensity (raw, with season)', 'Activity (raw)', (c, a) => c.observed / a, 500, (v) => `${num(v, 1)}/km²`, '500/km²', false, 'The same estimate before seasonal adjustment, so peak and off-season months look different.'),
  registered: seq('Registered footprint', 'Registered', (c, a) => (c.registered === null ? null : c.registered / a), 400, (v) => `${num(v, 1)}/km²`, '400/km²', false, 'Units on official record per km². Counts below the minimum cell size are suppressed.'),
  gap_z: {
    label: 'Peer-relative gap', short: 'Peer-relative gap', get: (c) => c.gap_z, needsScore: true, fmt: (v) => sigma(v),
    help: 'Expected minus registered footprint, compared only with zones of the same peer group.',
    color: (v) => ramp(DIV, (v + 4) / 8), legend: { kind: 'ramp', stops: DIV, lo: 'More on record than expected', hi: 'Fewer on record than expected' },
  },
  tier: cat('Validation priority tier', 'Priority tier', (c) => c.tier, TIER_META, 'Peer-relative gap × confidence. High and medium tiers are worth a closer look.'),
  spatial_class: cat('Spatial significance (Local Moran / Gi*)', 'Spatial pattern', (c) => c.spatial_class, SPATIAL_META, 'Whether the gap forms a statistically significant cluster or outlier (permutation test, p ≤ 0.05).'),
  gap_trend: cat('Gap trend (change-point)', 'Gap trend', (c) => c.gap_trend, TREND_META, 'Whether the gap is new, widening, stable or narrowing.'),
  confidence: { ...seq('Confidence', 'Confidence', (c) => c.confidence, 0, (v) => `${num(v)}/100`, '100', true, 'How much weight a score deserves: coverage, signal agreement, model error, stability, spatial support.'), color: (v) => ramp(SEQ, v / 100) },
  coverage: { ...seq('Data coverage (last 12 months)', 'Coverage', (c) => c.coverage, 0, (v) => pct(v, 0, false), '100%', false, 'Share of expected source values actually received. Low coverage means "insufficient data", never a score.'), color: (v) => ramp(SEQ, v) },
  change_z: {
    label: 'Year-on-year activity change', short: 'YoY change', get: (c) => c.change_z, needsScore: true, fmt: (v) => sigma(v),
    help: 'Seasonally adjusted change in inferred activity against the same months last year.',
    color: (v) => ramp(DIV, (v + 4) / 8), legend: { kind: 'ramp', stops: DIV, lo: 'Contracting', hi: 'Growing' },
  },
  peer: {
    label: 'Peer group', short: 'Peer group', needsScore: false, fmt: (v) => v, help: 'Zones are only compared with structurally similar zones.',
    get: (c, a, cell) => cell.peer_group_id, color: (v) => PEER_COLORS[(v - 1) % PEER_COLORS.length], legend: { kind: 'peer' },
  },
  night_light: seq('Night-time lights (VIIRS)', 'Night lights', (c) => c.night_light, 35, (v) => `${num(v, 1)} nW`, '35 nW', false, 'Corroborating signal only: it saturates in dense cores.'),
  footfall: seq('Tourist footfall', 'Footfall', (c) => c.footfall, 60000, (v) => `${num(v)}/mo`, '60k/mo', false, 'Strongly seasonal. Read with the seasonality lens.'),
};

function FitGoa() {
  const map = useMap();
  useEffect(() => { map.fitBounds([[14.89, 73.68], [15.81, 74.35]], { padding: [4, 4] }); }, [map]);
  return null;
}
function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo([target.lat, target.lon], Math.max(map.getZoom(), 11), { duration: 0.6 }); }, [target, map]);
  return null;
}
// keeps two maps in step (Economic Shadow Map)
function Sync({ view, onView }) {
  const self = useRef(false);
  const map = useMapEvents({
    moveend: () => {
      if (self.current) { self.current = false; return; }
      const c = map.getCenter();
      onView?.({ lat: c.lat, lng: c.lng, zoom: map.getZoom(), by: map });
    },
  });
  useEffect(() => {
    if (!view || view.by === map) return;
    const c = map.getCenter();
    if (Math.abs(c.lat - view.lat) < 1e-6 && Math.abs(c.lng - view.lng) < 1e-6 && map.getZoom() === view.zoom) return;
    self.current = true;
    map.setView([view.lat, view.lng], view.zoom, { animate: false });
  }, [view, map]);
  return null;
}

export default function GridMap({
  cells, values, layer = 'eai', alerts = [], selectedId, onSelect, onAlertClick, height = 560, basemap = 'dark', outline, flyTo,
  showAlerts = true, interactive = true, opacity = 0.74, legend = true, peerGroups = [], view, onView, title,
}) {
  const L_ = LAYERS[layer];
  const byId = useMemo(() => new Map((values || []).map((v) => [v.id, v])), [values]);
  const tiles = basemap === 'satellite'
    ? { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Imagery © Esri, Maxar, Earthstar Geographics' }
    : { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', attr: 'Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors' };
  const anyInsufficient = L_.needsScore && (values || []).some((v) => v.insufficient);

  return (
    <div className="map-shell" style={{ height }}>
      {title && <div className="map-title">{title}</div>}
      <MapContainer center={GOA_CENTER} zoom={9} zoomSnap={0.25} zoomDelta={0.5} style={{ height: '100%' }} preferCanvas zoomControl={interactive}
        scrollWheelZoom={interactive} dragging={interactive} doubleClickZoom={interactive} attributionControl>
        <FitGoa />
        <FlyTo target={flyTo} />
        {onView && <Sync view={view} onView={onView} />}
        <TileLayer key={basemap} url={tiles.url} attribution={tiles.attr} />
        {outline && <Polygon positions={outline} interactive={false} pathOptions={{ color: '#f0b429', weight: 1, opacity: 0.35, fill: false, dashArray: '4 4' }} />}
        {cells.map((c) => {
          const v = byId.get(c.id);
          const noScore = v && L_.needsScore && v.insufficient;
          const val = v && !noScore ? L_.get(v, c.area_km2, c) : null;
          const empty = val === null || val === undefined;
          const sel = c.id === selectedId;
          return (
            <Rectangle key={c.id} bounds={[[c.lat_min, c.lon_min], [c.lat_max, c.lon_max]]}
              pathOptions={{
                color: sel ? '#ffffff' : 'rgba(0,0,0,0.25)', weight: sel ? 2 : 0.4,
                fillColor: empty ? INSUFFICIENT : L_.color(val), fillOpacity: empty ? 0.5 : opacity, dashArray: undefined,
              }}
              eventHandlers={interactive ? { click: () => onSelect?.(c) } : undefined}>
              {interactive && (
                <Tooltip className="cell-tip" sticky direction="top" offset={[0, -6]}>
                  <div className="strong">{c.name}{c.sensitive ? ' · sensitive zone' : ''}</div>
                  <div className="muted small">{c.taluka} · {c.code}</div>
                  {v && (
                    <div className="small" style={{ marginTop: 4 }}>
                      {L_.short}: <strong>{empty ? (noScore ? 'insufficient data' : v.suppressed ? 'suppressed (small count)' : '—') : layer === 'peer' ? peerGroups.find((p) => p.id === val)?.name || val : L_.fmt(val)}</strong><br />
                      {v.insufficient ? <span className="muted">No score: {v.insufficient_reason === 'suppressed' ? 'count below the minimum cell size' : 'data coverage too low'}</span>
                        : <>Registered {num(v.registered)} · expected ~{num(v.expected)}<br />Tier {TIER_META[v.tier]?.label} · confidence {num(v.confidence)}</>}
                    </div>
                  )}
                </Tooltip>
              )}
            </Rectangle>
          );
        })}
        {showAlerts && alerts.map((a) => (
          <CircleMarker key={a.id} center={[a.lat, a.lon]} radius={a.priority === 'high' ? 7 : a.priority === 'medium' ? 5.5 : 4.5}
            pathOptions={{ color: '#0e0f13', weight: 1.5, fillColor: TYPE_META[a.type]?.color || '#fff', fillOpacity: 1 }}
            eventHandlers={{ click: () => onAlertClick?.(a) }}>
            <Tooltip className="cell-tip" direction="top" offset={[0, -6]}>
              <div className="strong">{a.code}</div>
              <div className="small">{TYPE_META[a.type]?.label} · {a.name}</div>
              <div className="small muted">Confidence {Math.round(a.confidence)} · {a.priority} tier · {a.status}</div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      {legend && (
        <div className="legend">
          <div className="strong">{L_.label}</div>
          {L_.legend.kind === 'ramp' && <>
            <div className="ramp" style={{ background: `linear-gradient(90deg, ${L_.legend.stops.join(',')})` }} />
            <div className="row between muted" style={{ flexWrap: 'nowrap', gap: 12 }}><span>{L_.legend.lo}</span><span style={{ textAlign: 'right' }}>{L_.legend.hi}</span></div>
          </>}
          {L_.legend.kind === 'cat' && <div className="col" style={{ gap: 3, marginTop: 6 }}>
            {L_.legend.items.map(([color, label]) => <span key={label} className="row" style={{ gap: 6 }}><i className="sw" style={{ background: color }} />{label}</span>)}
          </div>}
          {L_.legend.kind === 'peer' && <div className="col" style={{ gap: 3, marginTop: 6 }}>
            {peerGroups.map((p) => <span key={p.id} className="row" style={{ gap: 6 }}><i className="sw" style={{ background: PEER_COLORS[(p.id - 1) % PEER_COLORS.length] }} />{p.name}</span>)}
          </div>}
          {(anyInsufficient || layer === 'registered') && <span className="row" style={{ gap: 6, marginTop: 5 }}><i className="sw" style={{ background: INSUFFICIENT, opacity: 0.8 }} />{layer === 'registered' ? 'Suppressed (small count)' : 'Insufficient data (no score)'}</span>}
          {showAlerts && alerts.length > 0 && (
            <div className="row" style={{ marginTop: 8, gap: 8, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              {Object.entries(TYPE_META).filter(([k]) => k !== 'audit_control').map(([k, t]) => (
                <span key={k} className="row" style={{ gap: 4 }}><i className="sw" style={{ background: t.color, borderRadius: 9 }} />{t.short}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
