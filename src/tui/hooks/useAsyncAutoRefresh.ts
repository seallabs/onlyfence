import { useState, useEffect, useRef, useCallback } from 'react';
import { toErrorMessage } from '../../utils/errors.js';

/**
 * JSON.stringify replacer that converts bigint values to strings.
 */
const bigintReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

/**
 * Hook that polls an async fetcher at a fixed interval.
 *
 * Async counterpart of useAutoRefresh — designed for fetchers that
 * return Promises (e.g., RPC calls for on-chain balance queries).
 *
 * Uses a ref to avoid re-creating the interval when the fetcher
 * identity changes. The fetcher is called once on mount and then
 * every `intervalMs` milliseconds. An in-flight guard prevents
 * overlapping requests when a fetch takes longer than the interval.
 *
 * @param fetcher - Async function returning fresh data
 * @param initialData - Data to use before the first fetch resolves
 * @param intervalMs - Polling interval in milliseconds (default 30000)
 * @returns Current data, loading/error state, and a manual refresh trigger
 */
export function useAsyncAutoRefresh<T>(
  fetcher: () => Promise<T>,
  initialData: T,
  intervalMs = 30000,
): { data: T; loading: boolean; error: string | null; refresh: () => void } {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const inFlightRef = useRef(false);
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    fetcherRef
      .current()
      .then((next) => {
        setData((prev) => {
          const prevStr = JSON.stringify(prev, bigintReplacer);
          const nextStr = JSON.stringify(next, bigintReplacer);
          return prevStr === nextStr ? prev : next;
        });
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(toErrorMessage(err));
        setLoading(false);
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs, refresh]);

  return { data, loading, error, refresh };
}
