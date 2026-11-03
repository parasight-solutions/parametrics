const storage = () => globalThis.localStorage;

const getToken = () => storage()?.getItem(ACCESS_TOKEN_KEY) ?? null;

const setToken = (token) => storage().setItem(ACCESS_TOKEN_KEY, token);

const clearToken = () => storage()?.removeItem(ACCESS_TOKEN_KEY);

const getStoredUser = () => {
  try {
    return JSON.parse(storage()?.getItem(USER_KEY) ?? "null");
  } catch {
    return null;
  }
};

const setStoredUser = (user) =>
  storage().setItem(USER_KEY, JSON.stringify(user));

const saveSession = (user, token) => {
  setToken(token);
  setStoredUser(user);
};

const clearSession = () => {
  clearToken();
  storage()?.removeItem(USER_KEY);
};

// Reads exp without checking the signature (the backend does that), only so that an expired token
// is not restored as a logged-in session.
const isTokenExpired = (token, now = Date.now()) => {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(payload));
    return typeof exp !== "number" || exp * 1000 <= now;
  } catch {
    return true;
  }
};

export { getToken };
