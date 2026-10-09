import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Loading, ErrorBox, Empty, StatusBadge, TierBadge, useToast } from '../components/ui.jsx';
import { useMeta } from '../components/Layout.jsx';
import { MetricTile } from './Analytics.jsx';
import { api } from '../lib/api.js';
import { useAuth, can } from '../lib/auth.jsx';
import { num, pct, monthName, ago, ZONE_META, OUTCOME_META, ACTION_META, ROLE_META } from '../lib/format.js';

const LAYERS = [
  ['1. Evidence', 'Raw aggregated data with provenance', 'Data pipeline', 'Data & pipeline page: source, licence, version and acquisition date for every layer'],
  ['2. Inference', 'Statistical estimate of mismatch, with uncertainty', 'Model', 'Expected footprint with a likely range; peer-relative gap; spatial test'],
  ['3. Risk score', 'Calibrated, confidence-weighted priority', 'Product', 'Tier and confidence band on every zone; "insufficient data" where it cannot be scored'],
  ['4. Enforcement decision', 'Whether and how to act', 'Human officials only', 'Out of scope. Nothing in EconoScope triggers or records enforcement'],
];
const GUARDRAILS = [
  ['Language', 'The portal and exports say "anomaly to validate". They never label a place or a business.'],
  ['No individual output', 'The model produces zone scores only: no business names, addresses or map pins.'],
  ['No quotas', 'Validation lists cannot be exported per officer and carry a notice that they are not inspection targets.'],
  ['Outreach first', 'Every flag shows formalisation and support options next to validation.'],
  ['Insufficient data is a valid answer', 'Low-coverage and small-count zones show no score rather than a low or high one.'],
  ['Small-cell suppression', 'Recorded counts below the minimum cell size are never shown or scored.'],
  ['Night lights corroborate only', 'A flag supported by night lights alone is held back.'],
  ['Sensitive zones', 'Zones marked for insecure tenure need senior sign-off before any field visit.'],
  ['Append-only audit log', 'Every view, export, assignment and outcome is logged and cannot be edited or deleted.'],
];

