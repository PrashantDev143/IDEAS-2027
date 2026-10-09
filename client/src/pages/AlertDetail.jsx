import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea } from 'recharts';
import { useApi, Loading, ErrorBox, TierBadge, TypeBadge, StatusBadge, SpatialBadge, TrendBadge, SensitiveBadge, Confidence, ChartTip, Modal, useToast } from '../components/ui.jsx';
import { useMeta } from '../components/Layout.jsx';
import { SignalEvidence, ConfidenceBreakdown } from '../components/Evidence.jsx';
import GridMap from '../components/GridMap.jsx';
import { api } from '../lib/api.js';
import { useAuth, can } from '../lib/auth.jsx';
import { num, pct, sigma, monthName, monthShort, confBand, TYPE_META, OUTCOME_META, OUTCOME_HELP, ACTION_META, ZONE_META, ago } from '../lib/format.js';

const OUTREACH_LABEL = { none: 'Not started', referred: 'Referred for outreach', offered: 'Support offered on visit' };

export default function AlertDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { meta, refreshMeta } = useMeta();
  const toast = useToast();
  const { data: a, error, loading, reload } = useApi(`/alerts/${id}`);
  const cells = useApi('/cells');
  const [modal, setModal] = useState(null);
  if (loading && !a) return <Loading />;
  if (error) return <div className="page"><ErrorBox>{error}</ErrorBox><Link to="/app/alerts">← Back to flags</Link></div>;

  const staff = can(user, 'admin', 'analyst');
  const reader = user.role !== 'field_officer';
  const active = ['open', 'assigned'].includes(a.status);
  const canValidate = active && (staff || a.assigned_to === user.id);
  const canOutreach = can(user, 'admin', 'analyst', 'planner');
  const needsSignoff = !!a.sensitive && user.role !== 'admin';
  const control = !!a.is_control;
  const isChange = a.type === 'emerging_hotspot' || a.type === 'contraction';
  const color = TYPE_META[a.type].color;
  const done = (msg) => { toast(msg); setModal(null); reload(); refreshMeta(); };
  const patch = async (body, msg) => {
    try { await api(`/alerts/${a.id}`, { method: 'PATCH', body }); done(msg); } catch (e) { toast(e.message); }
  };
  const nearCells = cells.data?.filter((c) => Math.abs(c.lat - a.cell.lat) < 0.09 && Math.abs(c.lon - a.cell.lon) < 0.09) || [];
  const chart = a.series.map((s) => ({ ...s, band: [s.exp_lo, s.exp_hi] }));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row small" style={{ marginBottom: 6 }}><Link to={reader ? '/app/alerts' : '/app/field'}>← {reader ? 'Flags' : 'My tasks'}</Link><span className="muted">/</span><code>{a.code}</code></div>
          <h1>{TYPE_META[a.type].label} · {a.name}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            <TypeBadge t={a.type} /><TierBadge t={a.priority} /><StatusBadge s={a.status} />
            {!control && <><SpatialBadge c={a.spatial_class} /><TrendBadge t={a.gap_trend} /></>}
            {a.sensitive ? <SensitiveBadge /> : null}
            {a.outcome && <span className="badge">{OUTCOME_META[a.outcome]}</span>}
            <span className="small muted">{a.taluka} · {a.district} · {ZONE_META[a.zone]} · <Link to={`/app/cells/${a.cell_id}`}><code>{a.cell_code}</code></Link></span>
          </div>
        </div>
        <div className="row">
          {staff && active && <button className="btn" onClick={() => setModal('assign')} title={needsSignoff ? 'Sensitive zone: an administrator must sign off' : undefined}>{a.assigned_to ? 'Reassign' : 'Assign field team'}</button>}
          {staff && active && <button className="btn" onClick={() => setModal('dismiss')}>Close without visit</button>}
          {staff && !active && <button className="btn" onClick={() => patch({ status: 'open' }, 'Flag reopened')}>Reopen</button>}
          {canValidate && <button className="btn primary" onClick={() => setModal('validate')}>Record field outcome</button>}
        </div>
      </div>

      {a.sensitive ? <div className="note-box" style={{ borderColor: '#CC79A7' }}><strong>Sensitive zone.</strong> This area is marked for insecure tenure or informal settlement. A field visit needs senior (administrator) sign-off, and should go with a community liaison.</div> : null}

      <div className="grid g-2-1">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2>{control ? 'Why this zone is on the list' : 'What the platform observed'}</h2><span className="small muted">First detected {monthName(a.first_detected)} · last seen {monthName(a.last_detected)}{!a.still_active && active && !control ? ' · not recurring in the latest run' : ''}</span></div>
            <p className="explain">{a.explanation}</p>
          </div>

          <div className="grid g4">
            <div className="card stat"><div className="label">Registered units</div><div className="value" style={{ fontSize: 24 }}>{num(a.registered)}</div></div>
            <div className="card stat"><div className="label">Expected for its peers</div><div className="value" style={{ fontSize: 24 }}>~{num(a.expected)}</div><div className="hint">range {num(a.exp_lo)}–{num(a.exp_hi)}</div></div>
            <div className="card stat"><div className="label">{isChange ? 'YoY activity' : 'Peer-relative gap'}</div>
              <div className="value" style={{ fontSize: 24, color }}>{isChange ? pct(a.yoy_activity) : sigma(a.gap_z)}</div>
              <div className="hint">{isChange ? `registrations ${pct(a.yoy_registered)}` : `${a.gap_abs > 0 ? '' : '+'}${num(-a.gap_abs)} on record vs expected`}</div></div>
            <div className="card stat"><div className="label">Data coverage</div><div className="value" style={{ fontSize: 24 }}>{pct(a.coverage, 0, false)}</div><div className="hint">peer group: {a.peer_group}</div></div>
          </div>

          <div className="card">
            <div className="card-head"><div><h2>Trend</h2><p className="sub">Registered footprint against the level independent signals suggest for this peer group</p></div></div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <ComposedChart data={chart} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthShort} interval={5} tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(x) => num(x)} />
                  <Tooltip content={<ChartTip labelFmt={monthName} fmt={(v) => (Array.isArray(v) ? `${num(v[0])}–${num(v[1])}` : num(v))} />} />
                  <Legend iconType="plainline" />
                  <ReferenceArea x1={a.first_detected} x2={a.last_detected} fill="rgba(255,255,255,.05)" />
                  <Area dataKey="band" name="Likely range" stroke="none" fill="rgba(240,180,41,.14)" />
                  <Line dataKey="expected" name="Expected footprint" stroke="#f0b429" strokeWidth={2} dot={false} />
                  <Line dataKey="registered" name="Registered" stroke="#56B4E9" strokeWidth={2.2} dot={false} />
                  <Line dataKey="observed_sa" name="Inferred activity (seasonally adj.)" stroke="#8a8c9a" strokeDasharray="4 3" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div style={{ height: 150, marginTop: 10 }}>
              <ResponsiveContainer>
                <ComposedChart data={a.series} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthShort} interval={5} tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} domain={[-8, 8]} allowDataOverflow />
                  <Tooltip content={<ChartTip labelFmt={monthName} fmt={(v) => sigma(v, 2)} />} />
                  <Legend iconType="plainline" />
                  <ReferenceLine y={0} stroke="#373845" />
                  <ReferenceLine y={meta?.thresholds.gap_z} stroke="#E69F00" strokeDasharray="3 3" />
                  <ReferenceLine y={-meta?.thresholds.gap_z} stroke="#56B4E9" strokeDasharray="3 3" />
                  <Line dataKey="gap_z" name="Peer-relative gap (σ)" stroke="#ecedf1" dot={false} />
                  <Line dataKey="change_z" name="YoY activity change (σ)" stroke="#CC79A7" dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>Dashed lines mark the ±{meta?.thresholds.gap_z}σ gap thresholds. The lighter band is the period the flag has been active.</p>
          </div>

          {!control && (
            <div className="card">
              <div className="card-head"><div><h2>Signal decomposition</h2><p className="sub">{isChange ? 'Year-on-year change in each source against all other zones.' : 'Each independent source per registered unit, against the same peer group.'} Bars past ±1σ in the flag's direction count as agreeing.</p></div></div>
              <SignalEvidence signals={a.signals} color={color} />
            </div>
          )}

          <div className="card">
            <div className="card-head"><div><h2>What to check on a visit</h2><p className="sub">A short list so visit time is well spent</p></div></div>
            <ul className="l-list" style={{ marginTop: 0 }}>{a.checks.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2>Confidence</h2><strong style={{ font: '700 26px var(--serif)' }}>{Math.round(a.confidence)}</strong></div>
            <Confidence value={a.confidence} /><div className="small muted" style={{ margin: '4px 0 10px' }}>{confBand(a.confidence)} confidence band</div>
            {control ? <p className="small muted">Shown for reference only. This zone was drawn at random, not selected by its score.</p> : <>
              <ConfidenceBreakdown comp={a.confidenceBreakdown} />
              <div className="divider" style={{ margin: '14px 0' }} />
              <div className="small muted">Priority {num(a.priority_score, 2)} = |{isChange ? 'change' : 'peer-relative gap'}| × confidence → <strong style={{ color: 'var(--text)' }}>{a.priority}</strong> tier.</div>
            </>}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {nearCells.length > 0 && <GridMap cells={nearCells} values={a.neighbours} layer={isChange ? 'change_z' : 'gap_z'} selectedId={a.cell_id} height={250} showAlerts={false} legend={false} flyTo={{ lat: a.cell.lat, lon: a.cell.lon }} />}
            <div style={{ padding: 12 }} className="row between small">
              <span className="muted">{num(a.cell.lat, 4)}, {num(a.cell.lon, 4)} · {a.cell.area_km2} km²</span>
              <Link to={`/app/map?cell=${a.cell_id}&layer=${isChange ? 'change_z' : 'gap_z'}`}>Open on map →</Link>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Outreach first</h2><span className="small muted">{OUTREACH_LABEL[a.outreach_status]}</span></div>
            <p className="small muted" style={{ marginBottom: 8 }}>Formalisation and support are offered alongside any validation.</p>
            {a.outreachOptions.map((o) => <div key={o.title} className="small" style={{ marginBottom: 8 }}><strong>{o.title}.</strong> <span className="muted">{o.body}</span></div>)}
            {canOutreach && a.outreach_status === 'none' && <button className="btn sm" onClick={() => patch({ outreach_status: 'referred' }, 'Referred for outreach')}>Refer for outreach</button>}
            {canOutreach && a.outreach_status === 'referred' && <button className="btn sm ghost" onClick={() => patch({ outreach_status: 'none' }, 'Outreach referral withdrawn')}>Withdraw referral</button>}
          </div>

          <div className="card">
            <div className="card-head"><h2>Field outcome</h2>{a.assignee && <span className="small muted">Assigned to {a.assignee}</span>}</div>
            {a.validations.length === 0 ? <p className="small muted">{a.assigned_to ? 'Awaiting a field visit.' : 'Not yet assigned to a field team.'}</p> : a.validations.map((v) => (
              <div key={v.id} className="col" style={{ gap: 6, marginBottom: 10 }}>
                <div className="row between"><strong>{OUTCOME_META[v.outcome]}</strong><span className="small muted">{v.visited_on}</span></div>
                {v.establishments_found !== null && <div className="small">Establishments counted: <strong>{num(v.establishments_found)}</strong>{v.unregistered_found ? <> · not found in records: <strong>{num(v.unregistered_found)}</strong></> : null}</div>}
                {v.outreach_offered ? <div className="small">Registration support offered on the visit.</div> : null}
                {v.notes && <p className="small muted">{v.notes}</p>}
                <div className="small muted">by {v.officer}</div>
              </div>
            ))}
          </div>

          {reader && (
            <div className="card">
              <div className="card-head"><h2>Audit trail</h2></div>
              <div className="timeline">
                {a.history.map((h) => {
                  const d = h.details ? JSON.parse(h.details) : {};
                  return (
                    <div className="item" key={h.id}><div className="pin" />
                      <div className="small"><strong>{h.user_name || 'System'}</strong> {ACTION_META[h.action] || h.action}{d.outcome ? ` · ${OUTCOME_META[d.outcome]}` : ''}{d.note ? ` · “${d.note}”` : ''}
                        {typeof d.calibration === 'number' && <div className="muted">Baseline recalibrated for this zone (offset {num(d.calibration, 3)})</div>}
                        <div className="muted">{ago(h.created_at)}</div></div>
                    </div>
                  );
                })}
                <div className="item"><div className="pin" style={{ borderColor: 'var(--teal)' }} /><div className="small"><strong>{control ? 'Random audit sample' : 'Model engine'}</strong> {control ? 'drew this zone' : 'raised this flag'}<div className="muted">{monthName(a.first_detected)} run</div></div></div>
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="small muted">{a.disclaimer}</p>

      {modal === 'assign' && <AssignModal alert={a} needsSignoff={needsSignoff} onClose={() => setModal(null)} onSave={(uid, note) => patch({ assigned_to: uid, note }, 'Field team assigned')} />}
      {modal === 'dismiss' && <DismissModal onClose={() => setModal(null)} onSave={(outcome, note) => patch({ status: 'dismissed', outcome, note }, 'Flag closed')} gapType={!isChange && !control} />}
      {modal === 'validate' && <ValidateModal alert={a} onClose={() => setModal(null)} onDone={(r) => done(r.recalibrated ? 'Outcome recorded. The baseline for this zone was recalibrated.' : 'Outcome recorded. Thank you!')} />}
    </div>
  );
}

function AssignModal({ alert, needsSignoff, onClose, onSave }) {
  const { data } = useApi('/users?role=field_officer');
  const [uid, setUid] = useState(alert.assigned_to || '');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!uid && data?.length) setUid((data.find((u) => u.taluka === alert.taluka) || data[0]).id);
  }, [data, uid, alert.taluka]);
  return (
    <Modal title="Assign field validation" onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        {alert.sensitive ? <div className={needsSignoff ? 'error-box' : 'note-box small'}>{needsSignoff ? 'This is a sensitive zone. Only an administrator can sign off a field visit here.' : 'Sensitive zone: assigning records your senior sign-off in the audit log.'}</div> : null}
        <div className="field"><label>Field officer</label>
          <select className="select" value={uid} onChange={(e) => setUid(Number(e.target.value))}>
            {data?.map((u) => <option key={u.id} value={u.id}>{u.name}{u.taluka ? ` · ${u.taluka}` : ''} ({u.open_tasks} open)</option>)}
          </select></div>
        <div className="field"><label>Instructions (optional)</label><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. focus on the beach-front stretch" /></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!uid || needsSignoff} onClick={() => onSave(uid, note)}>Assign</button></div>
      </div>
    </Modal>
  );
}

