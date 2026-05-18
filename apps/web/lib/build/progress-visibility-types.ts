export const BUILD_TRUTH_STALE_THRESHOLD_MS = 5 * 60 * 1000;

export type BuildTruthSource =
  | "db-task-results"
  | "chat-self-report"
  | "sandbox-git"
  | "verification"
  | "dispatch-history"
  | "build-activity";

export type BuildFailureAxis =
  | "rate-limit"
  | "usage-limit"
  | "auth"
  | "timeout"
  | "test-failure"
  | "typecheck-failure"
  | "out-of-scope-noise"
  | "provider-unavailable"
  | "unknown";

export type TruthNumericSnapshot = {
  source: BuildTruthSource;
  completed: number;
  total: number;
  observedAt: string | null;
};

export type ResumeImplementationMode =
  | "replan-and-dispatch"
  | "reset-blocked"
  | "already-running"
  | "rerun-verification";

export type ResumeImplementationModeDetail = {
  mode: ResumeImplementationMode;
  label: string;
  reason: string;
};

export type ResumeBuildImplementationOutcome = {
  mode: ResumeImplementationMode;
  resetTasks: number;
  dispatchQueued: boolean;
  message: string;
};

export type TruthSourceAge = {
  ageMs: number | null;
  label: string;
  stale: boolean;
};

const LABELS: Record<BuildTruthSource, string> = {
  "db-task-results": "DB",
  "chat-self-report": "Chat",
  "sandbox-git": "Sandbox",
  verification: "Verification",
  "dispatch-history": "Dispatch",
  "build-activity": "Activity",
};

export function truthSourceLabel(source: BuildTruthSource): string {
  return LABELS[source];
}

export function getTruthSourceAge(
  observedAt: string | Date | null | undefined,
  now: Date = new Date(),
  staleThresholdMs: number = BUILD_TRUTH_STALE_THRESHOLD_MS,
): TruthSourceAge {
  if (!observedAt) {
    return {
      ageMs: null,
      label: "unknown age",
      stale: true,
    };
  }

  const observed = observedAt instanceof Date ? observedAt : new Date(observedAt);
  const observedMs = observed.getTime();
  if (!Number.isFinite(observedMs)) {
    return {
      ageMs: null,
      label: "unknown age",
      stale: true,
    };
  }

  const ageMs = Math.max(0, now.getTime() - observedMs);
  const label = formatAgeLabel(ageMs);
  return {
    ageMs,
    label,
    stale: ageMs >= staleThresholdMs,
  };
}

export function hasStaleTruthConflict(args: {
  staleThresholdMs?: number;
  newer: TruthNumericSnapshot;
  older: TruthNumericSnapshot;
}): boolean {
  const newerTime = parseTime(args.newer.observedAt);
  const olderTime = parseTime(args.older.observedAt);
  if (newerTime == null || olderTime == null) {
    return false;
  }

  const disagreement =
    args.newer.completed !== args.older.completed
    || args.newer.total !== args.older.total;
  if (!disagreement) {
    return false;
  }

  const threshold = args.staleThresholdMs ?? BUILD_TRUTH_STALE_THRESHOLD_MS;
  return newerTime > olderTime && newerTime - olderTime >= threshold;
}

function formatAgeLabel(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function parseTime(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}
