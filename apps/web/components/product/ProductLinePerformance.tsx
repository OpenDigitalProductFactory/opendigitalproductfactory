"use client";

import Link from "next/link";
import { EmptyState, Notice, StatusBadge } from "@/components/ui/report-kit";
import {
  DataTable,
  type Column,
} from "@/components/ui/report-kit/DataTable";
import {
  describeRecommendationForAudience,
  type ProductLinePerformanceView,
  type ProductPerformanceAudience,
  type ProductPerformanceMeasure,
  type ProductPerformanceRow,
} from "@/lib/product-management/product-performance";

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

function valueLabel(measure: ProductPerformanceMeasure): string {
  if (measure.currentValue === null) return "Not available";
  if (measure.unit && /^[A-Z]{3}$/.test(measure.unit)) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: measure.unit,
      maximumFractionDigits: 0,
    }).format(measure.currentValue);
  }
  if (measure.unit?.startsWith("%")) {
    return `${Math.round(measure.currentValue)}%`;
  }
  return `${Math.round(measure.currentValue * 100) / 100}${
    measure.unit ? ` ${measure.unit}` : ""
  }`;
}

function metric(
  measures: readonly ProductPerformanceMeasure[],
  key: ProductPerformanceMeasure["key"],
): ProductPerformanceMeasure {
  return measures.find((measure) => measure.key === key)!;
}

function TrendBadge({ measure }: { measure: ProductPerformanceMeasure }) {
  if (measure.trend === "unknown") {
    return <span className="text-dpf-caption text-[var(--dpf-muted)]">No trend</span>;
  }
  return (
    <StatusBadge
      intent={
        measure.trend === "rising"
          ? "success"
          : measure.trend === "falling"
            ? "warning"
            : "neutral"
      }
      label={measure.trend}
      uppercase={false}
    />
  );
}

