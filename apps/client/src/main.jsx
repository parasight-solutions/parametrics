import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import App from "./App.jsx";

import { AuthProvider } from "./context/auth/AuthContext.jsx";
import { NotificationsProvider } from "./context/notification/NotificationsProvider.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <NotificationsProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </NotificationsProvider>
  </StrictMode>,
);
