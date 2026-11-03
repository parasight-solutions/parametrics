// apps/web/src/lib/api.js
import { api } from "../apiClient";

export async function apiFetch(
  path,
  { auth = true, ...rest } = {}
) {
  return api(path, { auth, ...rest });
}

export default apiFetch;
