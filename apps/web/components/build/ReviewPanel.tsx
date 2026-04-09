// apps/web/components/build/ReviewPanel.tsx
"use client";

import { useState } from "react";
import type {
  FeatureBuildRow,
  FeatureBrief,
  BuildDesignDoc,
  BuildPlanDoc,
  TaskResult,
  VerificationOutput,
  AcceptanceCriterion,
} from "@/lib/feature-build-types";
import { safeRenderValue } from "@/lib/safe-render";

type Props = {
  build: FeatureBuildRow;
};

export function ReviewPanel({ build }: Props) {
  return (
    <div className="p-4 space-y-3 max-w-3xl">
      <h3 className="text-sm font-bold text-[var(--dpf-text)]">Review: {build.title}</h3>

      {/* Compact evidence bar */}
      <EvidenceBar build={build} />

      {/* Collapsible sections */}
      <BriefSection brief={build.brief} />
      <DesignDocSection doc={build.designDoc} review={build.designReview} />
      <BuildPlanSection plan={build.buildPlan} review={build.planReview} />
      <TaskResultsSection results={build.taskResults} />
      <VerificationSection verification={build.verificationOut} />
      <AcceptanceSection criteria={build.acceptanceMet} />
      <CodeChangesSection diffSummary={build.diffSummary} diffPatch={build.diffPatch} />
      <UxTestsSection results={build.uxTestResults} />
    </div>
  );
}

/* ── Collapsible wrapper ─────────────────────────────────────────────────── */

