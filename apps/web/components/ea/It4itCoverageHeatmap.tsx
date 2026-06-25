"use client";

// apps/web/components/ea/It4itCoverageHeatmap.tsx
//
// IT4IT functional-coverage heatmap (EP-IT4IT-CONFORMANCE). Renders the platform-scope
// coverage projection as nested capability-group bands of functional-component tiles,
// coloured through the report-kit status intent registry (no raw hex; color-mix tints).
// Click a tile to drill into its criteria. Empty state until the steward projection has
// written assessments. Honesty: no-data is neutral (never green); confidence (derived vs
// verified) is shown on every tile; the rollup method + a non-certification disclaimer are
// always visible.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatCard } from "@/components/ui/report-kit/StatCard";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";
import { ExportButton } from "@/components/ui/report-kit/ExportButton";
import { intentStyle, resolveIntent } from "@/components/ui/report-kit/statusColors";
import { setIt4itCoverageOverride } from "@/lib/actions/ea";
import type {
  CoverageStatus,
  It4itCoverageHeatmap as It4itCoverageHeatmapData,
  It4itComponentCoverage,
  It4itCriterionCoverage,
} from "@/lib/explore/reference-model-types";

const COVERAGE_OPTIONS: CoverageStatus[] = ["implemented", "partial", "planned", "not_started", "out_of_mvp"];

const DISCLAIMER =
  "This is a DPF evidence-derived IT4IT coverage baseline. It is not an Open Group certification or formal conformance claim.";

function tileColors(status: string, score: number) {
  const intent = resolveIntent("it4itCoverage", status);
  const style = intentStyle(intent);
  if (intent === "neutral") {
    return { background: "var(--dpf-surface-2)", borderColor: "var(--dpf-border)" };
  }
  const pct = Math.round(10 + (Math.max(0, Math.min(100, score)) / 100) * 18); // 10–28%
  return {
    background: `color-mix(in srgb, ${style.fg} ${pct}%, transparent)`,
    borderColor: `color-mix(in srgb, ${style.border} 42%, transparent)`,
  };
}

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  const verified = confidence === "verified" || confidence === "high";
  return (
    <span
      className="rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide"
      style={{
        color: verified ? "var(--dpf-success)" : "var(--dpf-muted)",
        background: verified
          ? "color-mix(in srgb, var(--dpf-success) 14%, transparent)"
          : "var(--dpf-surface-2)",
      }}
    >
      {verified ? "verified" : "derived"}
    </span>
  );
}

