// Google Connect start (S2-33): the app JWT is sent only as a Bearer header to
// POST /integrations/google/connect/start. The browser then navigates to the
// returned single-use URL; no JWT ever appears in a URL.

export function isSafeConnectUrl(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (u.username || u.password) return false;
    return /\/integrations\/google\/connect\/go$/.test(u.pathname) && !!u.searchParams.get("h");
  } catch {
    return false;
  }
}

export async function startGoogleConnect({ api, assign }) {
  const res = await api("/integrations/google/connect/start", { method: "POST" });
  const url = res?.url;
  if (!isSafeConnectUrl(url)) {
    throw { code: "connect_start_invalid", message: "Could not start Google connect." };
  }
  assign(url);
  return url;
}
