"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  useBackgroundOperationObserver,
  type BackgroundOperationObserver,
} from "@/lib/hooks/useBackgroundOperationObserver";
import type { SelfUpgradeStatusSnapshot } from "@/lib/self-upgrade/status-snapshot";

const SelfUpgradeLiveContext =
  createContext<BackgroundOperationObserver<SelfUpgradeStatusSnapshot> | null>(null);

export function isSelfUpgradeObservationActive(
  snapshot: SelfUpgradeStatusSnapshot,
): boolean {
  const status = snapshot.latestRun?.status;
  return (
    status === "queued" ||
    status === "pending" ||
    status === "running" ||
    snapshot.quiescence.level !== "normal"
  );
}

export function SelfUpgradeLiveProvider({
  initialSnapshot,
  children,
}: {
  initialSnapshot: SelfUpgradeStatusSnapshot;
  children: ReactNode;
}) {
  const observer = useBackgroundOperationObserver<SelfUpgradeStatusSnapshot>({
    endpoint: "/api/ops/self-upgrade/status",
    eventType: "system:self-upgrade",
    initialSnapshot,
    isActive: isSelfUpgradeObservationActive,
    // Job-engine registration recovery is not a self-upgrade lifecycle event.
    // Reconcile it slowly through the same single observer and targeted route.
    shouldReconcile: (snapshot) => snapshot.jobEngine.status === "degraded",
    reconcileMs: 15_000,
  });

  return (
    <SelfUpgradeLiveContext.Provider value={observer}>
      {children}
    </SelfUpgradeLiveContext.Provider>
  );
}

export function useSelfUpgradeLive(): BackgroundOperationObserver<SelfUpgradeStatusSnapshot> {
  const context = useContext(SelfUpgradeLiveContext);
  if (!context) {
    throw new Error("Self-upgrade live surfaces must be rendered inside SelfUpgradeLiveProvider.");
  }
  return context;
}

/** Compatibility seam for isolated component tests and non-shell rendering. */
export function useOptionalSelfUpgradeLive(): BackgroundOperationObserver<SelfUpgradeStatusSnapshot> | null {
  return useContext(SelfUpgradeLiveContext);
}
