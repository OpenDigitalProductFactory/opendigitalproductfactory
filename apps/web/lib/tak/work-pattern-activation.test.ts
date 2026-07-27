import { describe, expect, it } from "vitest";

import {
  activateWorkPattern,
  type WorkPatternActivationBinding,
  type WorkPatternActivationPersistence,
  type WorkPatternActivationPersistenceSession,
  type WorkPatternActivationSnapshot,
  workPatternActivationLaneKey,
} from "./work-pattern-activation";

const NOW = new Date("2026-07-26T12:00:00.000Z");

function snapshot(
  overrides: Partial<WorkPatternActivationSnapshot> = {},
): WorkPatternActivationSnapshot {
  return {
    agentId: "build-specialist",
    patternKey: "build-review",
    patternVersion: 2,
    sourceExperimentTaskRunId: "TR-WPX-source",
    source: {
      installScope: "dpf_dogfood",
      organizationId: "org-dogfood",
      taskCorpusKey: "dpf-repository",
      modelProfileId: "frontier-coding",
    },
    portableCanonicalCorpus: null,
    corroborations: [],
    candidateEvidence: {
      patternKey: "build-review",
      patternVersion: 2,
      methodVariantKey: "structured-review",
      modelProfileId: "frontier-coding",
      taskCorpusKey: "dpf-repository",
      taskCorpusVersion: "1",
      oracleKey: "build-gate",
      oracleVersion: "3",
      promotionPolicyKey: "governed-build-playbook-promotion",
      promotionPolicyVersion: 1,
    },
    promotionEvidence: {
      activityKey: "build.implement",
      riskClass: "internal-reversible",
      validPairCount: 8,
      invalidPairCount: 0,
      completedCellKeys: ["control", "method", "model", "interaction"],
      freshnessAt: new Date("2026-07-26T10:00:00.000Z"),
      rollbackBindingId: "AB-prior",
      objectiveDeltas: {
        correctness: 0.08,
        security: 0,
        migrationSafety: 0,
        customerImpact: 0,
        speed: 0.12,
        cost: 0.04,
      },
      commandmentGateRegression: false,
      criticalFindingReproduced: false,
      regulatoryHumanControlRequired: false,
      activeBindingHealthRegression: false,
    },
    intrinsicGrantKeys: ["build_execute"],
    ...overrides,
  };
}

class MemoryActivationStore implements WorkPatternActivationPersistence {
  readonly bindings = new Map<string, WorkPatternActivationBinding>();
  readonly observations: unknown[] = [];
  private lockTail = Promise.resolve();

  constructor(public currentSnapshot = snapshot()) {
    this.bindings.set("AB-prior", {
      bindingId: "AB-prior",
      name: "Build review v1",
      status: "superseded",
      resourceRef: "build-review@1",
      appliedAgentId: "build-specialist",
      grants: [{ grantKey: "build_execute", mode: "require-approval" }],
      authorityScope: {
        schemaVersion: 1,
        activationLaneKey: workPatternActivationLaneKey(this.currentSnapshot),
        bindingScopeKey: "legacy-scope",
        patternKey: "build-review",
        patternVersion: 1,
        activityKey: "build.implement",
        riskClass: "internal-reversible",
        installScopes: ["dpf_dogfood"],
        organizationIds: ["org-dogfood"],
        taskCorpusKeys: ["dpf-repository"],
        modelProfileIds: ["frontier-coding"],
        promotionPolicyKey: "governed-build-playbook-promotion",
        promotionPolicyVersion: 1,
        sourceExperimentTaskRunId: "TR-WPX-prior",
        corroborationTaskRunIds: [],
        priorSafeBindingId: null,
        evidenceFreshnessAt: "2026-07-20T12:00:00.000Z",
        evidenceOrigin: "customer-zero",
        scopeCeiling: "same-install",
        blockers: [
          "broader_scope_requires_portable_corpus_or_customer_corroboration",
        ],
      },
    });
  }

