import { useState } from "react";
import AppShell from "../components/AppShell";
import ActiveLocationPicker from "../components/ActiveLocationPicker";
import RecurrenceLab from "../components/RecurrenceLab";
import { getActiveLocationId } from "../session";

export default function Recurrence({ onLogout }) {
  const [locationId, setLocationId] = useState(getActiveLocationId());

  return (
    <AppShell
      title="Recurrence Lab"
      subtitle="Plan recurring Google Business Profile posts"
      onLogout={onLogout}
    >
      <div className="bg-white border rounded-xl p-5 space-y-4">
        <div>
          <div className="text-sm text-gray-600 mb-2">Active Location</div>
          <ActiveLocationPicker value={locationId} onChange={setLocationId} />
        </div>

        <RecurrenceLab
          locationId={locationId}
          onLocationChange={setLocationId}
          defaultOpen
        />
      </div>
    </AppShell>
  );
}
