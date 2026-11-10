"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

type MonitoringState = {
  online: boolean;
  checked: boolean;
  /** Monitoring is switched off on this install — a choice, not an outage
   *  (BI-2CE9CBF4). `online` is false too, so metric queries stay idle. */
  off: boolean;
};

const MonitoringContext = createContext<MonitoringState>({ online: false, checked: false, off: false });

export function useMonitoringStatus() {
  return useContext(MonitoringContext);
}

export function MonitoringProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MonitoringState>({ online: false, checked: false, off: false });

  const probe = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/metrics?query=up", {
        signal: AbortSignal.timeout(3_000),
        cache: "no-store",
      });
      const body = res.ok ? await res.json().catch(() => null) : null;
      const off = body?.status === "monitoring-off";
      setState({ online: res.ok && !off, checked: true, off });
    } catch {
      setState({ online: false, checked: true, off: false });
    }
  }, []);

  useEffect(() => {
    probe();
    const id = setInterval(probe, 30_000);
    return () => clearInterval(id);
  }, [probe]);

  return (
    <MonitoringContext.Provider value={state}>
      {children}
    </MonitoringContext.Provider>
  );
}
