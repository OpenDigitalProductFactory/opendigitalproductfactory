"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/form/SelectField";
import { TextField } from "@/components/ui/form/TextField";
import { Notice, StatusBadge } from "@/components/ui/report-kit";
import { saveInvestmentBalanceAction, bindInstallationInvestmentAction } from "@/lib/actions/portfolio-budget";
import type { OwnerInvestmentView } from "@/lib/portfolio/investment-balance-server";

export function InvestmentBalance({ views, canManage, formatLocale }: { views: OwnerInvestmentView[]; canManage: boolean; formatLocale?: string }) {
  return <section id="investment-balance" className="mt-6 space-y-4" aria-labelledby="investment-balance-heading">
    <h3 id="investment-balance-heading" className="text-dpf-title font-dpf-semibold">Investment balance</h3>
    <p className="text-dpf-body text-dpf-muted">Direction over time for the work you fund. Bug fixes normally count as repair.</p>
    {views.length === 0 ? <p className="text-dpf-body text-dpf-muted">No funding scope is assigned to you. The recorded budget owner can set the allocation.</p> : null}
    {views.map((view) => <ScopeBalance key={`${view.scope.organizationId}:${view.scope.purpose}`} view={view} canManage={canManage} formatLocale={formatLocale} />)}
  </section>;
}

