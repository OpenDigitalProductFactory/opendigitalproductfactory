"use client";

import { useCallback, useEffect, useState } from "react";

/** Wake at a display deadline, and recheck after a suspended tab returns. */
export function useDeadlineClock(deadline: number, enabled = true) {
  const [now, setNow] = useState<number | null>(null);
  const refreshClock = useCallback(() => setNow(Date.now()), []);
  useEffect(() => {
    if (!enabled) return;
    refreshClock();
    const onVisible = () => { if (!document.hidden) refreshClock(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, deadline, refreshClock]);
  useEffect(() => {
    if (!enabled || !Number.isFinite(deadline) || deadline <= Date.now()) return;
    const timer = setTimeout(refreshClock, Math.min(deadline - Date.now(), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [enabled, deadline, now, refreshClock]);
  return { now, refreshClock };
}
