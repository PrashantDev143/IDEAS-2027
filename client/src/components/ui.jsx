import { useEffect, useState, useCallback, createContext, useContext } from 'react';
import { api } from '../lib/api.js';
import { TYPE_META, STATUS_META, num } from '../lib/format.js';

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

export const PriorityBadge = ({ p }) => <span className={`badge p-${p}`}><span className="dot" />{p === 'high' ? 'High' : p === 'medium' ? 'Medium' : 'Low'}</span>;
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
