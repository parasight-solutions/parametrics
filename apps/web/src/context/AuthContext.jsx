import { useCallback, useEffect, useMemo, useState } from "react";

import { api, AUTH_EXPIRED_EVENT } from "../apiClient";
import { clearAuthSession, clearLegacyAuthStorage } from "../session";
import { restoreAuthenticatedUser } from "./authState";
import { AuthContext } from "./useAuth";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const login = useCallback((authenticatedUser) => {
    clearLegacyAuthStorage();
    setUser(authenticatedUser);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", auth: false });
    } finally {
      clearAuthSession();
      setUser(null);
    }
  }, []);

  const restoreSession = useCallback(async () => {
    setAuthLoading(true);
    clearLegacyAuthStorage();
    try {
      const restoredUser = await restoreAuthenticatedUser(() =>
        api("/auth/session", { auth: false }),
      );
      setUser(restoredUser);
      return restoredUser;
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession().catch((error) => {
      console.error("[auth] session restoration failed", error);
      setUser(null);
    });
  }, [restoreSession]);

  useEffect(() => {
    const expire = () => {
      clearAuthSession();
      setUser(null);
    };
    globalThis.addEventListener(AUTH_EXPIRED_EVENT, expire);
    return () => globalThis.removeEventListener(AUTH_EXPIRED_EVENT, expire);
  }, []);

  const value = useMemo(
    () => ({
      user,
      authLoading,
      isAuthenticated: Boolean(user),
      login,
      logout,
      restoreSession,
    }),
    [authLoading, login, logout, restoreSession, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
