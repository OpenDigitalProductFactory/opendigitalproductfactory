"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/report-kit";
import { confirmDialog } from "@/components/ui/Dialog";
import { requestManagedInferenceTransition, type ManagedInferencePublicOffer } from "@/lib/actions/managed-inference";

export function ManagedInferencePanel({ offer }: { offer: ManagedInferencePublicOffer }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [queued, setQueued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function changeEngine() {
    if (!offer.available || pending) return;
    const confirmed = await confirmDialog({
      title: offer.operation === "activate" ? "Use the tested engine?" : "Restore Docker?",
      message: offer.impact, confirmLabel: "Confirm change", tone: "danger",
    });
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await requestManagedInferenceTransition({ operation: offer.operation, offerToken: offer.token,
          operatorConfirmed: true, allowNodeAction: offer.needsNodeGrant });
        if (result.ok) setQueued(result.data.rfcId); else setError(result.error);
      } catch { setError("The request outcome could not be confirmed. Refresh its status before trying another change."); }
    });
  }
  return <section aria-label="Local inference engine" className="my-3">
    <Notice title="Local inference engine">
      <div>
        <p>{offer.available ? offer.operation === "activate"
          ? "A tested engine is ready for this Mac. The current models and settings are preserved."
          : "The managed engine is selected. Performance verification is reported separately."
          : offer.message}</p>
        {error && <p role="alert" className="mt-2 text-[var(--dpf-error)]">{error}</p>}
        {queued && <p role="status" className="mt-2">Queued as change {queued}. The host must complete and verify the switch.</p>}
        <div className="mt-2 flex gap-2">
          {offer.available && !queued && <Button size="sm" disabled={pending} onClick={changeEngine}>
            {pending ? "Preparing change…" : offer.operation === "activate" ? "Use tested engine" : "Restore Docker"}
          </Button>}
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => router.refresh()}>Refresh status</Button>
        </div>
      </div>
    </Notice>
  </section>;
}
