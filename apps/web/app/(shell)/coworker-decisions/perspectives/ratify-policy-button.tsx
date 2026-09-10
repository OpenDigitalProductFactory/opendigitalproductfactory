"use client";

// One-time ratification of a scope-owning policy version (BI-9C384562).
// Until a human ratifies the platform or organization perspective, the
// exact-bound authority projector cannot root any WWMD "yes" and every routine
// reviewer receipt falls to a per-action approval card. This is the single act
// that replaces those cards. Composed from ui/Button (BI-D25ED55D).

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";

import { ratifyPolicyVersion, type RatifyPolicyVersionResult } from "@/lib/actions/decision-perspective-ratify";

export const RATIFY_COPY = {
  action: "Ratify",
  pending: "Ratifying…",
  why: "Ratifying once lets your AI act on this policy's own high-confidence answers without asking you each time.",
  ratified: "Ratified",
} as const;

export function RatifyPolicyButton({ profileId }: { profileId: string }) {
  const [result, setResult] = useState<RatifyPolicyVersionResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    return <span className="text-xs text-[var(--dpf-success)]">✓ {RATIFY_COPY.ratified}</span>;
  }
  return (
    <span className="flex items-center gap-2">
      {result && !result.ok ? (
        <span className="text-xs text-[var(--dpf-danger)]">{result.error}</span>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        title={RATIFY_COPY.why}
        onClick={() => {
          if (pending) return;
          startTransition(async () => {
            setResult(await ratifyPolicyVersion({ profileId }));
          });
        }}
      >
        {pending ? RATIFY_COPY.pending : RATIFY_COPY.action}
      </Button>
    </span>
  );
}
