"use client";

import type { FeatureBuildRow } from "@/lib/feature-build-types";

type Props = {
  build: FeatureBuildRow;
};

export function EvidenceSummary({ build }: Props) {
  const items = [
    {
      label: "Design Document",
      status: build.designDoc ? "complete" : "missing",
      detail: build.designDoc ? "Approved" : "Not created",
    },
    {
      label: "Design Review",
      status: build.designReview?.decision === "pass" ? "pass" : build.designReview ? "fail" : "missing",
      detail: build.designReview?.summary ?? "Not reviewed",
    },
    {
      label: "Implementation Plan",
      status: build.buildPlan ? "complete" : "missing",
      detail: build.buildPlan ? `${build.buildPlan.tasks?.length ?? 0} tasks` : "Not created",
    },
    {
      label: "Plan Review",
      status: build.planReview?.decision === "pass" ? "pass" : build.planReview ? "fail" : "missing",
      detail: build.planReview?.summary ?? "Not reviewed",
    },
    {
      label: "Verification",
      status: build.verificationOut
        ? (build.verificationOut.testsFailed === 0 && build.verificationOut.typecheckPassed ? "pass" : "fail")
        : "missing",
      detail: build.verificationOut
        ? `${build.verificationOut.testsPassed} passed, ${build.verificationOut.testsFailed} failed`
        : "Not run",
    },
    {
      label: "Acceptance Criteria",
      status: build.acceptanceMet
        ? (build.acceptanceMet.every((c) => c.met) ? "pass" : "fail")
        : "missing",
      detail: build.acceptanceMet
        ? `${build.acceptanceMet.filter((c) => c.met).length}/${build.acceptanceMet.length} met`
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
    pass: "#4ade80",
    complete: "#4ade80",
    fail: "#f87171",
    missing: "#8888a0",
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-[var(--dpf-text)] uppercase tracking-widest">Evidence Chain</h3>
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: STATUS_COLORS[item.status] ?? "#8888a0" }}
            title={item.status}
          />
          <span className="text-xs text-[var(--dpf-text)] flex-1">{item.label}</span>
          <span className="text-[10px] text-[var(--dpf-muted)]">{item.detail}</span>
        </div>
      ))}
    </div>
  );
}
