import {
  clearSession,
  getStoredUser,
  getToken,
  isTokenExpired,
} from "../../session";

export function restoreAuthState(now = Date.now()) {
  const token = getToken();
  const user = getStoredUser();

  if (token && user && !isTokenExpired(token, now)) {
    return { user, token };
  }

  clearSession();
  return { user: null, token: null };
}
