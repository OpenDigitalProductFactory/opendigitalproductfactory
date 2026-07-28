import Link from "next/link";
import { Notice, StatCard } from "@/components/ui/report-kit";
import type { ProductOperatingContext } from "@/lib/product-management/product-operating-context";
import type { ProductDirectionView } from "@/lib/product-management/product-direction-view";
import { CurrentBets } from "./CurrentBets";
import { EvidenceDeltaList } from "./EvidenceDeltaList";
import { NeedsDecisionList } from "./NeedsDecisionList";
import { NextCoworkerRuns } from "./NextCoworkerRuns";
import { OutcomePosture } from "./OutcomePosture";
import { ProductContextActionPreview } from "./ProductContextActionPreview";

function section(
  view: ProductDirectionView,
  kind: ProductDirectionView["sections"][number]["kind"],
) {
  return view.sections.find((candidate) => candidate.kind === kind)!;
}

function formatMoney(value: number, currency: string | null): string {
  if (!currency) return "Mixed currencies";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function ProductDirectionBrief({
  context,
  view,
  showLead = true,
}: {
  context: ProductOperatingContext;
  view: ProductDirectionView;
  showLead?: boolean;
}) {
  const hasCommercialEvidence =
    context.commercialPerformance.saleCount > 0 ||
    context.offerings.items.length > 0 ||
    context.consumers.items.length > 0;
  const sourceKinds = Array.from(
    new Set(
      view.sections.flatMap((candidate) =>
        candidate.items.map((item) => item.sourceKind),
      ),
    ),
  );

  return (
    <div className="space-y-dpf-lg">
      <div
        data-dpf-lead={showLead ? true : undefined}
        className="flex flex-col gap-dpf-md sm:flex-row sm:items-start sm:justify-between"
      >
        <p className="max-w-prose text-dpf-body-lg text-[var(--dpf-muted)]">
          {view.introduction}
        </p>
        <Link
          href={view.primaryAction.href}
          data-dpf-primary-action
          className="shrink-0 rounded-dpf-md bg-[var(--dpf-accent)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-surface-1)]"
        >
          {view.primaryAction.label}
        </Link>
      </div>

      <NeedsDecisionList
        section={section(view, "needs-decision")}
        previewCount={view.evidencePreviewCount}
      />
      <EvidenceDeltaList
        section={section(view, "evidence-delta")}
        previewCount={view.evidencePreviewCount}
      />
      <CurrentBets
        section={section(view, "current-bets")}
        previewCount={view.evidencePreviewCount}
      />
      <OutcomePosture
        section={section(view, "outcome-posture")}
        previewCount={view.evidencePreviewCount}
      />
      <NextCoworkerRuns
        section={section(view, "next-coworker-runs")}
        previewCount={view.evidencePreviewCount}
      />

      <section aria-labelledby="direction-commercial-signals">
        <h2
          id="direction-commercial-signals"
          className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
        >
          Commercial and consumption signals
        </h2>
        {hasCommercialEvidence ? (
          <div className="mt-dpf-md grid gap-dpf-md sm:grid-cols-2 xl:grid-cols-4">
            {context.commercialPerformance.saleCount > 0 ? (
              <>
                <StatCard
                  label="Recorded sales"
                  value={context.commercialPerformance.saleCount}
                  hint="Product Sold evidence"
                />
                <StatCard
                  label="Additive revenue"
                  value={formatMoney(
                    context.commercialPerformance.additiveRevenue,
                    context.commercialPerformance.currency,
                  )}
                  hint="Bundle allocations are attribution, not added revenue"
                />
              </>
            ) : null}
            {context.offerings.items.length > 0 ? (
              <StatCard
                label="Commercial offerings"
                value={context.offerings.items.length}
                hint="Canonical Product Offering records"
              />
            ) : null}
            {context.consumers.items.length > 0 ? (
              <StatCard
                label="Evidence-backed consumers"
                value={context.consumers.items.length}
                hint="No placeholder consumers"
              />
            ) : null}
            {context.enablingDigitalProducts.items.length > 0 ? (
              <StatCard
                label="Enabling digital products"
                value={context.enablingDigitalProducts.items.length}
                hint="Only explicit operational-offering links"
              />
            ) : null}
          </div>
        ) : (
          <Notice variant="info" className="mt-dpf-md" title="No commercial evidence yet">
            Sales, consumers, and enabling digital products appear only after
            canonical offering, fulfillment, or transaction evidence exists.
          </Notice>
        )}
      </section>

      <ProductContextActionPreview
        scopeLabel={`${context.scope.kind}: ${context.scope.id}`}
        sourceKinds={sourceKinds}
      />
    </div>
  );
}
