import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AgyQuota } from '../lib/api';

const REFRESH_MS = 5 * 60_000;

export function useAgyQuota(enabled: boolean) {
  const [quota, setQuota] = useState<AgyQuota | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      if (!enabled) return;
      const id = ++seq.current;
      setLoading(true);
      const next = await api.agyQuota(refresh);
      if (id !== seq.current) return;
      setQuota((current) =>
        next.ok
          ? next
          : current
            ? { ...current, stale: true, error: next.error }
            : next,
      );
      setLoading(false);
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      seq.current += 1;
      setQuota(null);
      setLoading(false);
      return;
    }

    void load(false);
    const timer = window.setInterval(() => void load(false), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled, load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  return { quota, loading, refresh };
}
