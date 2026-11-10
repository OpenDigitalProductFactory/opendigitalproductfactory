"use client";

// UpgradeHold — what a person sees instead of a form while the platform is
// upgrading itself (BI-57D91FF0).
//
// During a governed self-upgrade the proxy refuses every mutating POST with a
// 503 whose body already says why ("portal_quiescing", a run id, a retry
// interval). The sign-in page used to lose that on the way to the screen: the
// server-action transport turned the 503 into "an unexpected response" and the
// route boundary rendered "Sign-in hit a problem — trying again usually fixes
// it", which is false on both counts. This component says what is happening
// in plain words, shows the run id for support, and retries by itself on the
// server's cadence — the person does nothing.
//
// It reads /api/internal/quiescence-state, the same Node-side truth the proxy
// gate reads; that route is allow-listed through quiescence and carries no
// secrets (level, run id, version).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Surface } from "@/components/ui/Surface";

export const QUIESCENCE_STATE_PATH = "/api/internal/quiescence-state";

export type QuiescenceProbe = { level: "normal" | "draining" | "swapping" | "unknown"; runId: string | null };

/** One read of the quiescence state. Never throws: a failed probe is "unknown". */
export async function probeQuiescence(fetchImpl: typeof fetch = fetch): Promise<QuiescenceProbe> {
  try {
    const res = await fetchImpl(QUIESCENCE_STATE_PATH, { cache: "no-store" });
    const body = (await res.json()) as Partial<QuiescenceProbe>;
    const level = body.level === "draining" || body.level === "swapping" || body.level === "normal" ? body.level : "unknown";
    return { level, runId: typeof body.runId === "string" ? body.runId : null };
  } catch {
    return { level: "unknown", runId: null };
  }
}

export type UpgradeHoldProps = {
  /** The run id from the refusal or the server render, for support. */
  runId?: string | null;
  /** Seconds between probes; the proxy's refusal says 30. */
  retryAfterSeconds?: number;
  /** Called once the platform reports normal again (defaults to a router refresh). */
  onResumed?: () => void;
  fetchImpl?: typeof fetch;
};

export function UpgradeHold({ runId = null, retryAfterSeconds = 30, onResumed, fetchImpl }: UpgradeHoldProps) {
  const router = useRouter();
  const [seen, setSeen] = useState<string | null>(runId);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const probe = await probeQuiescence(fetchImpl);
      if (cancelled) return;
      if (probe.runId) setSeen(probe.runId);
      if (probe.level === "normal") {
        if (onResumed) onResumed();
        else router.refresh();
      }
    };
    const timer = setInterval(tick, Math.max(5, retryAfterSeconds) * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fetchImpl, onResumed, retryAfterSeconds, router]);

  return (
    <Surface padding="lg" className="w-full max-w-sm text-center" role="status" aria-live="polite">
      <h1 className="mb-2 text-lg font-semibold text-[var(--dpf-text)]">The platform is upgrading itself</h1>
      <p className="mb-3 text-sm leading-6 text-[var(--dpf-muted)]">
        Sign-in resumes automatically when the upgrade finishes, usually within a few minutes. Nothing to do; this
        page checks by itself.
      </p>
      {seen ? (
        <p className="font-mono text-xs text-[var(--dpf-muted)]">Upgrade run {seen}</p>
      ) : null}
    </Surface>
  );
}
