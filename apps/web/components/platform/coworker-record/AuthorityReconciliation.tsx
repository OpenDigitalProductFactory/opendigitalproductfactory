"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { Notice } from "@/components/ui/report-kit/Notice";
import { confirmDialog } from "@/components/ui/Dialog";
import { approveCoworkerPermissions, previewCoworkerPermissions } from "@/lib/actions/coworker-grants";
import type { GrantReconciliationPreview } from "@/lib/tak/coworker-grant-reconciliation";
import { useT } from "@/lib/i18n/use-t";

export function AuthorityReconciliation({ agentId }: { agentId: string }) {
  const router = useRouter();
  const t = useT("setup");
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<GrantReconciliationPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, "canonical" | "alias">>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  function review() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try { setPreview(await previewCoworkerPermissions(agentId)); setChoices({}); }
      catch (err) { setError(err instanceof Error ? err.message : t("coworkerPermissions.previewUnavailable")); }
    });
  }
  async function approve() {
    if (!preview) return;
    const approved = await confirmDialog({ title: t("coworkerPermissions.confirmTitle"), tone: "danger",
      message: t("coworkerPermissions.confirmMessage"), confirmLabel: t("coworkerPermissions.approve") });
    if (!approved) return;
    startTransition(async () => {
      const result = await approveCoworkerPermissions({ coworkerRef: agentId, digest: preview.digest,
        choices: preview.differences.map((diff) => ({ grantKey: diff.grantKey, source: choices[diff.grantKey] })) });
      if (!result.ok) { setError(result.error ?? t("coworkerPermissions.approvalFailed")); return; }
      setError(null); setSaved(true); setPreview(null); router.refresh();
    });
  }
  return <section className="mt-3 space-y-3 text-sm text-[var(--dpf-text)]" aria-label={t("coworkerPermissions.section")}>
    <p className="text-[var(--dpf-muted)]">{t("coworkerPermissions.summary", { agentId })}</p>
    <Button size="sm" variant="secondary" onClick={review} disabled={pending}>{t("coworkerPermissions.review")}</Button>
    {error && <div role="alert"><Notice variant="error">{error}</Notice></div>}
    {saved && <div role="status"><Notice variant="success">{t("coworkerPermissions.saved")}</Notice></div>}
    {preview && <Surface padding="sm" className="space-y-3">
      <p>{t("coworkerPermissions.legacy", { agentId: preview.aliasAgentId ?? t("coworkerPermissions.none") })}</p>
      {preview.differences.length === 0 ? <p>{t("coworkerPermissions.noDifferences")}</p> : <>
        <p>{t("coworkerPermissions.chooseEach")}</p>
        {preview.differences.map((diff) => <label key={diff.grantKey} className="flex flex-wrap items-center justify-between gap-2">
          <span>{diff.grantKey}</span>
          <select aria-label={t("coworkerPermissions.sourceLabel", { grantKey: diff.grantKey })} value={choices[diff.grantKey] ?? ""}
            disabled={pending} onChange={(event) => setChoices({ ...choices, [diff.grantKey]: event.target.value as "canonical" | "alias" })}
            className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-[var(--dpf-text)]">
            <option value="">{t("coworkerPermissions.chooseState")}</option>
            <option value="canonical">{t("coworkerPermissions.currentState", { state: t(`coworkerPermissions.${diff.canonical}`) })}</option>
            <option value="alias">{t("coworkerPermissions.legacyState", { state: t(`coworkerPermissions.${diff.alias}`) })}</option>
          </select>
        </label>)}
        <Button size="sm" onClick={approve} disabled={pending || preview.differences.some((diff) => !choices[diff.grantKey])}>{t("coworkerPermissions.approve")}</Button>
      </>}
    </Surface>}
  </section>;
}