  async withActivationLock<T>(
    _laneKey: string,
    work: (session: WorkPatternActivationPersistenceSession) => Promise<T>,
  ): Promise<T> {
    const previous = this.lockTail;
    let release = () => {};
    this.lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const session: WorkPatternActivationPersistenceSession = {
        readSnapshot: async () => this.currentSnapshot,
        listBindingsForLane: async () => [...this.bindings.values()],
        findBinding: async (bindingId) => this.bindings.get(bindingId) ?? null,
        listRejectedCandidates: async () =>
          this.observations.flatMap((value) => {
            const observation = value as {
              decision?: string;
              candidateIdentity?: string;
              reasons?: string[];
            };
            return observation.decision === "reject"
              && observation.candidateIdentity
              && observation.reasons?.[0] === "commandment_gate_regression"
              ? [{
                  candidateIdentity: observation.candidateIdentity,
                  failureClass: observation.reasons?.[0] ?? "rejected",
                }]
              : [];
          }),
        saveBinding: async (binding) => {
          this.bindings.set(binding.bindingId, binding);
          return binding;
        },
        updateBindingStatus: async (bindingId, status) => {
          const current = this.bindings.get(bindingId);
          if (!current) throw new Error(`missing_binding:${bindingId}`);
          this.bindings.set(bindingId, { ...current, status });
        },
        recordDecision: async (observation) => {
          this.observations.push(observation);
        },
      };
      return await work(session);
    } finally {
      release();
    }
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    patternKey: "build-review",
    patternVersion: 2,
    sourceExperimentTaskRunId: "TR-WPX-source",
    requestedScope: {
      installScopes: ["dpf_dogfood" as const],
      organizationIds: ["org-dogfood"],
      taskCorpusKeys: ["dpf-repository"],
      modelProfileIds: ["frontier-coding"],
    },
    grants: [{ grantKey: "build_execute", mode: "require-approval" }],
    now: NOW,
    ...overrides,
  };
}