function Section({
  title,
  badge,
  badgeColor,
  defaultOpen = false,
  hidden = false,
  children,
}: {
  title: string;
  badge?: string;
  badgeColor?: string;
  defaultOpen?: boolean;
  hidden?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (hidden) return null;

  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-dpf-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-[var(--dpf-surface-2)] transition-colors rounded-md"
      >
        <span className="text-[10px] text-[var(--dpf-muted)] w-4 text-center select-none">
          {open ? "\u25BC" : "\u25B6"}
        </span>
        <span className="text-xs font-semibold text-[var(--dpf-text)] flex-1">{title}</span>
        {badge && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={{
              background: `color-mix(in srgb, ${badgeColor ?? "var(--dpf-muted)"} 15%, transparent)`,
              color: badgeColor ?? "var(--dpf-muted)",
            }}
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--dpf-border)] animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Evidence bar ────────────────────────────────────────────────────────── */

function EvidenceBar({ build }: { build: FeatureBuildRow }) {
  const items = [
    { label: "Design", ok: !!build.designDoc && build.designReview?.decision === "pass" },
    { label: "Plan", ok: !!build.buildPlan && build.planReview?.decision === "pass" },
    { label: "Build", ok: (build.taskResults?.length ?? 0) > 0 },
    { label: "Verify", ok: build.verificationOut?.typecheckPassed === true },
    {
      label: "AC",
      ok: build.acceptanceMet
        ? Array.isArray(build.acceptanceMet)
          ? build.acceptanceMet.every((c) => c.met)
          : true
        : false,
    },
  ];

  return (
    <div className="flex items-center gap-1 px-3 py-2 rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-1">
          {i > 0 && <span className="text-[var(--dpf-border)] mx-0.5">&middot;</span>}
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: item.ok ? "var(--dpf-success)" : "var(--dpf-muted)" }}
          />
          <span className="text-[10px] text-[var(--dpf-muted)]">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Feature Brief ───────────────────────────────────────────────────────── */

function BriefSection({ brief }: { brief: FeatureBrief | null }) {
  return (
    <Section
      title="Feature Brief"
      badge={brief ? "Complete" : "Missing"}
      badgeColor={brief ? "var(--dpf-success)" : "var(--dpf-muted)"}
      defaultOpen={true}
      hidden={!brief}
    >
      {brief && (
        <div className="space-y-2 text-sm">
          <Field label="Description" value={brief.description} />
          <Field label="Portfolio Context" value={brief.portfolioContext} />
          {brief.targetRoles.length > 0 && (
            <Field label="Target Roles" value={brief.targetRoles.join(", ")} />
          )}
          <Field label="Data Needs" value={brief.dataNeeds} />
          {brief.acceptanceCriteria.length > 0 && (
            <div>
              <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider">
                Acceptance Criteria
              </span>
              <ul className="mt-1 pl-4 list-disc">
                {brief.acceptanceCriteria.map((c, i) => (
                  <li key={i} className="text-xs text-[var(--dpf-text-secondary)] leading-relaxed">
                    {safeRenderValue(c)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/* ── Design Document ─────────────────────────────────────────────────────── */

function DesignDocSection({
  doc,
  review,
}: {
  doc: BuildDesignDoc | null;
  review: FeatureBuildRow["designReview"];
}) {
  const reviewBadge = review
    ? review.decision === "pass" ? "Approved" : "Failed"
    : doc ? "Not reviewed" : "Missing";
  const reviewColor = review?.decision === "pass"
    ? "var(--dpf-success)"
    : review?.decision === "fail"
    ? "var(--dpf-error)"
    : "var(--dpf-muted)";

  return (
    <Section title="Design Document" badge={reviewBadge} badgeColor={reviewColor} hidden={!doc}>
      {doc && (
        <div className="space-y-2 text-sm">
          <Field label="Problem Statement" value={doc.problemStatement} />
          <Field label="Proposed Approach" value={doc.proposedApproach} />
          <Field label="Existing Functionality Audit" value={doc.existingFunctionalityAudit} />
          <Field label="Reuse Plan" value={doc.reusePlan} />
          {doc.newCodeJustification && (
            <Field label="New Code Justification" value={doc.newCodeJustification} />
          )}
          {doc.acceptanceCriteria.length > 0 && (
            <div>
              <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider">
                Design Acceptance Criteria
              </span>
              <ul className="mt-1 pl-4 list-disc">
                {doc.acceptanceCriteria.map((c, i) => (
                  <li key={i} className="text-xs text-[var(--dpf-text-secondary)] leading-relaxed">
                    {safeRenderValue(c)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review && (
            <ReviewBadgeBlock decision={review.decision} summary={review.summary} issues={review.issues} />
          )}
        </div>
      )}
    </Section>
  );
}

/* ── Build Plan ──────────────────────────────────────────────────────────── */

function BuildPlanSection({
  plan,
  review,
}: {
  plan: BuildPlanDoc | null;
  review: FeatureBuildRow["planReview"];
}) {
  const taskCount = plan?.tasks?.length ?? 0;
  const badge = plan ? `${taskCount} task${taskCount !== 1 ? "s" : ""}` : "Missing";
  const reviewColor = review?.decision === "pass"
    ? "var(--dpf-success)"
    : review?.decision === "fail"
    ? "var(--dpf-error)"
    : "var(--dpf-muted)";

  return (
    <Section title="Build Plan" badge={badge} badgeColor={plan ? reviewColor : "var(--dpf-muted)"} hidden={!plan}>
      {plan && (
        <div className="space-y-3">
          {/* File structure */}
          {plan.fileStructure && plan.fileStructure.length > 0 && (
            <div>
              <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider">
                File Changes
              </span>
              <div className="mt-1 space-y-0.5">
                {plan.fileStructure.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs font-mono">
                    <span
                      className="text-[10px] px-1 rounded"
                      style={{
                        background: f.action === "create"
                          ? "color-mix(in srgb, var(--dpf-success) 15%, transparent)"
                          : "color-mix(in srgb, var(--dpf-warning) 15%, transparent)",
                        color: f.action === "create" ? "var(--dpf-success)" : "var(--dpf-warning)",
                      }}
                    >
                      {f.action}
                    </span>
                    <span className="text-[var(--dpf-text-secondary)]">{f.path}</span>
                    <span className="text-[var(--dpf-muted)] text-[10px] font-sans">{f.purpose}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Task list */}
          {plan.tasks && plan.tasks.length > 0 && (
            <div>
              <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider">
                Tasks
              </span>
              <div className="mt-1 space-y-1">
                {plan.tasks.map((t, i) => (
                  <div key={i} className="px-2 py-1.5 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-xs">
                    <span className="text-[var(--dpf-muted)] mr-1.5">{i + 1}.</span>
                    <span className="text-[var(--dpf-text)]">{t.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {review && (
            <ReviewBadgeBlock decision={review.decision} summary={review.summary} issues={review.issues} />
          )}
        </div>
      )}
    </Section>
  );
}

/* ── Task Results ────────────────────────────────────────────────────────── */

function TaskResultsSection({ results }: { results: TaskResult[] | null }) {
  const [expandedTask, setExpandedTask] = useState<number | null>(null);
  if (!results || results.length === 0) return null;

  const passCount = results.filter((r) => r.testResult.passed && r.codeReview.decision === "pass").length;
  const badge = `${passCount}/${results.length} passed`;
  const allPass = passCount === results.length;

  return (
    <Section
      title="Task Results"
      badge={badge}
      badgeColor={allPass ? "var(--dpf-success)" : "var(--dpf-warning)"}
      defaultOpen={true}
    >
      <div className="space-y-1">
        {results.map((r) => {
          const taskPass = r.testResult.passed && r.codeReview.decision === "pass";
          const isExpanded = expandedTask === r.taskIndex;

          return (
            <div key={r.taskIndex}>
              <button
                type="button"
                onClick={() => setExpandedTask(isExpanded ? null : r.taskIndex)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left cursor-pointer hover:bg-[var(--dpf-surface-2)] transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: taskPass ? "var(--dpf-success)" : "var(--dpf-error)" }}
                />
                <span className="text-xs text-[var(--dpf-muted)] w-5 shrink-0">#{r.taskIndex + 1}</span>
                <span className="text-xs text-[var(--dpf-text)] flex-1">{r.title}</span>
                <span className="text-[10px] text-[var(--dpf-muted)]">
                  {isExpanded ? "\u25BC" : "\u25B6"}
                </span>
              </button>

              {isExpanded && (
                <div className="ml-9 mt-1 mb-2 space-y-2 animate-fade-in">
                  {/* Test result */}
                  <div className="text-xs">
                    <span className="text-[var(--dpf-muted)]">Test: </span>
                    <span style={{ color: r.testResult.passed ? "var(--dpf-success)" : "var(--dpf-error)" }}>
                      {r.testResult.passed ? "Passed" : "Failed"}
                    </span>
                    {r.testResult.output && (
                      <pre className="mt-1 p-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[10px] text-[var(--dpf-muted)] whitespace-pre-wrap leading-relaxed max-h-32 overflow-auto">
                        {r.testResult.output}
                      </pre>
                    )}
                  </div>

                  {/* Code review */}
                  <div className="text-xs">
                    <span className="text-[var(--dpf-muted)]">Code Review: </span>
                    <span style={{ color: r.codeReview.decision === "pass" ? "var(--dpf-success)" : "var(--dpf-error)" }}>
                      {r.codeReview.decision === "pass" ? "Approved" : "Issues found"}
                    </span>
                    {r.codeReview.summary && (
                      <p className="mt-0.5 text-[var(--dpf-muted)] text-[10px] leading-relaxed">
                        {safeRenderValue(r.codeReview.summary)}
                      </p>
                    )}
                    {r.codeReview.issues.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {r.codeReview.issues.map((issue, j) => (
                          <div
                            key={j}
                            className="flex items-start gap-1.5 text-[10px] px-2 py-1 rounded"
                            style={{
                              background: issue.severity === "critical"
                                ? "color-mix(in srgb, var(--dpf-error) 8%, transparent)"
                                : "var(--dpf-surface-2)",
                            }}
                          >
                            <span
                              className="shrink-0 uppercase font-semibold"
                              style={{
                                color: issue.severity === "critical"
                                  ? "var(--dpf-error)"
                                  : issue.severity === "important"
                                  ? "var(--dpf-warning)"
                                  : "var(--dpf-muted)",
                              }}
                            >
                              {issue.severity}
                            </span>
                            <span className="text-[var(--dpf-text-secondary)]">
                              {issue.description}
                              {issue.location && (
                                <span className="text-[var(--dpf-muted)] ml-1">({issue.location})</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {r.commitSha && (
                    <div className="text-[10px] text-[var(--dpf-muted)] font-mono">
                      Commit: {r.commitSha.slice(0, 8)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ── Verification ────────────────────────────────────────────────────────── */

function VerificationSection({ verification }: { verification: VerificationOutput | null }) {
  if (!verification) return null;

  const badge = verification.typecheckPassed ? "Passed" : "Failed";
  const badgeColor = verification.typecheckPassed ? "var(--dpf-success)" : "var(--dpf-error)";

  return (
    <Section title="Verification" badge={badge} badgeColor={badgeColor}>
      <div className="space-y-2">
        <div className="flex gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: verification.typecheckPassed ? "var(--dpf-success)" : "var(--dpf-error)" }}
            />
            <span className="text-[var(--dpf-text)]">
              Typecheck: {verification.typecheckPassed ? "pass" : "fail"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--dpf-text)]">
              Tests: {verification.testsPassed} passed
              {verification.testsFailed > 0 && (
                <span className="text-[var(--dpf-warning)]"> / {verification.testsFailed} failed</span>
              )}
            </span>
          </div>
        </div>
        {verification.fullOutput && (
          <pre className="p-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[10px] text-[var(--dpf-muted)] whitespace-pre-wrap leading-relaxed max-h-48 overflow-auto">
            {verification.fullOutput}
          </pre>
        )}
        {verification.timestamp && (
          <div className="text-[10px] text-[var(--dpf-muted)]">
            Run at: {new Date(verification.timestamp).toLocaleString()}
          </div>
        )}
      </div>
    </Section>
  );
}

/* ── Acceptance Criteria ─────────────────────────────────────────────────── */

function AcceptanceSection({ criteria }: { criteria: AcceptanceCriterion[] | null }) {
  if (!criteria || !Array.isArray(criteria) || criteria.length === 0) return null;

  const metCount = criteria.filter((c) => c.met).length;
  const allMet = metCount === criteria.length;
  const badge = `${metCount}/${criteria.length} met`;

  return (
    <Section
      title="Acceptance Criteria"
      badge={badge}
      badgeColor={allMet ? "var(--dpf-success)" : "var(--dpf-warning)"}
      defaultOpen={!allMet}
    >
      <div className="space-y-1">
        {criteria.map((c, i) => (
          <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
            <span className="text-xs mt-0.5" style={{ color: c.met ? "var(--dpf-success)" : "var(--dpf-error)" }}>
              {c.met ? "\u2611" : "\u2610"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[var(--dpf-text)]">{safeRenderValue(c.criterion)}</div>
              {c.evidence && (
                <div className="text-[10px] text-[var(--dpf-muted)] mt-0.5 leading-relaxed">
                  {safeRenderValue(c.evidence)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── Code Changes ────────────────────────────────────────────────────────── */

function CodeChangesSection({
  diffSummary,
  diffPatch,
}: {
  diffSummary: string | null;
  diffPatch: string | null;
}) {
  const [showPatch, setShowPatch] = useState(false);
  if (!diffSummary && !diffPatch) return null;

  return (
    <Section title="Code Changes" badge={diffSummary ? "Available" : undefined} badgeColor="var(--dpf-accent)">
      <div className="space-y-2">
        {diffSummary && (
          <pre className="p-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[10px] text-[var(--dpf-muted)] whitespace-pre-wrap leading-relaxed">
            {diffSummary}
          </pre>
        )}
        {diffPatch && (
          <>
            <button
              type="button"
              onClick={() => setShowPatch(!showPatch)}
              className="text-[10px] text-[var(--dpf-accent)] hover:underline cursor-pointer"
            >
              {showPatch ? "Hide full diff" : "Show full diff"}
            </button>
            {showPatch && (
              <pre className="p-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[10px] text-[var(--dpf-muted)] whitespace-pre-wrap leading-relaxed max-h-96 overflow-auto font-mono">
                {diffPatch}
              </pre>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

/* ── UX Tests ────────────────────────────────────────────────────────────── */

function UxTestsSection({
  results,
}: {
  results: FeatureBuildRow["uxTestResults"];
}) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  if (!results || results.length === 0) return null;

  const passCount = results.filter((s) => s.passed).length;
  const allPass = passCount === results.length;
  const badge = `${passCount}/${results.length} passed`;

  return (
    <Section
      title="UX Test Results"
      badge={badge}
      badgeColor={allPass ? "var(--dpf-success)" : "var(--dpf-error)"}
      defaultOpen={!allPass}
    >
      <div className="space-y-1">
        {results.map((s, i) => (
          <div key={i}>
            <button
              type="button"
              onClick={() => setExpandedStep(expandedStep === i ? null : i)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left cursor-pointer hover:bg-[var(--dpf-surface-2)] transition-colors border ${
                s.passed
                  ? "border-[var(--dpf-border)]"
                  : "border-[color-mix(in_srgb,var(--dpf-error)_25%,var(--dpf-border))]"
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: s.passed ? "var(--dpf-success)" : "var(--dpf-error)" }}
              />
              <span className="text-xs text-[var(--dpf-text)] flex-1">{s.step}</span>
              <span className="text-[10px] text-[var(--dpf-muted)]">
                {s.passed ? "PASS" : "FAIL"}
              </span>
            </button>
            {expandedStep === i && (
              <div className="mt-1 ml-4 p-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] animate-fade-in">
                {s.screenshotUrl && (
                  <img src={s.screenshotUrl} alt={`Step ${i + 1}`} className="rounded border border-[var(--dpf-border)] mb-2 max-w-full" />
                )}
                {s.error && (
                  <pre className="text-[10px] text-[var(--dpf-error)] whitespace-pre-wrap">{s.error}</pre>
                )}
                {!s.screenshotUrl && !s.error && (
                  <span className="text-[10px] text-[var(--dpf-muted)]">No details available</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── Shared helpers ──────────────────────────────────────────────────────── */

function Field({ label, value }: { label: string; value: string | undefined | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider">{label}</span>
      <p className="text-xs text-[var(--dpf-text-secondary)] mt-0.5 leading-relaxed">{safeRenderValue(value)}</p>
    </div>
  );
}

function ReviewBadgeBlock({
  decision,
  summary,
  issues,
}: {
  decision: "pass" | "fail";
  summary: string;
  issues: Array<{ severity: string; description: string }>;
}) {
  return (
    <div
      className="mt-2 px-2 py-1.5 rounded border text-xs"
      style={{
        borderColor: decision === "pass"
          ? "color-mix(in srgb, var(--dpf-success) 30%, var(--dpf-border))"
          : "color-mix(in srgb, var(--dpf-error) 30%, var(--dpf-border))",
        background: decision === "pass"
          ? "color-mix(in srgb, var(--dpf-success) 5%, transparent)"
          : "color-mix(in srgb, var(--dpf-error) 5%, transparent)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: decision === "pass" ? "var(--dpf-success)" : "var(--dpf-error)" }}
        />
        <span className="font-medium text-[var(--dpf-text)]">
          Review: {decision === "pass" ? "Approved" : "Changes requested"}
        </span>
      </div>
      {summary && (
        <p className="text-[10px] text-[var(--dpf-muted)] mt-1 leading-relaxed">{safeRenderValue(summary)}</p>
      )}
      {issues.length > 0 && (
        <div className="mt-1 text-[10px] text-[var(--dpf-muted)]">
          {issues.length} issue{issues.length !== 1 ? "s" : ""} noted
        </div>
      )}
    </div>
  );
}
