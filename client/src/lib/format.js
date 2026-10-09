export const num = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pct = (v, d = 0, sign = true) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${sign && v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
export const signed = (v, d = 0) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${num(v, d)}`);
export const sigma = (v, d = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${num(v, d)}σ`);
export function compact(v) {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return num(v);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (m) => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : '—');
export const monthShort = (m) => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ’${m.slice(2, 4)}` : '');
export const calMonth = (i) => MONTHS[i - 1];
export function ago(ts) {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const confBand = (c) => (c === null || c === undefined ? null : c >= 70 ? 'high' : c >= 45 ? 'medium' : 'low');

// Colours are from the Okabe–Ito colour-blind-safe palette.
export const TYPE_META = {
  visibility_gap: { label: 'Visibility gap', short: 'Gap', color: '#E69F00', desc: 'Fewer units on record than independent signals suggest for a zone of its kind' },
  record_mismatch: { label: 'Record mismatch', short: 'Mismatch', color: '#56B4E9', desc: 'More units on record than signals suggest (possibly dormant or closed)' },
  emerging_hotspot: { label: 'Emerging hotspot', short: 'Hotspot', color: '#F0E442', desc: 'Seasonally adjusted activity growing unusually fast' },
  contraction: { label: 'Activity contraction', short: 'Contraction', color: '#CC79A7', desc: 'Seasonally adjusted activity declining unusually fast' },
  audit_control: { label: 'Random audit sample', short: 'Control', color: '#b4b6c2', desc: 'Zone drawn at random to check the ranking beats chance' },
};
export const TIER_META = {
  high: { label: 'High', color: '#D55E00' }, medium: { label: 'Medium', color: '#E69F00' }, low: { label: 'Low', color: '#3d6f8f' },
  insufficient: { label: 'Insufficient data', color: '#4a4b58' }, control: { label: 'Control', color: '#b4b6c2' },
};
export const SPATIAL_META = {
  hot: { label: 'Hot spot', color: '#D55E00', desc: 'Significant cluster of zones with activity beyond records' },
  cold: { label: 'Cold spot', color: '#0072B2', desc: 'Significant cluster of zones with records beyond activity' },
  outlier: { label: 'Spatial outlier', color: '#CC79A7', desc: 'Differs significantly from its neighbours' },
  ns: { label: 'Not significant', color: '#3a3b45', desc: 'No significant spatial pattern' },
};
export const TREND_META = {
  new: { label: 'New gap', color: '#D55E00' }, growing: { label: 'Widening', color: '#E69F00' },
  stable: { label: 'Stable', color: '#b4b6c2' }, shrinking: { label: 'Narrowing', color: '#56B4E9' }, none: { label: 'No gap', color: '#8a8c9a' },
};
export const STATUS_META = {
  open: { label: 'Open' }, assigned: { label: 'Assigned' }, validated: { label: 'Validated' }, dismissed: { label: 'Closed' },
};
export const OUTCOME_META = {
  confirmed: 'Gap confirmed', partially_confirmed: 'Partly confirmed', legitimately_busy: 'Legitimately busy',
  new_development: 'New development', no_gap: 'Nothing unusual found', data_issue: 'Data error',
};
export const OUTCOME_HELP = {
  confirmed: 'A real difference from the records, whatever its cause',
  partially_confirmed: 'Some difference, smaller than the model estimate',
  legitimately_busy: 'Busy for an ordinary reason: tourist season, market, transit hub',
  new_development: 'Recently opened premises; registrations still in process',
  no_gap: 'Ground count matches the records',
  data_issue: 'The signal was wrong, not the ground',
};
export const ROLE_META = { admin: 'Administrator', analyst: 'Policy analyst', field_officer: 'Field validation officer', planner: 'Planner / formalisation lead', auditor: 'Auditor' };
export const ZONE_META = {
  urban: 'Urban', coastal: 'Coastal tourism', industrial: 'Industrial', heritage: 'Heritage', mining: 'Mining belt', rural: 'Rural', forest: 'Forest / eco',
};
export const SOURCE_LABEL = {
  registered: 'Registered footprint', night_light: 'Night-time lights', built_up: 'Built-up footprint', listings: 'Hospitality listings',
  footfall: 'Tourist footfall', power_connections: 'Commercial power', digital_points: 'Payment points',
};
export const ACTION_META = {
  'alert.assign': 'assigned a flag', 'alert.unassign': 'unassigned a flag', 'alert.validate': 'recorded a field outcome',
  'alert.dismiss': 'closed a flag', 'alert.reopen': 'reopened a flag', 'alert.note': 'added a note', 'alert.outreach': 'updated outreach',
  'alert.signoff': 'gave senior sign-off for a sensitive zone', 'alert.view': 'viewed a flag', 'zone.view': 'viewed a zone evidence card',
  'engine.run': 'ran the model engine', 'data.ingest': 'ingested new monthly data', 'data.upload': 'uploaded a dataset',
  'settings.update': 'updated detection settings', 'user.create': 'created a user', 'user.update': 'updated a user', 'auth.password': 'changed their password',
  'auth.login': 'signed in', 'export.validation_list': 'exported a validation list', 'export.zones': 'exported zone priorities',
  'audit.sample': 'drew a random audit sample', 'governance.peer_review': 'reviewed the peer groups', 'apikey.create': 'created a partner API key',
  'apikey.revoke': 'revoked a partner API key', 'api.zones': 'partner API: zone list', 'api.zone': 'partner API: zone detail',
};
export const READERS = ['admin', 'analyst', 'planner', 'auditor'];
