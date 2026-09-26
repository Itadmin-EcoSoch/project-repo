/*  backend/env-alias.js  — load FIRST, before app.js
    ----------------------------------------------------------------------------
    App-scoped env var naming. Every setting this app uses can be named with a
    "_PROJECT_REPO" suffix in the hosting environment (Vercel), e.g.

        SUPABASE_URL_PROJECT_REPO, DATA_SOURCE_PROJECT_REPO,
        SHEETS_API_TOKEN_PROJECT_REPO, JWT_SECRET_PROJECT_REPO, ...

    so this app's variables never collide with other apps' variables. The code
    still reads the plain names (SUPABASE_URL, DATA_SOURCE, ...); this shim maps
    each "<NAME>_PROJECT_REPO" onto "<NAME>" at startup.

    Generic on purpose — no list to maintain. The plain name wins if BOTH are
    set, so existing (un-suffixed) production variables keep working until they
    are migrated to the suffixed names.
--------------------------------------------------------------------------- */

const SUFFIX = '_PROJECT_REPO';
const aliased = [];
for (const [key, val] of Object.entries(process.env)) {
  if (!key.endsWith(SUFFIX)) continue;
  const base = key.slice(0, -SUFFIX.length);
  if (!base) continue;
  if (process.env[base] === undefined || process.env[base] === '') {
    process.env[base] = val;
    aliased.push(base);
  }
}
if (aliased.length) console.log(`[env] applied ${aliased.length} *_PROJECT_REPO alias(es): ${aliased.join(', ')}`);

module.exports = {};
