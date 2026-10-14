"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/form/SelectField";
import { TextField } from "@/components/ui/form/TextField";
import { Notice, StatusBadge } from "@/components/ui/report-kit";
import { useT } from "@/lib/i18n/use-t";
import { saveInvestmentBalanceAction, bindInstallationInvestmentAction } from "@/lib/actions/portfolio-budget";
import type { OwnerInvestmentView } from "@/lib/portfolio/investment-balance-server";

export function InvestmentBalance({ views, canManage, formatLocale, nextHref, firstHref }: { views: OwnerInvestmentView[]; canManage: boolean; formatLocale?: string; nextHref?: string; firstHref?: string }) {
  const t = useT("portfolio");
  return <section id="investment-balance" className="mt-6 space-y-4" aria-labelledby="investment-balance-heading">
    <h3 id="investment-balance-heading" className="text-dpf-title font-dpf-semibold">{t("investment.heading")}</h3>
    <p className="text-dpf-body text-dpf-muted">{t("investment.intro")}</p>
    {views.length === 0 ? <p className="text-dpf-body text-dpf-muted">{t("investment.empty")}</p> : null}
    {views.map((view) => <ScopeBalance key={`${view.scope.organizationId}:${view.scope.purpose}:${view.report.ok ? view.report.data.revision?.revision ?? "default" : "unavailable"}`} view={view} canManage={canManage} formatLocale={formatLocale} />)}
    {nextHref || firstHref ? <nav aria-label={t("investment.pagination")} className="flex flex-wrap gap-4 text-dpf-body text-dpf-accent">
      {firstHref ? <Link href={firstHref} className="py-3 underline">{t("investment.first")}</Link> : null}
      {nextHref ? <Link href={nextHref} className="py-3 underline">{t("investment.more")}</Link> : null}
    </nav> : null}
  </section>;
}

