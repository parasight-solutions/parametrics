import { MapPin, Menu } from "lucide-react";

import CustomSelect from "./ui/CustomSelect";

import { useLocation } from "../context/location/useLocation";

const Header = ({ onClick }) => {
  const {
    locations,
    locationsLoading,
    handleLocationChange,
    activeLocation,
    disableLocationUpdate,
  } = useLocation();

  return (
    <div className="z-10 h-15 px-5 flex items-center justify-between md:justify-end gap-3 shadow-sm">
      <Menu size={22} onClick={onClick} className="shrink-0 md:hidden" />

      <div className="min-w-0 w-70 md:w-120">
        <CustomSelect
          id="locationId"
          icon={MapPin}
          placeholder="Select Location"
          value={activeLocation}
          options={locations}
          onChange={handleLocationChange}
          loading={locationsLoading}
          disabled={disableLocationUpdate}
        />
      </div>
    </div>
  );
};

export default Header;
