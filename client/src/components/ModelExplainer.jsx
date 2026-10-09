// Plain-language description of the model, shared by the landing page and the Methodology page.

export const MODEL_STEPS = [
  {
    title: 'Puts everything on the same zones',
    body: 'Registrations, survey counts, night-time lights, built-up area and tourism figures are all added up to the same ~2.7 km zones each month. Only totals reach the model; very small counts are hidden so no single business can be picked out.',
  },
  {
    title: 'Compares like with like',
    body: 'A beach village is not a town centre. Zones are sorted into peer groups by how built-up they are, how much tourism they see, their road access, distance to a market centre and land use. A zone is only ever compared with zones of its own kind.',
  },
  {
    title: 'Works out what should be on record',
    body: 'From the independent signals, the model estimates how many registered units a zone of that kind would normally have, with a likely range. The season is removed first, so a busy December is not mistaken for a gap.',
  },
  {
    title: 'Measures the gap and tests it',
    body: 'The gap is the expected footprint minus what is on record, measured against the spread of the peer group. A spatial test (Local Moran / Gi*) checks whether neighbours show the same pattern, and a change-point test says whether the gap is new, widening, stable or narrowing.',
  },
  {
    title: 'Says how sure it is',
    body: 'Every score carries a confidence from five named parts: data coverage, agreement between independent signals, model error, how long the gap has held, and spatial support. Where data is too thin the answer is "insufficient data", not a score.',
  },
  {
    title: 'Learns from the field',
    body: 'Field teams visit prioritised zones and a random control set. Their outcomes show whether the ranking beats chance, keep the confidence bands honest, and recalibrate zones that turn out to be busy for ordinary reasons.',
  },
];

export const ALERT_KINDS = [
  ['Visibility gap', '#E69F00', 'Fewer units on record than the signals suggest for a zone of its kind.'],
  ['Record mismatch', '#56B4E9', 'More units on record than the signals suggest. Some may have closed or moved.'],
  ['Emerging hotspot', '#F0E442', 'Activity growing unusually fast compared with a year ago, such as around a new airport.'],
  ['Contraction', '#CC79A7', 'Activity shrinking unusually fast, such as after an industry shutdown.'],
];

export default function ModelExplainer({ compact = false }) {
  const card = compact ? 'card' : 'l-card';
  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="grid g3">
        {MODEL_STEPS.map((s, i) => (
          <div key={s.title} className={card}>
            <div className="step-num" style={{ fontSize: 22, color: ['#f0b429', '#2ec4b6', '#E69F00'][i % 3] }}>{String(i + 1).padStart(2, '0')}</div>
            <h3 style={{ fontSize: 16, margin: '8px 0 6px' }}>{s.title}</h3>
            <p className="muted small" style={{ lineHeight: 1.6 }}>{s.body}</p>
          </div>
        ))}
      </div>
      <div className="grid g2">
        <div className={card}>
          <h3 style={{ fontSize: 16, marginBottom: 10 }}>What a flag says</h3>
          <p className="small" style={{ lineHeight: 1.7, color: 'var(--text-2)' }}>
            “Signals in <strong style={{ color: 'var(--text)' }}>this zone</strong> point to about <strong style={{ color: 'var(--text)' }}>470 registered units</strong> (likely range 370–600) for a zone of its kind.
            <strong style={{ color: 'var(--text)' }}> 240</strong> are on record, <strong style={{ color: '#E69F00' }}>5σ beyond its peers</strong>.
            Four of five independent signals agree, neighbours show the same pattern, and the gap has held for six months. Confidence 93/100.
            This is an anomaly to validate, not a finding about any business or person.”
          </p>
        </div>
        <div className={card}>
          <h3 style={{ fontSize: 16, marginBottom: 10 }}>What it never does</h3>
          <ul className="l-list small" style={{ marginTop: 0 }}>
            <li>It never names or scores an individual business or person. Output is zone-level only.</li>
            <li>It never treats a busy place as a problem. Gaps have ordinary causes: new development, seasonal trade, survey lag.</li>
            <li>It never triggers enforcement. Whether and how to act is decided by officials, outside the system.</li>
            <li>It never uses individually identifiable mobility, financial or biometric data.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
