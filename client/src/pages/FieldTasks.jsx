import { Link } from 'react-router-dom';
import { useApi, Loading, ErrorBox, Empty, TierBadge, TypeBadge, StatusBadge, SensitiveBadge, Confidence } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';
import { num, pct, sigma, monthShort, OUTCOME_META, TYPE_META } from '../lib/format.js';

export default function FieldTasks() {
  const { user } = useAuth();
  const pending = useApi('/alerts?status=assigned&mine=1&sort=priority');
  const done = useApi('/alerts?status=validated,dismissed&mine=1&sort=updated&limit=20');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Field tasks</div>
          <h1>My visit list</h1>
          <p className="sub">{user.role === 'field_officer' ? `Zones assigned to you${user.taluka ? ` · base taluka ${user.taluka}` : ''}.` : 'Flags assigned to your own account. Analysts assign flags to field officers from any flag page.'}</p>
        </div>
      </div>

      <div className="note-box">
        Each task is a zone, not a business. Count what is operating, note what explains it, and offer registration support.
        Some visits are random control zones: treat them exactly like the others. Your counts are what keeps the model honest.
      </div>

      {pending.loading && !pending.data ? <Loading /> : pending.error ? <ErrorBox>{pending.error}</ErrorBox> : pending.data.rows.length === 0 ? (
        <div className="card"><Empty>No pending visits.</Empty></div>
      ) : (
        <div className="grid g3">
          {pending.data.rows.map((a) => {
            const isChange = a.type === 'emerging_hotspot' || a.type === 'contraction';
            return (
              <Link key={a.id} to={`/app/alerts/${a.id}`} className="card col" style={{ color: 'var(--text)', gap: 10, borderTop: `2px solid ${TYPE_META[a.type].color}` }}>
                <div className="row between"><code className="muted">{a.code}</code><TierBadge t={a.priority} /></div>
                <div><h2>{a.name}</h2><div className="small muted">{a.taluka} · {a.lat.toFixed(4)}, {a.lon.toFixed(4)}</div></div>
                <div className="row"><TypeBadge t={a.type} />{a.sensitive ? <SensitiveBadge /> : null}</div>
                <dl className="kv">
                  <dt>On record</dt><dd>{num(a.registered)}</dd>
                  <dt>Expected for its peers</dt><dd>~{num(a.expected)}</dd>
                  <dt>{isChange ? 'YoY activity' : 'Peer-relative gap'}</dt><dd>{isChange ? pct(a.yoy_activity) : sigma(a.gap_z)}</dd>
                </dl>
                {!a.is_control && <Confidence value={a.confidence} />}
                <span className="btn primary sm" style={{ alignSelf: 'flex-start' }}>Open checklist & record outcome →</span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>Completed</h2></div>
        {done.loading && !done.data ? <Loading /> : done.data?.rows.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Flag</th><th>Zone</th><th>Type</th><th>Outcome</th><th>Detected</th><th>Status</th></tr></thead>
            <tbody>{done.data.rows.map((a) => (
              <tr key={a.id}><td><Link to={`/app/alerts/${a.id}`}><code>{a.code}</code></Link></td><td>{a.name} <span className="small muted">{a.taluka}</span></td>
                <td><TypeBadge t={a.type} /></td><td>{OUTCOME_META[a.outcome] || '—'}</td><td className="small">{monthShort(a.first_detected)}</td><td><StatusBadge s={a.status} /></td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No completed visits yet.</Empty>}
      </div>
    </div>
  );
}
