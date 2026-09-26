// Plain-language description of the detection model, shared by the landing page and the Methodology page.

export const MODEL_STEPS = [
  {
    title: 'Estimates real activity from what can be observed',
    body: 'Official surveys count businesses only once a year. The model learns how signals relate to those counts: night-time lights, built-up area, digital payment points, commercial power connections, hotel listings and tourist visits. It then applies that relationship every month to each 2.7 km cell, giving an up-to-date estimate of activity between surveys.',
  },
  {
    title: 'Removes the tourist season',
    body: "Goa is busy from November to February and quiet in the monsoon. The model learns each area's seasonal pattern and removes it, so a busy December is not mistaken for growth and a quiet July is not mistaken for decline.",
  },
  {
    title: 'Works out what the records would normally predict',
    body: 'Across Goa, observed activity is normally a steady multiple of the number of registered units. Multiplying each area’s registered units by that normal ratio gives the activity the records would lead you to expect there.',
  },
  {
    title: 'Flags what is unusual',
    body: 'Every cell is compared with every other cell. An area is flagged when observed activity is far above what records imply, or far below it (units still on the books may have closed). It is also flagged when activity is growing or shrinking much faster than elsewhere compared with a year ago. A second AI check (Isolation Forest) looks for unusual combinations of signals that no single rule would catch.',
  },
  {
    title: 'Scores its own confidence',
    body: 'Each alert gets a 0–100 confidence score based on four things: how many independent data sources agree, how large the difference is, how many months it has lasted, and how unusual the area looks overall. Priority combines confidence with how many businesses are involved, so field teams start where it matters most.',
  },
  {
    title: 'Learns from the field',
    body: 'Field officers visit flagged areas and record what they find. Their counts measure how accurate the model is. When a flag turns out to have a known explanation or be a false alarm, that area’s baseline is adjusted so it is not flagged again for the same reason.',
  },
];

export const ALERT_KINDS = [
  ['Visibility gap', '#f28c28', 'More activity observed than the records account for, e.g. unregistered homestays in a beach village.'],
  ['Record mismatch', '#9d8cf2', 'More registered units than the activity observed, e.g. businesses that closed but are still on the books.'],
  ['Emerging hotspot', '#f0b429', 'Activity growing unusually fast compared with a year ago, e.g. around a new airport.'],
  ['Contraction', '#2ec4b6', 'Activity shrinking unusually fast, e.g. an area hit by an industry shutdown.'],
];

export default function ModelExplainer({ compact = false }) {
  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="grid g3">
        {MODEL_STEPS.map((s, i) => (
          <div key={s.title} className={compact ? 'card' : 'l-card'}>
            <div className="step-num" style={{ fontSize: 22, color: ['#f0b429', '#2ec4b6', '#f28c28'][i % 3] }}>{String(i + 1).padStart(2, '0')}</div>
            <h3 style={{ fontSize: 16, margin: '8px 0 6px' }}>{s.title}</h3>
            <p className="muted small" style={{ lineHeight: 1.6 }}>{s.body}</p>
          </div>
        ))}
      </div>
      <div className="grid g2">
        <div className={compact ? 'card' : 'l-card'}>
          <h3 style={{ fontSize: 16, marginBottom: 10 }}>What an alert looks like</h3>
          <p className="small" style={{ lineHeight: 1.7, color: 'var(--text-2)' }}>
            “Observed activity in <strong style={{ color: 'var(--text)' }}>Morjim (Pernem)</strong> is about <strong style={{ color: 'var(--orange)' }}>+48%</strong> above
            what official records imply. <strong style={{ color: 'var(--text)' }}>5 of 6</strong> independent signals agree, and the gap has lasted
            <strong style={{ color: 'var(--text)' }}> 6 months</strong>. Confidence <strong style={{ color: 'var(--text)' }}>80/100</strong>. Recommend a field validation.”
          </p>
        </div>
        <div className={compact ? 'card' : 'l-card'}>
          <h3 style={{ fontSize: 16, marginBottom: 10 }}>What it does not do</h3>
          <ul className="l-list small" style={{ marginTop: 0 }}>
            <li>It does not identify individual businesses or people. Everything is aggregated to 2.7 km cells.</li>
            <li>It never declares anything illegal. An alert means “worth checking on the ground”.</li>
            <li>It uses only authorised, legally accessible data.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