export function ProductLinePerformance({
  view,
  audience,
}: {
  view: ProductLinePerformanceView;
  audience: ProductPerformanceAudience;
}) {
  const unavailable = view.line.measures.filter(
    (measure) => measure.availability !== "available",
  );
  const columns: Column<ProductPerformanceRow>[] = [
    {
      key: "product",
      header: "Product",
      sortAccessor: (product) => product.name,
      cell: (product) => (
        <>
          <Link
            href={product.href}
            className="font-dpf-medium text-[var(--dpf-accent)] hover:underline"
          >
            {product.name}
          </Link>
          <span className="mt-dpf-2xs block text-dpf-caption text-[var(--dpf-muted)]">
            {product.semanticId}
          </span>
        </>
      ),
    },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      sortAccessor: (product) =>
        metric(product.measures, "recognized-revenue").currentValue ?? -1,
      cell: (product) => {
        const revenue = metric(product.measures, "recognized-revenue");
        return (
          <>
            <span className="block">{valueLabel(revenue)}</span>
            <TrendBadge measure={revenue} />
          </>
        );
      },
    },
    {
      key: "sales",
      header: "Sales",
      align: "right",
      sortAccessor: (product) =>
        metric(product.measures, "completed-sales").currentValue ?? -1,
      cell: (product) =>
        valueLabel(metric(product.measures, "completed-sales")),
    },
    {
      key: "demand",
      header: "Demand",
      align: "right",
      sortAccessor: (product) =>
        metric(product.measures, "demand").currentValue ?? -1,
      cell: (product) => valueLabel(metric(product.measures, "demand")),
    },
    {
      key: "outcomes",
      header: "Outcomes",
      align: "right",
      sortAccessor: (product) =>
        metric(product.measures, "outcome-progress").currentValue ?? -1,
      cell: (product) =>
        valueLabel(metric(product.measures, "outcome-progress")),
    },
  ];

  return (
    <div className="space-y-dpf-xl">
      <section aria-labelledby="performance-attention">
        <div data-dpf-lead>
          <p className="text-dpf-caption font-dpf-semibold uppercase tracking-wide text-[var(--dpf-accent)]">
            Product-line direction
          </p>
          <h2
            id="performance-attention"
            className="mt-dpf-2xs text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
          >
            What deserves attention?
          </h2>
          <p className="mt-dpf-xs max-w-prose text-dpf-body text-[var(--dpf-muted)]">
            Recommendations use recorded evidence from{" "}
            {dateLabel(view.currentPeriod.from)} to{" "}
            {dateLabel(view.currentPeriod.to)}. They prepare a decision; they
            do not change pricing, capacity, marketing, or funding.
          </p>
        </div>

        {view.recommendations.length === 0 ? (
          <Notice
            variant="info"
            title="No evidence-backed action is ready"
            className="mt-dpf-md"
          >
            Current records do not support a specific recommendation. Review
            the missing-measures list before drawing a business conclusion.
          </Notice>
        ) : (
          <ul className="mt-dpf-md grid gap-dpf-md lg:grid-cols-2">
            {view.recommendations.map((recommendation) => {
              const copy = describeRecommendationForAudience(
                recommendation,
                audience,
              );
              return (
                <li
                  key={recommendation.recommendationId}
                  className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-lg"
                >
                  <div className="flex flex-wrap items-start justify-between gap-dpf-sm">
                    <h3 className="text-dpf-body-lg font-dpf-semibold text-[var(--dpf-text)]">
                      {recommendation.title}
                    </h3>
                    <StatusBadge
                      intent={
                        recommendation.confidence === "high"
                          ? "success"
                          : "warning"
                      }
                      label={`${recommendation.confidence} confidence`}
                      uppercase={false}
                    />
                  </div>
                  <p className="mt-dpf-sm text-dpf-body text-[var(--dpf-muted)]">
                    {copy.summary}
                  </p>
                  {recommendation.blindSpots.length > 0 ? (
                    <p className="mt-dpf-sm text-dpf-caption text-[var(--dpf-muted)]">
                      Missing evidence: {recommendation.blindSpots.join(" ")}
                    </p>
                  ) : null}
                  <div className="mt-dpf-md flex flex-wrap items-center gap-dpf-sm">
                    {recommendation.productId ? (
                      <Link
                        href={`/portfolio/product/${recommendation.productId}/direction`}
                        className="min-h-11 rounded-dpf-md border border-[var(--dpf-border)] px-dpf-md py-dpf-sm font-dpf-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
                      >
                        {copy.actionLabel}
                      </Link>
                    ) : (
                      <span className="text-dpf-body font-dpf-medium text-[var(--dpf-text)]">
                        {copy.actionLabel}
                      </span>
                    )}
                    <span className="text-dpf-caption text-[var(--dpf-muted)]">
                      {recommendation.evidence.length} cited{" "}
                      {recommendation.evidence.length === 1
                        ? "record"
                        : "records"}{" "}
                      · recommend only
                    </span>
                  </div>
                  {audience === "professional-pm" ? (
                    <details className="mt-dpf-md">
                      <summary className="cursor-pointer font-dpf-medium text-[var(--dpf-accent)]">
                        Decision detail
                      </summary>
                      <dl className="mt-dpf-sm grid gap-dpf-xs text-dpf-caption text-[var(--dpf-muted)]">
                        <div>
                          <dt className="font-dpf-semibold text-[var(--dpf-text)]">
                            Expected effect
                          </dt>
                          <dd>{recommendation.expectedEffect}</dd>
                        </div>
                        <div>
                          <dt className="font-dpf-semibold text-[var(--dpf-text)]">
                            Follow-up measure
                          </dt>
                          <dd>{recommendation.followUpMeasure}</dd>
                        </div>
                      </dl>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Notice
          variant="info"
          title="Use your business stance before acting"
          className="mt-dpf-md"
        >
          Open the page coworker and choose <strong>Ask what this business would
          do</strong>. The coworker will compare reversible options through
          WWWD. Nothing changes until the owning workflow receives a separate
          governed approval.
        </Notice>
      </section>

      <section aria-labelledby="performance-comparison">
        <div className="flex flex-wrap items-end justify-between gap-dpf-md">
          <div>
            <h2
              id="performance-comparison"
              className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
            >
              Product comparison
            </h2>
            <p className="mt-dpf-2xs max-w-prose text-dpf-body text-[var(--dpf-muted)]">
              Current period compared with{" "}
              {dateLabel(view.baselinePeriod.from)} to{" "}
              {dateLabel(view.baselinePeriod.to)}. Package allocations never
              add revenue a second time.
            </p>
          </div>
          <StatusBadge
            intent={view.unavailableMeasureCount > 0 ? "warning" : "success"}
            label={`${view.unavailableMeasureCount} measures incomplete`}
            uppercase={false}
          />
        </div>

        {view.products.length === 0 ? (
          <EmptyState
            className="mt-dpf-md"
            title="No managed products in this line"
            description="Add a real product to the product mix before comparing performance."
          />
        ) : (
          <div
            className="mt-dpf-md overflow-x-auto rounded-dpf-lg border border-[var(--dpf-border)]"
            role="region"
            aria-labelledby="performance-comparison"
          >
            <DataTable
              columns={columns}
              rows={view.products}
              getRowKey={(product) => product.productId}
              initialSort={{ key: "product", dir: "asc" }}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="measure-availability">
        <h2
          id="measure-availability"
          className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
        >
          What this comparison cannot say yet
        </h2>
        <p className="mt-dpf-2xs max-w-prose text-dpf-body text-[var(--dpf-muted)]">
          Missing evidence remains visible so a blank measure is never mistaken
          for zero.
        </p>
        <ul className="mt-dpf-md grid gap-dpf-sm md:grid-cols-2">
          {unavailable.map((measure) => (
            <li
              key={measure.key}
              className="rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-md"
            >
              <div className="flex items-start justify-between gap-dpf-sm">
                <h3 className="font-dpf-semibold text-[var(--dpf-text)]">
                  {measure.label}
                </h3>
                <StatusBadge
                  intent="neutral"
                  label={measure.availability}
                  uppercase={false}
                />
              </div>
              <p className="mt-dpf-xs text-dpf-caption text-[var(--dpf-muted)]">
                {measure.reason}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
