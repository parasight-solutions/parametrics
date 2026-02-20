// apps/web/src/App.jsx
import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Posts from "./pages/Posts";
import NewPost from "./pages/NewPost";
import Reviews from "./pages/Reviews";
import "./index.css";
import Integrations from "./pages/Integrations";
import GoogleConnected from "./pages/GoogleConnected";
import Locations from "./pages/Locations";

function isAuthed() {
  return !!localStorage.getItem("token");
}

export default function App() {
  const [authed, setAuthed] = useState(isAuthed());
  function onAuthed() { setAuthed(true); }
  function onLogout() { localStorage.removeItem("token"); setAuthed(false); }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/posts" element={authed ? <Posts onLogout={onLogout} /> : <Navigate to="/login" />} />
        <Route path="/posts/new" element={authed ? <NewPost onLogout={onLogout} /> : <Navigate to="/login" />} />
        <Route path="/reviews" element={authed ? <Reviews onLogout={onLogout} /> : <Navigate to="/login" />} />
        <Route path="/integrations" element={authed ? <Integrations onLogout={onLogout} /> : <Navigate to="/login" />} />
        <Route path="/locations" element={authed ? <Locations onLogout={onLogout} /> : <Navigate to="/login" />} />

        <Route path="/integrations/google/connected" element={<GoogleConnected />} />
        <Route path="/login" element={authed ? <Navigate to="/" /> : <Login onAuthed={onAuthed} />} />
        <Route path="/" element={authed ? <Dashboard onLogout={onLogout} /> : <Navigate to="/login" />} />
        <Route path="*" element={<Navigate to={authed ? "/" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  );
}
