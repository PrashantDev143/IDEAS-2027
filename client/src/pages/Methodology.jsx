import ModelExplainer from '../components/ModelExplainer.jsx';

const Section = ({ n, title, children }) => (
  <div className="card col" style={{ gap: 10 }}>
    <div className="row"><span className="step-num" style={{ fontSize: 22, color: 'var(--amber)' }}>{n}</span><h2>{title}</h2></div>
    {children}
  </div>
);
const F = ({ children }) => <div className="mono" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', overflowX: 'auto', whiteSpace: 'pre' }}>{children}</div>;

export default function Methodology() {
  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div>
        <div className="eyebrow">Methodology</div>
        <h1>How EconoScope detects anomalies</h1>
        <p className="sub">Every step is explainable. Nothing is a black box, and no alert claims wrongdoing.</p>
      </div>

      <div className="col" style={{ gap: 12 }}>
        <h2>In plain words</h2>
        <p className="muted">The model works out how much economic activity each area really has, compares it with the official records, and tells you where the two disagree or are changing fast. It also says how sure it is.</p>
        <ModelExplainer compact />
      </div>

      <h2 style={{ marginTop: 10 }}>Technical details</h2>

      <Section n="01" title="Spatial unit and data">
        <p className="muted">Goa is divided into ~2.7 km grid cells (0.025°). Each cell carries monthly values for official registrations and six independent signals:
          VIIRS night-time lights, built-up surface share, digital merchant payment points, commercial power connections, hospitality listings and tourist footfall.
          An annual survey baseline (ASUSE-style establishment estimate, modelled to cell level) is published at each financial-year close.</p>
      </Section>

      <Section n="02" title="Nowcast: from signals to observed activity">
        <p className="muted">A ridge regression is trained on the latest complete survey year, averaging each cell's signals over that year:</p>
        <F>{'ln(survey_c) = β₀ + β₁·ln(1+NTL) + β₂·BuiltUp + β₃·ln(1+Digital) + β₄·ln(1+Power) + β₅·ln(1+Listings) + β₆·ln(1+Footfall)'}</F>
        <p className="muted">Applied to every month, the model gives observed activity <em>O(c,t)</em> in establishment-equivalents, with a log-normal smearing correction. The survey is annual, so this nowcast fills the months between releases.</p>
      </Section>

      <Section n="03" title="Baseline: seasonality and the normal record ratio">
        <p className="muted">Goa's tourism cycle would otherwise dominate every signal. For each cell, a classical multiplicative decomposition (centred 2×12 moving average) estimates 12 seasonal factors:</p>
        <F>{'O_sa(c,t) = O(c,t) / S(c, month(t))'}</F>
        <p className="muted">The <strong>normal observed-to-recorded ratio κ</strong> is the median of O_sa/Registered across cells in the first 12 months (the baseline window). Expected activity from records is:</p>
        <F>{'E(c,t) = κ · Registered(c,t) · exp(calibration_c)'}</F>
        <p className="muted"><em>calibration_c</em> starts at 0. It changes only when field feedback says a flagged gap was explained or not real.</p>
      </Section>

      <Section n="04" title="Detection">
        <p className="muted"><strong>Visibility gap / record mismatch:</strong> gap = ln((O_sa+1)/(E+1)). Its robust z-score across all cells for the month (median/MAD) must be ≥ +2.5 (activity beyond records) or ≤ −2.5 (records beyond activity, e.g. dormant units). The absolute gap must also be ≥ 25 establishment-equivalents.</p>
        <p className="muted"><strong>Emerging hotspot / contraction:</strong> YoY = ln(mean O_sa over the last 3 months ÷ the same 3 months a year earlier). Its robust z must be beyond ±2.5, with at least a 15% change.</p>
        <p className="muted"><strong>Isolation Forest:</strong> 150 trees over each cell's multivariate profile (gap z, change z, per-signal deviations). This catches unusual combinations that no single rule would.</p>
      </Section>

      <Section n="05" title="Confidence and priority">
        <F>{`confidence = 100 × ( 0.35·agreement + 0.25·magnitude + 0.20·persistence + 0.20·isolation )

agreement   = share of applicable signals deviating ≥ 1σ in the alert's direction
magnitude   = min(1, |z| / (3 × threshold))
persistence = months (of last 6) with |z| ≥ 0.75 × threshold
isolation   = Isolation Forest score rescaled from [0.45, 0.65] to [0, 1]

priority score = confidence × (0.4 + 0.6 × log-scaled impact)   → high ≥ 50, medium ≥ 30`}</F>
        <p className="muted">When only one signal agrees, the explanation says so explicitly and recommends checking data quality before sending a team.</p>
      </Section>

      <Section n="06" title="Validation and feedback loop">
        <p className="muted">Analysts assign alerts to field officers. Officers record one of five outcomes (confirmed, partially confirmed, explained, false positive, data issue) with establishment counts and location.
          Outcomes drive three things. They measure <strong>precision</strong> and <strong>confidence calibration</strong>. Counts measure <strong>estimate error</strong> against ground truth.
          "Explained" and "false positive" outcomes on gap alerts <strong>recalibrate that cell's baseline</strong>, so the same pattern is not raised again.</p>
      </Section>

      <Section n="07" title="Responsible use">
        <ul className="l-list">
          <li>Alerts describe <em>economic-activity anomalies for validation</em>, never "illegal" or "unregistered" businesses as a finding.</li>
          <li>Only aggregated, authorised, legally accessible data at grid-cell level. No personal or transaction-level records.</li>
          <li>Role-based access (administrator, analyst, field officer) and a full audit trail of every action.</li>
          <li>The pilot runs on a <strong>synthetic dataset</strong> generated to mimic the real sources (including Mopa airport growth, coastal tourism seasonality and the mining-belt decline). Replace it with real data through the CSV upload.</li>
        </ul>
      </Section>
    </div>
  );
}
