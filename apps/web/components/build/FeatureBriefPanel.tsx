// apps/web/components/build/FeatureBriefPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { type FeatureBrief, type BuildPhase, type FeatureBuildRow } from "@/lib/feature-build-types";
import type { AttachmentInfo } from "@/lib/agent-coworker-types";
import { AgentAttachmentCard } from "@/components/agent/AgentAttachmentCard";
import { EvidenceSummary } from "./EvidenceSummary";
import { safeRenderValue } from "@/lib/safe-render";

type Props = {
  brief: FeatureBrief | null;
  phase: BuildPhase;
  diffSummary: string | null;
  attachments?: AttachmentInfo[];
  build?: FeatureBuildRow;
  loading?: boolean;
};

export function FeatureBriefPanel({ brief, phase, diffSummary, attachments, build, loading }: Props) {
  // Track incremental progress messages emitted by ideate-dispatch
  const [progressMsg, setProgressMsg] = useState<string | null>(null);

  useEffect(() => {
    function onProgress(e: Event) {
      const detail = (e as CustomEvent<{ message?: string; type?: string }>).detail;
      if (detail?.message) setProgressMsg(detail.message);
    }
    // build-research-progress carries text messages from ideate-dispatch progress callbacks.
    // Uses a separate event name so BuildStudio's DB refetch isn't triggered on every message.
    window.addEventListener("build-research-progress", onProgress);
    return () => window.removeEventListener("build-research-progress", onProgress);
  }, []);

  if (loading) {
    return (
      <div className="p-4 flex flex-col gap-3 animate-fade-in">
        <div className="h-4 w-32 bg-[var(--dpf-surface-2)] rounded animate-pulse" />
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-2.5 w-20 bg-[var(--dpf-surface-2)] rounded animate-pulse" />
              <div className="h-3.5 bg-[var(--dpf-surface-2)] rounded animate-pulse" style={{ width: `${60 + i * 8}%` }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (phase === "review" || phase === "ship" || phase === "complete") {
    return (
      <div className="p-4">
        <h3 className="text-sm font-bold text-[var(--dpf-text)] mb-3">Build Summary</h3>
        {diffSummary ? (
          <pre className="text-xs text-[var(--dpf-muted)] whitespace-pre-wrap leading-relaxed bg-[var(--dpf-surface-2)] p-3 rounded-md border border-[var(--dpf-border)]">
            {diffSummary}
          </pre>
        ) : (
          <p className="text-sm text-[var(--dpf-muted)]">No changes recorded.</p>
        )}
        {phase === "review" && build && (
          <div className="mt-4">
            <EvidenceSummary build={build} />
          </div>
        )}
      </div>
    );
  }

  // Ideate / Plan phase — show design doc if available, otherwise the feature brief
  const designDoc = build?.designDoc as Record<string, unknown> | null | undefined;
  const designReview = build?.designReview as { decision?: string; summary?: string; issues?: Array<{ severity: string; description: string }> } | null | undefined;

  if (designDoc) {
    const issues = designReview?.issues ?? [];
    const criticalIssues = issues.filter(i => i.severity === "critical");
    const otherIssues = issues.filter(i => i.severity !== "critical");

    return (
      <div className="p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--dpf-text)]">Design Research</h3>
          {designReview && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: designReview.decision === "pass"
                  ? "color-mix(in srgb, var(--dpf-success) 15%, var(--dpf-surface-2))"
                  : "color-mix(in srgb, var(--dpf-warning) 15%, var(--dpf-surface-2))",
                color: designReview.decision === "pass" ? "var(--dpf-success)" : "var(--dpf-warning)",
                border: `1px solid ${designReview.decision === "pass" ? "var(--dpf-success)" : "var(--dpf-warning)"}`,
              }}
            >
              Review: {designReview.decision === "pass" ? "Passed" : "Needs revision"}
            </span>
          )}
        </div>

        {/* Design review issues — show critical ones prominently */}
        {criticalIssues.length > 0 && (
          <div className="rounded-md border border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_8%,var(--dpf-surface-1))] p-3">
            <p className="text-xs font-semibold text-[var(--dpf-error)] mb-1.5">Critical issues to resolve:</p>
            <ul className="flex flex-col gap-1">
              {criticalIssues.map((issue, i) => (
                <li key={i} className="text-xs text-[var(--dpf-text-secondary)] leading-snug">&bull; {issue.description}</li>
              ))}
            </ul>
          </div>
        )}

        {designReview?.summary != null && (
          <DocSection label="Review Summary" value={String(designReview.summary)} />
        )}

        {designDoc.problemStatement != null && (
          <DocSection label="Problem Statement" value={String(designDoc.problemStatement)} />
        )}

        {designDoc.proposedApproach != null && (
          <DocSection label="Proposed Approach" value={String(designDoc.proposedApproach)} />
        )}

        {designDoc.existingFunctionalityAudit != null
          ? <DocSection label="Existing Code Audit" value={String(designDoc.existingFunctionalityAudit)} />
          : null}

        {designDoc.dataModel != null
          ? <DocSection label="Data Model" value={String(designDoc.dataModel)} />
          : null}

        {Array.isArray(designDoc.acceptanceCriteria) && designDoc.acceptanceCriteria.length > 0 && (
          <div>
            <span className="text-xs text-[var(--dpf-muted)] uppercase tracking-wider">Acceptance Criteria</span>
            <ul className="mt-1 pl-4 list-disc flex flex-col gap-0.5">
              {(designDoc.acceptanceCriteria as string[]).map((c, i) => (
                <li key={i} className="text-sm text-[var(--dpf-text-secondary)] leading-relaxed">{String(c)}</li>
              ))}
            </ul>
          </div>
        )}

        {otherIssues.length > 0 && (
          <div>
            <span className="text-xs text-[var(--dpf-muted)] uppercase tracking-wider">Review Findings</span>
            <ul className="mt-1 flex flex-col gap-1">
              {otherIssues.map((issue, i) => (
                <li key={i} className="text-xs text-[var(--dpf-text-secondary)] leading-snug">
                  <span className="font-medium capitalize">{issue.severity}:</span> {issue.description}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // No design doc yet — show brief or placeholder with optional progress indicator
  if (!brief) {
    return (
      <div className="p-4 flex flex-col gap-3">
        {build && <HappyPathStatusCard build={build} />}
        {progressMsg && (
          <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)] animate-pulse">
            <span className="w-2 h-2 rounded-full bg-[var(--dpf-accent)] shrink-0" />
            {progressMsg}
          </div>
        )}
        <p className="text-sm text-[var(--dpf-muted)]">
          Describe your feature idea in the conversation panel. The AI will build a Feature Brief from your description.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      {build && <HappyPathStatusCard build={build} />}
      {progressMsg && (
        <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)] animate-pulse">
          <span className="w-2 h-2 rounded-full bg-[var(--dpf-accent)] shrink-0" />
          {progressMsg}
        </div>
      )}
      <h3 className="text-sm font-bold text-[var(--dpf-text)]">Feature Brief</h3>
      <Section label="Title" value={safeRenderValue(brief.title)} />
      <Section label="Description" value={safeRenderValue(brief.description)} />
      <Section label="Portfolio" value={safeRenderValue(brief.portfolioContext) || "Not set"} />
      <Section label="Target Roles" value={safeRenderValue(brief.targetRoles) || "Not set"} />
      <Section label="Data Needs" value={safeRenderValue(brief.dataNeeds) || "Not set"} />
      {Array.isArray(brief.acceptanceCriteria) && brief.acceptanceCriteria.length > 0 && (
        <div>
          <span className="text-xs text-[var(--dpf-muted)] uppercase tracking-wider">
            Acceptance Criteria
          </span>
          <ul className="mt-1 pl-4 list-disc">
            {brief.acceptanceCriteria.map((c, i) => (
              <li key={i} className="text-sm text-[var(--dpf-text-secondary)] leading-relaxed">{safeRenderValue(c)}</li>
            ))}
          </ul>
        </div>
      )}
      {attachments && attachments.length > 0 && (
        <div>
          <span className="text-xs text-[var(--dpf-muted)] uppercase tracking-wider">
            Attachments
          </span>
          <div className="mt-1">
            {attachments.map((att) => (
              <AgentAttachmentCard key={att.id} attachment={att} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HappyPathStatusCard({ build }: { build: FeatureBuildRow }) {
  const intake = build.happyPathState.intake;
  const execution = build.happyPathState.execution;
  const items = [
    { label: "Taxonomy", value: intake.taxonomyNodeId ?? "Missing", ok: Boolean(intake.taxonomyNodeId) },
    { label: "Backlog", value: intake.backlogItemId ?? "Missing", ok: Boolean(intake.backlogItemId) },
    { label: "Epic", value: intake.epicId ?? "Missing", ok: Boolean(intake.epicId) },
    { label: "Goal", value: intake.constrainedGoal ?? "Missing", ok: Boolean(intake.constrainedGoal) },
  ];

  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-[var(--dpf-text)]">Happy Path Status</span>
        <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider">
          Engine: {execution.engine ?? "Not selected"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-start justify-between gap-3 text-xs">
            <span className="text-[var(--dpf-muted)] uppercase tracking-wider">{item.label}</span>
            <span className={item.ok ? "text-[var(--dpf-text)]" : "text-[var(--dpf-warning)]"}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-[var(--dpf-muted)] leading-snug">
        Stage: {execution.status}
        {execution.failureStage ? ` · failed at ${execution.failureStage}` : ""}
        {intake.failureReason ? ` · ${intake.failureReason}` : ""}
      </div>
    </div>
  );
}

function Section({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-[var(--dpf-muted)] uppercase tracking-wider">{label}</span>
      <p className="text-sm text-[var(--dpf-text-secondary)] mt-0.5 leading-snug">{value}</p>
    </div>
  );
}

function DocSection({ label, value }: { label: string; value: string }) {
  // Sections evaluated by the agent as "Not applicable — <reason>" are rendered
  // as a single muted line so the reader isn't scanning past a wall of boilerplate
  // when the answer is "nothing to do here". The agent still had to evaluate the
  // section to reach this conclusion — we just don't amplify the void.
  const trimmed = value.trim();
  const na = /^not\s+applicable\b/i.test(trimmed);
  if (na) {
    // Strip leading "Not applicable —" so the muted line reads like prose.
    const reason = trimmed.replace(/^not\s+applicable\s*[—\-:]*\s*/i, "").trim();
    return (
      <div>
        <span className="text-xs text-[var(--dpf-muted)] uppercase tracking-wider">{label}</span>
        <p className="text-xs text-[var(--dpf-muted)] mt-0.5 leading-snug italic">
          Not applicable{reason ? ` — ${reason}` : ""}
        </p>
      </div>
    );
  }
  return (
    <div>
      <span className="text-xs text-[var(--dpf-muted)] uppercase tracking-wider">{label}</span>
      <p className="text-sm text-[var(--dpf-text-secondary)] mt-0.5 leading-snug whitespace-pre-wrap">{value}</p>
    </div>
  );
}
