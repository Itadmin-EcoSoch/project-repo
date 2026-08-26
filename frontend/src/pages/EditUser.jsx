import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  TextField,
  Button,
  MenuItem,
  Grid,
  CircularProgress,
} from "@mui/material";

/*  ============================================================================
    WHAT CHANGED FROM THE ORIGINAL FILE — see AddUser.jsx for the fuller
    write-up; the same five things apply here:

    1. "Permission Level" removed — dead field, never used for access control,
       and the backend was returning the role's TEXT for it anyway (GET
       /api/users → permissions_level: u.role), which a type="number" box
       cannot render, so it always showed empty regardless of the real value.

    2. "Username" removed — the backend always sets it to the account's email
       (see asUser() in backend/routes/users.js), so this field's value was
       collected and discarded every time.

    3. Role is now fetched from GET /api/users/roles instead of a hardcoded
       3-item list, so all six real roles (Super Admin, Admin, Manager, QAC,
       User, Viewer) are reachable, not just three of them.

    4. startDate → start_date, matching the literal key backend/lib/mapping.js
       expects. The old name matched nothing on save (reads worked fine,
       since asUser() already returns start_date — only the write back was
       broken), so a changed Start Date silently reverted the moment the page
       reloaded.

    5. The grid layout that was overlapping — Status's field was being
       squeezed into a narrower column than its label needed, running its
       "dd-mm-yyyy" placeholder into "Start Date" next to it. Rebuilt the grid
       with consistent widths and one field per cell.

    6. Errors now surface the backend's real message — "Only a Super Admin can
       change an Admin account," "You cannot lower your own role" — instead of
       a flat "Unable to update user" that hid which of the several real
       guards had actually fired.
    ============================================================================ */

export default function EditUser() {
  const navigate = useNavigate();
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [roles,   setRoles]   = useState([]);
  const [errors,  setErrors]  = useState({});

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    role: "User",
    department: "",
    status: "Active",
    start_date: "",
  });

  useEffect(() => {
    loadUser();
    api.get("/api/users/roles")
      .then(res => setRoles(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setRoles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadUser() {
    try {
      const res = await api.get(`/api/users/${encodeURIComponent(id)}`);
      const u = res.data;

      setForm({
        firstName : u.first_name || "",
        lastName  : u.last_name  || "",
        email     : u.email      || "",
        phone     : u.phone      || "",
        role      : u.role       || "User",
        department: u.department || "",
        status    : u.status     || "Active",
        start_date: u.start_date ? String(u.start_date).slice(0, 10) : "",
      });
    } catch (err) {
      toast.error(err.message || "Unable to load that user");
    } finally {
      setLoading(false);
    }
  }

  function set(name, value) {
    setForm(f => ({ ...f, [name]: value }));
    if (errors[name]) setErrors(e => ({ ...e, [name]: undefined }));
  }

  function validate() {
    const e = {};
    if (!form.firstName.trim()) e.firstName = "First name is required";
    if (!form.lastName.trim())  e.lastName  = "Last name is required";
    if (!form.role)             e.role      = "Role is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function saveUser(e) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      await api.put(`/api/users/${encodeURIComponent(id)}`, form);
      toast.success("Team member updated");
      navigate("/users");
    } catch (err) {
      /*  Real, specific guards live here: self-lockout ("you cannot lower
          your own role"), Super-Admin-only edits on Admin accounts, an
          unrecognised role string. Show whichever one actually fired.      */
      toast.error(err.message || "Unable to update user");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Box mt={5} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }

  const selectedRole = roles.find(r => r.value === form.role);

  return (
    <Box p={4}>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h4" mb={3}>Edit User</Typography>

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
              {/*  Email is the Users tab's primary key (Code.gs looks rows up
                  by it) — changed here it would silently create a second,
                  disconnected row rather than renaming the existing one, so
                  it's shown but locked. Change it by removing and re-adding
                  the person instead.                                       */}
              <TextField
                fullWidth label="Email" name="email" value={form.email}
                disabled helperText="Email can't be changed here — remove and re-add the person instead."
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
                {saving ? "Saving…" : "Update User"}
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