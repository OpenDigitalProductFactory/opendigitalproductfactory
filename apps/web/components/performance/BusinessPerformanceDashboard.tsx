import { DEFAULT_LOCALE, translate } from "@dpf/i18n";
import Link from "next/link";

import {
  ExportButton,
  Notice,
  StatCard,
  StatusBadge,
} from "@/components/ui/report-kit";
import { LocalTime } from "@/components/ui/LocalTime";
import type {
  BusinessPerformanceMetricValue,
  ReadyBusinessPerformance,
} from "@/lib/performance/business-performance-provider";
import {
  formatComparisonDelta,
  formatComparisonMagnitude,
  formatMetricValue,
} from "@/lib/performance/performance-format";
import { buildPerformanceExportRows } from "@/lib/performance/performance-export";
import { buildPerformanceDecisionSummary } from "@/lib/performance/performance-decision-summary";
import { PerformanceTrendPanel } from "./PerformanceTrendPanel";
import { BusinessAnalysisWorkspace } from "./BusinessAnalysisWorkspace";
import type { BusinessAnalysisWatchView } from "@/lib/performance/business-analysis-watch.server";

function sourceModels(lineage: unknown): string[] {
  if (!lineage || typeof lineage !== "object" || !("sourceModels" in lineage)) return [];
  const models = (lineage as { sourceModels?: unknown }).sourceModels;
  return Array.isArray(models) ? models.filter((model): model is string => typeof model === "string") : [];
}

function MetricCard({ metric }: { metric: BusinessPerformanceMetricValue }) {
  const delta = metric.comparisonDelta;
  const deltaLabel = delta === null
    ? undefined
    : formatComparisonDelta(delta);
  const lineage = sourceModels(metric.sourceLineage);

  return (
    <article className="space-y-2" data-metric-key={metric.key}>
      <StatCard
        label={metric.label}
        value={formatMetricValue(metric.value, metric.unit, metric.currency ?? undefined)}
        intent={metric.availability === "available" ? "info" : "neutral"}
        hint={metric.unavailableReason ?? (metric.currency ? `Recorded ledger · ${metric.currency}` : `Compared with the prior period${metric.comparisonValue === null ? " when available" : ""}.`)}
        {...(metric.drilldownRoute ? { href: metric.drilldownRoute } : {})}
        {...(deltaLabel && delta !== null ? {
          delta: {
            label: deltaLabel,
            direction: delta > 0 ? "up" as const : delta < 0 ? "down" as const : "flat" as const,
            intent: "neutral" as const,
          },
        } : {})}
      />
      <details className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs text-[var(--dpf-text-secondary)]">
        <summary className="cursor-pointer font-medium text-[var(--dpf-text)]">
          How this is calculated
        </summary>
        <dl className="mt-2 grid gap-1 sm:grid-cols-[8rem_1fr]">
          <dt className="text-[var(--dpf-muted)]">Definition</dt>
          <dd>{metric.definition}</dd>
          <dt className="text-[var(--dpf-muted)]">Source owner</dt>
          <dd>{metric.sourceOwner}</dd>
          <dt className="text-[var(--dpf-muted)]">Definition version</dt>
          <dd>{metric.definitionVersion ?? "Not computed"}</dd>
          <dt className="text-[var(--dpf-muted)]">Source models</dt>
          <dd>{lineage.length > 0 ? lineage.join(", ") : "No source lineage recorded"}</dd>
          <dt className="text-[var(--dpf-muted)]">Source updated</dt>
          <dd><LocalTime value={metric.sourceWatermark} mode="time" /></dd>
        </dl>
        {metric.drilldownRoute ? (
          <Link className="mt-2 inline-flex min-h-11 items-center font-medium text-[var(--dpf-accent)]" href={metric.drilldownRoute}>
            Open source operations
          </Link>
        ) : null}
      </details>
    </article>
  );
}

