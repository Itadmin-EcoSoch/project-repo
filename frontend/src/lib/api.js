import axios from 'axios';

/*  Google Sheets reads are slower than Postgres — a cold first read of the
    Projects tab can take 8-15s, so the timeout is generous.               */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000',

  /*  MUST NOT BE SHORTER THAN SHEETS_TIMEOUT IN backend/.env (90000).

      It was 45000 while the backend waited 90000, so the browser abandoned
      requests the backend was still working on and would have answered. The
      user saw "timeout of 45000ms exceeded"; the backend saw a request that
      completed fine. Nothing was broken — the two halves disagreed about how
      long to wait, and the shorter one always wins.

      A cold read of the Projects tab is 1,542 rows across 85 columns over
      Apps Script and can genuinely take most of a minute. 90s matches the
      backend, so a slow request now fails for a real reason.

      Uploads override this per-request in FileField (4 minutes).          */
  timeout: 90000,
});

/* ---- session token, set by useAuth ---- */
let authToken = null;
export function setAuthToken(t) { authToken = t || null; }

api.interceptors.request.use(cfg => {
  if (authToken) cfg.headers.Authorization = `Bearer ${authToken}`;
  return cfg;
});

api.interceptors.response.use(
  res => res.data,
  err => {
    /*  A 403 means "you are signed in, but your role does not allow this".
        Bouncing to /login for that would be wrong and confusing — the message
        the API sent already says who can do it, so let it through to the
        caller's toast unchanged.                                           */
    if (err.response?.status === 403) {
      return Promise.reject(
        new Error(err.response?.data?.error || 'You do not have permission for this action')
      );
    }

    // token expired or revoked — bounce to the login screen
    if (err.response?.status === 401 && err.response?.data?.code === 'AUTH_REQUIRED') {
      try {
        localStorage.removeItem('ecosoch-token');
        localStorage.removeItem('ecosoch-user');
      } catch {}
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    return Promise.reject(
      new Error(err.response?.data?.error || err.message || 'Network error')
    );
  }
);

/** Force the backend to re-read the sheet on the next request. */
export const refreshFromSheet = () => api.post('/api/sync/refresh').catch(() => null);

/** Dropdown values (Project_Status, AMC_Type, Region…) pulled live from the sheet. */
export const getLookups = () => api.get('/api/lookups').then(r => r?.data || {});

/*  Admin-managed picklist values (Type of Project, Sales Lead, Inverter
    Brand, …) — see backend/routes/dropdownOptions.js and
    pages/AdminDropdowns.jsx. Reads work for anyone signed in; add/remove
    need Admin and will come back as a 403 with a clear message otherwise. */
export const getDropdownOptions    = (fieldKey) =>
  api.get('/api/dropdown-options', { params: fieldKey ? { field_key: fieldKey } : {} })
     .then(r => r?.data || []);
export const addDropdownOption     = (fieldKey, value) =>
  api.post('/api/dropdown-options', { field_key: fieldKey, value });
export const deleteDropdownOption  = (id) =>
  api.delete(`/api/dropdown-options/${encodeURIComponent(id)}`);

export default api;