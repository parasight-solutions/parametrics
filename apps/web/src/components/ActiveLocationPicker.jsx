// apps/web/src/components/ActiveLocationPicker.jsx
import { useEffect, useState } from "react";
import { api } from "../apiClient";
import {
  setActiveLocationId,
} from "../session";

export default function ActiveLocationPicker({ value, onChange }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api("/locations");
        setLocations(r.locations || []);
        setLoaded(true);
      } catch {
        setLoaded(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (loading || !loaded || !value) return;
    if (locations.some((l) => String(l.id) === String(value))) return;

    setActiveLocationId("");
    onChange?.("");
  }, [loaded, loading, locations, onChange, value]);

  function set(v) {
    setActiveLocationId(v);
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
