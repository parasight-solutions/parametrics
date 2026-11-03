import { useState } from "react";

import { AuthContext } from "./useAuth";
import {
  clearSession,
  getStoredUser,
  getToken,
  isTokenExpired,
  saveSession,
} from "../../auth/session";

export const AuthProvider = ({ children }) => {
  // Restore session during initial state initialization
  const [auth, setAuth] = useState(() => {
    const storedToken = getToken();
    const storedUser = getStoredUser();

    if (storedToken && storedUser && !isTokenExpired(storedToken)) {
      return {
        user: storedUser,
        token: storedToken,
      };
    }

    clearSession();

    return {
      user: null,
      token: null,
    };
  });

  const [authLoading] = useState(false);

  // Login
  const login = (userData, accessToken) => {
    saveSession(userData, accessToken);

    setAuth({
      user: userData,
      token: accessToken,
    });
  };

  // Logout
  const logout = () => {
    clearSession();

    setAuth({
      user: null,
      token: null,
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user: auth.user,
        token: auth.token,
        login,
        logout,
        authLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
