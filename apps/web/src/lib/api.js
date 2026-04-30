// apps/web/src/lib/api.js
import { api, getToken, setToken, clearToken } from "../apiClient";
import { setAuthSession } from "../session";

export { getToken, setToken, clearToken };

export async function apiFetch(
  path,
  {
    token,
    auth = true,
    ...rest
  } = {}
) {
  if (token) setAuthSession(token);
  return api(path, { auth, ...rest });
}

export default apiFetch;
