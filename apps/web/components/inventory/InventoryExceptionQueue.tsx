"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  acceptTriageRecommendation,
  dismissEntity,
  markTaxonomyGapForReview,
  reassignTaxonomy,
  requestDiscoveryEvidence,
} from "@/lib/actions/inventory";

type CandidateTaxonomy = {
  nodeId: string;
  name?: string;
  score: number;
};

type DecisionSummary = {
  decisionId: string;
  outcome: string;
  actorType: string;
  identityConfidence: number | null;
  taxonomyConfidence: number | null;
  evidenceCompleteness: number | null;
  reproducibilityScore: number | null;
  requiresHumanReview: boolean;
  evidencePacket: Record<string, unknown>;
};

type TriageRow = {
  id: string;
  entityKey: string;
  entityType: string;
  name: string;
  attributionConfidence: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  candidateTaxonomy: CandidateTaxonomy[];
  properties: Record<string, unknown> | unknown[] | string | number | boolean | null;
  latestDecision: DecisionSummary | null;
};

type TriageQueues = {
  autoAttributed: TriageRow[];
  humanReview: TriageRow[];
  needsMoreEvidence: TriageRow[];
  taxonomyGaps: TriageRow[];
  metrics: {
    total: number;
    withDecision: number;
  };
};

type Props = {
  queues: TriageQueues;
};

type QueueSectionConfig = {
  key: keyof Omit<TriageQueues, "metrics">;
  title: string;
  description: string;
  emptyLabel: string;
};

const SECTIONS: QueueSectionConfig[] = [
  {
    key: "humanReview",
    title: "Human Review",
    description: "Ambiguous items with enough evidence to review, but not enough certainty to act on automatically.",
    emptyLabel: "No items are waiting on human review.",
  },
  {
    key: "needsMoreEvidence",
    title: "Needs More Evidence",
    description: "Discovery does not have enough repeatable identity evidence yet. Capture more signals before forcing a placement.",
    emptyLabel: "No entities are currently blocked on missing evidence.",
  },
  {
    key: "taxonomyGaps",
    title: "Taxonomy Gaps",
    description: "The device identity looks credible, but the taxonomy likely needs a new pattern or branch to place it cleanly.",
    emptyLabel: "No unresolved taxonomy gaps are active right now.",
  },
  {
    key: "autoAttributed",
    title: "Auto Attributed",
    description: "Recent high-confidence recommendations that were safe to apply automatically. Keep these visible as a learning trail.",
    emptyLabel: "No recent auto-attributed decisions are in the current queue.",
  },
];

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number") return "n/a";
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function getEvidenceSummary(row: TriageRow): string {
  const packet = row.latestDecision?.evidencePacket ?? {};
  const protocolEvidence = packet.protocolEvidence;
  if (protocolEvidence && typeof protocolEvidence === "object" && !Array.isArray(protocolEvidence)) {
    const protocol = protocolEvidence as Record<string, unknown>;
    const labels = protocol.prometheusLabels;
    if (labels && typeof labels === "object" && !Array.isArray(labels)) {
      const labelEntries = Object.entries(labels as Record<string, unknown>)
        .filter(([, value]) => value != null && `${value}`.trim().length > 0)
        .slice(0, 2)
        .map(([key, value]) => `${key}: ${value}`);
      if (labelEntries.length > 0) return labelEntries.join(" | ");
    }

    const packageName = typeof protocol.packageName === "string" ? protocol.packageName : null;
    const processName = typeof protocol.processName === "string" ? protocol.processName : null;
    const containerImage = typeof protocol.containerImage === "string" ? protocol.containerImage : null;
    const firstSignal = packageName ?? processName ?? containerImage;
    if (firstSignal) return firstSignal;
  }

  const properties = row.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const propEntries = Object.entries(properties as Record<string, unknown>)
      .filter(([, value]) => value != null && `${value}`.trim().length > 0)
      .slice(0, 2)
      .map(([key, value]) => `${key}: ${value}`);
    if (propEntries.length > 0) return propEntries.join(" | ");
  }

  return "No summarized evidence captured yet.";
}

function getSuggestedTaxonomy(row: TriageRow): CandidateTaxonomy | null {
  return row.candidateTaxonomy[0] ?? null;
}

