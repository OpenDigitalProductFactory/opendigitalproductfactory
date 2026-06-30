import type { GoldenTrianglePreference } from "@/lib/golden-triangle";
import type { ProactivityLevel, ProactivityPlan } from "./proactivity-types";

type PriorityAxis = "quality" | "cost" | "time" | "balanced";
type PostureSource = "receiver-local" | "inherited-bias" | "receiver-override";

export type DelegatedPostureInput = {
  caller: {
    agentId: string;
    parentTaskRunId?: string | null;
    proactivityPlan?: ProactivityPlan | null;
    priority?: GoldenTrianglePreference | null;
  };
  receiver: {
    agentId: string;
    localProactivityPlan: ProactivityPlan;
    localPriority?: GoldenTrianglePreference | null;
    constraints?: {
      regulated?: boolean;
      qualityCritical?: boolean;
      reason?: string | null;
    };
  };
};

export type ResolvedDelegatedPosture = {
  executionAllowed: true;
  proactivity: {
    inheritedLevel: ProactivityLevel | null;
    localLevel: ProactivityLevel;
    effectiveLevel: ProactivityLevel;
    source: PostureSource;
    actionBoundary: ProactivityPlan["actionBoundary"];
    explanation: string;
  };
  priority: {
    inherited: GoldenTrianglePreference | null;
    local: GoldenTrianglePreference | null;
    effective: GoldenTrianglePreference | null;
    source: PostureSource;
    dominantAxis: PriorityAxis;
    explanation: string;
  };
  metadata: {
    source: "delegated-coworker";
    fromAgentId: string;
    toAgentId: string;
    parentTaskRunId: string | null;
  };
};

const LEVEL_RANK: Record<ProactivityLevel, number> = {
  quiet: 0,
  balanced: 1,
  assertive: 2,
};

export function resolveDelegatedPosture(input: DelegatedPostureInput): ResolvedDelegatedPosture {
  const localPlan = input.receiver.localProactivityPlan;
  const inheritedPlan = input.caller.proactivityPlan ?? null;
  const receiverOverride = Boolean(input.receiver.constraints?.regulated || input.receiver.constraints?.qualityCritical);
  const proactivity = resolveProactivity({
    inherited: inheritedPlan?.resolvedLevel ?? null,
    local: localPlan.resolvedLevel,
    actionBoundary: localPlan.actionBoundary,
    receiverOverride,
    overrideReason: input.receiver.constraints?.reason ?? null,
  });
  const priority = resolvePriority({
    inherited: input.caller.priority ?? null,
    local: input.receiver.localPriority ?? null,
    receiverOverride,
    overrideReason: input.receiver.constraints?.reason ?? null,
  });

  return {
    executionAllowed: true,
    proactivity,
    priority,
    metadata: {
      source: "delegated-coworker",
      fromAgentId: input.caller.agentId,
      toAgentId: input.receiver.agentId,
      parentTaskRunId: input.caller.parentTaskRunId ?? null,
    },
  };
}

function resolveProactivity(input: {
  inherited: ProactivityLevel | null;
  local: ProactivityLevel;
  actionBoundary: ProactivityPlan["actionBoundary"];
  receiverOverride: boolean;
  overrideReason: string | null;
}): ResolvedDelegatedPosture["proactivity"] {
  if (!input.inherited) {
    return {
      inheritedLevel: null,
      localLevel: input.local,
      effectiveLevel: input.local,
      source: "receiver-local",
      actionBoundary: input.actionBoundary,
      explanation: "No caller proactivity was provided, so the receiving coworker's local policy applies.",
    };
  }

  if (input.receiverOverride && LEVEL_RANK[input.local] >= LEVEL_RANK[input.inherited]) {
    return {
      inheritedLevel: input.inherited,
      localLevel: input.local,
      effectiveLevel: input.local,
      source: "receiver-override",
      actionBoundary: input.actionBoundary,
      explanation: input.overrideReason ?? "The receiving coworker's local risk or quality policy takes precedence.",
    };
  }

  const effective = LEVEL_RANK[input.inherited] > LEVEL_RANK[input.local] ? input.inherited : input.local;
  return {
    inheritedLevel: input.inherited,
    localLevel: input.local,
    effectiveLevel: effective,
    source: effective === input.local ? "receiver-local" : "inherited-bias",
    actionBoundary: input.actionBoundary,
    explanation:
      input.receiverOverride && input.overrideReason
        ? `${input.overrideReason} Caller proactivity remains advisory and cannot expand authority.`
        : effective === input.local
          ? "The receiving coworker's local proactivity is already at least as strong as the caller context."
          : "The caller context increases persistence for this delegated subtask without changing authority.",
  };
}

function resolvePriority(input: {
  inherited: GoldenTrianglePreference | null;
  local: GoldenTrianglePreference | null;
  receiverOverride: boolean;
  overrideReason: string | null;
}): ResolvedDelegatedPosture["priority"] {
  if (!input.inherited) {
    return {
      inherited: null,
      local: input.local,
      effective: input.local,
      source: "receiver-local",
      dominantAxis: dominantAxis(input.local),
      explanation: "No caller priority posture was provided, so the receiving coworker's local priority applies.",
    };
  }

  if (input.receiverOverride && dominantAxis(input.local) === "quality") {
    return {
      inherited: input.inherited,
      local: input.local,
      effective: input.local,
      source: "receiver-override",
      dominantAxis: "quality",
      explanation: input.overrideReason ?? "The receiving coworker's quality floor takes precedence over caller priority.",
    };
  }

  return {
    inherited: input.inherited,
    local: input.local,
    effective: input.inherited,
    source: "inherited-bias",
    dominantAxis: dominantAxis(input.inherited),
    explanation: "The caller priority posture is advisory context for the delegated subtask.",
  };
}

function dominantAxis(priority: GoldenTrianglePreference | null): PriorityAxis {
  if (!priority) return "balanced";
  const weights = {
    quality: priority.qualityWeight,
    cost: priority.costWeight,
    time: priority.timeWeight,
  };
  if (Math.abs(weights.quality - weights.cost) < 0.04 && Math.abs(weights.quality - weights.time) < 0.04) {
    return "balanced";
  }
  if (weights.quality >= weights.cost && weights.quality >= weights.time) return "quality";
  if (weights.cost >= weights.time) return "cost";
  return "time";
}
