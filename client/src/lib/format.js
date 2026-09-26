export const num = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pct = (v, d = 0, sign = true) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${sign && v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
export const signed = (v, d = 0) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${num(v, d)}`);
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

export const TYPE_META = {
  visibility_gap: { label: 'Visibility gap', short: 'Gap', color: '#f28c28', desc: 'Observed activity exceeds what official records imply' },
  record_mismatch: { label: 'Record mismatch', short: 'Mismatch', color: '#9d8cf2', desc: 'Official records exceed observed activity (possibly dormant units)' },
  emerging_hotspot: { label: 'Emerging hotspot', short: 'Hotspot', color: '#f0b429', desc: 'Seasonally adjusted activity growing unusually fast' },
  contraction: { label: 'Activity contraction', short: 'Contraction', color: '#2ec4b6', desc: 'Seasonally adjusted activity declining unusually fast' },
};
export const STATUS_META = {
  open: { label: 'Open' }, assigned: { label: 'Assigned' }, validated: { label: 'Validated' }, dismissed: { label: 'Dismissed' },
};
export const OUTCOME_META = {
  confirmed: 'Confirmed on ground', partially_confirmed: 'Partially confirmed', explained: 'Explained by known factor',
  false_positive: 'No anomaly found', data_issue: 'Data quality issue',
};
export const ROLE_META = { admin: 'Administrator', analyst: 'Analyst', field_officer: 'Field officer' };
export const ZONE_META = {
  urban: 'Urban', coastal: 'Coastal tourism', industrial: 'Industrial', heritage: 'Heritage', mining: 'Mining belt', rural: 'Rural', forest: 'Forest / eco',
};
export const ACTION_META = {
  'alert.assign': 'assigned an alert', 'alert.unassign': 'unassigned an alert', 'alert.validate': 'submitted a field validation',
  'alert.dismiss': 'dismissed an alert', 'alert.reopen': 'reopened an alert', 'alert.status': 'changed alert status', 'alert.note': 'added a note',
  'engine.run': 'ran the detection engine', 'data.ingest': 'ingested new monthly data', 'data.upload': 'uploaded a dataset',
  'settings.update': 'updated detection settings', 'user.create': 'created a user', 'user.update': 'updated a user', 'auth.password': 'changed their password',
};
