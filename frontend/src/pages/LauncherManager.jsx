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
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  TextField,
  Typography
} from "@mui/material";

export default function LauncherManager() {

  const navigate = useNavigate();
  const { id } = useParams();

  const editing = !!id;

  const [form, setForm] = useState({

    launcherId: crypto.randomUUID(),

    title: "",

    description: "",

    iconName: "dashboard",

    targetApp: "",

    targetView: "",

    externalURL: "",

    orderIndex: 1,

    status: "active",

    color: "#2196F3",

    iconStyle: "filled",

    helpText: "",

    badgeCount: 0,

    isFeatured: false

  });

  useEffect(() => {

    if (editing) {

      loadLauncher();

    }

  }, []);

  async function loadLauncher() {

    try {

      const res = await api.get(`/api/launcher/${id}`);

      const l = res.data;

      setForm({

        launcherId: l.launcher_id,

        title: l.title || "",

        description: l.description || "",

        iconName: l.icon_name || "dashboard",

        targetApp: l.target_app || "",

        targetView: l.target_view || "",

        externalURL: l.external_url || "",

        orderIndex: l.order_index || 1,

        status: l.status || "active",

        color: l.color || "#2196F3",

        iconStyle: l.icon_style || "filled",

        helpText: l.help_text || "",

        badgeCount: l.badge_count || 0,

        isFeatured: l.is_featured || false

      });

    }

    catch (err) {

      console.error(err);

      alert("Unable to load launcher");

    }

  }

  function handleChange(e) {

    const { name, value, checked, type } = e.target;

    setForm({

      ...form,

      [name]: type === "checkbox"
        ? checked
        : value

    });

  }

  async function saveLauncher() {

    try {

      if (editing) {

        await api.put(`/api/launcher/${id}`, form);

      } else {

        await api.post("/api/launcher", form);

      }

      alert(

        editing

          ? "Launcher Updated"

          : "Launcher Created"

      );

      navigate("/launcher");

    }

    catch (err) {

      console.error(err);

      alert("Unable to save launcher");

    }

  }

  return (

    <Box p={4}>

      <Typography variant="h4" mb={3}>

        {editing ? "Edit Launcher" : "Add Launcher"}

      </Typography>

      <Paper sx={{ p:3 }}>

        <Box display="grid" gap={2}>

          <TextField
            label="Title"
            name="title"
            value={form.title}
            onChange={handleChange}
          />

          <TextField
            label="Description"
            name="description"
            value={form.description}
            onChange={handleChange}
            multiline
            rows={3}
          />

          <TextField
            select
            label="Icon"
            name="iconName"
            value={form.iconName}
            onChange={handleChange}
          >

            <MenuItem value="dashboard">Dashboard</MenuItem>
            <MenuItem value="projects">Projects</MenuItem>
            <MenuItem value="clients">Clients</MenuItem>
            <MenuItem value="users">Users</MenuItem>
            <MenuItem value="reports">Reports</MenuItem>
            <MenuItem value="settings">Settings</MenuItem>
            <MenuItem value="calendar">Calendar</MenuItem>
            <MenuItem value="messages">Messages</MenuItem>
            <MenuItem value="files">Files</MenuItem>
            <MenuItem value="analytics">Analytics</MenuItem>

          </TextField>

          <TextField
            label="Target App"
            name="targetApp"
            value={form.targetApp}
            onChange={handleChange}
          />

          <TextField
            label="Target View"
            name="targetView"
            value={form.targetView}
            onChange={handleChange}
          />

          <TextField
            label="External URL"
            name="externalURL"
            value={form.externalURL}
            onChange={handleChange}
          />

          <TextField
            type="number"
            label="Display Order"
            name="orderIndex"
            value={form.orderIndex}
            onChange={handleChange}
          />

          <TextField
            select
            label="Status"
            name="status"
            value={form.status}
            onChange={handleChange}
          >

            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
            <MenuItem value="hidden">Hidden</MenuItem>

          </TextField>

          <TextField
            type="color"
            label="Color"
            name="color"
            value={form.color}
            onChange={handleChange}
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            label="Help Text"
            name="helpText"
            value={form.helpText}
            onChange={handleChange}
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={form.isFeatured}
                onChange={handleChange}
                name="isFeatured"
              />
            }
            label="Featured Launcher"
          />

          <Button
            variant="contained"
            onClick={saveLauncher}
          >
            {editing ? "Update Launcher" : "Create Launcher"}
          </Button>

        </Box>

      </Paper>

    </Box>

  );

}