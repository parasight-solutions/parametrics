import { useCallback, useEffect, useMemo, useState } from "react";

import { restoreAuthState } from "./authState";
import { clearSession, saveSession } from "../../session";
import { AUTH_EXPIRED_EVENT } from "../../services/authFailure";

import { AuthContext } from "./useAuth";

export const AuthProvider = ({ children }) => {
  const [auth, setAuth] = useState(restoreAuthState);

  const login = useCallback((userData, accessToken) => {
    saveSession(userData, accessToken);

    setAuth({
      user: userData,
      token: accessToken,
    });
  }, []);

  const logout = useCallback(() => {
    clearSession();

    setAuth({
      user: null,
      token: null,
    });
  }, []);

  useEffect(() => {
    const handleAuthExpired = () => logout();

    globalThis.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);

    return () =>
      globalThis.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [logout]);

  const value = useMemo(
    () => ({
      user: auth.user,
      token: auth.token,
      isAuthenticated: Boolean(auth.token && auth.user),
      login,
      logout,
      authLoading: false,
    }),
    [auth, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
