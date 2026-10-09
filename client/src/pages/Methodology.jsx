import ModelExplainer from '../components/ModelExplainer.jsx';
import { useMeta } from '../components/Layout.jsx';

const Section = ({ n, title, children }) => (
  <div className="card col" style={{ gap: 10 }}>
    <div className="row"><span className="step-num" style={{ fontSize: 22, color: 'var(--amber)' }}>{n}</span><h2>{title}</h2></div>
    {children}
  </div>
);
const F = ({ children }) => <div className="mono" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', overflowX: 'auto', whiteSpace: 'pre' }}>{children}</div>;

export default function Methodology() {
  const { meta } = useMeta();
  const t = meta?.thresholds;
  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div>
        <div className="eyebrow">Methodology</div>
        <h1>Peer-normalised economic–registration residual model</h1>
        <p className="sub">The score is built from named parts, so it cannot collapse into one unexplained number.</p>
      </div>

      <div className="col" style={{ gap: 12 }}>
        <h2>In plain words</h2>
        <p className="muted">Registered footprint should bear a predictable relationship to independent signs of activity. EconoScope flags zones where that relationship breaks, relative to similar zones, persistently, and says how sure it is.</p>
        <ModelExplainer compact />
      </div>

      <h2 style={{ marginTop: 10 }}>Technical details</h2>

      <Section n="01" title="Zone and aggregate">
        <p className="muted">Goa is covered by a uniform grid of ~2.7 km zones (0.025°). Every input is aggregated to the same zones for each month. Each ingest is versioned with source, licence, acquisition date and transformation.
          Recorded counts below the minimum cell size ({t?.min_cell_count ?? 5}) are suppressed. Missing values stay missing: they reduce coverage and are never imputed silently.</p>
      </Section>

      <Section n="02" title="Peer groups">
        <p className="muted">Zones are clustered (k-means, k = {meta?.peerGroups?.length ?? 6}) on standardised structural traits: built density, tourism intensity, road and transit access, distance to a market centre, and industrial or mining land use.
          Registration data is never a trait. Groups too small to support a regression are merged with their nearest neighbour. Because peer groups encode judgement, a governance owner reviews and signs them off.</p>
      </Section>

      <Section n="03" title="Activity nowcast and seasonality">
        <p className="muted">For the Economic Shadow Map, a ridge regression trained on the latest survey baseline turns the signals into inferred activity intensity for every zone and month.
          A classical multiplicative decomposition (centred 2×12 moving average) gives each zone 12 seasonal factors, which are removed from activity and from each seasonal signal.</p>
        <F>{'x_sa(z,t) = x(z,t) / S(z, month(t))'}</F>
      </Section>

      <Section n="04" title="Expected footprint and the residual">
        <p className="muted">Each month a robust (Huber-reweighted) ridge regression predicts the registered footprint from the seasonally adjusted independent signals. Slopes are shared statewide for stability.
          Each peer group then gets its own level, partially pooled towards the statewide line so a small group cannot define its own "normal" and a whole group cannot hide a systematic gap.</p>
        <F>{`ln(Registered + 1) ~ β₀ + Σ βⱼ · signalⱼ          (robust ridge, all scored zones)
offset_g  = n_g / (n_g + 30) × median(residual in peer group g)
Expected_z = exp(ŷ_z − offset_g − calibration_z) − 1
Residual_z = ln(Expected_z + 1) − ln(Registered_z + 1)
Gap_z      = Residual_z / σ_peer(z)                  (σ from the peer group's MAD)
Range      = exp(ŷ ± 1.96 σ_peer)`}</F>
        <p className="muted">A positive gap means fewer units on record than expected; a negative gap means more. <em>calibration_z</em> is zero until field feedback says a flagged zone was ordinary.</p>
      </Section>

      <Section n="05" title="Spatial significance">
        <p className="muted">Local Moran's I and Getis-Ord Gi* are computed on the gap over queen-contiguous neighbours, with a conditional permutation test (199 permutations, p ≤ 0.05).
          Zones are tagged <strong>hot spot</strong> (cluster of positive gaps), <strong>cold spot</strong> (cluster of negative gaps), <strong>spatial outlier</strong>, or <strong>not significant</strong>. This separates isolated noise from real clusters.</p>
      </Section>

      <Section n="06" title="Temporal change">
        <p className="muted">A mean-shift change-point search runs on each zone's gap series, alongside the slope over the last six months. A gap is labelled <strong>new</strong> (a strong shift within six months), <strong>widening</strong>, <strong>narrowing</strong> or <strong>stable</strong>.
          Separately, seasonally adjusted activity is compared with the same three months a year earlier to find emerging hotspots and contractions.</p>
      </Section>

      <Section n="07" title="Confidence and priority">
        <F>{`confidence = 100 × ( 0.30·agreement + 0.20·coverage + 0.20·stability + 0.15·model + 0.15·spatial )

agreement  share of applicable signals ≥ 1σ from their peer group in the gap's direction
coverage   share of source values received over 12 months (registrations count double)
stability  months of the last 6 in which the gap held
model      1 − σ_peer / 0.5   (how tightly the peer group follows the expected line)
spatial    1 for a matching hot/cold spot, 0.6 for an outlier, 0.35 otherwise

Priority_z = Gap_z × Confidence_z / 100        ranked within district
Tiers: High ≥ ${t?.tier_high ?? 2} · Medium ≥ ${t?.tier_medium ?? 1.1} · Low · Insufficient data`}</F>
        <p className="muted">A gap flag needs |gap| ≥ {t?.gap_z ?? 2}σ and at least one agreeing signal other than night lights. Night lights saturate in dense cores, so they corroborate and never drive a flag alone.
          A difference smaller than {t?.min_gap ?? 25} units stays in the low tier however large it is in σ, so tiny zones cannot outrank real gaps.
          A zone with coverage below {Math.round((t?.min_coverage ?? 0.6) * 100)}% or a suppressed count is "insufficient data".</p>
      </Section>

      <Section n="08" title="Validation without ground truth">
        <ul className="l-list">
          <li><strong>Randomised audit sample.</strong> Each cycle, field teams visit high-priority zones and a random control set across all tiers. Comparing confirmation rates shows whether the ranking beats chance (target lift &gt; 1.5×).</li>
          <li><strong>Calibration.</strong> Stated confidence bands are compared with observed confirmation rates (target within ±10 points).</li>
          <li><strong>Signal agreement.</strong> A flag driven by one signal is down-weighted or held back.</li>
          <li><strong>Bias audit.</strong> Flag and confirmation rates are compared across zone types, data-quality tiers and peer groups every release.</li>
          <li><strong>Feedback.</strong> "Legitimately busy", "new development" and "nothing unusual" outcomes recalibrate that zone's expected level.</li>
        </ul>
      </Section>

      <Section n="09" title="Known signal biases">
        <div className="table-wrap"><table>
          <thead><tr><th>Signal</th><th>Known bias</th><th>How it is handled</th></tr></thead>
          <tbody>
            <tr><td className="strong">Night lights</td><td>Saturates in dense cores; cannot tell wealthy-sparse from poor-dense</td><td>Corroborating layer only; never the sole driver of a flag</td></tr>
            <tr><td className="strong">Built-up footprint</td><td>Misses activity inside residential buildings</td><td>Paired with land-use and tourism signals</td></tr>
            <tr><td className="strong">Tourism density</td><td>Strongly seasonal</td><td>Seasonality lens; like-for-like periods</td></tr>
            <tr><td className="strong">Registration data</td><td>Quality varies by area</td><td>Coverage score; flag rates audited by data-quality tier</td></tr>
            <tr><td className="strong">Peer groups</td><td>Can encode existing bias</td><td>Documented traits; governance review each release</td></tr>
          </tbody>
        </table></div>
      </Section>

      <Section n="10" title="About this pilot build">
        <ul className="l-list">
          <li>The pilot runs on a <strong>synthetic dataset</strong> shaped like the real sources (including Mopa airport growth, coastal seasonality, the mining-belt decline and patchy data in forest zones). Real zone aggregates can be loaded through the CSV upload.</li>
          <li>Research grounding: night-light proxies for activity (Chen &amp; Nordhaus 2011; Henderson, Storeygard &amp; Weil 2012), "predict the expected, measure the residual" (Tanzi; Alm &amp; Embaye 2010), and local spatial statistics (Anselin 1995; Getis-Ord).</li>
          <li>A Bayesian hierarchical model for full uncertainty is a later upgrade; this build uses partial pooling as a lighter stand-in.</li>
        </ul>
      </Section>
    </div>
  );
}
