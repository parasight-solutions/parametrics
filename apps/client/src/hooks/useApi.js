import { useCallback, useState } from "react";

export default function useApi(defaults) {
  const [loading, setLoading] = useState(defaults || {});

  const setLoadingKey = useCallback((key, boolean) => {
    setLoading((prev) => ({ ...prev, [key]: boolean }));
  }, []);

  const callApi = useCallback(
    async (keyName, api, { loading = true, onSuccess, onError } = {}) => {
      if (loading) {
        setLoadingKey(keyName, true);
      }

      try {
        const res = await api();

        await onSuccess?.(res);
        return res;
      } catch (error) {
        console.error("Error: ", error);
        await onError?.(error);
        return undefined;
      } finally {
        setLoadingKey(keyName, false);
      }
    },
    [setLoadingKey],
  );

  return { loading, callApi };
}
