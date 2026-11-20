import { useState } from "react";

import { Outlet } from "react-router-dom";

import Header from "../components/Header";
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

      <div className="flex flex-col w-full overflow-hidden">
        <Header onClick={() => setIsSidebarOpen(true)} />

        <div className="flex-1 w-full p-5 md:px-12 md:py-8 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default PrivateLayout;
