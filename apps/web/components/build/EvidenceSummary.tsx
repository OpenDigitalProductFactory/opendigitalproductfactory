"use client";

import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { safeRenderValue } from "@/lib/safe-render";

type Props = {
  build: FeatureBuildRow;
  loading?: boolean;
};

export function EvidenceSummary({ build, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-2 animate-fade-in">
        <div className="h-3 w-28 bg-[var(--dpf-surface-2)] rounded animate-pulse" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2.5 rounded bg-[var(--dpf-surface-2)] animate-pulse">
            <div className="w-2 h-2 rounded-full bg-[var(--dpf-border)]" />
            <div className="h-3 flex-1 bg-[var(--dpf-border)] rounded" style={{ width: `${50 + i * 6}%` }} />
          </div>
        ))}
      </div>
    );
  }

  const items = [
    {
      label: "Design Document",
      status: build.designDoc ? "complete" : "missing",
      detail: build.designDoc ? "Approved" : "Not created",
    },
    {
      label: "Design Review",
      status: build.designReview?.decision === "pass" ? "pass" : build.designReview ? "fail" : "missing",
      detail: safeRenderValue(build.designReview?.summary) || "Not reviewed",
    },
    {
      label: "Implementation Plan",
      status: build.buildPlan ? "complete" : "missing",
      detail: build.buildPlan ? `${Array.isArray(build.buildPlan.tasks) ? build.buildPlan.tasks.length : 0} tasks` : "Not created",
    },
    {
      label: "Plan Review",
      status: build.planReview?.decision === "pass" ? "pass" : build.planReview ? "fail" : "missing",
      detail: safeRenderValue(build.planReview?.summary) || "Not reviewed",
    },
    {
      label: "Verification",
      status: build.verificationOut
        ? (build.verificationOut.typecheckPassed ? "pass" : "fail")
        : "missing",
      detail: build.verificationOut
        ? `Typecheck: ${build.verificationOut.typecheckPassed ? "pass" : "fail"}${build.verificationOut.testsFailed ? ` (${build.verificationOut.testsFailed} test warning${build.verificationOut.testsFailed > 1 ? "s" : ""})` : ""}`
        : "Not run",
    },
    {
      label: "Acceptance Criteria",
      status: build.acceptanceMet
        ? (Array.isArray(build.acceptanceMet) ? (build.acceptanceMet.every((c) => c.met) ? "pass" : "fail") : "pass")
        : "missing",
      detail: build.acceptanceMet
        ? (Array.isArray(build.acceptanceMet) ? `${build.acceptanceMet.filter((c) => c.met).length}/${build.acceptanceMet.length} met` : safeRenderValue(build.acceptanceMet))
        : "Not evaluated",
    },
    {
      label: "UX Acceptance Tests",
      status: (build as Record<string, unknown>).uxTestResults
        ? ((build as Record<string, unknown>).uxTestResults as Array<{ passed: boolean }>).every((s) => s.passed) ? "pass" : "fail"
        : "missing",
      detail: (build as Record<string, unknown>).uxTestResults
        ? `${((build as Record<string, unknown>).uxTestResults as Array<{ passed: boolean }>).filter((s) => s.passed).length}/${((build as Record<string, unknown>).uxTestResults as Array<{ passed: boolean }>).length} passed`
        : "Not run",
    },
  ];

  const STATUS_COLORS: Record<string, string> = {
    pass: "var(--dpf-success)",
    complete: "var(--dpf-success)",
    fail: "var(--dpf-error)",
    missing: "var(--dpf-muted)",
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-[var(--dpf-text)] uppercase tracking-widest">Evidence Chain</h3>
      {items.map((item) => (
        <div key={item.label} data-testid={`evidence-${item.label.toLowerCase().replace(/\s+/g, "-")}`} data-evidence-status={item.status} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] shadow-dpf-xs">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: STATUS_COLORS[item.status] ?? "var(--dpf-muted)" }}
            title={item.status}
          />
          <span className="text-xs text-[var(--dpf-text)] flex-1">{item.label}</span>
          <span className="text-[10px] text-[var(--dpf-muted)]">{item.detail}</span>
        </div>
      ))}

      {/* Phase Handoff Trail */}
      {build.phaseHandoffs && build.phaseHandoffs.length > 0 && (
        <>
          <h3 className="text-xs font-semibold text-[var(--dpf-text)] uppercase tracking-widest mt-4">Phase Handoffs</h3>
          {build.phaseHandoffs.map((h) => (
            <div key={`${h.fromPhase}-${h.toPhase}`} className="px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] shadow-dpf-xs">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-[var(--dpf-text)]">{h.fromPhase} &rarr; {h.toPhase}</span>
                <span className="text-[10px] text-[var(--dpf-muted)]">{h.fromAgentId} &rarr; {h.toAgentId}</span>
              </div>
              <p className="text-[10px] text-[var(--dpf-muted)] mt-1 leading-relaxed">{h.summary}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
