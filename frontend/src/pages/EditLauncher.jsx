import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
/*  Uses the shared api client from lib/api, not the raw axios package.
    Raw axios sends no Authorization header, so with REQUIRE_AUTH=true every
    call from this page came back 401 and the screen rendered empty. The
    shared client attaches the signed-in token and unwraps res.data.        */
import api from "../lib/api";

import {
  Box,
  Button,
  MenuItem,
  Paper,
  TextField,
  Typography,
  Checkbox,
  FormControlLabel,
  CircularProgress,
} from "@mui/material";

export default function EditLauncher() {
  const navigate = useNavigate();
  const { id } = useParams();

  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    title: "",
    description: "",
    iconName: "",
    iconURL: "",
    iconStyle: "filled",
    color: "#2196F3",
    targetApp: "",
    targetView: "",
    externalURL: "",
    orderIndex: 1,
    status: "active",
    isFeatured: false,
    badgeCount: 0,
    helpText: "",
  });

  useEffect(() => {
    loadLauncher();
  }, []);

  async function loadLauncher() {
    try {
      const res = await api.get(`/api/launcher/${id}`);

      const l = res.data;

      setForm({
        title: l.title || "",
        description: l.description || "",
        iconName: l.icon_name || "",
        iconURL: l.icon_url || "",
        iconStyle: l.icon_style || "filled",
        color: l.color || "#2196F3",
        targetApp: l.target_app || "",
        targetView: l.target_view || "",
        externalURL: l.external_url || "",
        orderIndex: l.order_index || 1,
        status: l.status || "active",
        isFeatured: l.is_featured || false,
        badgeCount: l.badge_count || 0,
        helpText: l.help_text || "",
      });

    } catch (err) {
      console.error(err);
      alert("Unable to load launcher");
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e) {
    const { name, value, checked, type } = e.target;

    setForm({
      ...form,
      [name]: type === "checkbox" ? checked : value,
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      await api.put(`/api/launcher/${id}`, form);

      alert("Launcher updated successfully");

      navigate("/launcher");

    } catch (err) {
      console.error(err);

      alert("Unable to update launcher");
    }
  }

  if (loading) {
    return (
      <Box mt={5} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box p={4}>
      <Typography variant="h4" gutterBottom>
        Edit Launcher
      </Typography>

      <Paper sx={{ p: 3 }}>

        <form onSubmit={handleSubmit}>

          <TextField
            fullWidth
            margin="normal"
            label="Title"
            name="title"
            value={form.title}
            onChange={handleChange}
          />

          <TextField
            fullWidth
            margin="normal"
            label="Description"
            name="description"
            value={form.description}
            onChange={handleChange}
          />

          <TextField
            fullWidth
            margin="normal"
            label="Icon Name"
            name="iconName"
            value={form.iconName}
            onChange={handleChange}
          />

          <TextField
            fullWidth
            margin="normal"
            label="Icon URL"
            name="iconURL"
            value={form.iconURL}
            onChange={handleChange}
          />

          <TextField
            fullWidth
            margin="normal"
            label="Color"
            name="color"
            value={form.color}
            onChange={handleChange}
          />

          <TextField
            fullWidth
            margin="normal"
            label="Target App"
            name="targetApp"
            value={form.targetApp}
            onChange={handleChange}
          />

          <TextField
            fullWidth
            margin="normal"
            label="Target View"
            name="targetView"
            value={form.targetView}
            onChange={handleChange}
          />

          <TextField
            fullWidth
            margin="normal"
            label="External URL"
            name="externalURL"
            value={form.externalURL}
            onChange={handleChange}
          />

          <TextField
            fullWidth
            margin="normal"
            type="number"
            label="Order"
            name="orderIndex"
            value={form.orderIndex}
            onChange={handleChange}
          />

          <TextField
            select
            fullWidth
            margin="normal"
            label="Status"
            name="status"
            value={form.status}
            onChange={handleChange}
          >
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </TextField>

          <TextField
            fullWidth
            margin="normal"
            type="number"
            label="Badge Count"
            name="badgeCount"
            value={form.badgeCount}
            onChange={handleChange}
          />

          <TextField
            fullWidth
            margin="normal"
            label="Help Text"
            name="helpText"
            value={form.helpText}
            onChange={handleChange}
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={form.isFeatured}
                name="isFeatured"
                onChange={handleChange}
              />
            }
            label="Featured Launcher"
          />

          <br />

          <Button
            type="submit"
            variant="contained"
            sx={{ mt: 2 }}
          >
            Update Launcher
          </Button>

        </form>

      </Paper>
    </Box>
  );
}