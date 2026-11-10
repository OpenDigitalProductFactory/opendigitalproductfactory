"use client";

// Route-group error boundary (BI-DD5FC4FF, Simplify & Strengthen W7).
// Thin wrapper — the shared face lives in ui/ErrorBoundaryCard.
//
// BI-57D91FF0: a sign-in submitted while the platform is upgrading itself is
// refused by the proxy with a 503 the server-action transport cannot explain,
// so it lands here. Before showing the generic card, ask the platform whether
// it is quiescing; if so, show the upgrade hold, which retries on its own.

import { useEffect, useState } from "react";

import { UpgradeHold, probeQuiescence, type QuiescenceProbe } from "@/components/auth/UpgradeHold";
import { ErrorBoundaryCard } from "@/components/ui/ErrorBoundaryCard";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [probe, setProbe] = useState<QuiescenceProbe | null>(null);
  useEffect(() => {
    let cancelled = false;
    probeQuiescence().then((p) => { if (!cancelled) setProbe(p); });
    return () => { cancelled = true; };
  }, []);

  if (probe && (probe.level === "draining" || probe.level === "swapping")) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--dpf-bg)]">
        <UpgradeHold runId={probe.runId} onResumed={reset} />
      </div>
    );
  }
  return (
    <ErrorBoundaryCard
      error={error}
      reset={reset}
      title="Sign-in hit a problem"
      description="Something went wrong loading this sign-in page. Trying again usually fixes it."
    />
  );
}
