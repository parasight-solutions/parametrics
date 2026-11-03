import { useCallback, useEffect, useMemo, useState } from "react";

import { restoreAuthenticatedUser } from "./authState";
import { clearSession } from "../../session";
import { AUTH_EXPIRED_EVENT } from "../../services/authFailure";
import { authEndpoints } from "../../services/auth.service";
import { AuthContext } from "./useAuth";

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const login = useCallback((userData) => {
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authEndpoints.logout();
    } finally {
      clearSession();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    restoreAuthenticatedUser(authEndpoints.session)
      .then((restoredUser) => {
        if (active) setUser(restoredUser);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
    };

    globalThis.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () =>
      globalThis.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      login,
      logout,
      authLoading,
    }),
    [authLoading, login, logout, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
