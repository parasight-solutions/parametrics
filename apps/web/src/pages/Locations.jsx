import { useEffect, useState } from "react";
import { api } from "../apiClient";

export default function Locations() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    try {
      const r = await api("/locations");
      setRows(r.locations || []);
    } catch (e) {
      setErr(e?.message || e?.code || "Failed to load");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Imported Locations</h1>
            <p className="text-sm text-gray-600">These are stored in MongoDB for later metrics/jobs.</p>
          </div>
          <div className="flex gap-2">
            <a href="/integrations" className="px-3 py-2 rounded-lg border bg-white text-sm">Back</a>
            <button onClick={load} className="px-3 py-2 rounded-lg border bg-white text-sm">Refresh</button>
          </div>
        </div>

        {err ? <div className="rounded-lg border bg-white p-3 text-sm">{err}</div> : null}

        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((l) => (
            <div key={l.id} className="rounded-xl border bg-white p-4">
              <div className="font-semibold">{l.title || l.name}</div>
              {l.address ? <div className="text-sm text-gray-700 mt-1">{l.address}</div> : null}
              <div className="mt-2 text-xs text-gray-600 flex flex-wrap gap-2">
                {l.primaryPhone ? <span className="px-2 py-1 rounded bg-gray-100">{l.primaryPhone}</span> : null}
                {l.websiteUri ? <span className="px-2 py-1 rounded bg-gray-100 break-all">{l.websiteUri}</span> : null}
              </div>
              <div className="mt-2 text-xs text-gray-500 font-mono break-all">{l.provider_location_name}</div>
            </div>
          ))}
        </div>

        {!rows.length && !err ? (
          <div className="text-sm text-gray-600">No imported locations yet. Go to Integrations → Import locations.</div>
        ) : null}
      </div>
    </div>
  );
}
