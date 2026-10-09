import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Layout.jsx';
import GridMap from '../components/GridMap.jsx';
import ModelExplainer, { ALERT_KINDS } from '../components/ModelExplainer.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function Landing() {
  const { user, logout } = useAuth();
  const [preview, setPreview] = useState(null);
  const [layer, setLayer] = useState('eai');
  useEffect(() => { fetch('/api/public/preview').then((r) => r.json()).then(setPreview).catch(() => {}); }, []);
  const appLink = user ? '/app' : '/login';

  return (
    <div className="landing">
      <nav className="l-nav">
        <Link to="/" className="brand" style={{ padding: 0 }}><Logo size={34} /><div><div className="brand-name">EconoScope</div><div className="brand-sub">Goa pilot</div></div></Link>
        <div className="links">
          <a href="#how">How it works</a><a href="#model">The model</a>
          {user && <button className="btn ghost" onClick={logout}>Sign out</button>}
          <Link to={appLink} className="btn primary">{user ? 'Open portal' : 'Sign in'}</Link>
        </div>
      </nav>

      <section className="l-section hero">
        <div>
          <h1>See where the economy is <em>growing, shrinking or missing</em> from the records.</h1>
          <p className="lead">
            EconoScope compares official business records with what satellites, tourism data and infrastructure show on the ground, zone by zone.
            Every flag comes with a reason and a confidence score, and it never points at an individual business.
          </p>
          <div className="row" style={{ gap: 12 }}>
            <Link to={appLink} className="btn primary">{user ? 'Open the portal →' : 'Sign in to the portal →'}</Link>
            <a href="#model" className="btn">How the model works</a>
          </div>
          {preview && (
            <div className="row" style={{ gap: 32, marginTop: 34 }}>
              <div><div className="l-stat" style={{ fontSize: 30 }}>{preview.stats.cells}</div><div className="small muted">zones monitored monthly</div></div>
              <div><div className="l-stat" style={{ fontSize: 30, color: 'var(--amber)' }}>8</div><div className="small muted">data sources combined</div></div>
              <div><div className="l-stat" style={{ fontSize: 30, color: 'var(--teal)' }}>{preview.stats.open_alerts}</div><div className="small muted">zones flagged for a closer look</div></div>
            </div>
          )}
        </div>
        <div>
          <div className="hero-map">
            {preview ? (
              <GridMap cells={preview.cells} values={preview.cells} layer={layer} height="100%" interactive={false} showAlerts={false} opacity={0.8} />
            ) : <div className="loading" style={{ height: '100%' }}><div className="spinner" /></div>}
          </div>
          <div className="row between" style={{ marginTop: 10 }}>
            <span className="small muted">Goa, latest month · demo data</span>
            <div className="seg">
              <button className={layer === 'eai' ? 'on' : ''} onClick={() => setLayer('eai')}>Activity</button>
              <button className={layer === 'gap_z' ? 'on' : ''} onClick={() => setLayer('gap_z')}>Gap vs peers</button>
            </div>
          </div>
        </div>
      </section>

      <section className="l-section" id="how">
        <h2 className="l-title">How it works</h2>
        <p className="muted" style={{ maxWidth: 680, marginBottom: 28 }}>Three steps, repeated every month.</p>
        <div className="grid g3">
          {[['1', 'var(--amber)', 'Combine the data', 'Business registrations and survey counts are combined with night-time satellite lights, built-up area and tourism figures, added up to ~2.7 km zones across Goa.'],
            ['2', 'var(--teal)', 'Compare with the records', 'Each zone is compared only with zones of the same kind. The model works out what should be on record there and flags zones that sit far from their peers, or are changing unusually fast.'],
            ['3', 'var(--orange)', 'Check on the ground', 'Each flag carries its evidence and a confidence score. Field teams visit the top zones and a random control set, offer registration support, and their findings recalibrate the model.']].map(([n, c, t, d]) => (
            <div key={n} className="l-card">
              <div className="pill-num" style={{ background: c }}>{n}</div>
              <h3 style={{ font: '700 19px var(--serif)', margin: '16px 0 8px' }}>{t}</h3>
              <p className="muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="l-section" id="model">
        <h2 className="l-title">What the model does</h2>
        <p className="muted" style={{ maxWidth: 720, marginBottom: 28 }}>
          In plain words: it works out how many businesses should be on record in each zone, given what can be observed there and in similar zones, and tells you where the records fall short or run ahead. It also says how sure it is.
        </p>
        <ModelExplainer />
      </section>

      <section className="l-section">
        <h2 className="l-title">Four kinds of alert</h2>
        <div className="grid g4" style={{ marginTop: 20 }}>
          {ALERT_KINDS.map(([t, c, d]) => (
            <div key={t} className="l-card" style={{ borderTop: `3px solid ${c}` }}>
              <h3 style={{ fontSize: 16, color: c, marginBottom: 6 }}>{t}</h3>
              <p className="muted small">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="l-section" style={{ textAlign: 'center' }}>
        <div className="l-card" style={{ padding: '40px 24px' }}>
          <h2 className="l-title">Explore the Goa pilot</h2>
          <p className="muted" style={{ marginBottom: 20 }}>Sign in with a demo account to browse the map, review alerts and record field validations.</p>
          <Link to={appLink} className="btn primary">{user ? 'Open the portal →' : 'Sign in →'}</Link>
        </div>
      </section>

      <footer className="footer">
        EconoScope · Team Chakravyuh (Vedant Borker, Swayam Prabhu, Prashant Goundadkar, Pratik Murkar) · Padre Conceição College of Engineering, Goa<br />
        The pilot runs on a synthetic demo dataset. Alerts are anomalies to validate, never findings of wrongdoing.
      </footer>
    </div>
  );
}
