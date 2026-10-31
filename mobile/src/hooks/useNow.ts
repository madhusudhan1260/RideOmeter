import { useEffect, useState } from 'react';

/** Re-render on an interval so ages ("12s ago") and LIVE→STALE flips stay correct. */
export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
