import { useState, useEffect, useCallback } from "react";

interface FetchOptions {
  retries?: number;
  retryDelay?: number;
  timeout?: number;
  onError?: (error: Error) => void;
}

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  retry: () => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * Hook: Fetch data with retry logic and error handling
 *
 * Example:
 * const { data, loading, error, retry } = useFetch("/api/early-coins");
 */
export function useFetch<T = any>(
  url: string,
  options: FetchOptions = {}
): FetchState<T> {
  const {
    retries = 3,
    retryDelay = 1000,
    timeout = 10000,
    onError
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "Accept": "application/json"
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();
      setData(json);
      setRetryCount(0);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);

      // Retry logic
      if (retryCount < retries) {
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, retryDelay);
      }
    } finally {
      setLoading(false);
    }
  }, [url, retries, retryDelay, timeout, retryCount, onError]);

  useEffect(() => {
    fetchData();
  }, [url, retryCount]);

  const retry = useCallback(async () => {
    setRetryCount(0);
    await fetchData();
  }, [fetchData]);

  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  return { data, loading, error, retry, refetch };
}

/**
 * Hook: Fetch multiple endpoints in parallel with partial failure handling
 *
 * Example:
 * const {data, loading, errors} = useMultiFetch({
 *   early: "/api/early-coins",
 *   elite: "/api/elite-validator"
 * })
 */
export function useMultiFetch<T extends Record<string, any>>(
  endpoints: Record<keyof T, string>,
  options: FetchOptions = {}
): {
  data: T | null;
  loading: boolean;
  errors: Record<string, Error | null>;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, Error | null>>({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setErrors({});

    const results: any = {};
    const newErrors: Record<string, Error | null> = {};

    const promises = Object.entries(endpoints).map(async ([key, url]) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options.timeout || 10000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        results[key] = await response.json();
        newErrors[key] = null;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        results[key] = null;
        newErrors[key] = error;
        options.onError?.(error);
      }
    });

    await Promise.all(promises);
    setData(results);
    setErrors(newErrors);
    setLoading(false);
  }, [endpoints, options]);

  useEffect(() => {
    fetchAll();
  }, [JSON.stringify(endpoints)]);

  return {
    data,
    loading,
    errors,
    refetch: fetchAll
  };
}
