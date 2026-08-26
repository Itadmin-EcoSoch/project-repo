/*  frontend/src/lib/clientDraft.js  — NEW FILE
    ----------------------------------------------------------------------------
    A client that has been filled in but deliberately NOT written to the Clients
    tab yet.

    THE RULE: a client only becomes a real row in the sheet when their FIRST
    project is saved. Until then the filled-in form lives here, in the browser,
    and the two are written together by POST /api/orders (client_type:'new'),
    inside one Apps Script lock — so an order either produces a client AND a
    project, or it produces neither.

    WHY sessionStorage AND router state
    AddClient hands the draft to AddProject through React Router state, which is
    held in memory. That is lost the moment the page is reloaded — and a 60-field
    project form is exactly the kind of page somebody refreshes. sessionStorage
    survives the reload but not the tab being closed, which is the right lifetime
    for something that was never meant to be permanent.

    Nothing here ever touches the network. The draft is thrown away the instant
    the order is saved (clearClientDraft) — from then on the client has a real
    Client_Id and is read from the sheet like any other.
--------------------------------------------------------------------------- */

const KEY        = 'ecosoch.clientDraft.v1';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;   // 6 hours — a stale draft is a mistake

/** Stash the draft. Called by AddClient immediately before navigating. */
export function saveClientDraft(draft) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), draft }));
  } catch (e) {
    /*  Private browsing / quota. Not fatal: router state still carries the
        draft for as long as the user does not reload.                      */
  }
}

/** The stashed draft, or null. Anything unusable is treated as absent. */
export function readClientDraft() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const draft  = parsed && parsed.draft;
    if (!draft || !String(draft.name || '').trim()) return null;
    if (Date.now() - (parsed.at || 0) > MAX_AGE_MS) { clearClientDraft(); return null; }
    return draft;
  } catch (e) {
    return null;
  }
}

/** Throw it away — on a successful save, or on an abandoned form. */
export function clearClientDraft() {
  try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing to do */ }
}

export function hasClientDraft() {
  return readClientDraft() !== null;
}