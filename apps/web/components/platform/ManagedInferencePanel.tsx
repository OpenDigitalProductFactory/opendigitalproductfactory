"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/report-kit";
import { confirmDialog } from "@/components/ui/Dialog";
import { requestManagedInferenceTransition, type ManagedInferencePublicOffer } from "@/lib/actions/managed-inference";
import { createManagedInferenceRequestId, parseManagedInferenceRequestId, type ManagedInferenceRequestObservation } from "@/lib/remote-action/managed-inference-request";
import { isRecord } from "@/lib/shared/coerce";

const pendingKey = "dpf:managed-inference:pending";
export function ManagedInferencePanel({ offer, copy, initialRequestId = null }: { offer: ManagedInferencePublicOffer; copy: Record<string, string>; initialRequestId?: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [queued, setQueued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originalRequestId, setOriginalRequestId] = useState<string | null>(initialRequestId);
  const [observation, setObservation] = useState<string | null>(null);
  useEffect(() => {
    try { const saved = localStorage.getItem(pendingKey); if (!initialRequestId && saved) setOriginalRequestId(saved); }
    catch { setOriginalRequestId("unavailable"); setError(copy.managedEngineSavedUnreadable); }
  }, [initialRequestId]);
  async function checkOriginal() {
    if (!originalRequestId) { router.refresh(); return; }
    if (!parseManagedInferenceRequestId(originalRequestId)) { setError(copy.managedEngineReconcile); return; }
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/platform/managed-inference?requestId=${encodeURIComponent(originalRequestId)}`, { cache: "no-store" });
        const body: unknown = await response.json();
        const value = isRecord(body) && isRecord(body.observation) ? body.observation : null;
        if (!response.ok || !value || value.requestId !== originalRequestId || typeof value.canSubmitNewRequest !== "boolean" || typeof value.message !== "string") throw new Error("unconfirmed");
        const current = value as unknown as ManagedInferenceRequestObservation;
        setObservation(current.message);
        if (current.canSubmitNewRequest) {
          if (localStorage.getItem(pendingKey) === originalRequestId) localStorage.removeItem(pendingKey);
          const remaining = localStorage.getItem(pendingKey);
          setOriginalRequestId(remaining); setQueued(null); router.refresh();
        }
      } catch { setError(copy.managedEngineUnconfirmed); }
    });
  }
  async function changeEngine() {
    if (!offer.available || pending || originalRequestId) return;
    try { const saved = localStorage.getItem(pendingKey); if (saved) { setOriginalRequestId(saved); return; } }
    catch { setError(copy.managedEngineDurableRequired); return; }
    const confirmed = await confirmDialog({
      title: offer.operation === "activate" ? copy.managedEngineConfirmActivate : copy.managedEngineConfirmRollback,
      message: offer.impact, confirmLabel: copy.managedEngineConfirm, tone: "danger",
    });
    if (!confirmed) return;
    let requestId: string;
    try {
      const saved = localStorage.getItem(pendingKey);
      if (saved) { setOriginalRequestId(saved); return; }
      requestId = createManagedInferenceRequestId();
      localStorage.setItem(pendingKey, requestId);
      if (localStorage.getItem(pendingKey) !== requestId) throw new Error("request ownership changed");
    } catch { setError(copy.managedEngineSaveFailed); return; }
    setOriginalRequestId(requestId);
    setError(null);
    startTransition(async () => {
      try {
        const result = await requestManagedInferenceTransition({ requestId, operation: offer.operation, offerToken: offer.token,
          operatorConfirmed: true, allowNodeAction: offer.needsNodeGrant });
        if (result.ok) setQueued(result.data.rfcId); else setError(result.error);
      } catch { setError(copy.managedEngineResponseLost); }
    });
  }
  return <section aria-label={copy.managedEngineTitle} className="my-3">
    <Notice title={copy.managedEngineTitle}>
      <div>
        <p>{offer.available ? offer.operation === "activate"
          ? copy.managedEngineReady
          : copy.managedEngineSelected
          : offer.message}</p>
        {error && <p role="alert" className="mt-2 text-[var(--dpf-error)]">{error}</p>}
        {queued && <p role="status" className="mt-2">{copy.managedEngineQueued} {queued}</p>}
        {observation && <p role="status" className="mt-2">{observation}</p>}
        {originalRequestId && !queued && !observation && <p role="status" className="mt-2">{copy.managedEngineRetained}</p>}
        <div className="mt-2 flex gap-2">
          {offer.available && !queued && !originalRequestId && <Button size="sm" disabled={pending} onClick={changeEngine}>
            {pending ? copy.managedEnginePreparing : offer.operation === "activate" ? copy.managedEngineUse : copy.managedEngineRestore}
          </Button>}
          <Button variant="secondary" size="sm" disabled={pending} onClick={checkOriginal}>{originalRequestId ? copy.managedEngineCheckOriginal : copy.managedEngineRefresh}</Button>
        </div>
      </div>
    </Notice>
  </section>;
}
