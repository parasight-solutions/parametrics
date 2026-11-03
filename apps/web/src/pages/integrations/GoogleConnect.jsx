// apps/web/src/pages/integrations/GoogleConnect.jsx
import { useEffect, useRef, useState } from "react";
const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  "http://localhost:5050";

export default function GoogleConnectPage() {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState("");
  const fetching = useRef(false);

  const connect = () => {
    window.location.href = `${API_BASE}/api/v1/integrations/google/start`;
  };

  // fetch once per minute max
  useEffect(() => {
    if (fetching.current) return;

    // 60s local cache to avoid rapid re-fetch on re-render
    const key = "gbp.accounts.cache";
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    if (cached && Date.now() - cached.ts < 60_000) {
      setAccounts(cached.data || []);
      return;
    }

    fetching.current = true;
    fetch(`${API_BASE}/api/v1/integrations/google/accounts`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (r.status === 429) {
          await r.json().catch(() => ({}));
          setError("Google quota cooldown. Try again in ~1 min.");
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        const list = data.accounts || [];
        setAccounts(list);
        localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: list }));
      })
      .catch((e) => setError(e.message || "failed"))
      .finally(() => { fetching.current = false; });
  }, []);

  return (
    <div className="p-4 space-y-3">
      <button onClick={connect}>Connect Google Business Profile</button>
      {error && <div style={{ color: "crimson" }}>{error}</div>}
      {accounts.length > 0 ? (
        <pre>{JSON.stringify(accounts, null, 2)}</pre>
      ) : (
        <div>No accounts yet.</div>
      )}
    </div>
  );
}
