import { useNavigate } from "react-router-dom";

import CustomButton from "../../components/ui/CustomButton";

import { useAuth } from "../../context/auth/useAuth";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <main className="min-h-screen bg-[#F7F9FB] p-6">
      <div className="mx-auto flex max-w-6xl items-center justify-between rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">{user?.email}</p>
        </div>

        <CustomButton
          type="button"
          name="Logout"
          variant="red_white"
          onClick={handleLogout}
        />
      </div>
    </main>
  );
};

export default Dashboard;
