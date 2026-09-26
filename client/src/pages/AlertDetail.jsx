import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea } from 'recharts';
import { useApi, Loading, ErrorBox, PriorityBadge, TypeBadge, StatusBadge, Confidence, ChartTip, Modal, useToast } from '../components/ui.jsx';
import { useMeta } from '../components/Layout.jsx';
import GridMap from '../components/GridMap.jsx';
import { api } from '../lib/api.js';
import { useAuth, can } from '../lib/auth.jsx';
import { num, pct, monthName, monthShort, TYPE_META, OUTCOME_META, ACTION_META, ZONE_META, ago } from '../lib/format.js';

export default function AlertDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { refreshMeta } = useMeta();
  const toast = useToast();
  const { data: a, error, loading, reload } = useApi(`/alerts/${id}`);
  const cells = useApi('/cells');
  const [modal, setModal] = useState(null);
  if (loading && !a) return <Loading />;
  if (error) return <div className="page"><ErrorBox>{error}</ErrorBox><Link to="/app/alerts">← Back to alerts</Link></div>;

  const staff = can(user, 'admin', 'analyst');
  const active = ['open', 'assigned'].includes(a.status);
  const canValidate = active && (staff || a.assigned_to === user.id);
  const isChange = TYPE_META[a.type] && (a.type === 'emerging_hotspot' || a.type === 'contraction');
  const cb = a.confidenceBreakdown;
  const done = (msg) => { toast(msg); setModal(null); reload(); refreshMeta(); };

  const patch = async (body, msg) => {
    try { await api(`/alerts/${a.id}`, { method: 'PATCH', body }); done(msg); } catch (e) { toast(e.message); }
  };

  const nearCells = cells.data?.filter((c) => Math.abs(c.lat - a.cell.lat) < 0.09 && Math.abs(c.lon - a.cell.lon) < 0.09) || [];
  const mapVals = a.series.length ? [{ id: a.cell_id, ...a.series.find((s) => s.month === a.last_detected) }, ...a.neighbours.map((n) => ({ id: n.id, gap_z: n.gap_z, change_z: n.change_z, eai: n.eai }))] : [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row small" style={{ marginBottom: 6 }}><Link to={staff ? '/app/alerts' : '/app/field'}>← {staff ? 'Alerts' : 'My tasks'}</Link><span className="muted">/</span><code>{a.code}</code></div>
          <h1>{TYPE_META[a.type].label} · {a.name}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            <TypeBadge t={a.type} /><PriorityBadge p={a.priority} /><StatusBadge s={a.status} />
            {a.outcome && <span className="badge">{OUTCOME_META[a.outcome]}</span>}
            <span className="small muted">{a.taluka} · {a.district} · {ZONE_META[a.zone]} · <code>{a.cell_code}</code></span>
          </div>
        </div>
        <div className="row">
          {staff && active && <button className="btn" onClick={() => setModal('assign')}>{a.assigned_to ? 'Reassign' : 'Assign field team'}</button>}
          {staff && active && <button className="btn" onClick={() => setModal('dismiss')}>Dismiss</button>}
          {staff && !active && <button className="btn" onClick={() => patch({ status: 'open' }, 'Alert reopened')}>Reopen</button>}
          {canValidate && <button className="btn primary" onClick={() => setModal('validate')}>Record field validation</button>}
        </div>
      </div>

      <div className="grid g-2-1">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2>What the platform observed</h2><span className="small muted">First detected {monthName(a.first_detected)} · last seen {monthName(a.last_detected)}{!a.still_active && active ? ' · not recurring in latest run' : ''}</span></div>
            <p className="explain">{a.explanation}</p>
          </div>

          <div className="grid g4">
            <div className="card stat"><div className="label">Observed (seasonally adj.)</div><div className="value" style={{ fontSize: 24 }}>{num(a.observed)}</div></div>
            <div className="card stat"><div className="label">Expected from records</div><div className="value" style={{ fontSize: 24 }}>{num(a.expected)}</div></div>
            <div className="card stat"><div className="label">Registered units</div><div className="value" style={{ fontSize: 24 }}>{num(a.registered)}</div></div>
            <div className="card stat"><div className="label">{isChange ? 'YoY activity vs registrations' : 'Gap vs records'}</div>
              <div className="value" style={{ fontSize: 24, color: TYPE_META[a.type].color }}>{isChange ? pct(a.yoy_activity) : pct(a.gap_pct)}</div>
              <div className="hint">{isChange ? `registrations ${pct(a.yoy_registered)}` : `${a.gap_abs > 0 ? '+' : ''}${num(a.gap_abs)} establishment-eq.`}</div></div>
          </div>

          <div className="card">
            <div className="card-head"><div><h2>Historical trend</h2><p className="sub">Observed activity from the signal nowcast, compared with the level official records imply</p></div></div>
            <div style={{ height: 280 }}>
              <ResponsiveContainer>
                <ComposedChart data={a.series} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthShort} interval={5} tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(x) => num(x)} />
                  <Tooltip content={<ChartTip labelFmt={monthName} />} />
                  <Legend iconType="plainline" />
                  <ReferenceArea x1={a.first_detected} x2={a.last_detected} fill="rgba(242,140,40,.08)" />
                  <Area dataKey="observed" name="Observed (raw)" stroke="none" fill="rgba(240,180,41,.12)" />
                  <Line dataKey="observed_sa" name="Observed (seasonally adj.)" stroke="#f0b429" strokeWidth={2.2} dot={false} />
                  <Line dataKey="expected" name="Expected from records" stroke="#2ec4b6" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  <Line dataKey="registered" name="Registered units" stroke="#8a8c9a" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div style={{ height: 160, marginTop: 10 }}>
              <ResponsiveContainer>
                <ComposedChart data={a.series} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthShort} interval={5} tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} domain={[-8, 8]} allowDataOverflow />
                  <Tooltip content={<ChartTip labelFmt={monthName} fmt={(v) => `${v > 0 ? '+' : ''}${num(v, 2)}σ`} />} />
                  <Legend iconType="plainline" />
                  <ReferenceLine y={0} stroke="#373845" />
                  <ReferenceLine y={2.5} stroke="#f28c28" strokeDasharray="3 3" />
                  <ReferenceLine y={-2.5} stroke="#9d8cf2" strokeDasharray="3 3" />
                  <Line dataKey="gap_z" name="Visibility gap (z)" stroke="#f28c28" dot={false} />
                  <Line dataKey="change_z" name="YoY change (z)" stroke="#5aa9f0" dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>Dashed lines mark the default ±2.5σ detection thresholds. The shaded band is the period the alert was active.</p>
          </div>

          <div className="card">
            <div className="card-head"><div><h2>Signal evidence</h2><p className="sub">How strongly each independent source deviates, compared with all other cells this month. Bars past ±1σ in the alert's direction count as agreeing.</p></div></div>
            {a.signals.map((s) => {
              const z = s.z ?? 0;
              const w = Math.min(50, Math.abs(z) / 6 * 50);
              return (
                <div className="evidence-row" key={s.signal} style={{ opacity: s.applicable ? 1 : 0.45 }}>
                  <div><div className="strong">{s.label}</div><div className="small muted">{s.category}{!s.applicable && ' · not applicable here'}</div></div>
                  <div className="evidence-track"><span className="mid" />
                    <i style={{ left: z >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: s.agrees ? TYPE_META[a.type].color : '#4a4b58' }} />
                  </div>
                  <div className="num small right" style={{ color: s.agrees ? 'var(--text)' : 'var(--muted)' }}>{s.z === null ? '—' : `${z > 0 ? '+' : ''}${num(z, 1)}σ`}{s.agrees ? ' ✓' : ''}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2>Confidence</h2><strong style={{ font: '700 26px var(--serif)' }}>{Math.round(a.confidence)}</strong></div>
            <Confidence value={a.confidence} />
            <div className="col" style={{ gap: 10, marginTop: 14 }}>
              {[['agreement', 'Signal agreement', `${Math.round(cb.agreement * 100)}% of applicable signals agree`],
                ['magnitude', 'Magnitude', 'Size of deviation vs threshold'],
                ['persistence', 'Persistence', `${cb.persistenceMonths} of last 6 months`],
                ['isolation', 'Isolation Forest', `multivariate outlier score ${cb.iso_raw}`]].map(([k, l, h]) => (
                <div key={k}>
                  <div className="row between small"><span className="strong">{l} <span className="muted">× {cb.weights?.[k]}</span></span><span className="num">{Math.round(cb[k] * 100)}</span></div>
                  <div className="conf"><div className="bar"><i style={{ width: `${cb[k] * 100}%`, background: 'var(--teal)' }} /></div></div>
                  <div className="small muted">{h}</div>
                </div>
              ))}
            </div>
            <div className="divider" style={{ margin: '14px 0' }} />
            <div className="small muted">Validation priority <strong style={{ color: 'var(--text)' }}>{a.priority}</strong> ({num(a.priority_score, 0)}) = confidence × estimated impact of ~{num(cb.impact)} establishment-equivalents.</div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {nearCells.length > 0 && <GridMap cells={nearCells} values={mapVals} layer={isChange ? 'change_z' : 'gap_z'} selectedId={a.cell_id} height={260} showAlerts={false} legend={false} flyTo={{ lat: a.cell.lat, lon: a.cell.lon }} />}
            <div style={{ padding: 12 }} className="row between small">
              <span className="muted">{num(a.cell.lat, 4)}, {num(a.cell.lon, 4)} · {a.cell.area_km2} km²</span>
              <Link to={`/app/map?cell=${a.cell_id}&layer=${isChange ? 'change_z' : 'gap_z'}`}>Open on map →</Link>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Field validation</h2>{a.assignee && <span className="small muted">Assigned to {a.assignee}</span>}</div>
            {a.validations.length === 0 ? <p className="small muted">{a.assigned_to ? 'Awaiting a field visit.' : 'Not yet assigned to a field team.'}</p> : a.validations.map((v) => (
              <div key={v.id} className="col" style={{ gap: 6, marginBottom: 10 }}>
                <div className="row between"><strong>{OUTCOME_META[v.outcome]}</strong><span className="small muted">{v.visited_on}</span></div>
                {v.establishments_found !== null && <div className="small">Establishments found: <strong>{num(v.establishments_found)}</strong>{v.unregistered_found ? <> · unregistered: <strong>{num(v.unregistered_found)}</strong></> : null}</div>}
                {v.notes && <p className="small muted">{v.notes}</p>}
                <div className="small muted">by {v.officer}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-head"><h2>Audit trail</h2></div>
            <div className="timeline">
              {a.history.map((h) => {
                const d = h.details ? JSON.parse(h.details) : {};
                return (
                  <div className="item" key={h.id}><div className="pin" />
                    <div className="small"><strong>{h.user_name || 'System'}</strong> {ACTION_META[h.action] || h.action}{d.outcome ? ` · ${OUTCOME_META[d.outcome]}` : ''}{d.note ? ` · “${d.note}”` : ''}
                      {typeof d.calibration === 'number' && <div className="muted">Baseline recalibrated for this cell (offset {num(d.calibration, 3)})</div>}
                      <div className="muted">{ago(h.created_at)}</div></div>
                  </div>
                );
              })}
              <div className="item"><div className="pin" style={{ borderColor: 'var(--teal)' }} /><div className="small"><strong>Detection engine</strong> raised this alert<div className="muted">{monthName(a.first_detected)} run</div></div></div>
            </div>
          </div>
        </div>
      </div>

      {modal === 'assign' && <AssignModal alert={a} onClose={() => setModal(null)} onSave={(uid, note) => patch({ assigned_to: uid, note }, 'Field team assigned')} />}
      {modal === 'dismiss' && <DismissModal onClose={() => setModal(null)} onSave={(outcome, note) => patch({ status: 'dismissed', outcome, note }, 'Alert dismissed')} gapType={!isChange} />}
      {modal === 'validate' && <ValidateModal alert={a} onClose={() => setModal(null)} onDone={() => done('Validation recorded. Thank you!')} />}
    </div>
  );
}

function AssignModal({ alert, onClose, onSave }) {
  const { data } = useApi('/users?role=field_officer');
  const [uid, setUid] = useState(alert.assigned_to || '');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!uid && data?.length) setUid((data.find((u) => u.taluka === alert.taluka) || data[0]).id);
  }, [data, uid, alert.taluka]);
  return (
    <Modal title="Assign field validation" onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        <div className="field"><label>Field officer</label>
          <select className="select" value={uid} onChange={(e) => setUid(Number(e.target.value))}>
            {data?.map((u) => <option key={u.id} value={u.id}>{u.name}{u.taluka ? ` · ${u.taluka}` : ''} ({u.open_tasks} open)</option>)}
          </select></div>
        <div className="field"><label>Instructions (optional)</label><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. focus on beach-front stretch; check homestays" /></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!uid} onClick={() => onSave(uid, note)}>Assign</button></div>
      </div>
    </Modal>
  );
}

function DismissModal({ onClose, onSave, gapType }) {
  const [outcome, setOutcome] = useState('explained');
  const [note, setNote] = useState('');
  return (
    <Modal title="Dismiss alert" onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        <div className="field"><label>Reason</label>
          <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="explained">Explained by known factor</option><option value="false_positive">No anomaly (false positive)</option><option value="data_issue">Data quality issue</option>
          </select></div>
        <div className="field"><label>Note</label><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What explains it?" /></div>
        {gapType && outcome !== 'data_issue' && <div className="note-box small">Feedback loop: the baseline for this cell will be recalibrated so the same pattern is not re-flagged.</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" onClick={() => onSave(outcome, note)}>Dismiss alert</button></div>
      </div>
    </Modal>
  );
}

function ValidateModal({ alert, onClose, onDone }) {
  const [f, setF] = useState({ outcome: 'confirmed', establishments_found: '', unregistered_found: '', notes: '', visited_on: new Date().toISOString().slice(0, 10), lat: '', lon: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const locate = () => navigator.geolocation?.getCurrentPosition(
    (p) => setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(5), lon: p.coords.longitude.toFixed(5) })),
    () => setErr('Could not read device location. Enter coordinates manually or leave blank.'),
  );
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api(`/alerts/${alert.id}/validations`, { method: 'POST', body: f }); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Field validation · ${alert.code}`} onClose={onClose} width={560}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <ErrorBox>{err}</ErrorBox>
        <div className="field"><label>Outcome</label>
          <select className="select" value={f.outcome} onChange={up('outcome')}>
            {Object.entries(OUTCOME_META).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
        <div className="grid g2">
          <div className="field"><label>Establishments counted</label><input className="input" type="number" min="0" step="1" value={f.establishments_found} onChange={up('establishments_found')} placeholder={`model: ~${Math.round(alert.observed)}`} /><span className="help">Total operating units in the cell area</span></div>
          <div className="field"><label>Of which unregistered</label><input className="input" type="number" min="0" step="1" value={f.unregistered_found} onChange={up('unregistered_found')} /><span className="help">Units with no registration on record</span></div>
        </div>
        <div className="grid g2">
          <div className="field"><label>Visit date</label><input className="input" type="date" value={f.visited_on} onChange={up('visited_on')} required /></div>
          <div className="field"><label>Visit location</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}><input className="input" style={{ width: '100%' }} placeholder="lat" value={f.lat} onChange={up('lat')} /><input className="input" style={{ width: '100%' }} placeholder="lon" value={f.lon} onChange={up('lon')} /><button type="button" className="btn sm" onClick={locate} title="Use device GPS">⌖</button></div></div>
        </div>
        <div className="field"><label>Field notes</label><textarea className="input" rows={4} value={f.notes} onChange={up('notes')} placeholder="What did you observe? Types of units, seasonality, registration status…" /></div>
        <div className="note-box small">Your verified count becomes ground truth. It is used to measure model accuracy and to recalibrate this cell's baseline.</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Submit validation'}</button></div>
      </form>
    </Modal>
  );
}
