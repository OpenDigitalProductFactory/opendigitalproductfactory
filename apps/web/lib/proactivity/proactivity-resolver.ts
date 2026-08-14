import type {
  ProactivityActionBoundary,
  ProactivityChannelPolicy,
  ProactivityEscalationTarget,
  ProactivityLevel,
  ProactivityPlan,
  ProactivityResolverInput,
  ProactivitySpendClass,
} from "./proactivity-types";

type PlanDefaults = {
  attentionWindowMinutes: number;
  followUpCadenceMinutes: number[];
  maxAttempts: number;
  spendClass: ProactivitySpendClass;
  channelPolicy: ProactivityChannelPolicy;
  escalationTarget: ProactivityEscalationTarget;
  actionBoundary: ProactivityActionBoundary;
};

const DEFAULTS_BY_LEVEL: Record<ProactivityLevel, PlanDefaults> = {
  quiet: {
    attentionWindowMinutes: 120,
    followUpCadenceMinutes: [],
    maxAttempts: 0,
    spendClass: "minimal",
    channelPolicy: "in-app-only",
    escalationTarget: "attention-surface",
    actionBoundary: "advise",
  },
  balanced: {
    attentionWindowMinutes: 60,
    followUpCadenceMinutes: [120],
    maxAttempts: 2,
    spendClass: "standard",
    channelPolicy: "preferred-channel",
    escalationTarget: "attention-surface",
    actionBoundary: "propose",
  },
  assertive: {
    attentionWindowMinutes: 30,
    followUpCadenceMinutes: [30, 60, 120],
    maxAttempts: 3,
    spendClass: "elevated",
    channelPolicy: "urgent-channel",
    escalationTarget: "owner",
    actionBoundary: "propose",
  },
};

export function resolveProactivityPlan(input: ProactivityResolverInput): ProactivityPlan {
  const level = resolveLevel(input);
  return resolveProactivityPlanForLevel(input, level);
}

export function resolveProactivityPlanForLevel(
  input: ProactivityResolverInput,
  level: ProactivityLevel,
  preferenceSource: ProactivityPlan["preferenceSource"] = "rule",
): ProactivityPlan {
  const defaults = { ...DEFAULTS_BY_LEVEL[level] };
  const evidenceRefs = evidenceFor(input);

  if (input.activityFamily === "field-dispatch-appointment") {
    defaults.escalationTarget = "dispatcher";
    if (level === "assertive") {
      defaults.channelPolicy = "urgent-channel";
      defaults.attentionWindowMinutes = 20;
    }
  }

  if (input.activityFamily === "build-studio-custodian") {
    defaults.escalationTarget = "platform-operator";
  }

  if (input.regulated || input.activityFamily === "tax-compliance") {
    defaults.actionBoundary = input.regulated ? "advise" : "propose";
    defaults.spendClass = level === "assertive" ? "standard" : defaults.spendClass;
  }

  return {
    resolvedLevel: level,
    policyId: policyIdFor(input, level),
    ...defaults,
    explanation: explanationFor(input, level),
    evidenceRefs,
    preferenceSource,
  };
}

function resolveLevel(input: ProactivityResolverInput): ProactivityLevel {
  if (input.activityFamily === "interactive-chat") return "balanced";

  if (input.activityFamily === "todo-follow-up") return "balanced";

  if (input.activityFamily === "field-dispatch-appointment") {
    if (
      input.archetype?.fieldDispatchRunningLate ||
      input.archetype?.demandSignature === "emergency-reactive" ||
      input.archetype?.capacityUnit === "slot-hours"
    ) {
      return "assertive";
    }
    return "balanced";
  }

  if (input.activityFamily === "build-studio-custodian") {
    return input.statusSignal === "blocked" || input.statusSignal === "stalled" || input.statusSignal === "degraded"
      ? "assertive"
      : "balanced";
  }

  if (input.activityFamily === "platform-health") {
    return input.statusSignal === "degraded" || input.statusSignal === "offline" ? "assertive" : "balanced";
  }

  if (input.activityFamily === "queue-health") {
    // A queue past its backpressure thresholds surfaces as blocked/degraded —
    // nudge assertively so a backing-up scarce resource does not sit unnoticed.
    return input.statusSignal === "blocked" || input.statusSignal === "degraded" ? "assertive" : "balanced";
  }

  if (input.activityFamily === "tax-compliance") {
    return typeof input.deadlineWindowDays === "number" && input.deadlineWindowDays <= 7 ? "assertive" : "balanced";
  }

  if (input.activityFamily === "security-incident") return "assertive";

  return "balanced";
}

function policyIdFor(input: ProactivityResolverInput, level: ProactivityLevel): string {
  return `proactivity:${input.activityFamily}:${level}`;
}

function evidenceFor(input: ProactivityResolverInput): ProactivityPlan["evidenceRefs"] {
  const refs: ProactivityPlan["evidenceRefs"] = [{ kind: "activity-family", id: input.activityFamily }];

  if (input.agentId) refs.push({ kind: "agent", id: input.agentId });
  if (input.routeContext) refs.push({ kind: "route-context", id: input.routeContext });
  if (input.statusSignal) refs.push({ kind: "status-signal", id: input.statusSignal });
  if (input.archetype?.archetypeId) refs.push({ kind: "archetype", id: input.archetype.archetypeId });
  if (input.archetype?.demandSignature) refs.push({ kind: "demand-signature", id: input.archetype.demandSignature });
  if (input.archetype?.capacityUnit) refs.push({ kind: "capacity-unit", id: input.archetype.capacityUnit });

  return refs;
}

function explanationFor(input: ProactivityResolverInput, level: ProactivityLevel): string {
  if (input.activityFamily === "field-dispatch-appointment" && level === "assertive") {
    return "Customer appointment timing is operationally load-bearing, so the coworker should warn earlier and escalate sooner while preserving approval boundaries.";
  }

  if (input.activityFamily === "build-studio-custodian" && level === "assertive") {
    return "Build Studio work is blocked or stalled, so the coworker should surface guided next action sooner without increasing authority.";
  }

  if (input.activityFamily === "tax-compliance" && level === "assertive") {
    return "A compliance deadline is close enough to justify assertive reminders while keeping advice and filing approval-gated.";
  }

  if (input.activityFamily === "crm-record-enrichment") {
    if (level === "quiet") {
      return "Quiet: store the record as entered and never volunteer enrichment — the human asks if they want it.";
    }
    return "A thin CRM record can be strengthened from public sources; offer to enrich (permission + scope confirmed) while the write stays governed and non-fabricating.";
  }

  if (level === "balanced") {
    return "Balanced is the default proactivity level for useful follow-up without noisy repeated interruption.";
  }
  if (level === "assertive") {
    return "Stay on this, warn earlier, and escalate sooner while preserving approval boundaries.";
  }
  return "Quiet minimizes unsolicited follow-up unless urgency or prior approval justifies attention.";
}
