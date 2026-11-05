import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import PrivateLayout from "./layout/PrivateLayout";

import Login from "./pages/authentication/Login";

import Dashboard from "./pages/private/Dashboard";
import Integrations from "./pages/private/Integrations";
import Posts from "./pages/private/Posts";
import Reviews from "./pages/private/Reviews";
import Reports from "./pages/private/Reports";
import OrganizationMembers from "./pages/private/OrganizationMembers";

import { useAuth } from "./context/auth/useAuth";
import RecurranceLab from "./pages/private/RecurranceLab";

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
          <Route path="/" element={<PrivateLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="posts" element={<Posts />} />
            <Route path="reviews" element={<Reviews />} />
            <Route path="reports" element={<Reports />} />
            <Route
              path="organization-members"
              element={<OrganizationMembers />}
            />
            <Route path="recurrence" element={<RecurranceLab />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