function MetricSection({
  title,
  keys,
  metrics,
}: {
  title: string;
  keys: readonly string[];
  metrics: ReadonlyMap<string, BusinessPerformanceMetricValue>;
}) {
  if (keys.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby={`performance-${title.toLowerCase()}`}>
      <h2 id={`performance-${title.toLowerCase()}`} className="text-base font-semibold text-[var(--dpf-text)]">
        {title}
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {keys.flatMap((key) => {
          const metric = metrics.get(key);
          return metric ? [<MetricCard key={key} metric={metric} />] : [];
        })}
      </div>
    </section>
  );
}

export function BusinessPerformanceDashboard({
  performance,
  watches = [],
  language = DEFAULT_LOCALE,
}: {
  performance: ReadyBusinessPerformance;
  watches?: readonly BusinessAnalysisWatchView[];
  language?: string;
}) {
  const t = (key: Parameters<typeof translate<"shell">>[2], args?: Parameters<typeof translate>[3]) => translate(language, "shell", key, args);
  const metrics = new Map(performance.metricValues.map((metric) => [metric.key, metric]));
  const decisionSummary = buildPerformanceDecisionSummary({
    metrics: performance.metricValues,
    headlineKeys: performance.sections.headline,
  });
  const exportRows = buildPerformanceExportRows(performance);

  if (performance.archetypeId === "software-platform") return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{performance.periodLabel} · {performance.reportingCurrency}</h2>
          <p className="text-xs text-[var(--dpf-muted)]">{t("finance.results.scope", { state: t(performance.periodState === "in-progress" ? "finance.results.partialMonth" : "finance.results.recordedMonth") })}</p>
        </div>
        <StatusBadge intent={performance.freshness === "stale" ? "warning" : "neutral"} label={t(performance.refreshFailure ? "finance.results.refreshFailed" : performance.freshness === "stale" ? "finance.results.snapshotDelayed" : "finance.results.recordedSnapshot")} />
      </div>
      <section aria-label="Headline performance" className="grid gap-3 md:grid-cols-3">
        {performance.sections.headline.flatMap(key => {
          const metric = metrics.get(key); return metric ? [<MetricCard key={key} metric={metric} />] : [];
        })}
      </section>
      {performance.nextAction ? <Link href={performance.nextAction.href} data-dpf-primary-action data-owner-first-next-action className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-[var(--dpf-accent)]">{performance.nextAction.label}</Link> : null}
      <details className="rounded-lg border border-[var(--dpf-border)] p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("finance.results.explore")}</summary>
        <div className="mt-3 space-y-4">
          {performance.refreshFailure && <p className="text-xs text-[var(--dpf-muted)]">{performance.refreshFailure.reason}</p>}
          <p className="text-xs text-[var(--dpf-muted)]">{t("finance.results.limits")} {t("finance.results.checked")} <LocalTime value={performance.asOf} mode="time" />.</p>
          <ExportButton rows={exportRows} filename="recorded-results.csv" label={t("finance.results.export")} />
          <BusinessAnalysisWorkspace performance={performance} watches={watches} />
          <PerformanceTrendPanel points={performance.trendPoints} metrics={performance.metricValues.map(({ key, label, unit, currency }) => ({ key, label, unit, currency: currency ?? undefined }))} preferredKeys={performance.sections.headline} />
        </div>
      </details>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--dpf-muted)]">Reporting period</p>
          <p className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">{performance.periodLabel}</p>
          <p className="text-xs text-[var(--dpf-muted)]">{performance.timezone}</p>
          {performance.availablePeriods.length > 1 ? (
            <nav aria-label="Performance period" className="mt-2 flex flex-wrap gap-2">
              {performance.availablePeriods.map((period) =>
                period.selected ? (
                  <span key={period.key} aria-current="date" className="rounded-md bg-[var(--dpf-surface-2)] px-2 py-1 text-xs font-medium text-[var(--dpf-text)]">
                    {period.label}
                  </span>
                ) : (
                  <Link key={period.key} href={`/performance?period=${period.key}`} className="inline-flex min-h-11 items-center rounded-md px-2 text-xs font-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]">
                    {period.label}
                  </Link>
                ),
              )}
            </nav>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            intent={performance.freshness === "fresh" ? "success" : "warning"}
            label={
              performance.freshness === "stale"
                ? "Snapshot delayed"
                : performance.periodState === "finalized"
                  ? "Finalized snapshot"
                  : "Fresh snapshot"
            }
          />
          <ExportButton
            rows={exportRows}
            filename={`business-performance-${performance.periodLabel.replaceAll(" ", "-").replaceAll(",", "").toLowerCase()}.csv`}
            label="Export this period"
          />
          <span className="text-xs text-[var(--dpf-muted)]">
            Oldest source update <LocalTime value={performance.asOf} mode="time" />
          </span>
        </div>
      </div>

      {performance.freshness === "stale" ? (
        <Notice variant="warn" title="The latest valid snapshot is delayed">
          Last successful snapshot retained; refresh will retry.
        </Notice>
      ) : null}

      <section aria-label="Headline performance" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {performance.sections.headline.flatMap((key) => {
          const metric = metrics.get(key);
          return metric ? [<MetricCard key={key} metric={metric} />] : [];
        })}
      </section>

      <section
        aria-labelledby="performance-owner-brief"
        className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
        data-dpf-lead
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="performance-owner-brief" className="text-base font-semibold text-[var(--dpf-text)]">
              Owner brief
            </h2>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Recorded facts and limits.
            </p>
          </div>
          <StatusBadge intent="neutral" label="Observation, not a recommendation" />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3 lg:divide-x lg:divide-[var(--dpf-border)]">
          <div>
            <h3 className="text-sm font-semibold text-[var(--dpf-text)]">What changed</h3>
            {decisionSummary.observedChanges.length > 0 ? (
              <ul className="mt-2 space-y-2 text-sm text-[var(--dpf-text-secondary)]">
                {decisionSummary.observedChanges.slice(0, 3).map((change) => (
                  <li key={change.key}>
                    <span className="font-medium text-[var(--dpf-text)]">{change.label}</span>{" "}
                    {change.direction} {formatComparisonMagnitude(change.delta)} versus the prior period.
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[var(--dpf-text-secondary)]">
                No prior comparison yet.
              </p>
            )}
          </div>
          <div className="lg:pl-4">
            <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Why it changed</h3>
            <p className="mt-2 text-sm text-[var(--dpf-text-secondary)]">
              {decisionSummary.driverEvidence.message}
            </p>
            <p className="mt-2 text-xs text-[var(--dpf-muted)]">
              Calculation details show sources.
            </p>
          </div>
          <div className="lg:pl-4">
            <h3 className="text-sm font-semibold text-[var(--dpf-text)]">What deserves review</h3>
            {decisionSummary.reviewItems.length > 0 ? (
              <ul className="mt-2 space-y-2 text-sm text-[var(--dpf-text-secondary)]">
                {decisionSummary.reviewItems.map((item) => (
                  <li key={`${item.kind}-${item.key}`}>
                    <span className="font-medium text-[var(--dpf-text)]">{item.label}:</span>{" "}
                    {item.reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[var(--dpf-text-secondary)]">
                No recorded gaps need review.
              </p>
            )}
          </div>
        </div>
      </section>

      <BusinessAnalysisWorkspace performance={performance} watches={watches} />

      <PerformanceTrendPanel
        points={performance.trendPoints}
        metrics={performance.metricValues.map(({ key, label, unit }) => ({ key, label, unit }))}
        preferredKeys={performance.sections.headline}
      />

      <MetricSection title="Operations" keys={performance.sections.operating} metrics={metrics} />
      <MetricSection title="Financial" keys={performance.sections.financial} metrics={metrics} />
      <MetricSection title="Customer" keys={performance.sections.customer} metrics={metrics} />
      <MetricSection title="Workforce" keys={performance.sections.workforce} metrics={metrics} />
    </div>
  );
}