export function It4itCoverageHeatmap({
  data,
  canOverride = false,
}: {
  data: It4itCoverageHeatmapData;
  canOverride?: boolean;
}) {
  const allComponents = data.groups.flatMap((g) => g.components);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = allComponents.find((c) => c.id === selectedId) ?? null;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function applyOverride(modelElementId: string, coverageStatus: CoverageStatus) {
    startTransition(async () => {
      await setIt4itCoverageOverride({ modelSlug: data.modelSlug, modelElementId, coverageStatus });
      router.refresh();
    });
  }

  if (!data.hasData) {
    return (
      <section className="mb-6">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">IT4IT Functional Coverage</h2>
          <p className="text-xs text-[var(--dpf-muted)]">
            Evidence-derived coverage of the IT4IT functional criteria, refreshed by the architecture
            parity steward.
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center">
          <p className="text-sm text-[var(--dpf-text)]">No IT4IT assessments have been generated yet.</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Run an architecture parity refresh to establish the baseline. {DISCLAIMER}
          </p>
        </div>
      </section>
    );
  }

  const exportRows = allComponents.map((c) => ({
    capabilityGroup: c.capabilityGroup,
    component: c.name,
    status: c.status,
    score: c.score,
    confidence: c.confidence ?? "derived",
    criteria: c.criteriaCount,
    requiredCriteria: c.requiredCriteriaCount,
  }));

  const criteriaColumns: Column<It4itCriterionCoverage>[] = [
    { key: "name", header: "Criterion", cell: (r) => r.name },
    {
      key: "normativeClass",
      header: "Class",
      cell: (r) => (
        <span className="text-xs text-[var(--dpf-muted)]">{r.normativeClass ?? "unset"}</span>
      ),
    },
    { key: "sourceReference", header: "Ref", mono: true, cell: (r) => r.sourceReference ?? "—" },
    {
      key: "status",
      header: "Coverage",
      cell: (r) => <StatusBadge domain="it4itCoverage" status={r.status} size="sm" />,
    },
  ];

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">IT4IT Functional Coverage</h2>
          <p className="text-xs text-[var(--dpf-muted)]">
            Evidence-derived coverage of {data.summary.componentsTotal} functional components, refreshed by
            the architecture parity steward. Colour = coverage status; intensity = evidence score.
          </p>
        </div>
        <ExportButton
          rows={exportRows}
          columns={[
            { key: "capabilityGroup", header: "Capability Group" },
            { key: "component", header: "Functional Component" },
            { key: "status", header: "Coverage Status" },
            { key: "score", header: "Evidence Score" },
            { key: "confidence", header: "Confidence" },
            { key: "criteria", header: "Criteria" },
            { key: "requiredCriteria", header: "Required Criteria" },
          ]}
          filename={`${data.modelSlug}-coverage.csv`}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Platform coverage" value={`${data.platformScore}%`} hint="status-weighted, evidence-derived" />
        <StatCard
          label="Components with evidence"
          value={`${data.summary.componentsWithEvidence}/${data.summary.componentsTotal}`}
          hint={`${data.summary.implemented} implemented · ${data.summary.partial} partial`}
        />
        <StatCard
          label="Required criteria covered"
          value={`${data.summary.requiredCriteriaImplemented + data.summary.requiredCriteriaPartial}/${data.summary.requiredCriteriaTotal}`}
          hint={`${data.summary.requiredCriteriaImplemented} implemented`}
        />
        <StatCard
          label="Verified assessments"
          value={data.summary.verifiedCount}
          hint={data.summary.verifiedCount === 0 ? "all evidence-derived" : "operator-confirmed"}
          intent={data.summary.verifiedCount > 0 ? "success" : "neutral"}
        />
      </div>

      <div className="space-y-3">
        {data.groups.map((group) => (
          <div
            key={group.group}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-[var(--dpf-text)]">{group.group}</h3>
              <span className="text-xs text-[var(--dpf-muted)]">
                {group.score}% · {group.componentsWithEvidence}/{group.componentCount}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {group.components.map((c) => {
                const colors = tileColors(c.status, c.score);
                const isSelected = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(isSelected ? null : c.id)}
                    aria-pressed={isSelected}
                    aria-label={`${c.name}: ${c.status.replace("_", " ")}, evidence score ${c.score}`}
                    className="flex flex-col gap-1 rounded-md border p-2 text-left transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
                    style={{
                      background: colors.background,
                      borderColor: isSelected ? "var(--dpf-accent)" : colors.borderColor,
                    }}
                  >
                    <span className="text-xs font-medium leading-tight text-[var(--dpf-text)]">{c.name}</span>
                    <span className="flex items-center justify-between gap-1">
                      <span className="text-[10px] capitalize text-[var(--dpf-muted)]">
                        {c.status.replace("_", " ")}
                      </span>
                      <ConfidenceBadge confidence={c.confidence} />
                    </span>
                    <span className="text-[10px] text-[var(--dpf-muted)]">
                      {c.criteriaCount} criteria · {c.requiredCriteriaCount} required
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{selected.name}</h3>
              <p className="text-xs text-[var(--dpf-muted)]">
                {selected.capabilityGroup} · <StatusBadgeInline component={selected} /> · evidence score {selected.score}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            >
              Close
            </button>
          </div>
          {canOverride && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
              <label htmlFor="it4it-override" className="text-xs text-[var(--dpf-muted)]">
                Set verified coverage:
              </label>
              <select
                id="it4it-override"
                defaultValue={selected.status}
                disabled={pending}
                onChange={(e) => applyOverride(selected.id, e.target.value as CoverageStatus)}
                className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs text-[var(--dpf-text)]"
              >
                {COVERAGE_OPTIONS.map((s) => (
                  <option key={s} value={s} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-[var(--dpf-muted)]">
                {pending ? "saving..." : "marks this component operator-verified; survives steward refresh"}
              </span>
            </div>
          )}
          <DataTable<It4itCriterionCoverage>
            columns={criteriaColumns}
            rows={selected.criteria}
            getRowKey={(r) => r.id}
            pageSize={10}
            empty="No criteria recorded for this component."
          />
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-[var(--dpf-muted)]">
        {DISCLAIMER} Rollup: {data.method}
        {data.generatedAt ? ` · last refreshed ${new Date(data.generatedAt).toLocaleString()}` : ""}
      </p>
    </section>
  );
}

function StatusBadgeInline({ component }: { component: It4itComponentCoverage }) {
  return <StatusBadge domain="it4itCoverage" status={component.status} size="sm" />;
}
