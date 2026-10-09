// Randomised audit sample: alongside prioritised visits, field teams visit a random control set
// drawn across all tiers. Comparing confirmation rates shows whether the ranking beats chance.
import { all, get, run } from './db.js';
import { nextCode, suggestedChecks } from './engine/engine.js';
import { mulberry32 } from './engine/stats.js';

export function createControlSample(n, seed = Date.now()) {
  const month = get('SELECT MAX(month) m FROM cell_metrics')?.m;
  if (!month) throw Object.assign(new Error('Run the engine before drawing a control sample'), { status: 409 });
  const pool = all(`SELECT c.*, m.observed_sa, m.expected, m.exp_lo, m.exp_hi, m.registered, m.gap_abs, m.gap_z, m.confidence, m.priority, m.tier,
      m.coverage, m.spatial_class, m.gap_trend, m.yoy_activity, m.yoy_registered, m.change_z, p.name peer_name
    FROM cell_metrics m JOIN cells c ON c.id = m.cell_id LEFT JOIN peer_groups p ON p.id = c.peer_group_id
    WHERE m.month = ? AND m.insufficient = 0 AND c.sensitive = 0
      AND c.id NOT IN (SELECT cell_id FROM alerts WHERE status IN ('open','assigned'))`, month);
  const rnd = mulberry32(seed);
  // stratify so every tier is represented
  const byTier = { high: [], medium: [], low: [] };
  for (const z of pool) byTier[z.tier]?.push(z);
  const picked = [];
  const tiers = ['low', 'medium', 'high'];
  for (let k = 0; picked.length < n && k < n * 6; k++) {
    const list = byTier[tiers[k % 3]];
    if (!list.length) continue;
    picked.push(list.splice(Math.floor(rnd() * list.length), 1)[0]);
  }
  const ids = [];
  for (const z of picked) {
    const r = run(`INSERT INTO alerts (code, cell_id, type, status, priority, priority_score, confidence, first_detected, last_detected, still_active,
        observed, expected, exp_lo, exp_hi, registered, gap_abs, gap_pct, gap_z, yoy_activity, yoy_registered, change_z, coverage, spatial_class, gap_trend,
        peer_group, is_control, signals_json, confidence_json, checks_json, explanation)
      VALUES (?,?,'audit_control','open','control',?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'[]','{}',?,?)`,
      nextCode(month, 'RC'), z.id, Math.abs(z.priority), z.confidence, month, month,
      z.observed_sa, z.expected, z.exp_lo, z.exp_hi, z.registered, z.gap_abs, z.registered > 0 ? z.expected / z.registered - 1 : null, z.gap_z,
      z.yoy_activity, z.yoy_registered, z.change_z, z.coverage, z.spatial_class, z.gap_trend, z.peer_name,
      JSON.stringify(suggestedChecks('audit_control', z)),
      `Random control visit for ${z.name} (${z.taluka} taluka). This zone was drawn at random across all priority tiers, not because of its score. Visiting it the same way as a prioritised zone shows whether the model's ranking does better than chance and keeps its confidence bands honest.`);
    ids.push(Number(r.lastInsertRowid));
  }
  return { month, created: ids.length, ids };
}
