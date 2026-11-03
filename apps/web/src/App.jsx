// apps/web/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Posts from "./pages/Posts";
import NewPost from "./pages/NewPost";
import Reviews from "./pages/Reviews";
import Recurrence from "./pages/Recurrence";
import "./index.css";
import Integrations from "./pages/Integrations";
import GoogleConnected from "./pages/GoogleConnected";
import Locations from "./pages/Locations";
import OrganizationMembers from "./pages/OrganizationMembers";
import ReportHistory from "./pages/ReportHistory";
import { useAuth } from "./context/useAuth";

export default function App() {
  const { authLoading, isAuthenticated: authed, login, logout } = useAuth();

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/posts" element={authed ? <Posts onLogout={logout} /> : <Navigate to="/login" />} />
        <Route path="/posts/new" element={authed ? <NewPost onLogout={logout} /> : <Navigate to="/login" />} />
        <Route path="/reviews" element={authed ? <Reviews onLogout={logout} /> : <Navigate to="/login" />} />
        <Route path="/recurrence" element={authed ? <Recurrence onLogout={logout} /> : <Navigate to="/login" />} />
        <Route path="/integrations" element={authed ? <Integrations onLogout={logout} /> : <Navigate to="/login" />} />
        <Route path="/locations" element={authed ? <Locations onLogout={logout} /> : <Navigate to="/login" />} />
        <Route path="/organization-members" element={authed ? <OrganizationMembers onLogout={logout} /> : <Navigate to="/login" />} />
        <Route path="/reports/history" element={authed ? <ReportHistory onLogout={logout} /> : <Navigate to="/login" />} />

        <Route path="/integrations/google/connected" element={<GoogleConnected />} />
        <Route path="/login" element={authed ? <Navigate to="/" /> : <Login onAuthed={login} />} />
        <Route path="/" element={authed ? <Dashboard onLogout={logout} /> : <Navigate to="/login" />} />
        <Route path="*" element={<Navigate to={authed ? "/" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  );
}
