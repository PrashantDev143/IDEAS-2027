import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Logo } from '../components/Layout.jsx';
import { ErrorBox } from '../components/ui.jsx';

const DEMO = [
  ['admin@econoscope.in', 'admin123', 'Administrator', 'Everything, plus users, settings, sign-off for sensitive zones'],
  ['analyst@econoscope.in', 'analyst123', 'Policy analyst', 'Rank zones, assign field teams, export validation lists'],
  ['field.north@econoscope.in', 'field123', 'Field validation officer', 'Own visit list and outcome form only'],
  ['planner@econoscope.in', 'planner123', 'Planner / formalisation lead', 'Read-only view, plus outreach referrals'],
  ['auditor@econoscope.in', 'auditor123', 'Auditor', 'Read-only view, audit log, bias and coverage review'],
];

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/app" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const u = await login(email, password);
      nav(u.role === 'field_officer' ? '/app/field' : '/app');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-side">
        <Link to="/" className="brand" style={{ padding: 0 }}><Logo size={36} /><div><div className="brand-name">EconoScope</div><div className="brand-sub">Government validation portal</div></div></Link>
        <div>
          <h1 style={{ fontSize: 40, marginBottom: 14 }}>Detect. Explain. <span style={{ color: 'var(--amber)' }}>Validate.</span></h1>
          <p className="muted" style={{ maxWidth: 460, fontSize: 15 }}>
            Every flag says which zone differs from its peers, why, and how sure the model is. Field teams then check on the ground. It never names a business or a person.
          </p>
        </div>
        <p className="small muted">IDEAS 5.0 · Team Chakravyuh · PCCE Goa</p>
      </div>
      <div className="auth-form">
        <form onSubmit={submit}>
          <div><h1>Sign in</h1><p className="sub">Use your department account.</p></div>
          <ErrorBox>{error}</ErrorBox>
          <div className="field"><label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pw">Password</label>
            <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="divider" />
          <div className="small muted">Demo accounts (click to fill)</div>
          {DEMO.map(([e, p, r, d]) => (
            <button type="button" key={e} className="demo-acc" onClick={() => { setEmail(e); setPassword(p); }}>
              <span><strong>{r}</strong><br /><span className="muted">{d}</span></span>
              <code className="muted">{p}</code>
            </button>
          ))}
          <Link to="/" className="small muted" style={{ textAlign: 'center' }}>← Back to overview</Link>
        </form>
      </div>
    </div>
  );
}
