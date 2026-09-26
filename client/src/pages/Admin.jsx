import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Loading, ErrorBox, Modal, useToast } from '../components/ui.jsx';
import { useMeta } from '../components/Layout.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLE_META, ACTION_META, ago } from '../lib/format.js';

export default function Admin() {
  const [tab, setTab] = useState('users');
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Administration</div><h1>Users, detection settings & audit</h1></div>
      </div>
      <div className="tabs" role="tablist">
        {[['users', 'Users'], ['settings', 'Detection settings'], ['audit', 'Audit log']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'users' && <Users />}
      {tab === 'settings' && <Settings />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function Users() {
  const { user: me } = useAuth();
  const { meta } = useMeta();
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/users');
  const [edit, setEdit] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  return (
    <div className="card">
      <div className="card-head"><h2>{data.length} users</h2><button className="btn primary sm" onClick={() => setEdit({})}>+ New user</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Taluka</th><th className="num">Open tasks</th><th>Status</th><th /></tr></thead>
        <tbody>{data.map((u) => (
          <tr key={u.id}><td className="strong">{u.name}{u.id === me.id && <span className="small muted"> (you)</span>}</td><td className="small">{u.email}</td><td>{ROLE_META[u.role]}</td><td>{u.taluka || '—'}</td>
            <td className="num">{u.open_tasks}</td><td>{u.active ? <span className="badge s-validated">Active</span> : <span className="badge s-dismissed">Disabled</span>}</td>
            <td className="right"><button className="btn sm" onClick={() => setEdit(u)}>Edit</button></td></tr>
        ))}</tbody>
      </table></div>
      {edit && <UserModal u={edit} talukas={meta?.talukas || []} onClose={() => setEdit(null)} onSaved={(m) => { toast(m); setEdit(null); reload(); }} />}
    </div>
  );
}

function UserModal({ u, talukas, onClose, onSaved }) {
  const isNew = !u.id;
  const [f, setF] = useState({ name: u.name || '', email: u.email || '', role: u.role || 'field_officer', taluka: u.taluka || '', password: '', active: u.active ?? true });
  const [err, setErr] = useState('');
  const up = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try {
      if (isNew) await api('/users', { method: 'POST', body: f });
      else await api(`/users/${u.id}`, { method: 'PATCH', body: { name: f.name, role: f.role, taluka: f.taluka, active: f.active, ...(f.password ? { password: f.password } : {}) } });
      onSaved(isNew ? 'User created' : 'User updated');
    } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={isNew ? 'New user' : `Edit ${u.name}`} onClose={onClose}>
      <form className="col" style={{ gap: 12 }} onSubmit={save}>
        <ErrorBox>{err}</ErrorBox>
        <div className="field"><label>Name</label><input className="input" value={f.name} onChange={up('name')} required /></div>
        <div className="field"><label>Email</label><input className="input" type="email" value={f.email} onChange={up('email')} required disabled={!isNew} /></div>
        <div className="grid g2">
          <div className="field"><label>Role</label><select className="select" value={f.role} onChange={up('role')}>{Object.entries(ROLE_META).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label>Base taluka</label><select className="select" value={f.taluka} onChange={up('taluka')}><option value="">—</option>{talukas.map((t) => <option key={t.name}>{t.name}</option>)}</select></div>
        </div>
        <div className="field"><label>{isNew ? 'Password' : 'Reset password (optional)'}</label><input className="input" type="password" minLength={8} value={f.password} onChange={up('password')} required={isNew} autoComplete="new-password" /><span className="help">At least 8 characters</span></div>
        {!isNew && <label className="row small"><input type="checkbox" checked={f.active} onChange={up('active')} /> Account active</label>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}

function Settings() {
  const toast = useToast();
  const { data, error, loading } = useApi('/settings');
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (loading || !s) return error ? <ErrorBox>{error}</ErrorBox> : <Loading />;
  const set = (k) => (e) => setS({ ...s, [k]: Number(e.target.value) });
  const setW = (k) => (e) => setS({ ...s, weights: { ...s.weights, [k]: Number(e.target.value) } });
  const save = async () => {
    setErr('');
    try { await api('/settings', { method: 'PUT', body: s }); toast('Settings saved. They apply from the next engine run.'); } catch (x) { setErr(x.message); }
  };
  const F = ({ k, label, help, step = 0.1, min, max }) => (
    <div className="field"><label>{label}</label><input className="input" type="number" step={step} min={min} max={max} value={s[k]} onChange={set(k)} /><span className="help">{help}</span></div>
  );
  return (
    <div className="grid g2">
      <div className="card col" style={{ gap: 14 }}>
        <h2>Detection thresholds</h2>
        <ErrorBox>{err}</ErrorBox>
        {F({ k: 'gap_z_threshold', label: 'Visibility gap threshold (robust z)', help: 'How far a cell’s observed/recorded ratio must sit from the statewide norm', min: 1, max: 6 })}
        {F({ k: 'change_z_threshold', label: 'YoY change threshold (robust z)', help: 'How unusual seasonally adjusted growth or decline must be', min: 1, max: 6 })}
        {F({ k: 'min_gap_establishments', label: 'Minimum absolute impact', help: 'Establishment-equivalents; filters out tiny rural cells', step: 1, min: 0, max: 5000 })}
        {F({ k: 'min_change_pct', label: 'Minimum YoY change (fraction)', help: '0.15 = 15%', step: 0.01, min: 0, max: 2 })}
        {F({ k: 'cooldown_months', label: 'Cooldown after closing (months)', help: 'Do not re-raise the same type in the same cell within this window', step: 1, min: 0, max: 24 })}
      </div>
      <div className="card col" style={{ gap: 14 }}>
        <h2>Confidence score weights</h2>
        <p className="small muted">Confidence = weighted mean of four transparent components. Weights are normalised automatically.</p>
        {[['agreement', 'Signal agreement'], ['magnitude', 'Magnitude'], ['persistence', 'Persistence'], ['isolation', 'Isolation Forest']].map(([k, l]) => (
          <div className="field" key={k}>
            <label>{l}: {s.weights[k].toFixed(2)}</label>
            <input type="range" min="0" max="1" step="0.05" value={s.weights[k]} onChange={setW(k)} />
          </div>
        ))}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'auto' }}>
          <button className="btn" onClick={() => setS(data.defaults)}>Reset to defaults</button>
          <button className="btn primary" onClick={save}>Save settings</button>
        </div>
        <p className="small muted">After saving, run the engine from <Link to="/app/data">Data & pipeline</Link> to apply.</p>
      </div>
    </div>
  );
}

function Audit() {
  const { data, error, loading } = useApi('/activity');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  return (
    <div className="card">
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>User</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>{data.map((l) => (
          <tr key={l.id}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{ago(l.created_at)}</td><td>{l.user_name || 'System'}</td><td>{ACTION_META[l.action] || l.action}</td>
            <td className="small">{l.entity === 'alert' ? <Link to={`/app/alerts/${l.entity_id}`}>alert #{l.entity_id}</Link> : l.entity ? `${l.entity}${l.entity_id ? ` #${l.entity_id}` : ''}` : '—'}</td>
            <td className="small muted mono" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.details || ''}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
