import { describe, expect, it } from "vitest";

import {
  classifyAutonomousBuildFailure,
  decideAutonomousRecovery,
  initialAutonomousRecoveryState,
  type AutonomousFailureClass,
} from "./autonomous-recovery-policy";

describe("classifyAutonomousBuildFailure", () => {
  it.each([
    ["429 rate limit", "code_generated", "provider-rate-limit"],
    ["tool protocol mismatch", "code_generated", "tool-protocol-mismatch"],
    ["maximum context length exceeded", "code_generated", "context-overflow"],
    ["blocked_sandbox_drift", "sandbox_created", "sandbox-drift"],
    ["blocked_control_plane_starvation", "tests_run", "control-plane-starvation"],
    ["error TS2322 typecheck failed", "code_generated", "scoped-verification-failure"],
  ] as const)("classifies %s", (message, step, expected) => {
    expect(classifyAutonomousBuildFailure({ message, step })).toBe(expected);
  });
});

describe("decideAutonomousRecovery", () => {
  it.each([
    ["provider-rate-limit", 2],
    ["context-overflow", 1],
    ["scoped-verification-failure", 2],
    ["reproduced-review-finding", 2],
    ["plan-oscillation", 1],
    ["post-push-ci-failure", 2],
    ["queue-stale-base", 1],
    ["unresolved-review-thread", 2],
    ["remote-sha-race", 1],
    ["deployed-sha-timeout", 1],
  ] as Array<[AutonomousFailureClass, number]>)(
    "%s consumes its declared bounded budget",
    (failureClass, bound) => {
      let state = initialAutonomousRecoveryState();
      for (let attempt = 0; attempt < bound; attempt += 1) {
        const decision = decideAutonomousRecovery({ failureClass, state });
        expect(decision.action).not.toBe("escalate");
        expect(decision.consumedBudget).toBe(true);
        state = decision.state;
      }

      const exhausted = decideAutonomousRecovery({ failureClass, state });
      expect(exhausted).toMatchObject({
        action: "escalate",
        terminal: true,
        escalationKey: `autonomous-recovery:${failureClass}:exhausted`,
      });
    },
  );

  it("normalizes a tool mismatch once and then uses one compatible fallback", () => {
    const first = decideAutonomousRecovery({
      failureClass: "tool-protocol-mismatch",
      state: initialAutonomousRecoveryState(),
    });
    expect(first.action).toBe("normalize-tool-protocol");

    const second = decideAutonomousRecovery({
      failureClass: "tool-protocol-mismatch",
      state: first.state,
    });
    expect(second.action).toBe("use-compatible-fallback");

    expect(decideAutonomousRecovery({
      failureClass: "tool-protocol-mismatch",
      state: second.state,
    }).action).toBe("escalate");
  });

  it("does not charge sandbox drift against product repair rounds", () => {
    const state = initialAutonomousRecoveryState();
    const decision = decideAutonomousRecovery({
      failureClass: "sandbox-drift",
      state,
    });

    expect(decision).toMatchObject({
      action: "converge-governed-sandbox",
      consumedBudget: false,
      terminal: false,
      state,
    });
  });

  it("waits for governed recovery after control-plane starvation", () => {
    const state = initialAutonomousRecoveryState();
    expect(decideAutonomousRecovery({
      failureClass: "control-plane-starvation",
      state,
    })).toMatchObject({
      action: "await-governed-runner",
      consumedBudget: false,
      terminal: false,
      state,
    });
  });

  it("retains counters across resume from serialized state", () => {
    const first = decideAutonomousRecovery({
      failureClass: "post-push-ci-failure",
      state: initialAutonomousRecoveryState(),
    });
    const resumedState = JSON.parse(JSON.stringify(first.state));

    const second = decideAutonomousRecovery({
      failureClass: "post-push-ci-failure",
      state: resumedState,
    });

    expect(second.state.attempts["post-push-ci-failure"]).toBe(2);
  });

  it("deduplicates the terminal escalation after budget exhaustion", () => {
    const exhausted = {
      ...initialAutonomousRecoveryState(),
      attempts: { "remote-sha-race": 1 },
    };
    const first = decideAutonomousRecovery({
      failureClass: "remote-sha-race",
      state: exhausted,
    });
    const second = decideAutonomousRecovery({
      failureClass: "remote-sha-race",
      state: first.state,
    });

    expect(first.emitEscalation).toBe(true);
    expect(second.emitEscalation).toBe(false);
  });

  it("honors human closure without reopening or consuming repair budget", () => {
    expect(decideAutonomousRecovery({
      failureClass: "human-closed-pr",
      state: initialAutonomousRecoveryState(),
    })).toMatchObject({
      action: "honor-human-closure",
      consumedBudget: false,
      terminal: true,
    });
  });

  it("never lets ambiguous review feedback self-authorize a repair", () => {
    expect(decideAutonomousRecovery({
      failureClass: "ambiguous-review-feedback",
      state: initialAutonomousRecoveryState(),
    })).toMatchObject({
      action: "escalate",
      terminal: true,
    });
  });

  it("delegates self-upgrade failures to the governed runner", () => {
    expect(decideAutonomousRecovery({
      failureClass: "self-upgrade-failure",
      state: initialAutonomousRecoveryState(),
    })).toMatchObject({
      action: "await-governed-runner",
      consumedBudget: false,
    });
  });
});
