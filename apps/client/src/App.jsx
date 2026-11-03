import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import Login from "./pages/authentication/Login";
import Dashboard from "./pages/private/Dashboard";

import { useAuth } from "./context/auth/useAuth";

const GuestWrapper = () => {
  const { isAuthenticated, authLoading } = useAuth();

  if (authLoading) return null;

  return isAuthenticated ? <Navigate to="/" replace /> : <Outlet />;
};

const PrivateWrapper = () => {
  const { isAuthenticated, authLoading } = useAuth();
  const location = useLocation();

  if (authLoading) return null;

  return isAuthenticated ? (
    <Outlet />
  ) : (
    <Navigate to="/login" state={{ from: location }} replace />
  );
};

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<GuestWrapper />}>
          <Route path="/login" element={<Login />} />
        </Route>

        <Route element={<PrivateWrapper />}>
          <Route index element={<Dashboard />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
