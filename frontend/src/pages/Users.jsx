import { useEffect, useState } from "react";
/*  Uses the shared api client from lib/api, not the raw axios package.
    Raw axios sends no Authorization header, so with REQUIRE_AUTH=true every
    call from this page came back 401 and the screen rendered empty. The
    shared client attaches the signed-in token and unwraps res.data.        */
import api from "../lib/api";
import { useNavigate } from "react-router-dom";

import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  CircularProgress,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  IconButton,
  Chip
} from "@mui/material";

import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

export default function Users() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {

    try {

      const res = await api.get("/api/users");

      setUsers(res.data);
      setFilteredUsers(res.data);

    } catch (err) {

      console.error(err);

    } finally {

      setLoading(false);

    }

  }

  function handleSearch(e) {

    const value = e.target.value;

    setSearch(value);

    const filtered = users.filter((u) =>

      `${u.first_name} ${u.last_name}`
        .toLowerCase()
        .includes(value.toLowerCase()) ||

      u.email.toLowerCase().includes(value.toLowerCase()) ||

      u.username.toLowerCase().includes(value.toLowerCase())

    );

    setFilteredUsers(filtered);

  }

  async function deleteUser(id) {

    if (!window.confirm("Delete this user?")) return;

    try {

      await api.delete(`/api/users/${id}`);

      loadUsers();

    } catch (err) {

      console.error(err);

      alert("Unable to delete user");

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

        Users Management

      </Typography>

      <Paper sx={{ p:3 }}>

        <Box
          display="flex"
          justifyContent="space-between"
          mb={3}
        >

          <TextField

            label="Search Users"

            value={search}

            onChange={handleSearch}

            sx={{ width:350 }}

          />

         <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate("/users/add")}
        >
        Add User
        </Button>

        </Box>

        <Table>

          <TableHead>

            <TableRow>

              <TableCell>Name</TableCell>

              <TableCell>Email</TableCell>

              <TableCell>Username</TableCell>

              <TableCell>Department</TableCell>

              <TableCell>Role</TableCell>

              <TableCell>Status</TableCell>

              <TableCell align="center">

                Actions

              </TableCell>

            </TableRow>

          </TableHead>

          <TableBody>

            {filteredUsers.map((user) => (

              <TableRow key={user.id}>

                <TableCell>

                  {user.first_name} {user.last_name}

                </TableCell>

                <TableCell>{user.email}</TableCell>

                <TableCell>{user.username}</TableCell>

                <TableCell>{user.department}</TableCell>

                <TableCell>{user.role}</TableCell>

                <TableCell>

                  <Chip

                    label={user.status}

                    color={
                      user.status === "active"
                        ? "success"
                        : "default"
                    }

                  />

                </TableCell>

                <TableCell align="center">

                    <IconButton
                        color="primary"
                        onClick={() => navigate(`/users/edit/${user.id}`)}
                    >
                      <EditIcon />
                        </IconButton>

        

                  <IconButton

                    color="error"

                    onClick={() => deleteUser(user.id)}

                  >

                    <DeleteIcon />

                  </IconButton>

                </TableCell>

              </TableRow>

            ))}

          </TableBody>

        </Table>

      </Paper>

    </Box>

  );

}