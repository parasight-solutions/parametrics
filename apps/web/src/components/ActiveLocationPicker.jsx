// apps/web/src/components/ActiveLocationPicker.jsx
import { useEffect, useState } from "react";
import { api } from "../apiClient";

const KEY = "active_location_id";

export function getActiveLocationId() {
  return localStorage.getItem(KEY) || "";
}

export default function ActiveLocationPicker({ value, onChange }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api("/locations");
        setLocations(r.locations || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function set(v) {
    localStorage.setItem(KEY, v || "");
    onChange?.(v || "");
  }

  return (
    <select
      className="w-full border rounded-lg px-3 py-2 bg-white"
      value={value || ""}
      onChange={(e) => set(e.target.value)}
      disabled={loading}
    >
      <option value="">{loading ? "Loading locations..." : "-- choose location --"}</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.title || l.id}
        </option>
      ))}
    </select>
  );
}