function BiasTable({ title, sub, rows, label = (g) => g, overall }) {
  return (
    <div className="card">
      <div className="card-head"><div><h2>{title}</h2><p className="sub">{sub}</p></div></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Group</th><th className="num">Zones</th><th className="num">Scored</th><th className="num">No score</th><th className="num">Flagged (high + medium)</th><th className="num">Flag rate</th><th className="num">Visits</th><th className="num">Confirmed</th><th>Review</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.grp}>
            <td className="strong">{label(r.grp)}</td><td className="num">{r.zones}</td><td className="num">{r.scored}</td><td className="num muted">{r.insufficient || '—'}</td>
            <td className="num">{r.flagged}</td>
            <td className="num"><span className="row" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'nowrap' }}>
              <span className="conf" style={{ minWidth: 60 }}><span className="bar"><i style={{ width: `${Math.min(100, (r.rate || 0) * 100 * 1.6)}%`, background: r.skewed ? '#D55E00' : '#56B4E9' }} /></span></span>{pct(r.rate, 0, false)}</span></td>
            <td className="num">{r.validated || '—'}</td><td className="num">{r.confirmRate === null ? '—' : pct(r.confirmRate, 0, false)}</td>
            <td>{r.skewed ? <span className="badge" style={{ color: '#D55E00', borderColor: 'currentColor' }}>Review: high rate, unconfirmed</span> : <span className="small muted">{r.rate > 2 * overall && r.confirmRate >= 0.5 ? 'High rate, confirmed by visits' : 'OK'}</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

export default function Governance() {
  const { user } = useAuth();
  const { meta } = useMeta();
  const toast = useToast();
  const g = useApi('/governance');
  const m = useApi('/metrics');
  const controls = useApi('/audit-sample');
  const [note, setNote] = useState('');
  const [n, setN] = useState(6);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState('bias');
  if ((g.loading && !g.data) || (m.loading && !m.data)) return <Loading />;
  if (g.error || m.error) return <div className="page"><ErrorBox>{g.error || m.error}</ErrorBox></div>;
  const d = g.data, s = m.data;
  const canReview = can(user, 'admin', 'auditor');
  const canSample = can(user, 'admin', 'analyst');
  const canAudit = can(user, 'admin', 'auditor');

  const review = async () => {
    setBusy('review');
    try { await api('/governance/peer-review', { method: 'POST', body: { note } }); toast('Peer-group review recorded'); setNote(''); g.reload(); } catch (e) { toast(e.message); } finally { setBusy(''); }
  };
  const sample = async () => {
    setBusy('sample');
    try { const r = await api('/audit-sample', { method: 'POST', body: { n: Number(n) } }); toast(`Drew ${r.created} random control zone(s) for ${monthName(r.month)}. Assign them like any other flag.`); controls.reload(); } catch (e) { toast(e.message); } finally { setBusy(''); }
  };
  const busyBurden = s.falsePositiveBurden;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Governance · {monthName(d.latest)}</div>
          <h1>Guardrails, bias audit and pilot metrics</h1>
          <p className="sub">What stops a score being read as an accusation, and how we check the model is fair and working</p>
        </div>
        <span className="badge" style={{ color: d.release.ready ? 'var(--green)' : '#E69F00', borderColor: 'currentColor', fontSize: 12, padding: '4px 12px' }}>
          {d.release.ready ? 'Release checks passed' : 'Release checks open'}
        </span>
      </div>

      {!d.release.ready && (
        <div className="note-box" style={{ borderColor: '#E69F00' }}>
          <strong>Before this release is used for field planning:</strong>
          <ul className="l-list small" style={{ marginTop: 4 }}>
            {!d.release.peerGroupsReviewed && <li>The peer groups have not been reviewed and signed off by a governance owner.</li>}
            {d.release.skewedGroups.map((x) => <li key={x}>"{ZONE_META[x] || x}" zones are flagged far more often than average without field confirmation.</li>)}
          </ul>
        </div>
      )}

      <div className="tabs" role="tablist">
        {[['bias', 'Bias & coverage'], ['metrics', 'Pilot success metrics'], ['controls', 'Random audit sample'], ['guardrails', 'Guardrails'], ...(canAudit ? [['audit', 'Audit log']] : [])].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'bias' && <>
        <div className="grid g4">
          <MetricTile label="Zones scored" value={`${d.overall.scored} / ${d.overall.zones}`} hint={`${d.overall.zones - d.overall.scored} show "insufficient data"`} />
          <MetricTile label="Overall flag rate" value={pct(d.overall.rate, 0, false)} hint="high + medium tiers, of scored zones" />
          <MetricTile label="Flags held back" value={num(d.suppressedSingleSignal)} hint="supported by one signal or night lights only" />
          <MetricTile label="Sensitive zones" value={num(d.sensitive.length)} hint="need senior sign-off before a visit" />
        </div>
        <BiasTable title="Flag rates by zone type" sub="A zone type flagged much more often than average, with no field confirmation behind it, must be reviewed before release." rows={d.byZone} label={(x) => ZONE_META[x] || x} overall={d.overall.rate} />
        <BiasTable title="Flag rates by data-quality tier" sub="Poor data should lead to 'insufficient data', not to more flags." rows={d.byQuality} overall={d.overall.rate} />
        <BiasTable title="Flag rates by peer group" sub="Peer groups encode judgement, so their flag rates are audited too." rows={d.byPeer} overall={d.overall.rate} />

        <div className="grid g2">
          <div className="card">
            <div className="card-head"><div><h2>Peer-group review</h2><p className="sub">{d.peerGroups.length} groups from k = {d.settings.peer_groups_k}. Traits: built density, tourism intensity, road access, distance to a market centre, land use.</p></div></div>
            {d.peerGroups.map((p) => <div key={p.id} className="small" style={{ marginBottom: 8 }}><strong>{p.name}</strong> <span className="muted">· {p.n} zones · {p.description}</span></div>)}
            <div className="divider" style={{ margin: '10px 0' }} />
            {d.peerReview ? <div className="ok-box">Reviewed by {d.peerReview.reviewer} {ago(d.peerReview.created_at)}: “{d.peerReview.note}”</div> : <div className="note-box small" style={{ borderColor: '#E69F00' }}>Not yet reviewed for this configuration.</div>}
            {canReview && <div className="col" style={{ gap: 8, marginTop: 10 }}>
              <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you check? e.g. tourism belt and town centres are separated; mining zones grouped together" aria-label="Review note" />
              <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={busy === 'review' || note.trim().length < 10} onClick={review}>Record review</button>
            </div>}
          </div>
          <div className="card">
            <div className="card-head"><div><h2>Sensitive zones</h2><p className="sub">Marked for insecure tenure or informal settlement</p></div></div>
            {d.sensitive.length === 0 ? <Empty>None marked.</Empty> : <table><tbody>{d.sensitive.map((z) => (
              <tr key={z.id}><td><Link to={`/app/cells/${z.id}`}>{z.name}</Link> <span className="small muted">{z.taluka}</span></td><td><TierBadge t={z.tier} /></td><td className="small muted right">{z.open_flags ? `${z.open_flags} open flag(s)` : ''}</td></tr>
            ))}</tbody></table>}
            <div className="divider" style={{ margin: '10px 0' }} />
            <h3 style={{ marginBottom: 6 }}>Why zones have no score</h3>
            {d.insufficient.map((x) => <div key={x.reason} className="row between small"><span>{x.reason === 'suppressed' ? `Recorded count below ${d.settings.min_cell_count} (suppressed)` : `Coverage below ${pct(d.settings.min_coverage, 0, false)}`}</span><strong>{x.n}</strong></div>)}
          </div>
        </div>
      </>}

      {tab === 'metrics' && <>
        <div className="grid g4">
          <MetricTile label="Validation hit rate (high tier)" value={pct(s.hitRate.topTier, 0, false)} target="clearly above random controls" met={s.hitRate.topTier !== null && s.hitRate.control !== null ? s.hitRate.topTier > s.hitRate.control + 0.1 : null} hint={`controls: ${pct(s.hitRate.control, 0, false)}`} />
          <MetricTile label="Lift over random selection" value={s.lift.value === null ? '—' : `${num(s.lift.value, 2)}×`} target="> 1.5×" met={s.lift.value === null ? null : s.lift.met} />
          <MetricTile label="Calibration" value={s.calibration.bands.map((b) => `${b.band} ${b.diff > 0 ? '+' : ''}${Math.round(b.diff * 100)}`).join(' · ') || '—'} target="within ±10 points per band" met={s.calibration.bands.length ? s.calibration.met : null} />
          <MetricTile label="Explainability" value={pct(s.explainability.share, 0, false)} target="100%" met={s.explainability.share === null ? null : s.explainability.share === 1} hint={`${s.explainability.n} flags with full decomposition and coverage note`} />
          <MetricTile label="Freshness" value={s.freshness.upToDate ? 'Up to date' : 'Behind'} target="≤ 1 month from data to scores" met={s.freshness.upToDate} hint={`data ${monthName(s.freshness.dataMonth)}, scores ${monthName(s.freshness.scoredMonth)}`} />
          <MetricTile label="Adoption this month" value={`${s.adoption.activeThisMonth} / ${s.adoption.trainedUsers}`} target="majority of trained users" met={s.adoption.share > 0.5} hint="users active in the portal" />
          <MetricTile label="False-positive burden" value={busyBurden.length ? pct(busyBurden[busyBurden.length - 1].share, 0, false) : '—'} target="falling quarter on quarter"
            met={busyBurden.length > 1 ? busyBurden[busyBurden.length - 1].share <= busyBurden[busyBurden.length - 2].share : null} hint="tourism-zone flags marked legitimately busy" />
          <MetricTile label="Formalisation outcome" value="Not reported" hint={s.formalisation.note} />
        </div>
        <div className="card">
          <div className="card-head"><div><h2>False-positive burden by quarter</h2><p className="sub">Share of flags in tourism zones that field teams marked "legitimately busy"</p></div></div>
          {busyBurden.length === 0 ? <Empty>No tourism-zone validations yet.</Empty> : <table>
            <thead><tr><th>Quarter</th><th className="num">Tourism-zone visits</th><th className="num">Marked legitimately busy</th></tr></thead>
            <tbody>{busyBurden.map((b) => <tr key={b.quarter}><td>{b.quarter}</td><td className="num">{b.n}</td><td className="num">{pct(b.share, 0, false)}</td></tr>)}</tbody>
          </table>}
          <p className="small muted" style={{ marginTop: 8 }}>These targets are proposals from the PRD, to be agreed with the pilot partner. All figures here come from the synthetic demo dataset.</p>
        </div>
      </>}

      {tab === 'controls' && <>
        <div className="card">
          <div className="card-head"><div><h2>Draw a random control sample</h2><p className="sub">Each cycle, field teams visit high-priority zones and a random set across all tiers. Comparing the two confirmation rates is the core test of the model.</p></div></div>
          {canSample ? <div className="row">
            <div className="field" style={{ width: 120 }}><label htmlFor="n">Zones to draw</label><input id="n" className="input" type="number" min="1" max="30" value={n} onChange={(e) => setN(e.target.value)} /></div>
            <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={busy === 'sample'} onClick={sample}>{busy === 'sample' ? 'Drawing…' : 'Draw control zones'}</button>
            <span className="small muted" style={{ alignSelf: 'flex-end' }}>Stratified across high, medium and low tiers. Sensitive zones and zones with an open flag are excluded.</span>
          </div> : <p className="small muted">Analysts and administrators draw control samples.</p>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Control visits</h2><Link className="small" to="/app/alerts?control=1&status=">Open in flag register →</Link></div>
          {controls.loading && !controls.data ? <Loading /> : !controls.data?.length ? <Empty>No control zones drawn yet.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Code</th><th>Zone</th><th>Cycle</th><th>Assigned to</th><th>Status</th><th>Outcome</th></tr></thead>
              <tbody>{controls.data.map((c) => (
                <tr key={c.id}><td><Link to={`/app/alerts/${c.id}`}><code>{c.code}</code></Link></td><td>{c.name} <span className="small muted">{c.taluka}</span></td><td className="small">{monthName(c.first_detected)}</td>
                  <td className="small">{c.assignee || '—'}</td><td><StatusBadge s={c.status} /></td><td className="small">{OUTCOME_META[c.outcome] || '—'}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </>}

      {tab === 'guardrails' && <>
        <div className="card">
          <div className="card-head"><div><h2>Four layers, kept separate</h2><p className="sub">The last layer, the enforcement decision, sits entirely outside the system.</p></div></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Layer</th><th>What it is</th><th>Who owns it</th><th>Where it lives in the product</th></tr></thead>
            <tbody>{LAYERS.map(([a, b, c, e], i) => <tr key={a} style={i === 3 ? { opacity: 0.75 } : undefined}><td className="strong">{a}</td><td>{b}</td><td>{c}</td><td className="small muted">{e}</td></tr>)}</tbody>
          </table></div>
        </div>
        <div className="grid g3">
          {GUARDRAILS.map(([t, b]) => <div key={t} className="card"><h3 style={{ marginBottom: 6 }}>{t}</h3><p className="small muted">{b}</p></div>)}
        </div>
        <p className="small muted">{meta?.disclaimer}</p>
      </>}

      {tab === 'audit' && canAudit && <AuditLog />}
    </div>
  );
}

function AuditLog() {
  const [filter, setFilter] = useState('');
  const { data, error, loading } = useApi(`/activity${filter ? `?action=${filter}` : ''}`);
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Audit log</h2><p className="sub">Append-only. Every view, export, assignment and outcome, traceable to a user and a time.</p></div>
        <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter actions">
          <option value="">All actions</option><option value="export">Exports</option><option value="alert.view">Flag views</option><option value="zone.view">Zone views</option>
          <option value="alert.validate">Field outcomes</option><option value="alert.assign">Assignments</option><option value="alert.signoff">Senior sign-offs</option>
          <option value="settings">Settings changes</option><option value="api">Partner API calls</option><option value="auth">Sign-ins</option>
        </select>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorBox>{error}</ErrorBox> : !data.length ? <Empty>No entries.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>User</th><th>Role</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>{data.map((l) => (
            <tr key={l.id}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{ago(l.created_at)}</td><td>{l.user_name || 'Partner API'}</td><td className="small muted">{ROLE_META[l.user_role] || '—'}</td><td>{ACTION_META[l.action] || l.action}</td>
              <td className="small">{l.entity === 'alert' && l.entity_id ? <Link to={`/app/alerts/${l.entity_id}`}>flag #{l.entity_id}</Link> : l.entity === 'zone' && l.entity_id ? <Link to={`/app/cells/${l.entity_id}`}>zone #{l.entity_id}</Link> : l.entity || '—'}</td>
              <td className="small muted mono" style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.details || ''}>{l.details || ''}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