describe("activateWorkPattern", () => {
  it("activates exactly one evidence-bounded binding and preserves the prior safe version", async () => {
    const store = new MemoryActivationStore();

    const result = await activateWorkPattern(request(), { persistence: store });

    expect(result.decision).toBe("activate");
    expect(result.bindingId).toMatch(/^AB-WP-/);
    expect(
      [...store.bindings.values()].filter((binding) => binding.status === "active"),
    ).toEqual([
      expect.objectContaining({
        bindingId: result.bindingId,
        name: "Build review v2",
        resourceRef: "build-review@2",
        authorityScope: expect.objectContaining({
          priorSafeBindingId: "AB-prior",
          scopeCeiling: "same-install",
        }),
      }),
    ]);
    expect(store.observations).toContainEqual(
      expect.objectContaining({ decision: "activate", bindingId: result.bindingId }),
    );
  });

  it("converges concurrent retries on one active deterministic binding", async () => {
    const store = new MemoryActivationStore();

    const [left, right] = await Promise.all([
      activateWorkPattern(request(), { persistence: store }),
      activateWorkPattern(request(), { persistence: store }),
    ]);

    expect(left.bindingId).toBe(right.bindingId);
    expect(
      [...store.bindings.values()].filter((binding) => binding.status === "active"),
    ).toHaveLength(1);
  });

  it("re-reads evidence after lock acquisition and refuses stale evidence", async () => {
    const store = new MemoryActivationStore(snapshot({
      promotionEvidence: {
        ...snapshot().promotionEvidence,
        freshnessAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    }));

    const result = await activateWorkPattern(request(), { persistence: store });

    expect(result).toEqual(
      expect.objectContaining({
        decision: "continue",
        reasons: ["evidence_stale"],
      }),
    );
    expect([...store.bindings.values()].some((binding) => binding.status === "active")).toBe(false);
  });

  it("rejects a requested scope broader than effective evidence", async () => {
    const store = new MemoryActivationStore();

    const result = await activateWorkPattern(request({
      requestedScope: {
        installScopes: ["dpf_dogfood", "customer_overlay"],
        organizationIds: ["org-dogfood", "org-customer"],
        taskCorpusKeys: ["dpf-repository", "customer-corpus"],
        modelProfileIds: ["frontier-coding"],
      },
    }), { persistence: store });

    expect(result).toEqual(
      expect.objectContaining({
        decision: "reject",
        reasons: ["requested_scope_exceeds_evidence"],
      }),
    );
  });

  it("rejects any grant that widens intrinsic coworker authority", async () => {
    const store = new MemoryActivationStore();

    await expect(
      activateWorkPattern(request({
        grants: [{ grantKey: "production_write", mode: "require-approval" }],
      }), { persistence: store }),
    ).rejects.toThrow(/cannot widen intrinsic coworker access/i);
  });

  it("escalates an evidence snapshot governed by an unsupported policy version", async () => {
    const store = new MemoryActivationStore(snapshot({
      candidateEvidence: {
        ...snapshot().candidateEvidence,
        promotionPolicyVersion: 2,
      },
    }));

    await expect(
      activateWorkPattern(request(), { persistence: store }),
    ).resolves.toEqual(expect.objectContaining({
      decision: "escalate",
      reasons: ["promotion_policy_version_unsupported"],
    }));
  });

  it("retains a materially identical rejection until evidence identity changes", async () => {
    const store = new MemoryActivationStore();
    store.currentSnapshot = snapshot({
      promotionEvidence: {
        ...snapshot().promotionEvidence,
        commandmentGateRegression: true,
      },
    });
    await activateWorkPattern(request(), { persistence: store });
    store.currentSnapshot = snapshot();

    const repeated = await activateWorkPattern(request(), { persistence: store });

    expect(repeated).toEqual(expect.objectContaining({
      decision: "reject",
      reasons: ["materially_identical_rejection_retained"],
    }));
  });

  it("rolls back within the same lane and retains the failed binding evidence", async () => {
    const store = new MemoryActivationStore();
    const activated = await activateWorkPattern(request(), { persistence: store });
    store.currentSnapshot = snapshot({
      promotionEvidence: {
        ...snapshot().promotionEvidence,
        activeBindingHealthRegression: true,
        rollbackBindingId: "AB-prior",
      },
    });

    const rolledBack = await activateWorkPattern(request(), { persistence: store });

    expect(rolledBack).toEqual(
      expect.objectContaining({
        decision: "rollback",
        bindingId: activated.bindingId,
        activeBindingId: "AB-prior",
      }),
    );
    expect(store.bindings.get(activated.bindingId as string)?.status).toBe("rolled-back");
    expect(store.bindings.get("AB-prior")?.status).toBe("active");
    expect(store.observations).toContainEqual(
      expect.objectContaining({
        decision: "rollback",
        bindingId: activated.bindingId,
        activeBindingId: "AB-prior",
      }),
    );
  });

  it("escalates instead of rolling back across a broader authority scope", async () => {
    const store = new MemoryActivationStore();
    const activated = await activateWorkPattern(request(), { persistence: store });
    const prior = store.bindings.get("AB-prior");
    if (!prior) throw new Error("missing test prior binding");
    store.bindings.set("AB-prior", {
      ...prior,
      authorityScope: {
        ...prior.authorityScope,
        organizationIds: ["org-other"],
      },
    });
    store.currentSnapshot = snapshot({
      promotionEvidence: {
        ...snapshot().promotionEvidence,
        activeBindingHealthRegression: true,
        rollbackBindingId: "AB-prior",
      },
    });

    const result = await activateWorkPattern(request(), { persistence: store });

    expect(result).toEqual(expect.objectContaining({
      decision: "escalate",
      reasons: ["rollback_scope_mismatch"],
    }));
    expect(store.bindings.get(activated.bindingId as string)?.status).toBe("active");
    expect(store.bindings.get("AB-prior")?.status).toBe("superseded");
  });
});