function ScopeBalance({ view, canManage, formatLocale }: { view: OwnerInvestmentView; canManage: boolean; formatLocale?: string }) {
  const router = useRouter();
  const report = view.report.ok ? view.report.data : null;
  const [refactorPercent, setRefactor] = useState(String(report?.policy.refactorPercent ?? 20));
  const [windowDays, setWindow] = useState(String(report?.policy.windowDays ?? 42));
  const [steering, setSteering] = useState(report?.policy.steeringEnabled ?? false);
  const [reason, setReason] = useState("");
  const [bindingReason, setBindingReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const purpose = view.scope.purpose === "shared-platform" ? "Shared platform" : "Archetype work";
  if (!report) return <Notice variant="warn" title={`${view.organizationName} · ${purpose}`}>
    Allocation is unavailable. Recorded ownership or policy needs review before work can use this budget.
  </Notice>;
  const measured = report.observation;
  const number = new Intl.NumberFormat(formatLocale);
  const priorities = [{ value: "80", label: "Strengthen existing work · 80% repair" }, { value: "50", label: "Balance repair and new work · 50% repair" }, { value: "20", label: "Expand capability · 20% repair" }];
  if (!priorities.some((option) => option.value === String(report.policy.refactorPercent))) priorities.push({ value: String(report.policy.refactorPercent), label: `Current target · ${report.policy.refactorPercent}% repair` });
  const windows = [{ value: "42", label: "Six weeks" }, { value: "28", label: "Four weeks" }, { value: "90", label: "Three months" }];
  if (!windows.some((option) => option.value === String(report.policy.windowDays))) windows.push({ value: String(report.policy.windowDays), label: `Current window · ${report.policy.windowDays} days` });
  const binding = report.installationBinding;
  const boundHere = binding?.scope.principalId === view.scope.principalId;
  function run(change: () => Promise<{ ok: boolean; data?: string; error?: string }>) {
    setError(null); setMessage(null);
    startTransition(async () => {
      try {
        const result = await change();
        if (!result.ok) { setError(result.error ?? "The change could not be saved."); return; }
        setMessage(result.data ?? "Saved."); router.refresh();
      } catch { setError("The change could not be saved. Reload to check its current state before retrying."); }
    });
  }
  return <div className="border-t border-dpf-border pt-4">
    <h4 className="text-dpf-body-lg font-dpf-semibold">{view.organizationName} · {purpose}</h4>
    <p className="text-dpf-body text-dpf-muted">{report.source === "default" ? `${report.ownerKind === "founder" ? "Founder" : "Organization"} default` : "Owner-set allocation"}</p>
    {!report.policyActive ? <p role="status" className="text-dpf-body text-[var(--dpf-warning)]">This allocation has expired or is not yet active. Save a renewed allocation to use it for future work.</p> : null}
    <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 text-dpf-body">
      <div><dt className="text-dpf-muted">Target</dt><dd className="font-dpf-semibold">{`${report.policy.refactorPercent}% repair / ${100 - report.policy.refactorPercent}% new`}</dd></div>
      <div><dt className="text-dpf-muted">Observed · {report.policy.windowDays} days</dt><dd>{measured.actualRefactorPercent === null ? "Not measured yet" : `${Math.round(measured.actualRefactorPercent)}% repair among classified tokens · ${number.format(measured.knownTokens)} known tokens`}</dd></div>
    </dl>
    <p className="mt-2 text-dpf-caption text-dpf-muted">{number.format(measured.knownAttempts)} measured attempts · {measured.classificationPercent === null ? "Classification not measured" : `${Math.round(measured.classificationPercent)}% classified`} · {number.format(measured.unknownAttempts)} attempts with unknown usage. External agent spending is unobserved.</p>
    <p className="mt-2 text-dpf-body text-dpf-muted">{!report.policyActive || !report.policy.steeringEnabled ? "Automatic preference is off." : measured.suppression ? "Automatic preference is waiting for sufficient, recent coverage." : measured.preferred ? `Prefer ${measured.preferred === "refactor" ? "repair" : "new work"} within this funding scope.` : "The measured balance is within tolerance."}</p>
    <details className="mt-2"><summary className="cursor-pointer py-2 text-dpf-body text-dpf-accent">Policy details</summary>
      <p className="break-words text-dpf-caption text-dpf-muted">{report.revision ? `Revision ${report.revision.revision}. Effective ${report.revision.effectiveAt}. ${report.revision.expiresAt ? `Expires ${report.revision.expiresAt}.` : "No expiry."} Reason: ${report.revision.reason}` : "Versioned default: development-investment.default.v1. No owner override is recorded."}</p>
    </details>
    {canManage ? <>
      <details className="mt-2"><summary className="cursor-pointer py-2 text-dpf-body text-dpf-accent">Adjust allocation</summary>
        <form className="max-w-lg space-y-4" onSubmit={(event) => { event.preventDefault(); run(() => saveInvestmentBalanceAction({ scope: view.scope, expectedRevision: report.revision?.revision ?? null, reason, policy: { ...report.policy, refactorPercent: Number(refactorPercent), windowDays: Number(windowDays), freshnessDays: Math.min(report.policy.freshnessDays, Number(windowDays)), steeringEnabled: steering } })); }}>
          <SelectField name={`priority-${view.scope.organizationId}-${view.scope.purpose}`} label="Priority" value={refactorPercent} onValueChange={setRefactor} options={priorities} disabled={pending} />
          <SelectField name={`window-${view.scope.organizationId}-${view.scope.purpose}`} label="Review window" value={windowDays} onValueChange={setWindow} options={windows} disabled={pending} />
          <label className="flex items-start gap-2 text-dpf-body"><input type="checkbox" className="mt-1" checked={steering} onChange={(event) => setSteering(event.target.checked)} disabled={pending} />Prefer underfunded work when coverage is sufficient</label>
          <TextField name={`reason-${view.scope.organizationId}-${view.scope.purpose}`} label="Reason" value={reason} onValueChange={setReason} required disabled={pending} />
          <Button type="submit" disabled={pending || !reason.trim()}>{pending ? "Saving…" : report.policyActive ? "Save allocation" : "Renew allocation"}</Button>
        </form>
      </details>
      <details className="mt-2"><summary className="cursor-pointer py-2 text-dpf-body text-dpf-accent">Installation funding</summary>
        <p className="text-dpf-body text-dpf-muted">Use this scope for matching work without room or portfolio funding on this installation. Other installations keep their own bindings.</p>
        {boundHere ? <StatusBadge intent="neutral" label="Bound to this scope" size="md" /> : binding && !report.canSucceedBinding ? <p className="text-dpf-body">Another owner funds this work. Ownership must be resolved before rebinding.</p> : <form className="mt-3 max-w-lg space-y-3" onSubmit={(event) => { event.preventDefault(); run(() => bindInstallationInvestmentAction({ scope: view.scope, expectedBoundAt: binding?.boundAt ?? null, reason: bindingReason })); }}>
          {report.canSucceedBinding ? <p className="text-dpf-body">Recorded ownership has changed. Confirm the successor funding scope; historical spending stays with its original owner.</p> : null}
          <TextField name={`binding-reason-${view.scope.organizationId}-${view.scope.purpose}`} label="Funding reason" value={bindingReason} onValueChange={setBindingReason} required disabled={pending} />
          <Button type="submit" disabled={pending || !bindingReason.trim() || !report.policyActive}>{pending ? "Saving…" : "Use this funding scope"}</Button>
        </form>}
      </details>
    </> : null}
    {pending ? <p role="status" className="text-dpf-body text-dpf-muted">Saving allocation…</p> : null}
    {message ? <p role="status" className="mt-2 text-dpf-body">{message}</p> : null}
    {error ? <p role="alert" className="mt-2 text-dpf-body text-[var(--dpf-error)]">{error}</p> : null}
  </div>;
}
