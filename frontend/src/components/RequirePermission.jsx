/*  frontend/src/components/RequirePermission.jsx  — NEW FILE
    ----------------------------------------------------------------------------
    Wraps a route so people only reach screens they are allowed to open.

        <Route path="/users" element={
          <RequirePermission page="users">
            <Users />
          </RequirePermission>
        } />

    Two ways to use it:
        page="users"          the screen needs a tier (see lib/permissions.js)
        capability="delete"   the screen needs a specific ability

    Refusing well matters more than refusing. Somebody who lands here is usually
    following a link a colleague sent them, so the screen says which role opens
    it and who to ask, rather than just "denied".
--------------------------------------------------------------------------- */

import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { PAGE_TIERS, ROLE_OPTIONS, TIER } from '../lib/permissions';

/** "Admin", "Manager" … the friendliest role name that opens a given tier. */
function lowestRoleFor(tier) {
  const match = ROLE_OPTIONS.filter(o => o.tier >= tier).sort((a, b) => a.tier - b.tier)[0];
  return match?.value || 'Admin';
}

export default function RequirePermission({ page, capability, children }) {
  const { can, canPage, role, checking } = useAuth();

  if (checking) return null;

  const allowed = capability ? can(capability) : canPage(page);
  if (allowed) return children;

  const needTier = capability
    ? TIER.ADMIN
    : (PAGE_TIERS[String(page).toLowerCase()] ?? TIER.STAFF);

  return <NoAccess role={role} needRole={lowestRoleFor(needTier)} />;
}

export function NoAccess({ role, needRole }) {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '56px 26px', textAlign: 'center', maxWidth: 420, margin: '0 auto' }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 18px',
                    background: 'var(--slate-100)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
        🔒
      </div>

      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-head)', marginBottom: 8 }}>
        This page is restricted
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 22 }}>
        You are signed in as <b style={{ color: 'var(--text-head)' }}>{role || 'Staff'}</b>.
        This screen needs <b style={{ color: 'var(--text-head)' }}>{needRole}</b> or above.
        Ask an admin to change your role under Team members.
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'var(--white)', color: 'var(--text-body)',
                   border: '1.5px solid var(--slate-200)', borderRadius: 10,
                   padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          Go back
        </button>
        <button onClick={() => navigate('/projects')}
          style={{ background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 10,
                   padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          Open Projects
        </button>
      </div>
    </div>
  );
}