export function InventoryExceptionQueue({ queues }: Props) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const totalVisible = useMemo(
    () =>
      queues.humanReview.length
      + queues.needsMoreEvidence.length
      + queues.taxonomyGaps.length
      + queues.autoAttributed.length,
    [queues],
  );

  if (totalVisible === 0) return null;

  async function runAction(actionKey: string, task: () => Promise<{ ok: boolean; error?: string }>) {
    setPendingKey(actionKey);
    const result = await task();
    setPendingKey(null);
    if (result.ok) {
      router.refresh();
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            Triage Workbench
          </p>
          <div>
            <h2 className="text-lg font-semibold text-[var(--dpf-text)]">
              Discovery taxonomy review
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">
              Review what discovery can place automatically, what needs more signals, and where the taxonomy itself needs to grow.
            </p>
          </div>
        </div>
        <div className="grid min-w-[16rem] grid-cols-2 gap-2 self-stretch text-sm">
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
              Active gaps
            </div>
            <div className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">
              {queues.metrics.total}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
              With decisions
            </div>
            <div className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">
              {queues.metrics.withDecision}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {SECTIONS.map((section) => {
          const rows = queues[section.key];
          return (
            <section key={section.key} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{section.title}</h3>
                  <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--dpf-muted)]">
                    {section.description}
                  </p>
                </div>
                <div className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--dpf-text)]">
                  {rows.length} item{rows.length === 1 ? "" : "s"}
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-3 text-sm text-[var(--dpf-muted)]">
                  {section.emptyLabel}
                </div>
              ) : (
                <div className="space-y-2">
                  {rows.map((row) => {
                    const suggestedTaxonomy = getSuggestedTaxonomy(row);
                    const decision = row.latestDecision;
                    const decisionKey = decision?.decisionId ?? row.id;
                    const reviewAction = decision?.decisionId
                      ? () => acceptTriageRecommendation(decision.decisionId)
                      : suggestedTaxonomy
                        ? () => reassignTaxonomy(row.id, suggestedTaxonomy.nodeId)
                        : null;

                    return (
                      <article
                        key={row.id}
                        className="grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(14rem,0.8fr)]"
                      >
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-semibold text-[var(--dpf-text)]">{row.name}</h4>
                            <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
                              {row.entityType}
                            </span>
                            <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-[10px] text-[var(--dpf-muted)]">
                              {row.entityKey}
                            </span>
                          </div>

                          <div className="grid gap-2 text-xs text-[var(--dpf-muted)] sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-2">
                              <div className="uppercase tracking-[0.14em]">Identity</div>
                              <div className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
                                {formatPercent(decision?.identityConfidence ?? row.attributionConfidence)}
                              </div>
                            </div>
                            <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-2">
                              <div className="uppercase tracking-[0.14em]">Taxonomy</div>
                              <div className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
                                {formatPercent(decision?.taxonomyConfidence ?? suggestedTaxonomy?.score ?? null)}
                              </div>
                            </div>
                            <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-2">
                              <div className="uppercase tracking-[0.14em]">Evidence</div>
                              <div className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
                                {formatPercent(decision?.evidenceCompleteness)}
                              </div>
                            </div>
                            <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-2">
                              <div className="uppercase tracking-[0.14em]">Reproducible</div>
                              <div className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
                                {formatPercent(decision?.reproducibilityScore)}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1 text-xs text-[var(--dpf-muted)]">
                            <p>
                              Evidence: <span className="text-[var(--dpf-text)]">{getEvidenceSummary(row)}</span>
                            </p>
                            <p>
                              Suggested taxonomy:{" "}
                              <span className="font-mono text-[var(--dpf-text)]">
                                {suggestedTaxonomy
                                  ? suggestedTaxonomy.nodeId.replace(/\//g, " / ")
                                  : "No suitable node identified"}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col justify-between gap-3">
                          <div className="space-y-1 text-xs text-[var(--dpf-muted)]">
                            <div>
                              Decision:{" "}
                              <span className="font-medium text-[var(--dpf-text)]">
                                {decision?.outcome?.replace(/-/g, " ") ?? "untriaged"}
                              </span>
                            </div>
                            <div>Last seen: {formatDate(row.lastSeenAt)}</div>
                            <div>First seen: {formatDate(row.firstSeenAt)}</div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {reviewAction && (
                              <button
                                type="button"
                                onClick={() => void runAction(`accept:${decisionKey}`, reviewAction)}
                                disabled={pendingKey === `accept:${decisionKey}`}
                                className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                              >
                                {pendingKey === `accept:${decisionKey}` ? "Working..." : "Accept recommendation"}
                              </button>
                            )}
                            {suggestedTaxonomy && !decision?.decisionId && (
                              <button
                                type="button"
                                onClick={() => void runAction(`top:${row.id}`, () => reassignTaxonomy(row.id, suggestedTaxonomy.nodeId))}
                                disabled={pendingKey === `top:${row.id}`}
                                className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] disabled:opacity-60"
                              >
                                {pendingKey === `top:${row.id}` ? "Working..." : "Use top match"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void runAction(`evidence:${row.id}`, () => requestDiscoveryEvidence(row.id))}
                              disabled={pendingKey === `evidence:${row.id}`}
                              className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] disabled:opacity-60"
                            >
                              {pendingKey === `evidence:${row.id}` ? "Working..." : "Request evidence"}
                            </button>
                            {!suggestedTaxonomy && (
                              <button
                                type="button"
                                onClick={() => void runAction(`taxonomy:${row.id}`, () => markTaxonomyGapForReview(row.id))}
                                disabled={pendingKey === `taxonomy:${row.id}`}
                                className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] disabled:opacity-60"
                              >
                                {pendingKey === `taxonomy:${row.id}` ? "Working..." : "Mark taxonomy gap"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void runAction(`dismiss:${row.id}`, () => dismissEntity(row.id))}
                              disabled={pendingKey === `dismiss:${row.id}`}
                              className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-muted)] disabled:opacity-60"
                            >
                              {pendingKey === `dismiss:${row.id}` ? "Working..." : "Dismiss"}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
