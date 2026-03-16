import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Hook that polls a synchronous fetcher at a fixed interval.
 *
 * Uses a ref to avoid re-creating the interval when the fetcher
 * identity changes. The fetcher is called once on mount and then
 * every `intervalMs` milliseconds.
 *
 * @param fetcher - Synchronous function returning fresh data
 * @param intervalMs - Polling interval in milliseconds (default 5000)
 * @returns Current data and a manual refresh trigger
 */
export function useAutoRefresh<T>(
  fetcher: () => T,
  intervalMs = 5000,
): { data: T; refresh: () => void } {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [data, setData] = useState<T>(() => fetcher());

  const refresh = useCallback(() => {
    setData((prev) => {
      const next = fetcherRef.current();
      // Preserve reference identity when data is unchanged to skip re-render.
      // JSON.stringify is fine here — payloads are small (5-15 rows) and the
      // avoided terminal re-render is far more expensive than the comparison.
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs, refresh]);

  return { data, refresh };
}
