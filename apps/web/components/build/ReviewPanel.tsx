// apps/web/components/build/ReviewPanel.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatText } from "@/lib/actions/local-format";
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
      <TaskResultsSection results={Array.isArray(build.taskResults) ? build.taskResults : Array.isArray((build.taskResults as any)?.tasks) ? (build.taskResults as any).tasks : null} />
      <VerificationSection verification={build.verificationOut} />
      <AcceptanceSection criteria={build.acceptanceMet} />
      <CodeChangesSection diffSummary={build.diffSummary} diffPatch={build.diffPatch} />
      <ManualTestSteps criteria={build.acceptanceMet} title={build.title} />
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
    { label: "Build", ok: Array.isArray(build.taskResults) ? build.taskResults.length > 0 : Array.isArray((build.taskResults as any)?.tasks) && (build.taskResults as any).tasks.length > 0 },
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
  const [formatted, setFormatted] = useState<Record<string, string>>({});
  const [isFormatting, startFormatting] = useTransition();

  const reviewBadge = review
    ? review.decision === "pass" ? "Approved" : "Failed"
    : doc ? "Not reviewed" : "Missing";
  const reviewColor = review?.decision === "pass"
    ? "var(--dpf-success)"
    : review?.decision === "fail"
    ? "var(--dpf-error)"
    : "var(--dpf-muted)";

  function handleFormat() {
    if (!doc) return;
    startFormatting(async () => {
      const fields = [
        { key: "proposedApproach", value: doc.proposedApproach },
        { key: "dataModel", value: doc.dataModel },
        { key: "existingCodeAudit", value: doc.existingCodeAudit ?? doc.existingFunctionalityAudit },
        { key: "reusePlan", value: doc.reusePlan },
      ];
      const results: Record<string, string> = {};
      for (const f of fields) {
        if (f.value && f.value.length > 100) {
          results[f.key] = await formatText(f.value, doc.problemStatement);
        }
      }
      setFormatted(results);
    });
  }

  return (
    <Section title="Design Document" badge={reviewBadge} badgeColor={reviewColor} hidden={!doc}>
      {doc && (
        <div className="space-y-2 text-sm">
          {Object.keys(formatted).length === 0 && (
            <button
              type="button"
              onClick={handleFormat}
              disabled={isFormatting}
              className="text-[10px] text-[var(--dpf-accent)] hover:underline cursor-pointer disabled:opacity-50"
            >
              {isFormatting ? "Formatting with local AI..." : "Format for readability"}
            </button>
          )}
          <Field label="Problem Statement" value={doc.problemStatement} />
          <Field label="Proposed Approach" value={formatted.proposedApproach ?? doc.proposedApproach} />
          {doc.dataModel && <Field label="Data Model" value={formatted.dataModel ?? doc.dataModel} />}
          <Field label="Existing Code Audit" value={formatted.existingCodeAudit ?? doc.existingCodeAudit ?? doc.existingFunctionalityAudit ?? ""} />
          <Field label="Reuse Plan" value={formatted.reusePlan ?? doc.reusePlan} />
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

  // Handle both old shape (testResult/codeReview) and orchestrator shape (outcome/specialist)
  const passCount = results.filter((r) => {
    if (r.testResult && r.codeReview) return r.testResult.passed && r.codeReview.decision === "pass";
    return (r as any).outcome === "DONE" || (r as any).outcome === "DONE_WITH_CONCERNS";
  }).length;
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
        {results.map((r, idx) => {
          // Support both orchestrator shape (outcome/specialist) and legacy shape (testResult/codeReview)
          const raw = r as any;
          const taskPass = raw.testResult && raw.codeReview
            ? raw.testResult.passed && raw.codeReview.decision === "pass"
            : raw.outcome === "DONE" || raw.outcome === "DONE_WITH_CONCERNS";
          const taskIndex = r.taskIndex ?? idx;
          const isExpanded = expandedTask === taskIndex;
          const outcomeLabel = raw.outcome ?? (taskPass ? "DONE" : "BLOCKED");
          const specialistLabel = raw.specialist ?? "unknown";
          const durationLabel = raw.durationMs ? `${(raw.durationMs / 1000).toFixed(0)}s` : "";

          return (
            <div key={taskIndex}>
              <button
                type="button"
                onClick={() => setExpandedTask(isExpanded ? null : taskIndex)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left cursor-pointer hover:bg-[var(--dpf-surface-2)] transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: taskPass ? "var(--dpf-success)" : "var(--dpf-error)" }}
                />
                <span className="text-xs text-[var(--dpf-muted)] w-5 shrink-0">#{taskIndex + 1}</span>
                <span className="text-xs text-[var(--dpf-text)] flex-1">{r.title}</span>
                <span className="text-[10px] text-[var(--dpf-muted)]">
                  {durationLabel} {isExpanded ? "\u25BC" : "\u25B6"}
                </span>
              </button>

              {isExpanded && (
                <div className="ml-9 mt-1 mb-2 space-y-2 animate-fade-in">
                  {/* Orchestrator shape: outcome + specialist */}
                  <div className="text-xs flex gap-3">
                    <span>
                      <span className="text-[var(--dpf-muted)]">Outcome: </span>
                      <span style={{ color: taskPass ? "var(--dpf-success)" : "var(--dpf-error)" }}>
                        {outcomeLabel}
                      </span>
                    </span>
                    <span>
                      <span className="text-[var(--dpf-muted)]">Specialist: </span>
                      <span className="text-[var(--dpf-text)]">{specialistLabel}</span>
                    </span>
                  </div>

                  {/* Legacy shape: test result + code review (if present) */}
                  {raw.testResult && (
                    <div className="text-xs">
                      <span className="text-[var(--dpf-muted)]">Test: </span>
                      <span style={{ color: raw.testResult.passed ? "var(--dpf-success)" : "var(--dpf-error)" }}>
                        {raw.testResult.passed ? "Passed" : "Failed"}
                      </span>
                      {raw.testResult.output && (
                        <pre className="mt-1 p-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[10px] text-[var(--dpf-muted)] whitespace-pre-wrap leading-relaxed max-h-32 overflow-auto">
                          {raw.testResult.output}
                        </pre>
                      )}
                    </div>
                  )}

                  {raw.codeReview && (
                    <div className="text-xs">
                      <span className="text-[var(--dpf-muted)]">Code Review: </span>
                      <span style={{ color: raw.codeReview.decision === "pass" ? "var(--dpf-success)" : "var(--dpf-error)" }}>
                        {raw.codeReview.decision === "pass" ? "Approved" : "Issues found"}
                      </span>
                    </div>
                  )}

                  {/* Content/summary from orchestrator */}
                  {raw.content && (
                    <pre className="p-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[10px] text-[var(--dpf-muted)] whitespace-pre-wrap leading-relaxed max-h-32 overflow-auto">
                      {typeof raw.content === "string" ? raw.content.slice(0, 500) : JSON.stringify(raw.content).slice(0, 500)}
                    </pre>
                  )}

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

function parseVerificationErrors(output: string | undefined | null): string[] {
  if (!output) return [];
  const errors: string[] = [];
  // TypeScript errors: src/file.ts(line,col): error TS1234: message
  for (const match of output.matchAll(/([^\s]+\.tsx?)\((\d+),\d+\):\s*error\s+TS\d+:\s*(.+)/g)) {
    errors.push(`${match[1]}:${match[2]} — ${match[3]}`);
  }
  // Next.js / generic errors: Error: message at file
  if (errors.length === 0) {
    for (const match of output.matchAll(/(?:Error|error):\s*(.{10,80})/g)) {
      errors.push(match[1].trim());
      if (errors.length >= 5) break;
    }
  }
  return errors;
}

function VerificationSection({ verification }: { verification: VerificationOutput | null }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!verification) return null;

  const allPassed = verification.typecheckPassed && verification.testsFailed === 0;
  const badge = allPassed ? "Passed" : "Failed";
  const badgeColor = allPassed ? "var(--dpf-success)" : "var(--dpf-error)";

  const errors = parseVerificationErrors(verification.fullOutput);
  const totalTests = verification.testsPassed + verification.testsFailed;

  return (
    <Section title="Verification" badge={badge} badgeColor={badgeColor} defaultOpen={!allPassed}>
      <div className="space-y-2">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className={`rounded border p-2 ${verification.typecheckPassed ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
            <div className="text-[10px] text-[var(--dpf-muted)]">TypeCheck</div>
            <div className="text-xs font-medium text-[var(--dpf-text)]">
              {verification.typecheckPassed ? "No errors" : `${errors.length} error${errors.length === 1 ? "" : "s"}`}
            </div>
          </div>
          <div className={`rounded border p-2 ${verification.testsFailed === 0 ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
            <div className="text-[10px] text-[var(--dpf-muted)]">Tests</div>
            <div className="text-xs font-medium text-[var(--dpf-text)]">
              {totalTests > 0
                ? `${verification.testsPassed} passed${verification.testsFailed > 0 ? `, ${verification.testsFailed} failed` : ""}`
                : "No tests run"}
            </div>
          </div>
        </div>

        {/* Parsed error list */}
        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.slice(0, 8).map((err, i) => (
              <div key={i} className="text-[10px] text-[var(--dpf-error)] bg-red-500/5 rounded px-2 py-1 border border-red-500/20 font-mono">
                {err}
              </div>
            ))}
            {errors.length > 8 && (
              <div className="text-[10px] text-[var(--dpf-muted)]">... and {errors.length - 8} more errors</div>
            )}
          </div>
        )}

        {/* Raw output toggle */}
        {verification.fullOutput && (
          <>
            <button
              type="button"
              onClick={() => setShowRaw(!showRaw)}
              className="text-[10px] text-[var(--dpf-accent)] hover:underline cursor-pointer"
            >
              {showRaw ? "Hide raw output" : "Show raw output"}
            </button>
            {showRaw && (
              <pre className="p-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[10px] text-[var(--dpf-muted)] whitespace-pre-wrap leading-relaxed max-h-48 overflow-auto">
                {verification.fullOutput}
              </pre>
            )}
          </>
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

type ParsedFileChange = { path: string; operation: "new" | "modified" | "deleted"; shortPath: string };

function parseFileChanges(diff: string): ParsedFileChange[] {
  const files: ParsedFileChange[] = [];
  const segments: Array<{ path: string; start: number }> = [];
  const headerRe = /^diff --git a\/(.+) b\/(.+)$/gm;
  let m;
  while ((m = headerRe.exec(diff)) !== null) {
    segments.push({ path: m[2], start: m.index });
  }
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const end = i + 1 < segments.length ? segments[i + 1].start : diff.length;
    const block = diff.slice(seg.start, end);
    const operation = block.includes("--- /dev/null") ? "new"
      : block.includes("+++ /dev/null") ? "deleted"
      : "modified";
    const shortPath = seg.path.replace(/^apps\/web\//, "").replace(/^packages\/db\//, "db/");
    files.push({ path: seg.path, operation, shortPath });
  }
  return files;
}

function CodeChangesSection({
  diffSummary,
  diffPatch,
}: {
  diffSummary: string | null;
  diffPatch: string | null;
}) {
  const [showPatch, setShowPatch] = useState(false);
  if (!diffSummary && !diffPatch) return null;

  const files = diffPatch ? parseFileChanges(diffPatch) : [];
  const newCount = files.filter((f) => f.operation === "new").length;
  const modCount = files.filter((f) => f.operation === "modified").length;
  const delCount = files.filter((f) => f.operation === "deleted").length;
  const badge = files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"}` : "Available";

  const opColors: Record<string, string> = {
    new: "var(--dpf-success)",
    modified: "var(--dpf-accent)",
    deleted: "var(--dpf-error)",
  };
  const opLabels: Record<string, string> = {
    new: "new",
    modified: "mod",
    deleted: "del",
  };

  return (
    <Section title="Code Changes" badge={badge} badgeColor="var(--dpf-accent)">
      <div className="space-y-2">
        {/* Summary counts */}
        {files.length > 0 && (
          <div className="flex gap-3 text-[10px] text-[var(--dpf-muted)]">
            {newCount > 0 && <span style={{ color: opColors.new }}>{newCount} new</span>}
            {modCount > 0 && <span style={{ color: opColors.modified }}>{modCount} modified</span>}
            {delCount > 0 && <span style={{ color: opColors.deleted }}>{delCount} deleted</span>}
          </div>
        )}

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-0.5">
            {files.map((file, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
                <span
                  className="text-[9px] font-medium px-1 rounded"
                  style={{ color: opColors[file.operation], background: `${opColors[file.operation]}15` }}
                >
                  {opLabels[file.operation]}
                </span>
                <span className="text-[10px] font-mono text-[var(--dpf-text)] truncate">{file.shortPath}</span>
              </div>
            ))}
          </div>
        )}

        {/* Full diff toggle */}
        {diffPatch && (
          <>
            <button
              type="button"
              onClick={() => setShowPatch(!showPatch)}
              className="text-[10px] text-[var(--dpf-accent)] hover:underline cursor-pointer"
            >
              {showPatch ? "Hide full diff" : "View full diff"}
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

/* ── Manual Test Steps ──────────────────────────────────────────────────── */

function ManualTestSteps({
  criteria,
  title,
}: {
  criteria: AcceptanceCriterion[] | null;
  title: string;
}) {
  if (!criteria || !Array.isArray(criteria) || criteria.length === 0) return null;

  return (
    <Section title="Test It Yourself" badge={`${criteria.length} step${criteria.length === 1 ? "" : "s"}`} badgeColor="var(--dpf-accent)">
      <div className="space-y-0">
        <p className="text-[10px] text-[var(--dpf-muted)] mb-2">
          Manual walkthrough for <strong>{title}</strong>:
        </p>
        <ol className="space-y-1.5">
          {criteria.map((c, i) => (
            <li key={i} className="flex items-start gap-2 px-2 py-1.5 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
              <span className="text-[10px] font-bold text-[var(--dpf-accent)] mt-0.5 shrink-0 w-4 text-right">
                {i + 1}.
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--dpf-text)]">{safeRenderValue(c.criterion)}</div>
                {c.evidence && (
                  <div className="text-[10px] text-[var(--dpf-muted)] mt-0.5 italic">
                    Expected: {safeRenderValue(c.evidence)}
                  </div>
                )}
              </div>
              <span className="text-[10px] mt-0.5" style={{ color: c.met ? "var(--dpf-success)" : "var(--dpf-muted)" }}>
                {c.met ? "verified" : "untested"}
              </span>
            </li>
          ))}
        </ol>
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
