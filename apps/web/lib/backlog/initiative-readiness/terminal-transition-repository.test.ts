import { describe, expect, it } from "vitest";

import type { InitiativeReadinessDecision } from "./types";
import { executeGovernedTerminalTransition } from "./terminal-transition-repository";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";

function decision(verdict: "allowed" | "input-required" | "denied"): InitiativeReadinessDecision {
  return {
    decisionId: "IRD-TEST",
    policyVersion: "initiative-readiness.v1",
    subject: { kind: "backlog-item", id: "BI-1" },
    transitionObject: { kind: "backlog-item", id: "row-1", expectedVersion: "in-progress", targetState: "done" },
    profile: "feature",
    target: "completion",
    verdict,
    satisfied: [],
    unmet: verdict === "input-required"
      ? [readinessRequirement({ code: "OBJECTIVE_RECONCILIATION_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" })]
      : [],
    blockers: verdict === "denied"
      ? [readinessRequirement({ code: "REVIEW_FAILED", state: "fail", accountableRole: "review-owner" })]
      : [],
    evaluatedAt: "2026-08-22T08:00:00.000Z",
  };
}

function fakeDb(options: { casCount?: number; failDecisionWrite?: boolean } = {}) {
  const state = { authorization: [] as unknown[], decisions: [] as unknown[], mutations: 0 };
  const tx = {
    authorizationDecisionLog: {
      create: async (args: unknown) => { state.authorization.push(args); return args; },
    },
    backlogItemActivity: {
      create: async (args: unknown) => {
        if (options.failDecisionWrite) throw new Error("audit unavailable");
        state.decisions.push(args);
        return args;
      },
    },
  };
  return {
    state,
    db: {
      $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => {
        const before = structuredClone(state);
        try {
          return await work(tx);
        } catch (error) {
          state.authorization = before.authorization;
          state.decisions = before.decisions;
          state.mutations = before.mutations;
          throw error;
        }
      },
    },
    mutate: async () => {
      const count = options.casCount ?? 1;
      if (count === 1) state.mutations += 1;
      return count;
    },
  };
}

const input = {
  anchorBacklogItemId: "row-1",
  actor: { actorType: "agent" as const, actorRef: "AGT-1", humanContextRef: "user-1", agentContextRef: "AGT-1" },
  authority: {
    organizationId: "org-1",
    actionKey: "complete_backlog_item",
    objectRef: "BI-1",
    rationale: { capability: "manage_backlog", grant: "initiative_completion" },
    authoritySnapshot: {
      decision: "allow" as const,
      effectiveHumanCapability: "manage_backlog",
      effectiveAgentGrant: "initiative_completion",
      tokenScope: "organization",
      organizationId: "org-1",
      actionKey: "complete_backlog_item",
      policyVersion: "coworker-authority.v1",
    },
  },
};

describe("executeGovernedTerminalTransition", () => {
  it("records an input-required decision and leaves terminal state untouched", async () => {
    const fake = fakeDb();
    const result = await executeGovernedTerminalTransition({
      ...input,
      db: fake.db,
      resolve: async () => ({ governed: true, decision: decision("input-required"), factsDigest: "sha256:facts" }),
      mutate: fake.mutate,
    });

    expect(result).toMatchObject({ ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED" });
    expect(fake.state.mutations).toBe(0);
    expect(fake.state.authorization).toHaveLength(1);
    expect(fake.state.decisions).toHaveLength(1);
  });

  it("persists authority, readiness decision, and one CAS mutation atomically", async () => {
    const fake = fakeDb();
    const result = await executeGovernedTerminalTransition({
      ...input,
      db: fake.db,
      resolve: async () => ({ governed: true, decision: decision("allowed"), factsDigest: "sha256:facts" }),
      mutate: fake.mutate,
    });

    expect(result).toMatchObject({ ok: true, decision: { verdict: "allowed" } });
    expect(fake.state).toMatchObject({ mutations: 1 });
    expect(fake.state.authorization).toHaveLength(1);
    expect(fake.state.decisions).toHaveLength(1);
  });

  it("rolls back an allowed attempt and records STALE_EVIDENCE when CAS misses", async () => {
    const fake = fakeDb({ casCount: 0 });
    const result = await executeGovernedTerminalTransition({
      ...input,
      db: fake.db,
      resolve: async () => ({ governed: true, decision: decision("allowed"), factsDigest: "sha256:facts" }),
      mutate: fake.mutate,
    });

    expect(result).toMatchObject({ ok: false, code: "STALE_EVIDENCE", decision: { verdict: "denied" } });
    expect(fake.state.mutations).toBe(0);
    expect(fake.state.authorization).toHaveLength(1);
    expect(fake.state.decisions).toHaveLength(1);
  });

  it("does not mutate when the readiness audit write fails", async () => {
    const fake = fakeDb({ failDecisionWrite: true });
    await expect(executeGovernedTerminalTransition({
      ...input,
      db: fake.db,
      resolve: async () => ({ governed: true, decision: decision("allowed"), factsDigest: "sha256:facts" }),
      mutate: fake.mutate,
    })).rejects.toThrow("audit unavailable");
    expect(fake.state).toMatchObject({ authorization: [], decisions: [], mutations: 0 });
  });
});
