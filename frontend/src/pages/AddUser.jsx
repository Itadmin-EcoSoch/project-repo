import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
/*  Uses the shared api client from lib/api, not the raw axios package.
    Raw axios sends no Authorization header, so with REQUIRE_AUTH=true every
    call from this page came back 401 and the screen rendered empty. The
    shared client attaches the signed-in token and unwraps res.data.        */
import api from "../lib/api";

import {
  Box,
  Paper,
  Typography,
  Grid,
  TextField,
  MenuItem,
  Button,
  CircularProgress,
} from "@mui/material";

/*  ============================================================================
    WHAT CHANGED FROM THE ORIGINAL FILE
    ----------------------------------------------------------------------------
    1. There was no Save button. The form's onSubmit was wired up correctly,
       but nothing in the JSX actually rendered a submit button, so there was
       no way to trigger it. Added at the bottom, alongside Cancel.

    2. Role was a hardcoded 3-item list (Admin / Manager / User), while the
       real permission system (backend/lib/permissions.js) recognises six:
       Super Admin, Admin, Manager, QAC, User, Viewer. Now fetched live from
       GET /api/users/roles — the same list the backend actually validates
       against — so this can never drift out of sync with it again, and an
       Admin can reach every real role from this screen.

    3. "Permission Level" is gone. It was a leftover numeric field from an
       earlier data model: nothing in the backend ever reads it for access
       control (the real system only ever looks at Role), and the validation
       schema that referenced it (backend/lib/validation.js) is dead code —
       never imported by any route. Keeping a field that looks important but
       silently does nothing was worse than removing it.

    4. "Username" is gone too. The backend always sets a user's username to
       their email address regardless of what this field held (see asUser()
       in backend/routes/users.js) — so it was a text box whose value was
       collected and then thrown away. Removed rather than left as a fake
       input; a note under Email now says it doubles as the sign-in name.

    5. startDate → start_date. backend/lib/mapping.js's Users map expects the
       literal key start_date (it maps to the sheet's Start_Date column); the
       old camelCase startDate matched nothing and was silently dropped on
       save — the exact same class of bug as Launcher's Display Order. Added
       Department and Start Date fields here too, to match what Edit User
       already collects.

    6. Errors now show the server's actual message (toast, not a bare alert).
       The backend has real, specific guards here — "Only a Super Admin can
       create an Admin account," "must have an @ecosoch.com address" — and
       silently saying "Unable to create user" for all of them hid the actual
       reason from whoever was trying to add someone.
    ============================================================================ */

const emptyForm = () => ({
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  role: "User",
  department: "",
  status: "Active",
  start_date: "",
});

export default function AddUser() {
  const navigate = useNavigate();

  const [form, setForm] = useState(emptyForm());
  const [errors, setErrors] = useState({});
  const [roles, setRoles] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/users/roles")
      .then(res => setRoles(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setRoles([
        { value: "Admin", hint: "" }, { value: "Manager", hint: "" }, { value: "User", hint: "" },
      ]));
  }, []);

  function set(name, value) {
    setForm(f => ({ ...f, [name]: value }));
    if (errors[name]) setErrors(e => ({ ...e, [name]: undefined }));
  }

  function validate() {
    const e = {};
    if (!form.firstName.trim()) e.firstName = "First name is required";
    if (!form.lastName.trim())  e.lastName  = "Last name is required";
    if (!form.email.trim())    e.email     = "Email is required";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) e.email = "That does not look like an email address";
    if (!form.role)            e.role      = "Role is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function saveUser(e) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      await api.post("/api/users", form);
      toast.success("Team member added");
      navigate("/users");
    } catch (err) {
      /*  The backend's own guards (wrong email domain, role not recognised,
          "only a Super Admin can create an Admin account") each return a
          specific message — show it, rather than a generic failure that
          hides exactly what needs to change.                              */
      toast.error(err.message || "Unable to create user");
    } finally {
      setSaving(false);
    }
  }

  const selectedRole = roles.find(r => r.value === form.role);

  return (
    <Box p={4}>
      <Typography variant="h4" mb={3}>Add User</Typography>

      <Paper sx={{ p: 4 }}>
        <form onSubmit={saveUser}>
          <Grid container spacing={3}>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth label="First Name" name="firstName" required
                value={form.firstName} onChange={e => set("firstName", e.target.value)}
                error={!!errors.firstName} helperText={errors.firstName}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth label="Last Name" name="lastName" required
                value={form.lastName} onChange={e => set("lastName", e.target.value)}
                error={!!errors.lastName} helperText={errors.lastName}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth type="email" label="Email" name="email" required
                value={form.email} onChange={e => set("email", e.target.value)}
                error={!!errors.email}
                helperText={errors.email || "Also used as the sign-in username — must be an @ecosoch.com address."}
                placeholder="name@ecosoch.com"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth label="Phone" name="phone"
                value={form.phone} onChange={e => set("phone", e.target.value)}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth label="Department" name="department"
                value={form.department} onChange={e => set("department", e.target.value)}
                placeholder="All"
                helperText="Leave blank for “All”."
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth select label="Status" name="status"
                value={form.status} onChange={e => set("status", e.target.value)}
              >
                <MenuItem value="Active">Active</MenuItem>
                <MenuItem value="Inactive">Inactive</MenuItem>
              </TextField>
            </Grid>

            <Grid item xs={12} md={6}>
              {/*  Options come from GET /api/users/roles — perm.ROLE_OPTIONS in
                  backend/lib/permissions.js — so this list is always exactly
                  what the backend will actually accept, nothing hardcoded here
                  to drift out of step with it.                              */}
              <TextField
                fullWidth select label="Role" name="role" required
                value={form.role} onChange={e => set("role", e.target.value)}
                error={!!errors.role} helperText={errors.role || selectedRole?.hint}
              >
                {(roles.length ? roles : [{ value: form.role, hint: "" }]).map(r => (
                  <MenuItem key={r.value} value={r.value}>{r.value}</MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth type="date" label="Start Date" name="start_date"
                value={form.start_date} onChange={e => set("start_date", e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            <Grid item xs={12}>
              <Button type="submit" variant="contained" disabled={saving}
                      startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}>
                {saving ? "Saving…" : "Save User"}
              </Button>
              <Button sx={{ ml: 2 }} disabled={saving} onClick={() => navigate("/users")}>
                Cancel
              </Button>
            </Grid>

          </Grid>
        </form>
      </Paper>
    </Box>
  );
}