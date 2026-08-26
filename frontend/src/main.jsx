import React from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

import { Toaster } from "react-hot-toast";

import Layout from "./components/Layout";
import { ThemeProvider } from "./hooks/useTheme";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import Login from "./pages/Login";
import RequirePermission from "./components/RequirePermission";

import Dashboard from "./pages/Dashboard";
import AllProjects from "./pages/AllProjects";
import ProjectDetail from "./pages/ProjectDetail";
import AMCContract  from './pages/AMCContract';
import AMCVisit     from './pages/AMCVisit';
import EditProject from "./pages/EditProject";

/* ── Solar Care: Client → Project → { Tickets, AMC } → Visits ── */
import SolarCare, { ClientSolarCare } from "./pages/SolarCare";
import ProjectSolarCare from "./pages/ProjectSolarCare";
import AddTicket        from "./pages/AddTicket";
import TicketDetail     from "./pages/TicketDetail";
import AMCSetup         from "./pages/AMCSetup";

import AddClient from "./pages/AddClient";
import AddProject from "./pages/AddProject";
import EditClient from "./pages/EditClient";

import Users from "./pages/Users";
import AddUser from "./pages/AddUser";
import EditUser from "./pages/EditUser";

import Launcher from "./pages/Launcher";
import LauncherManager from "./pages/LauncherManager";
import AddLauncher from "./pages/AddLauncher";
import EditLauncher from "./pages/EditLauncher";
import AdminDropdowns from "./pages/AdminDropdowns";

import {
  ProjectsMap,
  AllClients,
  ClientDetail,
  AMCTasks,
  SearchPage,
} from "./pages/Pages";

import "./styles/globals.css";

/*  Blocks every screen until there is a session. If the backend has no
    GOOGLE_CLIENT_ID configured, auth is treated as off so the app still
    works — that way adding login can never lock you out by accident.   */
/*  Staff cannot open the Dashboard, so sending everyone there on sign-in would
    greet half the company with a locked screen. Send them to the first page
    their role can actually use.                                            */
function Landing() {
  const { canPage } = useAuth();
  return <Navigate to={canPage('dashboard') ? '/dashboard' : '/projects'} replace />;
}

function RequireAuth({ children }) {
  const { isAuthed, checking, authRequired, config } = useAuth();
  const location = useLocation();

  if (!config || checking) {
    return (
      <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
                   background:"var(--slate-100)",color:"var(--text-muted)",
                   fontSize:13,fontWeight:600}}>
        Loading…
      </div>
    );
  }
  if (authRequired && !isAuthed) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
    <BrowserRouter>
    <AuthProvider>

      <Toaster
        position="top-center"
        toastOptions={{
          duration: 2800,
          style: {
            background: "var(--white)",
            color: "var(--text-head)",
            fontSize: "13px",
            border: "1px solid var(--slate-200)",
            boxShadow: "var(--shadow-md)",
          },
          success: {
            iconTheme: {
              primary: "#F5A623",
              secondary: "#fff",
            },
          },
          error: {
            iconTheme: {
              primary: "#dc2626",
              secondary: "#fff",
            },
          },
        }}
      />

      <Routes>
        {/* the login screen sits OUTSIDE Layout — no navbar until signed in */}
        <Route path="/login" element={<Login />} />

        <Route path="*" element={
          <RequireAuth>
            <Layout>
              <Routes>

          {/* Dashboard */}
          <Route
            path="/"
            element={<Landing />}
          />

          <Route
            path="/dashboard"
            element={<RequirePermission page="dashboard"><Dashboard /></RequirePermission>}
          />

          {/* Projects */}

          <Route
            path="/projects"
            element={<AllProjects />}
          />

          <Route
            path="/projects/:id"
            element={<ProjectDetail />}
          />

          <Route
            path="/projects/:id/edit"
            element={<EditProject />}
          />

          {/* ── Solar Care ──────────────────────────────────────────
              The hierarchy, top to bottom:
                /solar-care                        every client
                /solar-care/clients/:clientId      one client, its projects
                /projects/:id/solar-care           one project: tickets + AMC
                /projects/:id/tickets/new          raise a ticket
                /tickets/:ticketId                 one ticket
                /projects/:id/amc/new              set up Inspection/Cleaning/Both
                /amc/contracts/:amcId              one contract, its visits
                /amc/visits/:taskId                one visit                 */}

          <Route
            path="/solar-care"
            element={<SolarCare />}
          />

          <Route
            path="/solar-care/clients/:clientId"
            element={<ClientSolarCare />}
          />

          <Route
            path="/projects/:id/solar-care"
            element={<ProjectSolarCare />}
          />

          <Route
            path="/projects/:id/tickets/new"
            element={<AddTicket />}
          />

          <Route
            path="/tickets/:ticketId"
            element={<TicketDetail />}
          />

          <Route
            path="/projects/:id/amc/new"
            element={<AMCSetup />}
          />

          {/* AMC drill-down: project -> contract -> visit */}
          <Route
            path="/amc/contracts/:amcId"
            element={<AMCContract />}
          />

          <Route
            path="/amc/visits/:taskId"
            element={<AMCVisit />}
          />

          {/* Clients */}

          <Route
            path="/clients"
            element={<AllClients />}
          />

          <Route
            path="/clients/:id"
            element={<ClientDetail />}
          />

          <Route
            path="/add-client"
            element={<AddClient />}
          />

          <Route
            path="/clients/:id/add-project"
            element={<AddProject />}
          />

          <Route
            path="/clients/:id/edit"
            element={<EditClient />}
          />

          {/* Maps */}

          <Route
            path="/map"
            element={<RequirePermission page="map"><ProjectsMap /></RequirePermission>}
          />

          {/* AMC */}

          <Route
            path="/amc"
            element={<AMCTasks />}
          />

          {/* Search */}

          <Route
            path="/search"
            element={<SearchPage />}
          />

          {/* Users */}

          <Route
            path="/users"
            element={<RequirePermission page="users"><Users /></RequirePermission>}
          />

          <Route
            path="/users/add"
            element={<RequirePermission page="users"><AddUser /></RequirePermission>}
          />

          <Route
            path="/users/edit/:id"
            element={<RequirePermission page="users"><EditUser /></RequirePermission>}
          />

          {/* Launcher */}

          <Route
            path="/launcher"
            element={<Launcher />}
          />

          
          <Route
            path="/launcher/add"
            element={<RequirePermission page="launcher"><AddLauncher /></RequirePermission>}
          />

          <Route
            path="/launcher/edit/:id"
            element={<RequirePermission page="launcher"><EditLauncher /></RequirePermission>}
          />
          <Route
            path="/launcher-manager"
            element={<RequirePermission page="launcher"><LauncherManager /></RequirePermission>}
          />

          {/* Admin: dropdown lists (Type of Project, Sales Lead, …) */}

          <Route
            path="/admin/dropdowns"
            element={<RequirePermission page="dropdowns"><AdminDropdowns /></RequirePermission>}
          />

          {/* 404 */}

          <Route
            path="*"
            element={<Landing />}
          />

              </Routes>
            </Layout>
          </RequireAuth>
        } />
      </Routes>

    </AuthProvider>
    </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);