import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  buildNextListParams,
  parseListSearchParams,
  serializeListSearchParams,
} from "./listParamsSearchParams";

export default function useListParams(
  defaults = {},
  { syncWithUrl = false, urlKeys = [] } = {},
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialConfig] = useState(() => {
    const initialDefaults = { ...defaults };
    const initialUrlKeys = [...urlKeys];
    const initialValues = syncWithUrl
      ? parseListSearchParams(initialDefaults, initialUrlKeys, searchParams)
      : initialDefaults;

    return {
      defaults: initialDefaults,
      syncWithUrl,
      urlKeys: initialUrlKeys,
      values: initialValues,
    };
  });

  const [params, setParams] = useState(() => ({
    ...initialConfig.values,
  }));
  const [draftParams, setDraftParams] = useState(() => ({
    ...initialConfig.values,
  }));
  const paramsRef = useRef(params);
  const draftParamsRef = useRef(draftParams);
  const searchParamsRef = useRef(searchParams);
  const didCanonicalizeUrl = useRef(false);

  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  const getParams = useCallback(() => paramsRef.current, []);

  const commitParams = useCallback(
    (nextParams) => {
      paramsRef.current = nextParams;
      setParams(nextParams);

      if (!initialConfig.syncWithUrl) return;

      const nextSearchParams = serializeListSearchParams(
        searchParamsRef.current,
        nextParams,
        initialConfig.defaults,
        initialConfig.urlKeys,
      );

      searchParamsRef.current = nextSearchParams;
      setSearchParams(nextSearchParams, { replace: true });
    },
    [initialConfig, setSearchParams],
  );

  useEffect(() => {
    if (!initialConfig.syncWithUrl || didCanonicalizeUrl.current) return;

    didCanonicalizeUrl.current = true;
    const canonicalSearchParams = serializeListSearchParams(
      searchParamsRef.current,
      initialConfig.values,
      initialConfig.defaults,
      initialConfig.urlKeys,
    );

    if (
      canonicalSearchParams.toString() === searchParamsRef.current.toString()
    ) {
      return;
    }

    searchParamsRef.current = canonicalSearchParams;
    setSearchParams(canonicalSearchParams, { replace: true });
  }, [initialConfig, setSearchParams]);

  const changeParams = useCallback(
    (field, value) => {
      commitParams(
        buildNextListParams(
          paramsRef.current,
          { [field]: value },
          { resetPage: field !== "page" },
        ),
      );
    },
    [commitParams],
  );

  const changeDraftParam = useCallback((field, value) => {
    const nextDraftParams = {
      ...draftParamsRef.current,
      [field]: value,
    };

    draftParamsRef.current = nextDraftParams;
    setDraftParams(nextDraftParams);
  }, []);

  const applyDraftParams = useCallback(
    (fields = []) => {
      const updates = fields.reduce((result, field) => {
        result[field] = draftParamsRef.current[field];
        return result;
      }, {});

      commitParams(
        buildNextListParams(paramsRef.current, updates, { resetPage: true }),
      );
    },
    [commitParams],
  );

  const bulkUpdateParams = useCallback(
    (updates = {}) => {
      commitParams(
        buildNextListParams(paramsRef.current, updates, {
          resetPage: !Object.prototype.hasOwnProperty.call(updates, "page"),
        }),
      );
    },
    [commitParams],
  );

  const resetParams = useCallback(() => {
    const nextParams = { ...initialConfig.defaults };

    draftParamsRef.current = nextParams;
    setDraftParams(nextParams);
    commitParams(nextParams);
  }, [commitParams, initialConfig]);

  return {
    params,
    draftParams,
    getParams,
    changeParams,
    changeDraftParam,
    applyDraftParams,
    bulkUpdateParams,
    resetParams,
  };
}
