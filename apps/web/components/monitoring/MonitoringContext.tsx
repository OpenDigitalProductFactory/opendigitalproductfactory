"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

type MonitoringState = {
  online: boolean;
  checked: boolean;
};

const MonitoringContext = createContext<MonitoringState>({ online: false, checked: false });

export function useMonitoringStatus() {
  return useContext(MonitoringContext);
}

export function MonitoringProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MonitoringState>({ online: false, checked: false });

  const probe = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/metrics?query=up", {
        signal: AbortSignal.timeout(3_000),
        cache: "no-store",
      });
      setState({ online: res.ok, checked: true });
    } catch {
      setState({ online: false, checked: true });
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
