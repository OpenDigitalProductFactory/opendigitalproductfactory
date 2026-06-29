"use client";

import type { FeatureBuildRow, BuildPhase } from "@/lib/feature-build-types";
import type { BuildStudioBranchBadge } from "./build-studio-branch-badge";

export function formatOperatorPhaseLabel(phase: BuildPhase): string {
  switch (phase) {
    case "ideate":
      return "Designing";
    case "plan":
      return "Planning";
    case "build":
      return "Building";
    case "review":
      return "Reviewing";
    case "ship":
      return "Release decision";
    case "complete":
      return "Complete";
    case "failed":
      return "Blocked";
    default:
      return "Working";
  }
}

function formatOperatorDate(value: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function compactOperatorLine(value: string, maxLength = 190): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const sentenceBreak = normalized.lastIndexOf(".", maxLength);
  const cutAt = sentenceBreak >= 80 ? sentenceBreak + 1 : maxLength;
  return `${normalized.slice(0, cutAt).trim()}...`;
}

export function BuildOperatorHeaderDetails({
  build,
  branchBadge,
  engineerView,
}: {
  build: FeatureBuildRow;
  branchBadge: BuildStudioBranchBadge | null;
  engineerView: boolean;
}) {
  if (!engineerView) {
    return (
      <>
        <span className="font-medium text-[var(--dpf-text)]">AI Coworker is handling this build.</span>
        <span>&middot;</span>
        <span>{formatOperatorPhaseLabel(build.phase)}</span>
        <span>&middot;</span>
        <span>Updated {formatOperatorDate(build.updatedAt)}</span>
      </>
    );
  }

  return (
    <>
      <span data-testid="build-studio-build-id">{build.buildId}</span>
      {build.originator && (
        <>
          <span>&middot;</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 font-medium text-[var(--dpf-text)]">
            {build.originator.itemId}
          </span>
        </>
      )}
      {branchBadge && (
        <>
          <span>&middot;</span>
          <span
            className="inline-flex max-w-full min-w-0 items-center gap-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-1.5 py-0.5 font-mono"
            title={branchBadge.title}
          >
            <svg className="shrink-0" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
            </svg>
            <span className="truncate">{branchBadge.value}</span>
          </span>
        </>
      )}
    </>
  );
}

export function BuildWorkRequestStrip({
  build,
  onOpenWorkRequest,
}: {
  build: FeatureBuildRow;
  onOpenWorkRequest: () => void;
}) {
  if (!build.originator) return null;

  return (
    <div className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--dpf-muted)]">
        <span className="font-semibold text-[var(--dpf-text)]">Work request</span>
        <button
          type="button"
          onClick={onOpenWorkRequest}
          title="Open the full work request"
          className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
          data-testid="build-studio-canonical-doc-trigger"
        >
          {build.originator.title}
        </button>
        <span className="inline-flex items-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 font-medium text-[var(--dpf-muted)]">
          {formatOperatorPhaseLabel(build.phase)}
        </span>
      </div>
      {build.originator.resolution && (
        <p className="mt-2 max-w-4xl text-xs leading-relaxed text-[var(--dpf-muted)]">
          <span className="font-semibold text-[var(--dpf-text)]">Why it matters:</span>{" "}
          {compactOperatorLine(build.originator.resolution)}
        </p>
      )}
    </div>
  );
}
