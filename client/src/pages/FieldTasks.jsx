import { Link } from 'react-router-dom';
import { useApi, Loading, ErrorBox, Empty, PriorityBadge, TypeBadge, StatusBadge, Confidence } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';
import { num, pct, monthShort, OUTCOME_META, TYPE_META } from '../lib/format.js';

export default function FieldTasks() {
  const { user } = useAuth();
  const pending = useApi('/alerts?status=assigned&mine=1&sort=priority');
  const done = useApi('/alerts?status=validated,dismissed&mine=1&sort=updated&limit=20');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Field tasks</div>
          <h1>My validation queue</h1>
          <p className="sub">{user.role === 'field_officer' ? `Assigned to you${user.taluka ? ` · base taluka ${user.taluka}` : ''}.` : 'Alerts assigned to your own account. Analysts can assign alerts to field officers from any alert page.'}</p>
        </div>
      </div>

      <div className="note-box">
        For each task, visit the cell, count the operating establishments and record what you find. Your verified counts become ground truth.
        They measure model accuracy and recalibrate the baseline, so the same pattern is not flagged again if it has a known explanation.
      </div>

      {pending.loading && !pending.data ? <Loading /> : pending.error ? <ErrorBox>{pending.error}</ErrorBox> : pending.data.rows.length === 0 ? (
        <div className="card"><Empty>No pending tasks. 🎉</Empty></div>
      ) : (
        <div className="grid g3">
          {pending.data.rows.map((a) => {
            const isChange = a.type === 'emerging_hotspot' || a.type === 'contraction';
            return (
              <Link key={a.id} to={`/app/alerts/${a.id}`} className="card col" style={{ color: 'var(--text)', gap: 10, borderTop: `2px solid ${TYPE_META[a.type].color}` }}>
                <div className="row between"><code className="muted">{a.code}</code><PriorityBadge p={a.priority} /></div>
                <div><h2>{a.name}</h2><div className="small muted">{a.taluka} · {a.lat.toFixed(4)}, {a.lon.toFixed(4)}</div></div>
                <TypeBadge t={a.type} />
                <dl className="kv">
                  <dt>Model estimate</dt><dd>~{num(a.observed)}</dd>
                  <dt>Registered</dt><dd>{num(a.registered)}</dd>
                  <dt>{isChange ? 'YoY change' : 'Gap vs records'}</dt><dd>{isChange ? pct(a.yoy_activity) : pct(a.gap_pct)}</dd>
                </dl>
                <Confidence value={a.confidence} />
                <span className="btn primary sm" style={{ alignSelf: 'flex-start' }}>Open & record validation →</span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>Completed</h2></div>
        {done.loading && !done.data ? <Loading /> : done.data?.rows.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Alert</th><th>Location</th><th>Type</th><th>Outcome</th><th>Detected</th><th>Status</th></tr></thead>
            <tbody>{done.data.rows.map((a) => (
              <tr key={a.id}><td><Link to={`/app/alerts/${a.id}`}><code>{a.code}</code></Link></td><td>{a.name} <span className="small muted">{a.taluka}</span></td>
                <td><TypeBadge t={a.type} /></td><td>{OUTCOME_META[a.outcome] || '—'}</td><td className="small">{monthShort(a.first_detected)}</td><td><StatusBadge s={a.status} /></td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No completed validations yet.</Empty>}
      </div>
    </div>
  );
}