function ScopeBalance({ view, canManage, formatLocale }: { view: OwnerInvestmentView; canManage: boolean; formatLocale?: string }) {
  const router = useRouter();
  const t = useT("portfolio");
  const report = view.report.ok ? view.report.data : null;
  const [refactorPercent, setRefactor] = useState(String(report?.policy.refactorPercent ?? 20));
  const [windowDays, setWindow] = useState(String(report?.policy.windowDays ?? 42));
  const [steering, setSteering] = useState(report?.policy.steeringEnabled ?? false);
  const [reason, setReason] = useState("");
  const [bindingReason, setBindingReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const purpose = t(view.scope.purpose === "shared-platform" ? "investment.shared" : "investment.archetype");
  if (!report) return <Notice variant="warn" title={`${view.organizationName} · ${purpose}`}>{t("investment.unavailable")}</Notice>;
  const measured = report.observation;
  const number = new Intl.NumberFormat(formatLocale);
  const priorities = [{ value: "80", label: t("investment.strengthen") }, { value: "50", label: t("investment.balance") }, { value: "20", label: t("investment.expand") }];
  if (!priorities.some((option) => option.value === String(report.policy.refactorPercent))) priorities.push({ value: String(report.policy.refactorPercent), label: t("investment.currentTarget", { percent: report.policy.refactorPercent }) });
  const windows = [{ value: "42", label: t("investment.sixWeeks") }, { value: "28", label: t("investment.fourWeeks") }, { value: "90", label: t("investment.threeMonths") }];
  if (!windows.some((option) => option.value === String(report.policy.windowDays))) windows.push({ value: String(report.policy.windowDays), label: t("investment.currentWindow", { days: report.policy.windowDays }) });
  const binding = report.installationBinding;
  const boundHere = binding?.scope.principalId === view.scope.principalId;
  function run(change: () => Promise<{ ok: boolean; data?: string; error?: string }>) {
    setError(null); setMessage(null);
    startTransition(async () => {
      try {
        const result = await change();
        if (!result.ok) { setError(result.error ?? t("investment.saveFailed")); return; }
        setMessage(result.data ?? t("investment.saved")); router.refresh();
      } catch { setError(t("investment.saveFailed")); }
    });
  }
  return <div className="border-t border-dpf-border pt-4">
    <h4 className="text-dpf-body-lg font-dpf-semibold">{view.organizationName} · {purpose}</h4>
    <p className="text-dpf-body text-dpf-muted">{t(report.source === "default" ? report.ownerKind === "founder" ? "investment.founderDefault" : "investment.organizationDefault" : "investment.ownerSet")}</p>
    {!report.policyActive ? <p role="status" className="text-dpf-body text-[var(--dpf-warning)]">{t("investment.inactive")}</p> : null}
    <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 text-dpf-body">
      <div><dt className="text-dpf-muted">{t("investment.target")}</dt><dd className="font-dpf-semibold">{t("investment.targetMix", { repair: report.policy.refactorPercent, newWork: 100 - report.policy.refactorPercent })}</dd></div>
      <div><dt className="text-dpf-muted">{t("investment.observed", { days: report.policy.windowDays })}</dt><dd>{measured.actualRefactorPercent === null ? t("investment.notMeasured") : t("investment.measured", { repair: Math.round(measured.actualRefactorPercent), tokens: number.format(measured.knownTokens) })}</dd></div>
    </dl>
    <p className="mt-2 text-dpf-caption text-dpf-muted">{t("investment.coverage", { known: number.format(measured.knownAttempts), classified: measured.classificationPercent === null ? t("investment.classificationUnknown") : t("investment.classified", { percent: Math.round(measured.classificationPercent) }), unknown: number.format(measured.unknownAttempts) })}</p>
    <p className="mt-2 text-dpf-caption text-dpf-muted">{t(report.attributionGap.level === "installation" ? "investment.gapInstallation" : "investment.gapOrganization", { count: number.format(report.attributionGap.unassignedAttempts) })} {t("investment.gapExplanation")}</p>
    <p className="mt-2 text-dpf-body text-dpf-muted">{t(!report.policyActive || !report.policy.steeringEnabled ? "investment.preferenceOff" : measured.suppression ? "investment.preferenceWaiting" : measured.preferred ? measured.preferred === "refactor" ? "investment.preferRepair" : "investment.preferNew" : "investment.withinTolerance")}</p>
    <details className="mt-2"><summary className="cursor-pointer py-3 text-dpf-body text-dpf-accent">{t("investment.details")}</summary>
      <p className="break-words text-dpf-caption text-dpf-muted">{report.revision ? t("investment.revision", { revision: report.revision.revision, effective: report.revision.effectiveAt, expiry: report.revision.expiresAt ? t("investment.expires", { when: report.revision.expiresAt }) : t("investment.noExpiry"), reason: report.revision.reason }) : t("investment.defaultDetails")}</p>
    </details>
    {canManage ? <>
      <details className="mt-2"><summary className="cursor-pointer py-3 text-dpf-body text-dpf-accent">{t("investment.adjust")}</summary>
        <form className="max-w-lg space-y-4" onSubmit={(event) => { event.preventDefault(); run(() => saveInvestmentBalanceAction({ scope: view.scope, expectedRevision: report.revision?.revision ?? null, reason, policy: { ...report.policy, refactorPercent: Number(refactorPercent), windowDays: Number(windowDays), freshnessDays: Math.min(report.policy.freshnessDays, Number(windowDays)), steeringEnabled: steering } })); }}>
          <SelectField name={`priority-${view.scope.organizationId}-${view.scope.purpose}`} label={t("investment.priority")} value={refactorPercent} onValueChange={setRefactor} options={priorities} disabled={pending} />
          <SelectField name={`window-${view.scope.organizationId}-${view.scope.purpose}`} label={t("investment.reviewWindow")} value={windowDays} onValueChange={setWindow} options={windows} disabled={pending} />
          <label className="flex items-start gap-2 text-dpf-body"><input type="checkbox" className="mt-1" checked={steering} onChange={(event) => setSteering(event.target.checked)} disabled={pending} />{t("investment.steering")}</label>
          <TextField name={`reason-${view.scope.organizationId}-${view.scope.purpose}`} label={t("investment.reason")} value={reason} onValueChange={setReason} required disabled={pending} />
          <Button type="submit" disabled={pending || !reason.trim()}>{t(pending ? "investment.saving" : report.policyActive ? "investment.save" : "investment.renew")}</Button>
        </form>
      </details>
      <details className="mt-2"><summary className="cursor-pointer py-3 text-dpf-body text-dpf-accent">{t("investment.installationFunding")}</summary>
        <p className="text-dpf-body text-dpf-muted">{t("investment.installationExplanation")}</p>
        {boundHere ? <StatusBadge intent="neutral" label={t("investment.bound")} size="md" /> : binding && !report.canSucceedBinding ? <p className="text-dpf-body">{t("investment.anotherOwner")}</p> : <form className="mt-3 max-w-lg space-y-3" onSubmit={(event) => { event.preventDefault(); run(() => bindInstallationInvestmentAction({ scope: view.scope, expectedBoundAt: binding?.boundAt ?? null, reason: bindingReason })); }}>
          {report.canSucceedBinding ? <p className="text-dpf-body">{t("investment.successor")}</p> : null}
          <TextField name={`binding-reason-${view.scope.organizationId}-${view.scope.purpose}`} label={t("investment.fundingReason")} value={bindingReason} onValueChange={setBindingReason} required disabled={pending} />
          <Button type="submit" disabled={pending || !bindingReason.trim() || !report.policyActive}>{t(pending ? "investment.saving" : "investment.useScope")}</Button>
        </form>}
      </details>
    </> : null}
    {pending ? <p role="status" className="text-dpf-body text-dpf-muted">{t("investment.savingStatus")}</p> : null}
    {message ? <p role="status" className="mt-2 text-dpf-body">{message}</p> : null}
    {error ? <p role="alert" className="mt-2 text-dpf-body text-[var(--dpf-error)]">{error}</p> : null}
  </div>;
}
