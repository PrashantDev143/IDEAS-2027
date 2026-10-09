import { useEffect, useState, useCallback, createContext, useContext } from 'react';
import { api } from '../lib/api.js';
import { TYPE_META, STATUS_META, TIER_META, SPATIAL_META, TREND_META, confBand, num } from '../lib/format.js';

export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path).then((data) => setState({ data, error: null, loading: false })).catch((e) => setState({ data: null, error: e.message, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

export const Loading = ({ label = 'Loading…' }) => (
  <div className="loading"><div className="col" style={{ alignItems: 'center' }}><div className="spinner" /><span className="small">{label}</span></div></div>
);
export const ErrorBox = ({ children }) => (children ? <div className="error-box" role="alert">{children}</div> : null);
export const Empty = ({ children }) => <div className="empty">{children}</div>;

const Chip = ({ color, label, title, dot = true }) => (
  <span className="badge" style={{ color, borderColor: 'currentColor' }} title={title}>{dot && <span className="dot" />}{label}</span>
);
// validation priority tier (also used for flags)
export const TierBadge = ({ t }) => (t ? <Chip color={TIER_META[t]?.color === '#3d6f8f' ? '#8fbbd6' : t === 'insufficient' ? '#b4b6c2' : TIER_META[t]?.color} label={TIER_META[t]?.label || t} title="Validation priority tier" /> : null);
export const PriorityBadge = ({ p }) => <TierBadge t={p} />;
export const SpatialBadge = ({ c }) => (c ? <Chip color={c === 'ns' ? '#8a8c9a' : c === 'cold' ? '#56B4E9' : SPATIAL_META[c]?.color} label={SPATIAL_META[c]?.label || c} title={SPATIAL_META[c]?.desc} /> : null);
export const TrendBadge = ({ t }) => (t && t !== 'none' ? <Chip color={TREND_META[t]?.color} label={TREND_META[t]?.label || t} title="Change-point analysis of the gap" dot={false} /> : null);
export const SensitiveBadge = () => <Chip color="#CC79A7" label="Sensitive zone" title="Insecure tenure / informal settlement: a field visit needs senior sign-off" dot={false} />;
export const BandLabel = ({ value }) => { const b = confBand(value); return b ? <span className="small muted">{b} confidence</span> : null; };
export const StatusBadge = ({ s }) => <span className={`badge s-${s}`}>{STATUS_META[s]?.label || s}</span>;
export const TypeBadge = ({ t }) => (
  <span className="badge" style={{ color: TYPE_META[t]?.color, borderColor: 'currentColor' }} title={TYPE_META[t]?.desc}>
    <span className="dot" />{TYPE_META[t]?.label || t}
  </span>
);

export function Confidence({ value }) {
  const v = Math.round(value);
  const color = v >= 70 ? 'var(--green)' : v >= 45 ? 'var(--amber)' : 'var(--muted)';
  return (
    <div className="conf" title={`Confidence ${v}/100`}>
      <div className="bar"><i style={{ width: `${v}%`, background: color }} /></div><span>{v}</span>
    </div>
  );
}

export function Stat({ label, value, hint, accent }) {
  return (
    <div className={`card stat ${accent ? `accent-${accent}` : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, width }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { maxWidth: width } : undefined}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4200);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={setMsg}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function ChartTip({ active, payload, label, labelFmt, fmt = (v) => num(v) }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="t">{labelFmt ? labelFmt(label) : label}</div>
      {payload.filter((p) => p.value !== null && p.value !== undefined).map((p) => (
        <div className="r" key={p.dataKey}>
          <span><span className="sw" style={{ background: p.color || p.stroke || p.fill }} />{p.name}</span>
          <strong className="num">{fmt(p.value, p.dataKey)}</strong>
        </div>
      ))}
    </div>
  );
}

export function Seg({ value, onChange, options }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}
