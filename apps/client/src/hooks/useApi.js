import { useCallback, useState } from "react";

const useApi = (defaults) => {
  const [loading, setLoading] = useState(defaults || {});

  const setLoadingKey = useCallback((key, boolean) => {
    setLoading((prev) => ({ ...prev, [key]: boolean }));
  }, []);

  const callApi = useCallback(
    async (
      keyName,
      api,
      { loading = true, onSuccess, onError, atLast } = {},
    ) => {
      if (loading) {
        setLoadingKey(keyName, true);
      }

      try {
        const res = await api();

        console.log("Response: ", res);
        await onSuccess?.(res);
        return res;
      } catch (error) {
        console.error("Error: ", error);
        await onError?.(error);
        return undefined;
      } finally {
        setLoadingKey(keyName, false);
        await atLast?.();
      }
    },
    [setLoadingKey],
  );

  return { loading, callApi };
};

export default useApi;
