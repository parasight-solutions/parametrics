import { useCallback, useEffect, useState } from "react";

import useApi from "../../hooks/useApi";

import { LocationContext } from "./useLocation";

import { commonEndpoints } from "../../services/common.service";

import { getActiveLocationId, setActiveLocationId } from "../../session";

export const LocationProvider = ({ children }) => {
  const { loading, callApi } = useApi({ locationsLoading: true });
  const [locations, setLocations] = useState([]);

  const [activeLocation, setActiveLocation] = useState(getActiveLocationId());

  const fetchLocations = useCallback(() => {
    callApi("locationsLoading", commonEndpoints.getLocations, {
      onSuccess: ({ data }) => {
        const formatted = data?.locations?.map((location) => ({
          value: location?.id,
          label: location?.title,
          ...location,
        }));

        setLocations(formatted);
      },
    });
  }, [callApi]);

  const handleLocationChange = (value) => {
    setActiveLocation(value);
    setActiveLocationId(value);
  };

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  return (
    <LocationContext.Provider
      value={{
        locations,
        locationsLoading: loading?.locationsLoading,
        handleLocationChange,
        activeLocation,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
};
