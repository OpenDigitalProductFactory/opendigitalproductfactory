"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SOURCE_CATALOG } from "@dpf/i18n";

import { reviewProviderComplianceEvidence } from "@/lib/actions/provider-compliance-evidence-review";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";

const COPY = SOURCE_CATALOG.approvals.complianceEvidence;

export function ComplianceEvidenceReviewActions({
  evidence,
}: {
  evidence: { sourceKey: string; url: string; claims: Array<{ claimId: string; summary: string }> };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function review(decision: "confirmed" | "changed") {
    startTransition(async () => {
      const result = await reviewProviderComplianceEvidence({ sourceKey: evidence.sourceKey, decision });
      setMessage(result.ok ? result.data.message : result.error);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="w-full space-y-3">
      <Surface padding="sm" rounded="md">
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-[var(--dpf-text)]">
            {COPY.reviewClaims}
          </summary>
          <ul className="mt-2 space-y-2 text-xs leading-relaxed text-[var(--dpf-muted)]">
            {evidence.claims.map((claim) => <li key={claim.claimId}>{claim.summary}</li>)}
          </ul>
          <a
            href={evidence.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex text-xs font-semibold text-[var(--dpf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            {COPY.openSource}
          </a>
        </details>
      </Surface>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => review("confirmed")}
          className="min-h-9"
        >
          {COPY.confirm}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => review("changed")}
          className="min-h-9"
        >
          {COPY.flagChanged}
        </Button>
      </div>
      {message ? <p role="status" className="text-xs text-[var(--dpf-muted)]">{message}</p> : null}
    </div>
  );
}
