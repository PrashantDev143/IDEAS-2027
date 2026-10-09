// Shared pieces of the Explainable Evidence Card.
import { num } from '../lib/format.js';

export function SignalEvidence({ signals, color }) {
  return signals.map((s) => {
    const z = s.z ?? 0;
    const w = Math.min(50, (Math.abs(z) / 6) * 50);
    return (
      <div className="evidence-row" key={s.signal} style={{ opacity: s.applicable ? 1 : 0.45 }}>
        <div>
          <div className="strong">{s.label}</div>
          <div className="small muted">{s.category === 'enrichment' ? 'optional enrichment' : s.category}{s.signal === 'night_light' ? ' · corroborating only' : ''}{!s.applicable && ' · not applicable or no data'}</div>
        </div>
        <div className="evidence-track"><span className="mid" />
          <i style={{ left: z >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: s.agrees ? color : '#4a4b58' }} />
        </div>
        <div className="num small right" style={{ color: s.agrees ? 'var(--text)' : 'var(--muted)' }}>{s.z === null ? '—' : `${z > 0 ? '+' : ''}${num(z, 1)}σ`}{s.agrees ? ' ✓' : ''}</div>
      </div>
    );
  });
}

const PARTS = [
  ['agreement', 'Signal agreement', (c) => `${c.agreeing} of ${c.applicable} applicable signals agree`],
  ['coverage', 'Data coverage', () => 'Share of source values received in the last 12 months'],
  ['stability', 'Residual stability', (c) => `Held for ${c.stabilityMonths} of the last 6 months`],
  ['model', 'Model error', () => 'How tightly the peer group follows the expected line'],
  ['spatial', 'Spatial support', () => 'Whether neighbouring zones show the same pattern'],
];
export function ConfidenceBreakdown({ comp }) {
  if (!comp) return null;
  return (
    <div className="col" style={{ gap: 9 }}>
      {PARTS.map(([k, label, hint]) => (
        <div key={k}>
          <div className="row between small"><span className="strong">{label} <span className="muted">× {comp.weights?.[k]}</span></span><span className="num">{Math.round((comp[k] || 0) * 100)}</span></div>
          <div className="conf"><div className="bar"><i style={{ width: `${(comp[k] || 0) * 100}%`, background: 'var(--teal)' }} /></div></div>
          <div className="small muted">{hint(comp)}</div>
        </div>
      ))}
    </div>
  );
}
