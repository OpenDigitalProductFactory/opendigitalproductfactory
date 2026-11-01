"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/use-t";
import { getResponseFeedbackAction, recordResponseFeedbackAction } from "@/lib/actions/response-feedback";
import { useOperationsMapRefresh } from "@/components/platform/operations-map-refresh-context";
import type { ResponseFeedbackState } from "@/lib/routing/response-feedback";

type Notice = "loadingFeedback" | "savingFeedback" | "noFeedbackYet" | "feedbackSaved" | "feedbackCleared" | "feedbackUnavailable" | "feedbackReadError" | "feedbackSaveError" | "feedbackConflict";
const BUTTON = "min-h-11 min-w-11 rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)] aria-disabled:opacity-50 aria-pressed:bg-[var(--dpf-surface-2)]";

/** A display hint avoids reads for unbound history. Every action still authorizes on the server. */
export function ResponseFeedback({ messageId, eligible, initialState }: { messageId: string; eligible: boolean; initialState?: ResponseFeedbackState }) {
  const t = useT("routingManagement");
  const refreshMap = useOperationsMapRefresh();
  const [state, setState] = useState<ResponseFeedbackState | null>(null);
  const [notice, setNotice] = useState<Notice>("loadingFeedback");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const keptRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const current = ++generation.current;
    setState(null); setError(false); setBusy(false); busyRef.current = false;
    if (!eligible) { setNotice("feedbackUnavailable"); return; }
    if (initialState?.messageId === messageId) {
      setState(initialState);
      setNotice(!initialState.available ? "feedbackUnavailable" : initialState.value === null ? "noFeedbackYet" : "feedbackSaved");
      return;
    }
    setNotice("loadingFeedback");
    void getResponseFeedbackAction(messageId).then(result => {
      if (current !== generation.current) return;
      if (!result.ok) { setNotice("feedbackReadError"); setError(true); return; }
      setState(result.data);
      setNotice(!result.data.available ? "feedbackUnavailable" : result.data.value === null ? "noFeedbackYet" : "feedbackSaved");
    }).catch(() => {
      if (current === generation.current) { setNotice("feedbackReadError"); setError(true); }
    });
    return () => { generation.current++; };
  }, [messageId, eligible, initialState]);

  async function checkCurrent() {
    if (busyRef.current) return;
    const current = generation.current;
    busyRef.current = true; setBusy(true); setNotice("loadingFeedback");
    let available = false;
    try {
      const result = await getResponseFeedbackAction(messageId);
      if (current !== generation.current) return;
      if (!result.ok) { setState(null); setNotice("feedbackReadError"); setError(true); return; }
      setState(result.data); available = result.data.available && result.data.canWrite;
      refreshMap();
      setError(false);
      setNotice(!result.data.available ? "feedbackUnavailable" : result.data.value === null ? "noFeedbackYet" : "feedbackSaved");
    } catch {
      if (current === generation.current) { setState(null); setNotice("feedbackReadError"); setError(true); }
    } finally {
      if (current === generation.current) {
        busyRef.current = false; setBusy(false);
        // An explicit recovery may remove its button. Restore to a stable control/status.
        if (available) keptRef.current?.focus(); else statusRef.current?.focus();
      }
    }
  }

  async function save(value: boolean | null) {
    if (busyRef.current || error || !state?.available || !state.canWrite || value === state.value) return;
    const current = generation.current;
    busyRef.current = true; setBusy(true); setNotice("savingFeedback");
    try {
      const result = await recordResponseFeedbackAction({ messageId, value, expectedRevision: state.revision });
      if (current !== generation.current) return;
      if (result.ok) {
        setState(result.data.state); setError(false); setNotice(value === null ? "feedbackCleared" : "feedbackSaved");
        refreshMap();
      } else if (result.error === "conflict") {
        const refreshed = await getResponseFeedbackAction(messageId);
        if (current !== generation.current) return;
        setState(refreshed.ok ? refreshed.data : null);
        setError(true); setNotice("feedbackConflict");
      } else {
        // A failed/unknown mutation is never blindly replayed. The operator reconciles first.
        setError(true); setNotice("feedbackSaveError");
      }
    } catch {
      if (current === generation.current) { setError(true); setNotice("feedbackSaveError"); }
    } finally {
      if (current === generation.current) { busyRef.current = false; setBusy(false); }
    }
  }

  if (!eligible) return <p className="mt-2 text-xs text-[var(--dpf-muted)]">{t("feedbackUnavailable")}</p>;
  const blocked = busy || error || !state?.available || !state.canWrite;
  return <section aria-label={t("responseFeedback")} className="mt-2 max-w-full text-[var(--dpf-text)]" aria-busy={busy}>
    <div className="flex flex-wrap gap-2">
      <button ref={keptRef} data-surface-node-id="feedback.keep" type="button" className={BUTTON} aria-pressed={state?.value === true} aria-disabled={blocked} onClick={() => void save(true)}>{t("kept")}</button>
      <button data-surface-node-id="feedback.revise" type="button" className={BUTTON} aria-pressed={state?.value === false} aria-disabled={blocked} onClick={() => void save(false)}>{t("needsRevision")}</button>
      <button data-surface-node-id="feedback.clear" type="button" className={BUTTON} aria-disabled={blocked || state?.value == null} onClick={() => void save(null)}>{t("clearFeedback")}</button>
      {error && <button data-surface-node-id="feedback.reload" type="button" className={BUTTON} aria-disabled={busy} onClick={() => void checkCurrent()}>{t("checkFeedback")}</button>}
    </div>
    <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" className="mt-1 text-xs text-[var(--dpf-muted)]">{t(notice)}</p>
    {state?.source && <p className="mt-1 text-xs text-[var(--dpf-muted)]">{state.source === "human" ? t("humanFeedback") : t("agentFeedback")}</p>}
  </section>;
}
