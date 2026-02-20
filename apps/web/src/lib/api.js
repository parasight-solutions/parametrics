// apps/web/src/lib/api.js
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5050";

/**
 * Simple fetch wrapper that always attaches Authorization: Bearer <token>.
 */
export async function apiFetch(path, { token, method = "GET", body, headers } = {}) {
  if (!token) throw new Error("Missing JWT token");
  const h = new Headers(headers || {});
  h.set("Authorization", `Bearer ${token}`);
  if (body && !h.has("Content-Type")) h.set("Content-Type", "application/json");

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;

    // Normalize reauth error so UI can handle it deterministically
    if (res.status === 409 && json?.error?.code === "reauth_required") {
      err.code = "reauth_required";
    }

    throw err;
  }
  return res.json();
}
