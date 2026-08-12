"use client";

import { useMemo, useState, useTransition } from "react";
import {
  getPerformanceMetricDefinition,
  validateBusinessAnalysisPlan,
  type BusinessAnalysisPlanResult,
} from "@dpf/storefront-templates";

import { Notice, StatusBadge } from "@/components/ui/report-kit";
import { createBusinessAnalysisWatchAction } from "@/lib/actions/business-analysis-watch";
import type { BusinessAnalysisWatchView } from "@/lib/performance/business-analysis-watch.server";
import type { ReadyBusinessPerformance } from "@/lib/performance/business-performance-provider";

const CADENCES = [
  { value: "0 9 * * 1", label: "Weekly · Monday at 09:00 UTC" },
  { value: "0 9 1 * *", label: "Monthly · first day at 09:00 UTC" },
] as const;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function percent(value: number): string {
  return `${Math.round(Math.abs(value) * 100)}%`;
}

export function BusinessAnalysisWorkspace({
  performance,
  watches,
}: {
  performance: ReadyBusinessPerformance;
  watches: readonly BusinessAnalysisWatchView[];
}) {
  const availableMetrics = performance.metricValues.filter(
    (metric) => metric.availability === "available" && metric.value !== null && metric.sourceWatermark,
  );
  const [question, setQuestion] = useState("");
  const [metricKey, setMetricKey] = useState(availableMetrics[0]?.key ?? "");
  const [comparison, setComparison] = useState("prior-period");
  const [threshold, setThreshold] = useState("10");
  const [schedule, setSchedule] = useState<string>(CADENCES[0].value);
  const [preview, setPreview] = useState<BusinessAnalysisPlanResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedMetric = useMemo(
    () => availableMetrics.find(({ key }) => key === metricKey),
    [availableMetrics, metricKey],
  );
  const materialChanges = watches.filter(
    ({ config }) => config.lastEvaluation?.status === "material-change",
  );

  function review() {
    setResult(null);
    const definition = getPerformanceMetricDefinition(metricKey);
    setPreview(validateBusinessAnalysisPlan({
      schemaVersion: 1,
      question,
      intent: "change",
      metrics: [{ key: metricKey }],
      dimensions: [],
      filters: [],
      period: {
        start: isoDate(performance.periodStart),
        end: isoDate(performance.periodStart),
        timezone: performance.timezone,
        grain: definition?.grain ?? "day",
      },
      comparison: { basis: comparison },
      sources: [{ owner: definition?.sourceOwner ?? "", maximumAge: "PT2H" }],
      checks: [{ kind: "completeness" }, { kind: "comparison-baseline" }],
    }));
  }

  function save() {
    if (preview?.status !== "accepted" || !selectedMetric?.sourceWatermark || selectedMetric.value === null) return;
    setResult(null);
    startTransition(async () => {
      const response = await createBusinessAnalysisWatchAction({
        title: question,
        schedule,
        config: {
          schemaVersion: 1,
          plan: preview.plan,
          fingerprint: preview.fingerprint,
          materiality: {
            mode: "relative",
            direction: "either",
            value: Number(threshold) / 100,
          },
          baseline: {
            value: selectedMetric.value!,
            sourceWatermark: selectedMetric.sourceWatermark!.toISOString(),
          },
          lastEvaluation: null,
        },
      });
      setResult(response);
    });
  }

  return (
    <section className="space-y-3" aria-labelledby="performance-questions-title">
      {materialChanges.length > 0 ? (
        <div className="rounded-xl border border-[var(--dpf-warning)] bg-[var(--dpf-surface-2)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">Changes detected</h2>
            <StatusBadge intent="warning" label={`${materialChanges.length} for review`} />
          </div>
          <ul className="mt-2 space-y-1 text-sm text-[var(--dpf-text-secondary)]">
            {materialChanges.map(({ taskId, config }) => {
              const evaluation = config.lastEvaluation!;
              const label = getPerformanceMetricDefinition(evaluation.metricKey)?.label ?? evaluation.metricKey;
              return <li key={taskId}>{label} moved {evaluation.delta === null ? "beyond its boundary" : percent(evaluation.delta)} from the retained baseline.</li>;
            })}
          </ul>
        </div>
      ) : null}

      <details className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <summary id="performance-questions-title" className="cursor-pointer text-base font-semibold text-[var(--dpf-text)]">
          Performance questions
          <span className="ml-2 text-xs font-normal text-[var(--dpf-muted)]">Inspect the plan before DPF watches it</span>
        </summary>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <label className="grid gap-1 text-sm text-[var(--dpf-text)]">
              <span className="font-medium">Business question</span>
              <textarea value={question} onChange={(event) => { setQuestion(event.target.value); setPreview(null); }} rows={3} placeholder="Did covers move enough to deserve attention?" className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm text-[var(--dpf-text)]">
                <span className="font-medium">Metric</span>
                <select value={metricKey} onChange={(event) => { setMetricKey(event.target.value); setPreview(null); }} className="min-h-11 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3">
                  {availableMetrics.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm text-[var(--dpf-text)]">
                <span className="font-medium">Comparison</span>
                <select value={comparison} onChange={(event) => { setComparison(event.target.value); setPreview(null); }} className="min-h-11 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3">
                  <option value="prior-period">Prior period</option>
                  <option value="none">No comparison</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm text-[var(--dpf-text)]">
                <span className="font-medium">Change worth surfacing</span>
                <span className="flex items-center gap-2"><input aria-label="Material change percent" type="number" min="1" max="1000" value={threshold} onChange={(event) => setThreshold(event.target.value)} className="min-h-11 w-28 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3" /><span>%</span></span>
              </label>
              <label className="grid gap-1 text-sm text-[var(--dpf-text)]">
                <span className="font-medium">Cadence</span>
                <select value={schedule} onChange={(event) => setSchedule(event.target.value)} className="min-h-11 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3">
                  {CADENCES.map((cadence) => <option key={cadence.value} value={cadence.value}>{cadence.label}</option>)}
                </select>
              </label>
            </div>
            <button type="button" onClick={review} disabled={!question.trim() || !metricKey} className="min-h-11 justify-self-start rounded-md bg-[var(--dpf-accent)] px-4 text-sm font-medium text-[var(--dpf-surface-1)] disabled:cursor-not-allowed disabled:opacity-50">Review question</button>
          </div>

          <div aria-live="polite">
            {!preview ? <Notice variant="info" title="Review before scheduling">No schedule is created until the interpretation, evidence, and change boundary are visible and confirmed.</Notice> : null}
            {preview?.status === "clarification-required" ? <Notice variant="warn" title="Clarify before watching"><ul>{preview.issues.map((issue) => <li key={`${issue.path}-${issue.code}`}>{issue.message}</li>)}</ul></Notice> : null}
            {preview?.status === "refused" ? <Notice variant="error" title="This question cannot run safely"><ul>{preview.issues.map((issue) => <li key={`${issue.path}-${issue.code}`}>{issue.message}</li>)}</ul></Notice> : null}
            {preview?.status === "accepted" ? (
              <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-[var(--dpf-text)]">What DPF understood</h3><StatusBadge intent="success" label="Plan accepted" /></div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
                  <dt className="text-[var(--dpf-muted)]">Metric</dt><dd className="text-[var(--dpf-text)]">{selectedMetric?.label}</dd>
                  <dt className="text-[var(--dpf-muted)]">Period</dt><dd className="text-[var(--dpf-text)]">{performance.periodLabel} · prior period</dd>
                  <dt className="text-[var(--dpf-muted)]">Source</dt><dd className="text-[var(--dpf-text)]">{selectedMetric?.sourceOwner}</dd>
                  <dt className="text-[var(--dpf-muted)]">Freshness limit</dt><dd className="text-[var(--dpf-text)]">PT2H</dd>
                  <dt className="text-[var(--dpf-muted)]">Checks</dt><dd className="text-[var(--dpf-text)]">Completeness · comparison baseline</dd>
                  <dt className="text-[var(--dpf-muted)]">Change boundary</dt><dd className="text-[var(--dpf-text)]">{threshold}% in either direction</dd>
                  <dt className="text-[var(--dpf-muted)]">Plan identity</dt><dd className="break-all font-mono text-xs text-[var(--dpf-text)]">{preview.fingerprint}</dd>
                </dl>
                <Notice variant="info" title="Schedule effect" className="mt-3">Creates one organization-scoped watched question. It records only material change; unchanged checks stay quiet.</Notice>
                <button type="button" onClick={save} disabled={pending || Number(threshold) <= 0} className="mt-3 min-h-11 rounded-md bg-[var(--dpf-accent)] px-4 text-sm font-medium text-[var(--dpf-surface-1)] disabled:opacity-50">{pending ? "Saving…" : "Start watching"}</button>
              </div>
            ) : null}
            {result?.ok ? <Notice variant="success" title="Watched question saved" className="mt-3">{result.message}</Notice> : null}
            {result && !result.ok ? <p role="alert" className="mt-3 text-sm text-[var(--dpf-error)]">{result.error}</p> : null}
          </div>
        </div>

        {watches.length > 0 ? <details className="mt-4 border-t border-[var(--dpf-border)] pt-3"><summary className="cursor-pointer text-sm font-medium text-[var(--dpf-accent)]">Watched questions ({watches.length})</summary><ul className="mt-2 space-y-2">{watches.map((watch) => <li key={watch.taskId} className="rounded-md bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text-secondary)]"><span className="font-medium text-[var(--dpf-text)]">{watch.title}</span> · {watch.isActive ? "Active" : "Paused"} · {watch.config.fingerprint}</li>)}</ul></details> : null}
      </details>
    </section>
  );
}
