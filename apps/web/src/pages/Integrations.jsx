// apps/web/src/pages/Integrations.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api } from "../apiClient";

function fmtDate(d) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d || "");
  }
}

function readReauth() {
  try {
    const raw = sessionStorage.getItem("reauth_required");
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || obj.provider !== "google") return null;
    return obj;
  } catch {
    return null;
  }
}

export default function Integrations({ onLogout }) {
  const location = useLocation();

  const googleSectionRef = useRef(null);
  const connectBtnRef = useRef(null);

  const [status, setStatus] = useState({ connected: false, activeIntegrationId: null });
  const [connections, setConnections] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activatingId, setActivatingId] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [msg, setMsg] = useState("");

  const [reauth, setReauth] = useState(null);

  const activeConn = useMemo(
    () => connections.find((c) => c.is_active) || null,
    [connections]
  );

  async function loadAll() {
    setMsg("");
    setLoading(true);
    try {
      const s = await api("/integrations/google/status");
      setStatus(s);

      const c = await api("/integrations/google/connections");
      setConnections(c.connections || []);

      if (s.connected) {
        // If this succeeds, refresh token flow is working → clear banners.
        const a = await api("/integrations/google/accounts");
        setAccounts(a.accounts || []);

        try {
          sessionStorage.removeItem("reauth_required");
          sessionStorage.removeItem("reauth_required_alerted");
          sessionStorage.removeItem("reauth_required_dismissed");
        } catch {}
        setReauth(null);
      } else {
        setAccounts([]);
        setSelectedAccount("");
        setLocations([]);
      }
    } catch (e) {
      // If apiClient detected reauth_required, it already stored sessionStorage
      setMsg(e?.message || "Failed to load integration status");

      const r = readReauth();
      if (r) setReauth(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If redirected here with ?reauth=google (or reauth exists), auto-scroll to Google card + focus CTA.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wants = params.get("reauth") === "google";
    const r = readReauth();

    if (wants || r) {
      setReauth(
        r || {
          provider: "google",
          message: "Google connection expired/revoked. Please reconnect Google.",
          at: Date.now(),
          from: "",
        }
      );

      // small defer so DOM is painted before scroll/focus
      setTimeout(() => {
        googleSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        connectBtnRef.current?.focus?.();
      }, 50);
    } else {
      setReauth(null);
    }
  }, [location.search]);

  function connectGoogle() {
    const token = localStorage.getItem("token") || "";
    if (!token) {
      setMsg("Login required. Please login again.");
      return;
    }

    // User accepted the next-step CTA; clear banner state so UX is clean.
    try {
      sessionStorage.removeItem("reauth_required");
      sessionStorage.removeItem("reauth_required_alerted");
      sessionStorage.removeItem("reauth_required_dismissed");
    } catch {}
    setReauth(null);

    window.location.href = `/api/v1/integrations/google/start?t=${encodeURIComponent(token)}`;
  }

  async function activateConnection(id) {
    setActivatingId(id);
    setMsg("");
    try {
      await api(`/integrations/google/connections/${id}/activate`, { method: "POST" });
      await loadAll();
      setMsg("Activated Google connection.");
    } catch (e) {
      setMsg(e?.message || "Activation failed");
    } finally {
      setActivatingId("");
    }
  }

  async function reconcileLocations() {
    setReconciling(true);
    setMsg("");
    try {
      const out = await api("/integrations/google/locations/reconcile", { method: "POST" });
      setMsg(`Reconcile complete. scanned=${out.scanned}, updated=${out.updated}, unmatched=${out.unmatched}`);
    } catch (e) {
      setMsg(e?.message || "Reconcile failed");
    } finally {
      setReconciling(false);
    }
  }

  async function loadLocations(accountName) {
    setLocations([]);
    if (!accountName) return;
    setLoading(true);
    setMsg("");
    try {
      const r = await api(`/integrations/google/locations?accountName=${encodeURIComponent(accountName)}`);
      setLocations(r.locations || []);
    } catch (e) {
      setMsg(e?.message || "Failed to load locations");
    } finally {
      setLoading(false);
    }
  }

  async function importLocations() {
    if (!selectedAccount) return;
    setImporting(true);
    setMsg("");
    try {
      const r = await api("/integrations/google/locations/import", {
        method: "POST",
        body: { accountName: selectedAccount },
      });
      setMsg(`Imported/updated: inserted=${r.inserted || 0}, updated=${r.updated || 0}`);
    } catch (e) {
      setMsg(e?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function dismissReauth() {
    try {
      sessionStorage.setItem("reauth_required_dismissed", "1");
    } catch {}
    setReauth(null);
  }

  const reauthMsg =
    reauth?.message || "Google connection expired/revoked. Please reconnect Google.";

  return (
    <AppShell title="Integrations" subtitle="Connect and manage your data sources" onLogout={onLogout}>
      <div className="space-y-6">
        <div ref={googleSectionRef} className="bg-white border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-lg font-semibold">Google Business Profile</div>
              <div className="text-sm text-gray-600">
                {status.connected
                  ? `Connected (active: ${status.email || activeConn?.provider_email || "unknown"})`
                  : "Not connected"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={loadAll}
                className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100"
              >
                Refresh
              </button>
              <button
                ref={connectBtnRef}
                onClick={connectGoogle}
                className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black"
              >
                Connect Google
              </button>
            </div>
          </div>

          {reauth ? (
            <div className="border rounded-lg bg-amber-50 p-3 flex items-start justify-between gap-3 flex-wrap">
              <div className="text-sm text-amber-900">
                <div className="font-semibold">Reconnect required</div>
                <div className="text-amber-900/90">{reauthMsg}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={connectGoogle}
                  className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black"
                >
                  Reconnect Google
                </button>
                <button
                  onClick={dismissReauth}
                  className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}

          {msg ? <div className="text-sm text-indigo-700">{msg}</div> : null}

          {connections.length ? (
            <div className="border rounded-lg p-3 bg-gray-50">
              <div className="text-sm font-medium mb-2">Connected Google accounts</div>
              <div className="space-y-2">
                {connections.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <div className="font-medium">
                        {c.provider_email || c.provider_subject || c.id}
                        {c.is_active ? <span className="ml-2 text-xs text-green-700">(active)</span> : null}
                      </div>
                      <div className="text-xs text-gray-600">
                        Updated: {fmtDate(c.updated_at)} | Scopes: {(c.scopes || []).length}
                      </div>
                    </div>

                    {!c.is_active ? (
                      <button
                        disabled={!!activatingId}
                        onClick={() => activateConnection(c.id)}
                        className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                      >
                        {activatingId === c.id ? "Activating…" : "Set active"}
                      </button>
                    ) : (
                      <button
                        disabled={reconciling}
                        onClick={reconcileLocations}
                        className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-100 disabled:opacity-50"
                      >
                        {reconciling ? "Reconciling…" : "Reconcile locations"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {status.connected ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">Accounts</div>
                <select
                  className="w-full px-3 py-2 border rounded-lg"
                  value={selectedAccount}
                  onChange={(e) => {
                    setSelectedAccount(e.target.value);
                    loadLocations(e.target.value);
                  }}
                >
                  <option value="">Select an account…</option>
                  {accounts.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.accountName || a.name}
                    </option>
                  ))}
                </select>

                <button
                  disabled={!selectedAccount || importing}
                  onClick={importLocations}
                  className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50"
                >
                  {importing ? "Importing…" : "Import locations"}
                </button>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Locations (preview)</div>
                <div className="border rounded-lg bg-white max-h-64 overflow-auto">
                  {loading ? (
                    <div className="p-3 text-sm text-gray-600">Loading…</div>
                  ) : locations.length ? (
                    locations.map((l) => (
                      <div key={l.name} className="p-3 border-b">
                        <div className="font-medium text-sm">{l.title || l.name}</div>
                        <div className="text-xs text-gray-600">{l.address || "-"}</div>
                      </div>
                    ))
                  ) : (
                    <div className="p-3 text-sm text-gray-600">No locations loaded yet.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
