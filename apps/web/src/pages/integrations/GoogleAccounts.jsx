// apps/web/src/pages/integrations/GoogleAccounts.jsx
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

export default function GoogleAccounts() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [err, setErr] = useState(null);
  const lastFetchRef = useRef(0);

  const load = async () => {
    if (!token) return setErr("No token");
    // client-side throttle: max 1 call per 65s (server also caches 60s)
    const now = Date.now();
    if (now - lastFetchRef.current < 65_000 && accounts.length) return;
    lastFetchRef.current = now;

    setLoading(true); setErr(null);
    try {
      const data = await apiFetch("/api/v1/integrations/google/accounts", { token });
      setAccounts(data.accounts || []);
    } catch (e) {
      setErr(e?.body?.error?.code || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* auto-load once */ }, []); // eslint-disable-line

  return (
    <div>
      <h2>Google Business Profile – Accounts</h2>
      <button onClick={load} disabled={loading}>Refresh</button>
      {loading && <p>Loading…</p>}
      {err && <p style={{color:'crimson'}}>Error: {String(err)}</p>}
      <ul>
        {accounts.map(a => (
          <li key={a.name}>
            <code>{a.name}</code> — {a.accountName || a.organizationInfo?.registeredDomain || a.type || "account"}
          </li>
        ))}
      </ul>
      {!accounts.length && !loading && !err && <p>No accounts visible for this Google user.</p>}
    </div>
  );
}
