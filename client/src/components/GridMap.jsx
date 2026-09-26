import { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Rectangle, CircleMarker, Polygon, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { num, pct, TYPE_META } from '../lib/format.js';

const GOA_CENTER = [15.35, 74.02];

// ----- colour ramps -----
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
const DIV = ['#1b9e94', '#2ec4b6', '#7fd8cf', '#2a2b34', '#f7b267', '#f28c28', '#e0452b'];

export const LAYERS = {
  eai: { label: 'Economic Activity Index', short: 'Activity index', get: (c) => c.eai, color: (v) => ramp(SEQ, v / 90), legend: { stops: SEQ, lo: '0', hi: '90+' }, fmt: (v) => num(v, 1) },
  gap_z: { label: 'Visibility gap (observed vs records)', short: 'Visibility gap', get: (c) => c.gap_z, color: (v) => ramp(DIV, (v + 4) / 8), legend: { stops: DIV, lo: 'Records exceed', hi: 'Observed exceeds' }, fmt: (v) => `${v > 0 ? '+' : ''}${num(v, 1)}σ`, diverging: true },
  change_z: { label: 'Year-on-year change (seasonally adjusted)', short: 'YoY change', get: (c) => c.change_z, color: (v) => ramp(DIV, (v + 4) / 8), legend: { stops: DIV, lo: 'Contracting', hi: 'Growing' }, fmt: (v) => `${v > 0 ? '+' : ''}${num(v, 1)}σ`, diverging: true },
  registered: { label: 'Official registrations density', short: 'Registrations', get: (c, a) => c.registered / a, color: (v) => ramp(SEQ, Math.log1p(v) / Math.log1p(400)), legend: { stops: SEQ, lo: '0', hi: '400/km²' }, fmt: (v) => `${num(v, 1)}/km²` },
  night_light: { label: 'Night-time lights (VIIRS)', short: 'Night lights', get: (c) => c.night_light, color: (v) => ramp(SEQ, Math.log1p(v) / Math.log1p(35)), legend: { stops: SEQ, lo: '0', hi: '35 nW' }, fmt: (v) => `${num(v, 1)} nW/cm²/sr` },
  footfall: { label: 'Tourist footfall', short: 'Footfall', get: (c) => c.footfall, color: (v) => ramp(SEQ, Math.log1p(v) / Math.log1p(60000)), legend: { stops: SEQ, lo: '0', hi: '60k/mo' }, fmt: (v) => `${num(v)}/mo` },
  digital_points: { label: 'Digital merchant payment points', short: 'Digital points', get: (c) => c.digital_points, color: (v) => ramp(SEQ, Math.log1p(v) / Math.log1p(3000)), legend: { stops: SEQ, lo: '0', hi: '3k' }, fmt: (v) => num(v) },
};

function FitGoa() {
  const map = useMap();
  useEffect(() => {
    map.fitBounds([[14.89, 73.68], [15.81, 74.35]], { padding: [4, 4] });
  }, [map]);
  return null;
}

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lon], Math.max(map.getZoom(), 11), { duration: 0.6 });
  }, [target, map]);
  return null;
}

export default function GridMap({
  cells, values, layer = 'eai', alerts = [], selectedId, onSelect, onAlertClick, height = 560, basemap = 'dark',
  outline, flyTo, showAlerts = true, interactive = true, opacity = 0.72, legend = true,
}) {
  const L_ = LAYERS[layer];
  const byId = useMemo(() => new Map((values || []).map((v) => [v.id, v])), [values]);
  const tiles = basemap === 'satellite'
    ? { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Imagery © Esri, Maxar, Earthstar Geographics' }
    : { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', attr: 'Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors' };

  return (
    <div className="map-shell" style={{ height }}>
      <MapContainer center={GOA_CENTER} zoom={9} zoomSnap={0.25} zoomDelta={0.5} style={{ height: '100%' }} preferCanvas zoomControl={interactive}
        scrollWheelZoom={interactive} dragging={interactive} doubleClickZoom={interactive} attributionControl>
        <FitGoa />
        <FlyTo target={flyTo} />
        <TileLayer key={basemap} url={tiles.url} attribution={tiles.attr} />
        {outline && <Polygon positions={outline} interactive={false} pathOptions={{ color: '#f0b429', weight: 1, opacity: 0.35, fill: false, dashArray: '4 4' }} />}
        {cells.map((c) => {
          const v = byId.get(c.id);
          const val = v ? L_.get(v, c.area_km2) : null;
          const sel = c.id === selectedId;
          return (
            <Rectangle key={c.id} bounds={[[c.lat_min, c.lon_min], [c.lat_max, c.lon_max]]}
              pathOptions={{
                color: sel ? '#ffffff' : 'rgba(0,0,0,0.25)', weight: sel ? 2 : 0.4,
                fillColor: val === null || val === undefined ? '#222' : L_.color(val), fillOpacity: opacity,
              }}
              eventHandlers={interactive ? { click: () => onSelect?.(c) } : undefined}>
              {interactive && (
                <Tooltip className="cell-tip" sticky direction="top" offset={[0, -6]}>
                  <div className="strong">{c.name}</div>
                  <div className="muted small">{c.taluka} · {c.code}</div>
                  {v && (
                    <div className="small" style={{ marginTop: 4 }}>
                      {L_.short}: <strong>{val === null ? '—' : L_.fmt(val)}</strong><br />
                      Observed ~{num(v.observed_sa)} · Registered {num(v.registered)}
                      {v.yoy_activity !== null && <><br />YoY activity {pct(v.yoy_activity)}</>}
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
              <div className="small muted">Confidence {Math.round(a.confidence)} · {a.priority} priority · {a.status}</div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      {legend && (
        <div className="legend">
          <div className="strong">{L_.label}</div>
          <div className="ramp" style={{ background: `linear-gradient(90deg, ${L_.legend.stops.join(',')})` }} />
          <div className="row between muted"><span>{L_.legend.lo}</span><span>{L_.legend.hi}</span></div>
          {showAlerts && alerts.length > 0 && (
            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              {Object.entries(TYPE_META).map(([k, t]) => (
                <span key={k} className="row" style={{ gap: 4 }}><i style={{ width: 8, height: 8, borderRadius: 9, background: t.color, display: 'inline-block' }} />{t.short}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
