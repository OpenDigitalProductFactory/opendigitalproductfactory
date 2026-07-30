import type {
  getAiSpendOverview,
  listAiProviderFinanceProfiles,
} from "@/lib/finance/ai-provider-finance";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { StatCard, StatusBadge } from "@/components/ui/report-kit";
import {
  buildFinanceCoworkerAsks,
  buildTraceabilityPrompt,
  humanizeFinanceLabel,
} from "./aiFinanceCoworkerAsks";
import { AiFinanceCoworkerAskButton } from "./AiFinanceCoworkerAskButton";
import { AiSpendProviderTable, type AiSpendProviderTableRow } from "./AiSpendProviderTable";
import { AiSubscriptionPaymentForm, type AiSubscriptionPaymentProviderOption } from "./AiSubscriptionPaymentForm";

type Overview = Awaited<ReturnType<typeof getAiSpendOverview>>;
type Rows = Awaited<ReturnType<typeof listAiProviderFinanceProfiles>>;

function formatMoney(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatShortDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function humanizeValue(value: string | null | undefined) {
  if (!value) return null;
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function coveredProviderIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function buildRows(rows: Rows, currencySymbol: string): AiSpendProviderTableRow[] {
  return rows.map((row) => {
    const latestContract = row.supplierContracts[0] ?? null;
    const latestSnapshot = latestContract?.usageSnapshots[0] ?? null;
    const committed = Number(latestContract?.monthlyCommittedAmount ?? 0);
    const metered = row.actualSpendMtd.costUsd;
    const latestBill = latestContract?.bills[0] ?? null;
    const latestPayment = latestBill?.allocations[0]?.payment ?? null;
    const latestPaymentDate = formatShortDate(latestPayment?.receivedAt ?? latestBill?.issueDate);
    const latestPaymentAmount = Number(latestPayment?.amount ?? latestBill?.totalAmount ?? 0);
    const coveredCount = coveredProviderIds(latestContract?.coveredProviderIds).length;
    const billingCadence = humanizeValue(latestContract?.billingCadence) ?? "No cadence";
    const billingDay = latestContract?.billingDayOfMonth ? `day ${latestContract.billingDayOfMonth}` : "no day";
    const paymentMethod = humanizeValue(latestContract?.paymentMethod);
    const primaryWorkItem = row.financeWorkItems[0] ?? null;
    const hasPaidEvidence = latestBill?.status === "paid" || latestPayment?.status === "completed";
    const needsSetup = !latestContract || latestContract.status === "draft" || (committed === 0 && !hasPaidEvidence) || row.financeWorkItems.length > 0;
    const financeStatus = needsSetup ? "needs_setup" : "tracked";

    return {
      id: row.id,
      providerId: row.provider.providerId,
      providerName: row.provider.name,
      providerStatus: row.provider.status,
      supplierId: row.supplier?.id ?? null,
      supplierName: row.supplier?.name ?? null,
      financeStatus,
      financeStatusLabel: financeStatus === "tracked" ? "Tracked" : "Needs setup",
      commitmentLabel: committed > 0 ? `${currencySymbol}${formatMoney(committed)}` : "Needs finance input",
      billingLabel: latestContract
        ? [billingCadence, billingDay, paymentMethod].filter(Boolean).join(" · ")
        : "No billing schedule",
      coverageLabel: coveredCount > 1 ? `Covers ${coveredCount} provider rows` : "Single provider",
      latestPaymentLabel: latestBill
        ? [
            latestBill.status === "paid" || latestPayment?.status === "completed" ? "Paid" : humanizeValue(latestBill.status),
            latestPaymentDate,
            latestPaymentAmount > 0 ? `${currencySymbol}${formatMoney(latestPaymentAmount)}` : null,
          ].filter(Boolean).join(" · ")
        : "No bill/payment",
      latestBillId: latestBill?.id ?? null,
      meteredSpendLabel: metered > 0 ? `${currencySymbol}${formatMoney(metered)}` : "No metered spend",
      utilizationLabel: latestSnapshot ? `${latestSnapshot.utilizationPct?.toFixed(1) ?? "0.0"}%` : "No snapshot",
      workItemCount: row.financeWorkItems.length,
      primaryWorkItemType: primaryWorkItem?.type ?? null,
      primaryWorkItemLabel: primaryWorkItem ? humanizeFinanceLabel(primaryWorkItem.type) : "No asks",
    };
  });
}

function buildProviderOptions(rows: Rows): AiSubscriptionPaymentProviderOption[] {
  return rows
    .map((row) => ({
      providerId: row.provider.providerId,
      providerName: row.provider.name,
      supplierName: row.supplier?.name ?? null,
    }))
    .sort((a, b) => a.providerName.localeCompare(b.providerName));
}

export function AiSpendWorkspace({
  overview,
  rows,
  currencySymbol,
}: {
  overview: Overview;
  rows: Rows;
  currencySymbol: string;
}) {
  const tableRows = buildRows(rows, currencySymbol);
  const providerHint = `${overview.untrackedProviderCount} active provider${overview.untrackedProviderCount === 1 ? "" : "s"} need a finance profile`;
  const traceabilityGapCount = overview.dataQualityIssueCount
    ?? overview.untrackedProviderCount + overview.contractsNeedingSetup + overview.openWorkItems;
  const coworkerAsks = buildFinanceCoworkerAsks(rows);
  const visibleAsks = coworkerAsks.slice(0, 4);
  const remainingAskCount = Math.max(overview.openWorkItems - visibleAsks.length, 0);
  const hasTraceabilityGaps = traceabilityGapCount > 0;
  const providerOptions = buildProviderOptions(rows);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="AI finance profiles"
          value={`${overview.supplierCount}/${overview.activeProviderCount}`}
          hint={providerHint}
          intent={overview.untrackedProviderCount > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Committed spend"
          value={`${currencySymbol}${formatMoney(overview.committedSpend)}`}
          hint="Known monthly commitments only"
          intent={overview.contractsNeedingSetup > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Unpriced active providers"
          value={`${overview.untrackedProviderCount}`}
          hint={`${overview.contractsNeedingSetup} need finance setup`}
          intent={overview.untrackedProviderCount > 0 || overview.contractsNeedingSetup > 0 ? "danger" : "success"}
        />
        <StatCard
          label="Employee asks queued"
          value={`${overview.openWorkItems}`}
          hint="Finance Specialist follow-ups"
          intent={overview.openWorkItems > 0 ? "warning" : "success"}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          label="Metered spend MTD"
          value={`${currencySymbol}${formatMoney(overview.actualMeteredSpendUsd)}`}
          hint={`${overview.inferenceCallsThisMonth.toLocaleString()} API calls; subscription plans need contract details`}
          intent={overview.actualMeteredSpendUsd > overview.committedSpend * 0.8 ? "warning" : "neutral"}
        />
        <StatCard
          label="Financial traceability gaps"
          value={`${traceabilityGapCount}`}
          hint="Untracked providers, draft commitments, and open asks"
          intent={traceabilityGapCount > 0 ? "danger" : "success"}
        />
      </div>

      {hasTraceabilityGaps && (
        <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge intent="danger" label="Action needed" />
                <StatusBadge intent="warning" label={`${overview.openWorkItems} queued`} />
              </div>
              <h2 className="mt-3 text-base font-semibold text-[var(--dpf-text)]">
                Finance Specialist needs employee input
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">
                Missing AI provider costs are treated as finance traceability gaps until the coworker can
                retrieve billing details or an employee supplies the exact subscription, renewal, and payment evidence.
              </p>
            </div>
            <AiFinanceCoworkerAskButton
              label="Open triage"
              prompt={buildTraceabilityPrompt(overview, traceabilityGapCount, coworkerAsks.length)}
            />
          </div>

          {visibleAsks.length > 0 ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {visibleAsks.map((ask) => (
                <div
                  key={ask.id}
                  className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge domain="aiFinanceWork" status={ask.type} label={ask.typeLabel} />
                    <StatusBadge domain="severity" status={ask.severity} label={ask.severityLabel} variant="soft" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-[var(--dpf-text)]">{ask.title}</h3>
                  <p className="mt-1 text-xs text-[var(--dpf-muted)]">{ask.providerName}</p>
                  <p className="mt-3 text-sm text-[var(--dpf-text)]">{ask.question}</p>
                  {ask.missingFields.length > 0 ? (
                    <p className="mt-2 text-xs text-[var(--dpf-muted)]">
                      Missing: {ask.missingFields.map(humanizeFinanceLabel).join(", ")}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <AiFinanceCoworkerAskButton prompt={ask.coworkerPrompt} />
                    {ask.routeTarget && ask.routeTarget !== "/finance/spend/ai" ? (
                      <Link
                        href={ask.routeTarget}
                        className="inline-flex items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)]"
                      >
                        <span>Open setup</span>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-4">
              <p className="text-sm font-medium text-[var(--dpf-text)]">
                No provider-specific ask is attached yet.
              </p>
              <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                Finance Specialist should reconcile active AI providers and create exact asks for any cost,
                renewal, billing-source, or browser-profile gaps it cannot close independently.
              </p>
            </div>
          )}

          {remainingAskCount > 0 ? (
            <p className="mt-3 text-xs text-[var(--dpf-muted)]">
              {remainingAskCount} additional finance ask{remainingAskCount === 1 ? "" : "s"} may be attached
              outside the visible AI provider rows.
            </p>
          ) : null}
        </section>
      )}

      <AiSubscriptionPaymentForm providerOptions={providerOptions} />

      <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Utilization and ownership</h2>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Monitor committed spend, latest utilization, and provider contracts that still need finance completion.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <AiSpendProviderTable rows={tableRows} />
        </div>
      </div>
    </div>
  );
}
