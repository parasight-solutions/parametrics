import { useCallback, useEffect, useState } from "react";

import useApi from "./useApi";

import { commonEndpoints } from "../services/common.service";

const useLocations = () => {
  const { loading, callApi } = useApi({ locationsLoading: true });
  const [locations, setLocations] = useState([]);

  const fetchLocations = useCallback(() => {
    callApi("locationsLoading", commonEndpoints.getLocations, {
      onSuccess: (res) => {
        const formatted = res?.locations?.map((location) => ({
          value: location?.id,
          label: location?.title,
          ...location,
        }));

        setLocations(formatted);
      },
    });
  }, [callApi]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  return { locationsLoading: loading.locationsLoading, locations };
};

export default useLocations;
