import type { BuildPhase } from "@/lib/feature-build-types";

export type AutonomousBuildCustodyView = {
  state:
    | "working"
    | "recovering"
    | "waiting"
    | "needs-decision"
    | "shadow"
    | "complete";
  title: string;
  detail: string;
  attentionRequired: boolean;
  engineer: {
    checkpoint: string;
    mode: string;
    evaluatedAt: string;
    heartbeatAt: string | null;
    blockers: string[];
    patternVersion: number | null;
    method: string | null;
    provider: string | null;
    model: string | null;
    recoveryAttempts: Record<string, number>;
  };
};

const STALE_HEARTBEAT_MS = 10 * 60 * 1000;

const REPAIR_COPY: Record<string, string> = {
  blocked_sandbox_drift: "The shared verification environment is being refreshed.",
  blocked_control_plane_starvation: "The shared verification control plane is awaiting governed recovery.",
  sandbox_unavailable: "Build Studio is waiting for a governed verification environment.",
  provider_unavailable: "Build Studio is switching to an eligible AI provider.",
  oracles_red: "Build Studio is repairing evidence that did not pass verification.",
  oracles_unavailable: "Build Studio is restoring the required verification evidence.",
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function attempts(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(object(value)).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

function activeCopy(checkpoint: string): Pick<
  AutonomousBuildCustodyView,
  "state" | "title" | "detail"
> {
  if (checkpoint === "pr") {
    return {
      state: "waiting",
      title: "Checking the pull request",
      detail: "Build Studio is resolving review and merge-queue evidence.",
    };
  }
  if (checkpoint === "release") {
    return {
      state: "waiting",
      title: "Waiting for governed release",
      detail: "The change is merged. Build Studio will finish after the deployed version is verified.",
    };
  }
  return {
    state: "working",
    title: "Build Studio is working",
    detail: "This evidence-cleared build can continue without a routine approval.",
  };
}

export function projectAutonomousBuildCustody(input: {
  phase: BuildPhase;
  buildExecState: unknown;
  now?: Date;
}): AutonomousBuildCustodyView | null {
  const exec = object(input.buildExecState);
  const custody = object(exec.autonomousCustody);
  const mode = string(custody.mode);
  if (!mode || mode === "off") return null;

  const eligibility = object(custody.eligibility);
  const profile = object(custody.executionProfileRef);
  const recovery = object(exec.autonomousRecovery);
  const checkpoint = string(custody.checkpoint) ?? "unknown";
  const evaluatedAt = string(custody.evaluatedAt) ?? "";
  const heartbeatAt = string(custody.heartbeatAt);
  const blockers = Array.isArray(eligibility.blockers)
    ? eligibility.blockers.filter((value): value is string => typeof value === "string")
    : [];
  const engineer = {
    checkpoint,
    mode,
    evaluatedAt,
    heartbeatAt,
    blockers,
    patternVersion:
      typeof profile.patternVersion === "number" ? profile.patternVersion : null,
    method: string(profile.method),
    provider: string(profile.providerId),
    model: string(profile.modelId),
    recoveryAttempts: attempts(recovery.attempts),
  };

  if (input.phase === "complete") {
    return {
      state: "complete",
      title: "Live and complete",
      detail: "Build Studio verified the deployed version before closing this build.",
      attentionRequired: false,
      engineer,
    };
  }
  if (mode === "shadow") {
    return {
      state: "shadow",
      title: "Autonomy is being checked",
      detail: "Build Studio is observing this lane without taking new autonomous actions.",
      attentionRequired: false,
      engineer,
    };
  }

  const eligible = eligibility.eligible === true;
  const nextAction = string(eligibility.nextGovernedAction);
  if (!eligible && nextAction === "escalate") {
    return {
      state: "needs-decision",
      title: "Needs your decision",
      detail: "Build Studio reached an authority or evidence boundary and has safely paused.",
      attentionRequired: true,
      engineer,
    };
  }
  if (!eligible) {
    return {
      state: "recovering",
      title: "Build Studio is recovering",
      detail:
        blockers.map((blocker) => REPAIR_COPY[blocker]).find(Boolean)
        ?? "Build Studio is applying a bounded recovery before it tries again.",
      attentionRequired: false,
      engineer,
    };
  }

  const now = input.now ?? new Date();
  if (
    heartbeatAt
    && Number.isFinite(Date.parse(heartbeatAt))
    && now.getTime() - Date.parse(heartbeatAt) > STALE_HEARTBEAT_MS
  ) {
    return {
      state: "needs-decision",
      title: "Build Studio may be stalled",
      detail: "No recent autonomous heartbeat was recorded. Review the build evidence before continuing.",
      attentionRequired: true,
      engineer,
    };
  }

  return {
    ...activeCopy(checkpoint),
    attentionRequired: false,
    engineer,
  };
}