function DismissModal({ onClose, onSave, gapType }) {
  const [outcome, setOutcome] = useState('legitimately_busy');
  const [note, setNote] = useState('');
  return (
    <Modal title="Close flag without a visit" onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        <p className="small muted">Use this when local knowledge already explains the pattern, for example a festival ground or a transit hub.</p>
        <div className="field"><label>Reason</label>
          <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {['legitimately_busy', 'new_development', 'no_gap', 'data_issue'].map((k) => <option key={k} value={k}>{OUTCOME_META[k]}</option>)}
          </select><span className="help">{OUTCOME_HELP[outcome]}</span></div>
        <div className="field"><label>Note</label><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What explains it?" /></div>
        {gapType && outcome !== 'data_issue' && <div className="note-box small">Feedback loop: this zone's baseline will be recalibrated so the same pattern is not flagged again.</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" onClick={() => onSave(outcome, note)}>Close flag</button></div>
      </div>
    </Modal>
  );
}

function ValidateModal({ alert, onClose, onDone }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ outcome: 'confirmed', establishments_found: '', unregistered_found: '', outreach_offered: false, notes: '', visited_on: today, lat: '', lon: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const locate = () => navigator.geolocation?.getCurrentPosition(
    (p) => setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(5), lon: p.coords.longitude.toFixed(5) })),
    () => setErr('Could not read the device location. Enter coordinates manually or leave them blank.'),
  );
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { onDone(await api(`/alerts/${alert.id}/validations`, { method: 'POST', body: f })); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Field outcome · ${alert.code}`} onClose={onClose} width={560}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <ErrorBox>{err}</ErrorBox>
        <div className="field"><label htmlFor="v-outcome">Outcome</label>
          <select id="v-outcome" className="select" value={f.outcome} onChange={up('outcome')}>
            {Object.entries(OUTCOME_META).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select><span className="help">{OUTCOME_HELP[f.outcome]}</span></div>
        <div className="grid g2">
          <div className="field"><label>Establishments counted</label><input className="input" type="number" min="0" step="1" value={f.establishments_found} onChange={up('establishments_found')} placeholder={`expected: ~${Math.round(alert.expected)}`} /><span className="help">Total operating units in the zone</span></div>
          <div className="field"><label>Of which not found in records</label><input className="input" type="number" min="0" step="1" value={f.unregistered_found} onChange={up('unregistered_found')} /><span className="help">A count only. Never record names or addresses.</span></div>
        </div>
        <div className="grid g2">
          <div className="field"><label>Visit date</label><input className="input" type="date" max={today} value={f.visited_on} onChange={up('visited_on')} required /></div>
          <div className="field"><label>Visit location</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}><input className="input" style={{ width: '100%' }} placeholder="lat" value={f.lat} onChange={up('lat')} /><input className="input" style={{ width: '100%' }} placeholder="lon" value={f.lon} onChange={up('lon')} /><button type="button" className="btn sm" onClick={locate} title="Use device GPS">⌖</button></div></div>
        </div>
        <label className="row small"><input type="checkbox" checked={f.outreach_offered} onChange={up('outreach_offered')} /> Registration support and scheme information were offered</label>
        <div className="field"><label>Field notes</label><textarea className="input" rows={4} value={f.notes} onChange={up('notes')} placeholder="What did you observe? Types of units, seasonality, recent construction…" /></div>
        <div className="note-box small">Your count becomes ground truth: it measures the model's accuracy and, when the pattern has an ordinary explanation, recalibrates this zone.</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Submit outcome'}</button></div>
      </form>
    </Modal>
  );
}
