import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

export default function GoogleLocationsImport() {
  const { token } = useAuth();

  const [accounts, setAccounts] = useState([]);
  const [accountsErr, setAccountsErr] = useState(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const [selected, setSelected] = useState(""); // JSON string of { accountName, integrationId }
  const selectedObj = useMemo(() => {
    try { return selected ? JSON.parse(selected) : null; } catch { return null; }
  }, [selected]);

  const [locations, setLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [locationsErr, setLocationsErr] = useState(null);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importErr, setImportErr] = useState(null);

  const loadAccounts = async () => {
    setLoadingAccounts(true);
    setAccountsErr(null);
    try {
      const data = await apiFetch("/api/v1/integrations/google/accounts", { token });
      setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
    } catch (e) {
      setAccountsErr(e?.body?.error?.code || e.message || "accounts_failed");
    } finally {
      setLoadingAccounts(false);
    }
  };

  const loadLocations = async (accountName, integrationId) => {
    setLoadingLocations(true);
    setLocationsErr(null);
    setLocations([]);
    try {
      const qs = new URLSearchParams({ accountName });
      if (integrationId) qs.set("integrationId", integrationId);

      const data = await apiFetch(`/api/v1/integrations/google/locations?${qs.toString()}`, { token });
      setLocations(Array.isArray(data?.locations) ? data.locations : []);
    } catch (e) {
      setLocationsErr(e?.body?.error?.code || e.message || "locations_failed");
    } finally {
      setLoadingLocations(false);
    }
  };

  const runImport = async () => {
    setImportErr(null);
    setImportResult(null);

    if (!selectedObj?.accountName) return;

    setImporting(true);
    try {
      const data = await apiFetch("/api/v1/integrations/google/locations/import", {
        token,
        method: "POST",
        body: {
          accountName: selectedObj.accountName,
          integrationId: selectedObj.integrationId || null,
        },
      });
      setImportResult(data);

      // refresh locations list after import
      await loadLocations(selectedObj.accountName, selectedObj.integrationId);
    } catch (e) {
      setImportErr(e?.body?.error?.code || e.message || "import_failed");
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedObj?.accountName) {
      loadLocations(selectedObj.accountName, selectedObj.integrationId);
    } else {
      setLocations([]);
      setLocationsErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div style={{ maxWidth: 860 }}>
      <h2>Import Locations</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <button onClick={loadAccounts} disabled={loadingAccounts}>
          {loadingAccounts ? "Loading..." : "Refresh Accounts"}
        </button>

        {accountsErr && <span style={{ color: "crimson" }}>Accounts error: {String(accountsErr)}</span>}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Select Account</label>
        <select
          style={{ width: 820, padding: 8 }}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={loadingAccounts}
        >
          <option value="">-- select --</option>
          {accounts.map((a) => {
            const integrationId = a.integration_id || (a.owners?.[0]?.integration_id ?? null);
            const ownerEmail = a.owner_email || (a.owners?.[0]?.email ?? "");
            const val = JSON.stringify({ accountName: a.name, integrationId });

            const label = `${a.name}${a.accountName ? ` — ${a.accountName}` : ""}${ownerEmail ? ` (via ${ownerEmail})` : ""}`;
            return (
              <option key={`${a.name}:${integrationId || "noid"}`} value={val}>
                {label}
              </option>
            );
          })}
        </select>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <button onClick={runImport} disabled={!selectedObj?.accountName || importing}>
          {importing ? "Importing..." : "Import Locations"}
        </button>
        {importErr && <span style={{ color: "crimson" }}>Import error: {String(importErr)}</span>}
      </div>

      {importResult && (
        <pre style={{ background: "#111", color: "#0f0", padding: 12, borderRadius: 6 }}>
          {JSON.stringify(importResult, null, 2)}
        </pre>
      )}

      <h3 style={{ marginTop: 18 }}>Locations</h3>
      {locationsErr && <p style={{ color: "crimson" }}>Locations error: {String(locationsErr)}</p>}
      {loadingLocations && <p>Loading locations...</p>}

      {!loadingLocations && locations.length === 0 && selectedObj?.accountName && !locationsErr && (
        <p>No locations found for this account.</p>
      )}

      {locations.length > 0 && (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
          {locations.map((l) => (
            <div key={l.name} style={{ padding: 12, borderBottom: "1px solid #eee" }}>
              <div style={{ fontWeight: 700 }}>{l.title || l.name}</div>
              <div style={{ opacity: 0.85 }}>{l.address || "-"}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {l.locationId} {l.primaryPhone ? `• ${l.primaryPhone}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
