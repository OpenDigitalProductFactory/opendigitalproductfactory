"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { Notice } from "@/components/ui/report-kit/Notice";
import { confirmDialog } from "@/components/ui/Dialog";
import { approveCoworkerPermissions, previewCoworkerPermissions } from "@/lib/actions/coworker-grants";
import type { GrantReconciliationPreview } from "@/lib/tak/coworker-grant-reconciliation";
import { useT } from "@/lib/i18n/use-t";

type Source = "canonical" | "alias";

/** An exception review, never a second permissions editor or setup step. */
export function AuthorityReconciliation({ agentId, initialPreview, loadError }: {
  agentId: string;
  initialPreview: GrantReconciliationPreview | null;
  loadError?: string | null;
}) {
  const router = useRouter();
  const t = useT("setup");
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<GrantReconciliationPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, Source>>({});
  const [error, setError] = useState<string | null>(loadError ?? null);
  const [saved, setSaved] = useState(false);
  const [remaining, setRemaining] = useState(initialPreview?.differences.length ?? 0);
  const initialCount = initialPreview?.differences.length ?? 0;
  useEffect(() => {
    setRemaining(initialCount);
    setPreview(null); setChoices({});
    setError(loadError ?? null);
    if (initialCount) setSaved(false);
  }, [initialPreview?.digest, initialCount, loadError]);

  function review() {
    setError(null); setChoices({}); setPreview(null);
    startTransition(async () => {
      try {
        const fresh = await previewCoworkerPermissions(agentId);
        setRemaining(fresh.differences.length);
        setPreview(fresh.differences.length ? fresh : null);
        if (!fresh.differences.length) router.refresh();
      } catch (err) { setError(err instanceof Error ? err.message : t("coworkerPermissions.previewUnavailable")); }
    });
  }
  function chooseAll(source: Source) {
    if (preview) setChoices(Object.fromEntries(preview.differences.map((d) => [d.grantKey, source])));
  }
  async function approve() {
    if (!preview || preview.differences.some((d) => !choices[d.grantKey]) || pending) return;
    // Freeze the displayed snapshot/choices before the dialog. A cancelled
    // confirmation changes nothing; the server rejects changed provenance.
    const input = { coworkerRef: agentId, digest: preview.digest,
      choices: preview.differences.map((d) => ({ grantKey: d.grantKey, source: choices[d.grantKey] })) };
    const approved = await confirmDialog({ title: t("coworkerPermissions.confirmTitle"), tone: "danger",
      message: t("coworkerPermissions.confirmMessage"), confirmLabel: t("coworkerPermissions.approve") });
    if (!approved) return;
    startTransition(async () => {
      try {
        const result = await approveCoworkerPermissions(input);
        if (!result.ok) throw new Error(result.error ?? t("coworkerPermissions.approvalFailed"));
        setError(null); setSaved(true); setPreview(null); setRemaining(0); setChoices({}); router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("coworkerPermissions.approvalFailed"));
        // A rejected snapshot can never be resubmitted blindly.
        setPreview(null); setChoices({});
      }
    });
  }
  if (!remaining && !error && !saved) return null;
  const showReview = remaining > 0 || Boolean(error);
  return <section className="mt-4 space-y-3 text-dpf-body text-dpf-text" aria-label={t("coworkerPermissions.section")}>
    {error && <div role="alert"><Notice variant="error">{error}</Notice></div>}
    {saved && <div role="status"><Notice variant="success">{t("coworkerPermissions.saved")}</Notice></div>}
    {showReview && <Surface padding="sm" className="space-y-3">
      <p className="font-dpf-semibold">{remaining > 0
        ? t("coworkerPermissions.differenceCount", { count: remaining }) : t("coworkerPermissions.previewUnavailable")}</p>
      {remaining > 0 && <p className="text-dpf-muted">{t("coworkerPermissions.conflictSummary")}</p>}
      <Button variant="secondary" onClick={review} disabled={pending}>{t("coworkerPermissions.review")}</Button>
      {preview && <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => chooseAll("canonical")} disabled={pending}>{t("coworkerPermissions.keepAll")}</Button>
          <Button variant="secondary" onClick={() => chooseAll("alias")} disabled={pending}>{t("coworkerPermissions.previousAll")}</Button>
        </div>
        <p role="status" className="text-dpf-muted">{t("coworkerPermissions.selectedCount", {
          selected: preview.differences.filter((d) => choices[d.grantKey]).length, total: preview.differences.length })}</p>
        <details className="space-y-3">
          <summary className="cursor-pointer rounded-dpf-sm py-2 focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)]">{t("coworkerPermissions.individual")}</summary>
          {preview.differences.map((diff) => <label key={diff.grantKey} className="flex flex-wrap items-center justify-between gap-2 border-t border-dpf-border py-3">
            <span className="break-all">{diff.grantKey.replaceAll("_", " ")}</span>
            <select aria-label={t("coworkerPermissions.sourceLabel", { grantKey: diff.grantKey })} value={choices[diff.grantKey] ?? ""}
              disabled={pending} onChange={(event) => setChoices({ ...choices, [diff.grantKey]: event.target.value as Source })}
              className="max-w-full rounded-dpf-md border border-dpf-border bg-dpf-surface-2 p-2 text-dpf-text focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)]">
              <option value="">{t("coworkerPermissions.chooseState")}</option>
              <option value="canonical">{t("coworkerPermissions.currentState", { state: t(`coworkerPermissions.${diff.canonical}`) })}</option>
              <option value="alias">{t("coworkerPermissions.legacyState", { state: t(`coworkerPermissions.${diff.alias}`) })}</option>
            </select>
          </label>)}
        </details>
        <Button onClick={approve} disabled={pending || preview.differences.some((diff) => !choices[diff.grantKey])}>{t("coworkerPermissions.approve")}</Button>
      </div>}
    </Surface>}
  </section>;
}
