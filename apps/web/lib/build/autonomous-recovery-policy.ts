export const AUTONOMOUS_RECOVERY_POLICY_VERSION =
  "autonomous-build-recovery/v1";

export const AUTONOMOUS_FAILURE_CLASSES = [
  "provider-rate-limit",
  "tool-protocol-mismatch",
  "context-overflow",
  "scoped-verification-failure",
  "reproduced-review-finding",
  "plan-oscillation",
  "sandbox-drift",
  "control-plane-starvation",
  "post-push-ci-failure",
  "queue-stale-base",
  "unresolved-review-thread",
  "remote-sha-race",
  "human-closed-pr",
  "ambiguous-review-feedback",
  "self-upgrade-failure",
  "deployed-sha-timeout",
  "authority-regulatory-ceiling",
] as const;

export type AutonomousFailureClass =
  (typeof AUTONOMOUS_FAILURE_CLASSES)[number];

export type AutonomousRecoveryAction =
  | "backoff-or-fallback-provider"
  | "normalize-tool-protocol"
  | "use-compatible-fallback"
  | "compact-and-replay"
  | "repair-and-verify"
  | "decompose"
  | "converge-governed-sandbox"
  | "repair-ci-and-push-new-sha"
  | "leave-queue-replay-and-reenroll"
  | "address-and-rereview"
  | "reconcile-remote-sha"
  | "honor-human-closure"
  | "await-governed-runner"
  | "observe-deployed-sha"
  | "escalate";

export type AutonomousRecoveryStateV1 = {
  schemaVersion: 1;
  policyVersion: typeof AUTONOMOUS_RECOVERY_POLICY_VERSION;
  attempts: Partial<Record<AutonomousFailureClass, number>>;
  emittedEscalationKeys: string[];
};

export type AutonomousRecoveryDecision = {
  action: AutonomousRecoveryAction;
  consumedBudget: boolean;
  terminal: boolean;
  escalationKey: string | null;
  emitEscalation: boolean;
  state: AutonomousRecoveryStateV1;
};

export function classifyAutonomousBuildFailure(input: {
  message: string;
  step?: string | null;
}): AutonomousFailureClass {
  const text = input.message.toLowerCase();
  if (
    /\b429\b|rate.?limit|too many requests|capacity retry/.test(text)
  ) {
    return "provider-rate-limit";
  }
  if (/tool.*(?:protocol|schema|argument)|protocol.*tool/.test(text)) {
    return "tool-protocol-mismatch";
  }
  if (/context.*(?:length|overflow|window)|token.*limit/.test(text)) {
    return "context-overflow";
  }
  if (/blocked_sandbox_drift|sandbox.*(?:drift|freshness)/.test(text)) {
    return "sandbox-drift";
  }
  if (/blocked_control_plane_starvation|control-plane.*starv/.test(text)) {
    return "control-plane-starvation";
  }
  if (
    /typecheck|error ts\d{4}|tests? failed|build failed/.test(text)
    || input.step === "code_generated"
    || input.step === "tests_run"
  ) {
    return "scoped-verification-failure";
  }
  return "scoped-verification-failure";
}

type BoundedPolicy = {
  bound: number;
  action: AutonomousRecoveryAction;
};

const BOUNDED_POLICIES: Partial<
  Record<AutonomousFailureClass, BoundedPolicy>
> = {
  "provider-rate-limit": {
    bound: 2,
    action: "backoff-or-fallback-provider",
  },
  "context-overflow": { bound: 1, action: "compact-and-replay" },
  "scoped-verification-failure": {
    bound: 2,
    action: "repair-and-verify",
  },
  "reproduced-review-finding": {
    bound: 2,
    action: "repair-and-verify",
  },
  "plan-oscillation": { bound: 1, action: "decompose" },
  "post-push-ci-failure": {
    bound: 2,
    action: "repair-ci-and-push-new-sha",
  },
  "queue-stale-base": {
    bound: 1,
    action: "leave-queue-replay-and-reenroll",
  },
  "unresolved-review-thread": {
    bound: 2,
    action: "address-and-rereview",
  },
  "remote-sha-race": { bound: 1, action: "reconcile-remote-sha" },
  "deployed-sha-timeout": { bound: 1, action: "observe-deployed-sha" },
};

export function initialAutonomousRecoveryState(): AutonomousRecoveryStateV1 {
  return {
    schemaVersion: 1,
    policyVersion: AUTONOMOUS_RECOVERY_POLICY_VERSION,
    attempts: {},
    emittedEscalationKeys: [],
  };
}

function terminalEscalation(
  failureClass: AutonomousFailureClass,
  state: AutonomousRecoveryStateV1,
): AutonomousRecoveryDecision {
  const escalationKey = `autonomous-recovery:${failureClass}:exhausted`;
  const emitEscalation = !state.emittedEscalationKeys.includes(escalationKey);
  return {
    action: "escalate",
    consumedBudget: false,
    terminal: true,
    escalationKey,
    emitEscalation,
    state: emitEscalation
      ? {
          ...state,
          emittedEscalationKeys: [
            ...state.emittedEscalationKeys,
            escalationKey,
          ],
        }
      : state,
  };
}

function consume(
  failureClass: AutonomousFailureClass,
  state: AutonomousRecoveryStateV1,
  policy: BoundedPolicy,
): AutonomousRecoveryDecision {
  const attempts = state.attempts[failureClass] ?? 0;
  if (attempts >= policy.bound) {
    return terminalEscalation(failureClass, state);
  }
  return {
    action: policy.action,
    consumedBudget: true,
    terminal: false,
    escalationKey: null,
    emitEscalation: false,
    state: {
      ...state,
      attempts: {
        ...state.attempts,
        [failureClass]: attempts + 1,
      },
    },
  };
}

/**
 * Versioned and serializable recovery policy. It maps already-classified
 * failures to bounded actions; consumers own persistence and side effects.
 * Deliberately absent: direct Compose, redeploy, force-push, or PR reopen.
 */
export function decideAutonomousRecovery(input: {
  failureClass: AutonomousFailureClass;
  state: AutonomousRecoveryStateV1;
}): AutonomousRecoveryDecision {
  const { failureClass, state } = input;

  if (failureClass === "sandbox-drift") {
    return {
      action: "converge-governed-sandbox",
      consumedBudget: false,
      terminal: false,
      escalationKey: null,
      emitEscalation: false,
      state,
    };
  }
  if (failureClass === "human-closed-pr") {
    return {
      action: "honor-human-closure",
      consumedBudget: false,
      terminal: true,
      escalationKey: null,
      emitEscalation: false,
      state,
    };
  }
  if (
    failureClass === "self-upgrade-failure"
    || failureClass === "control-plane-starvation"
  ) {
    return {
      action: "await-governed-runner",
      consumedBudget: false,
      terminal: false,
      escalationKey: null,
      emitEscalation: false,
      state,
    };
  }
  if (
    failureClass === "ambiguous-review-feedback"
    || failureClass === "authority-regulatory-ceiling"
  ) {
    return terminalEscalation(failureClass, state);
  }
  if (failureClass === "tool-protocol-mismatch") {
    const attempts = state.attempts[failureClass] ?? 0;
    if (attempts >= 2) return terminalEscalation(failureClass, state);
    return consume(failureClass, state, {
      bound: 2,
      action:
        attempts === 0
          ? "normalize-tool-protocol"
          : "use-compatible-fallback",
    });
  }

  const policy = BOUNDED_POLICIES[failureClass];
  return policy
    ? consume(failureClass, state, policy)
    : terminalEscalation(failureClass, state);
}
