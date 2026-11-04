import { useState } from "react";

import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";

import SideBar from "../components/SideBar";
import ResponsiveMenuModal from "../components/ResponsiveMenuModal";

const PrivateLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen max-w-405 mx-auto">
      <ResponsiveMenuModal
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        sideModal={
          <SideBar
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
          />
        }
        sideModalClass="md:static md:translate-x-0 min-w-50"
        modalOpenDirection="left"
      />

      <div className="flex-1 w-full">
        <div className="md:hidden shrink-0 z-10 h-15 px-5 flex items-center justify-between gap-3 shadow-sm">
          <Menu size={22} onClick={() => setIsSidebarOpen(true)} />
        </div>

        <div
          className="h-full w-full
            p-5 md:px-12 md:py-8
            overflow-y-auto"
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default PrivateLayout;
