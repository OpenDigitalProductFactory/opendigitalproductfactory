import { useState, useEffect, useRef } from "react";

const HEALTH_URL = process.env.EXPO_PUBLIC_API_URL
  ? `${process.env.EXPO_PUBLIC_API_URL}/api/health`
  : "http://localhost:3000/api/health";

const POLL_INTERVAL_MS = 15_000;

/**
 * Monitors network connectivity by polling the API health endpoint.
 * Returns `{ isOnline }`.
 */
export function useOfflineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch(HEALTH_URL, { method: "HEAD" });
        setIsOnline(res.ok);
      } catch {
        setIsOnline(false);
      }
    }

    // Initial check
    check();

    intervalRef.current = setInterval(check, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return { isOnline };
}
