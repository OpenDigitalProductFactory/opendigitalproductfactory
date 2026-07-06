"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEngagementStatus } from "@/lib/actions/leads";
import { qualifyEngagement } from "@/lib/actions/crm";

// Lead-triage loop on each engagement row: contacted → qualify (converts to an
// opportunity via the existing qualifyEngagement flow) or disqualify. Only the
// transitions valid for the current status render.
export function EngagementTriageActions({
  engagementId,
  status,
  hasAccount,
}: {
  engagementId: string;
  status: string;
  hasAccount: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function run(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  if (status === "converted" || status === "unqualified") return null;

  const btn =
    "rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {status === "new" && (
        <button className={btn} disabled={isPending} onClick={() => run(() => updateEngagementStatus(engagementId, "contacted"))}>
          Mark contacted
        </button>
      )}
      <button
        className="rounded bg-[var(--dpf-accent)] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        disabled={isPending || !hasAccount}
        title={hasAccount ? "Create the opportunity from this lead" : "Link an account first"}
        onClick={() => run(() => qualifyEngagement(engagementId))}
      >
        Qualify → opportunity
      </button>
      <button className={btn} disabled={isPending} onClick={() => run(() => updateEngagementStatus(engagementId, "unqualified"))}>
        Disqualify
      </button>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}
