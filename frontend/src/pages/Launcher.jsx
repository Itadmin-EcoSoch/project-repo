import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
/*  Uses the shared api client from lib/api, not the raw axios package.
    Raw axios sends no Authorization header, so with REQUIRE_AUTH=true every
    call from this page came back 401 and the screen rendered empty. The
    shared client attaches the signed-in token and unwraps res.data.        */
import api from "../lib/api";

import {
  Box,
  Paper,
  Typography,
  Button,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  IconButton,
  Chip,
  CircularProgress,
  TextField,
} from "@mui/material";

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

export default function Launcher() {

  const navigate = useNavigate();

  const [launcher, setLauncher] = useState([]);
  const [filteredLauncher, setFilteredLauncher] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadLauncher();
  }, []);

  async function loadLauncher() {

    try {

      const res = await api.get("/api/launcher");

      setLauncher(res.data);
      setFilteredLauncher(res.data);

    } catch (err) {

      console.error(err);

    } finally {

      setLoading(false);

    }

  }

  function handleSearch(e) {

    const value = e.target.value;

    setSearch(value);

    const filtered = launcher.filter((item) =>
      item.title.toLowerCase().includes(value.toLowerCase()) ||
      item.target_app.toLowerCase().includes(value.toLowerCase()) ||
      item.target_view.toLowerCase().includes(value.toLowerCase())
    );

    setFilteredLauncher(filtered);

  }

  async function deleteLauncher(id) {

    if (!window.confirm("Delete this launcher item?")) return;

    try {

      await api.delete(`/api/launcher/${id}`);

      loadLauncher();

    } catch (err) {

      console.error(err);

      alert("Unable to delete launcher");

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

        Launcher Management

      </Typography>

      <Paper sx={{ p: 3 }}>

        <Box
          display="flex"
          justifyContent="space-between"
          mb={3}
        >

          <TextField
            label="Search Launcher"
            value={search}
            onChange={handleSearch}
            sx={{ width: 350 }}
          />

          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate("/launcher/add")}
          >

            Add Launcher

          </Button>

        </Box>

        <Table>

          <TableHead>

            <TableRow>

              <TableCell>Order</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Icon</TableCell>
              <TableCell>Target App</TableCell>
              <TableCell>View</TableCell>
              <TableCell>Badge</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Featured</TableCell>
              <TableCell>Color</TableCell>

              <TableCell align="center">

                Actions

              </TableCell>

            </TableRow>

          </TableHead>

          <TableBody>

            {filteredLauncher.length === 0 ? (

              <TableRow>

                <TableCell
                  colSpan={10}
                  align="center"
                >

                  No Launcher Items Found

                </TableCell>

              </TableRow>

            ) : (

              filteredLauncher.map((item) => (

                <TableRow key={item.id}>

                  <TableCell>

                    {item.order_index}

                  </TableCell>

                  <TableCell>

                    {item.title}

                  </TableCell>

                  <TableCell>

                    {item.icon_name}

                  </TableCell>

                  <TableCell>

                    {item.target_app}

                  </TableCell>

                  <TableCell>

                    {item.target_view}

                  </TableCell>

                  <TableCell>

                    {item.badge_count}

                  </TableCell>

                  <TableCell>

                    <Chip
                      label={item.status}
                      color={
                        item.status === "active"
                          ? "success"
                          : "default"
                      }
                    />

                  </TableCell>

                  <TableCell>

                    {item.is_featured ? "⭐" : "-"}

                  </TableCell>

                  <TableCell>

                    <Box
                      sx={{
                        width: 25,
                        height: 25,
                        borderRadius: 1,
                        background: item.color,
                        border: "1px solid #ccc",
                      }}
                    />

                  </TableCell>

                  <TableCell align="center">

                    <IconButton
                      color="primary"
                      onClick={() =>
                        navigate(`/launcher/edit/${item.id}`)
                      }
                    >

                      <EditIcon />

                    </IconButton>

                    <IconButton
                      color="error"
                      onClick={() => deleteLauncher(item.id)}
                    >

                      <DeleteIcon />

                    </IconButton>

                  </TableCell>

                </TableRow>

              ))

            )}

          </TableBody>

        </Table>

      </Paper>

    </Box>

  );

}