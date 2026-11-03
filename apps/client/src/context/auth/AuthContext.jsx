import { useCallback, useEffect, useMemo, useState } from "react";

import { authEndpoints } from "../../services/auth.service";
import { AUTH_EXPIRED_EVENT } from "../../services/authFailure";

import { clearSession } from "../../session";

import useApi from "../../hooks/useApi";
import { AuthContext } from "./useAuth";

export const AuthProvider = ({ children }) => {
  const { loading, callApi } = useApi({ authLoading: true });

  const [user, setUser] = useState(null);
  const authLoading = loading?.authLoading;

  const login = useCallback((userData) => {
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    await callApi("loggingOut", authEndpoints.logout, {
      onSuccess: () => {
        clearSession();
        setUser(null);
      },
    });
  }, [callApi]);

  useEffect(() => {
    callApi("authLoading", authEndpoints.session, {
      onSuccess: (res) => {
        const user = res?.data?.user ?? res?.user ?? null;
        setUser(user);
      },
      onError: (error) => {
        if (error?.response?.status === 401 || error?.status === 401)
          setUser(null);
      },
    });
  }, [callApi]);

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
