import { useState, useEffect, createContext, useContext } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth, can } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { ROLE_META, monthName } from '../lib/format.js';

export const Logo = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="#1f2027" />
    <circle cx="14" cy="14" r="7.5" fill="none" stroke="#f0b429" strokeWidth="2.6" />
    <path d="M19.5 19.5 26 26" stroke="#f0b429" strokeWidth="3" strokeLinecap="round" />
    <circle cx="14" cy="14" r="2.4" fill="#2ec4b6" />
  </svg>
);

const MetaCtx = createContext({ meta: null, refreshMeta: () => {} });
export const useMeta = () => useContext(MetaCtx);

const initials = (n) => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export default function Layout() {
  const { user, logout } = useAuth();
  const [meta, setMeta] = useState(null);
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({});
  const loc = useLocation();
  const signOut = () => { logout(); window.location.replace('/'); };

  const refreshMeta = () => {
    api('/meta').then(setMeta).catch(() => {});
    if (user.role !== 'field_officer') api('/alerts?status=open,assigned&limit=1').then((r) => setCounts((c) => ({ ...c, alerts: r.total }))).catch(() => {});
    api('/alerts?status=assigned&mine=1&limit=1').then((r) => setCounts((c) => ({ ...c, tasks: r.total }))).catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refreshMeta, []);
  useEffect(() => setOpen(false), [loc.pathname]);

  const isField = user.role === 'field_officer';
  return (
    <MetaCtx.Provider value={{ meta, refreshMeta }}>
      <div className="shell">
        <aside className={`sidebar ${open ? 'open' : ''}`}>
          <Link to="/app" className="brand"><Logo /><div><div className="brand-name">EconoScope</div><div className="brand-sub">Goa pilot</div></div></Link>
          <nav className="nav" aria-label="Main">
            <div className="nav-label">Monitor</div>
            {!isField && <NavLink to="/app" end>◉ Overview</NavLink>}
            <NavLink to="/app/map">▦ Activity map</NavLink>
            {!isField && <NavLink to="/app/alerts">⚑ Alerts {counts.alerts ? <span className="count">{counts.alerts}</span> : null}</NavLink>}
            <NavLink to="/app/field">✓ Field tasks {counts.tasks ? <span className="count">{counts.tasks}</span> : null}</NavLink>
            {!isField && <>
              <div className="nav-label">Intelligence</div>
              <NavLink to="/app/analytics">◔ Analytics & model</NavLink>
              <NavLink to="/app/data">⛁ Data & pipeline</NavLink>
            </>}
            {can(user, 'admin') && <>
              <div className="nav-label">Administration</div>
              <NavLink to="/app/admin">⚙ Users & settings</NavLink>
            </>}
            <div className="nav-label">About</div>
            <NavLink to="/app/method">ⓘ Methodology</NavLink>
          </nav>
          <div className="sidebar-foot">
            <div className="user-chip">
              <div className="avatar">{initials(user.name)}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="strong" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
                <div className="small muted">{ROLE_META[user.role]}{user.taluka ? ` · ${user.taluka}` : ''}</div>
              </div>
            </div>
            <button className="btn sm" style={{ width: '100%', marginTop: 10 }} onClick={signOut}>Sign out</button>
          </div>
        </aside>
        {open && <div className="modal-bg" style={{ zIndex: 1100, background: 'rgba(0,0,0,.4)' }} onClick={() => setOpen(false)} />}
        <div className="main">
          <header className="topbar">
            <button className="btn ghost sm menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
            <div className="small muted">Data through <strong style={{ color: 'var(--text)' }}>{meta ? monthName(meta.latest) : '…'}</strong></div>
            <div className="spacer" />
            {meta?.synthetic && <span className="synthetic-pill" title="Seeded demo data shaped like the real sources. Upload real datasets under Data & pipeline.">Demo dataset (synthetic)</span>}
            <span className="small muted topbar-user">{user.name} · {ROLE_META[user.role]}</span>
            <button className="btn sm" onClick={signOut}>⎋ Sign out</button>
          </header>
          <Outlet />
        </div>
      </div>
    </MetaCtx.Provider>
  );
}
