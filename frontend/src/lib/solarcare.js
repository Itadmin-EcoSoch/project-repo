/*  frontend/src/lib/solarcare.js  — NEW FILE
    ----------------------------------------------------------------------------
    Every Solar Care call in one place, so the pages stay about layout.

        Client → Project → { Ticket Generation, AMC } → Visits

    All of these hit the routes added in backend/routes/{solarcare,tickets,amcSetup}.js
--------------------------------------------------------------------------- */

import api from './api';

/* the axios interceptor already unwraps res.data, so `r` is the API envelope */
const body = r => r?.data ?? r;

/* ── the tree ────────────────────────────────────────────────────────── */

/** All clients with roll-up counts — the top level of the tree. */
export const listSolarCareClients = (q = '') =>
  api.get(`/api/solarcare/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(body);

/** One client, its projects, and each project's tickets + AMC. */
export const getClientTree = clientId =>
  api.get(`/api/solarcare/clients/${encodeURIComponent(clientId)}`).then(body);

/** One project with both operations expanded. */
export const getProjectSolarCare = projectId =>
  api.get(`/api/solarcare/projects/${encodeURIComponent(projectId)}`).then(body);

/** One AMC contract with its numbered visits. */
export const getContract = amcId =>
  api.get(`/api/solarcare/contracts/${encodeURIComponent(amcId)}`).then(body);

export const getSolarCareStats = () => api.get('/api/solarcare/stats').then(body);

/* ── tickets ─────────────────────────────────────────────────────────── */

export const listTickets = projectId =>
  api.get(`/api/tickets/by-project/${encodeURIComponent(projectId)}`).then(body);

export const listAllTickets = (params = {}) =>
  api.get(`/api/tickets?${new URLSearchParams(params)}`).then(body);

export const getTicket = ticketId =>
  api.get(`/api/tickets/${encodeURIComponent(ticketId)}`).then(body);

export const createTicket = payload => api.post('/api/tickets', payload).then(body);

export const updateTicket = (ticketId, patch) =>
  api.patch(`/api/tickets/${encodeURIComponent(ticketId)}`, patch).then(body);

export const deleteTicket = ticketId =>
  api.delete(`/api/tickets/${encodeURIComponent(ticketId)}`).then(body);

/* ── AMC setup ───────────────────────────────────────────────────────── */

export const getAMCOptions   = ()        => api.get('/api/amc-setup/options').then(body);
export const previewAMC      = payload   => api.post('/api/amc-setup/preview', payload).then(body);
export const createAMC       = payload   => api.post('/api/amc-setup/create', payload).then(body);

/** Update a single visit (mark it done, add a resolution). */
export const updateVisit = (taskId, patch) =>
  api.patch(`/api/amc/${encodeURIComponent(taskId)}`, patch).then(body);

/* ── vocabulary ──────────────────────────────────────────────────────── */

export const TICKET_TYPES = [
  'Breakdown', 'Generation Drop', 'Inverter Fault', 'Module Damage',
  'Wiring / Electrical', 'Structure', 'Monitoring', 'Cleaning Request',
  'Inspection Request', 'Other',
];

export const TICKET_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const TICKET_STATUSES   = ['Open', 'In Progress', 'On Hold', 'Resolved', 'Closed', 'Cancelled'];


/*  Date of the last scheduled visit — identical formula to
    backend/lib/amcSchedule.js's amcEndDate(), so AMCSetup.jsx can show it
    live as each contract's terms are filled in, before ever calling
    previewAMC(). The backend is still what actually decides the real value
    when the contract is created; this is a preview only, kept in step by
    hand rather than wired together, so if that backend formula ever
    changes, mirror the change here too.                                   */
function amcParseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function amcAddMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
function amcEomonth(date, months) {
  const d = amcAddMonths(date, months);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
const amcAddDays = (date, days) => new Date(date.getTime() + days * 86400000);
const amcToISO   = d => (d ? d.toISOString().slice(0, 10) : '');

export function amcEndDatePreview(startVal, frequencyVal, yearsVal) {
  const start = amcParseDate(startVal);
  const F = Number(frequencyVal) || 0, P = Number(yearsVal) || 0;
  if (!start || !F || !P) return '';
  const monthOffset = Math.floor((F - 1) * (12 / F)) - 1 + 12 * (P - 1);
  let d = amcAddDays(amcEomonth(start, monthOffset), start.getUTCDate());
  if (F === 24) d = amcAddDays(d, 14);
  return amcToISO(d);
}

/** The three ways a client can buy AMC. "Both" writes two contracts. */
export const AMC_OPTIONS = [
  { value: 'Inspection', label: 'Inspection only', emoji: '🔍',
    hint: 'Periodic health check of the plant' },
  { value: 'Cleaning',   label: 'Cleaning only',   emoji: '🧽',
    hint: 'Periodic module cleaning' },
  { value: 'Both',       label: 'Inspection + Cleaning', emoji: '🔧',
    hint: 'Two separate contracts on this project, each with its own schedule' },
];

/** Visits per year, with the plain-English reading of each. */
export const VISIT_FREQUENCIES = [
  { value: 24, label: '24 / year', note: 'Twice a month' },
  { value: 12, label: '12 / year', note: 'Monthly' },
  { value: 6,  label: '6 / year',  note: 'Every 2 months' },
  { value: 4,  label: '4 / year',  note: 'Quarterly' },
  { value: 2,  label: '2 / year',  note: 'Half-yearly' },
  { value: 1,  label: '1 / year',  note: 'Yearly' },
];

/** Payment frequencies allowed for a given visit frequency.
 *  One visit cannot have many payments, but one payment can cover many visits. */
export const PAYMENT_FREQ_BY_VISITS = {
  1: [1], 2: [1, 2], 4: [1, 2, 4], 6: [1, 2, 4, 6],
  12: [1, 2, 4, 6, 12], 24: [1, 2, 4, 6, 12],
};

/* ── small shared helpers ────────────────────────────────────────────── */

export const isTicketClosed = s => /closed|resolved|cancelled|done/i.test(String(s || ''));
export const isVisitDone    = s => /done|complete/i.test(String(s || ''));
export const isVisitSkipped = s => /skip/i.test(String(s || ''));

/*  Visit status vocabulary — only these three. Legacy rows (Scheduled /
    In Progress / blank) read as Pending.                                    */
export const VISIT_STATUSES = ['Pending', 'Done', 'Skipped'];

export const normalizeVisitStatus = s => {
  const v = String(s || '').trim();
  if (/done|complete/i.test(v)) return 'Done';
  if (/skip/i.test(v))          return 'Skipped';
  return 'Pending';                       // Scheduled / In Progress / '' -> Pending
};

/*  Badge colours: Pending = dark orange, Done = green, Skipped = red. */
export const VISIT_STATUS_STYLE = {
  Pending: { bg: '#FFEDD5', fg: '#C2410C' },
  Done:    { bg: '#DCFCE7', fg: '#15803D' },
  Skipped: { bg: '#FEE2E2', fg: '#B91C1C' },
};
export const visitStatusStyle = s => VISIT_STATUS_STYLE[normalizeVisitStatus(s)] || VISIT_STATUS_STYLE.Pending;

export const fmtDate = d => {
  if (!d) return '—';
  const x = new Date(d);
  return isNaN(x) ? String(d)
    : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const PRIORITY_COLOR = {
  Low     : { bg: '#F1F5F9', fg: '#475569' },
  Medium  : { bg: '#DBEAFE', fg: '#1E40AF' },
  High    : { bg: '#FEF3C7', fg: '#92400E' },
  Critical: { bg: '#FEE2E2', fg: '#B91C1C' },
};

export const TICKET_STATUS_COLOR = {
  'Open'       : { bg: '#FEF3C7', fg: '#92400E' },
  'In Progress': { bg: '#DBEAFE', fg: '#1E40AF' },
  'On Hold'    : { bg: '#EDE9FE', fg: '#5B21B6' },
  'Resolved'   : { bg: '#D1FAE5', fg: '#065F46' },
  'Closed'     : { bg: '#E2E8F0', fg: '#475569' },
  'Cancelled'  : { bg: '#FFE4E6', fg: '#9F1239' },
};