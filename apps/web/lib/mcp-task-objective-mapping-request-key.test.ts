import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  authorizeObjectiveMappingRequestKeyEvolution,
  createObjectiveMappingRequestKey,
  objectiveMappingHistoricalProviderProofDigest,
  validateObjectiveMappingRequestKey,
  validateHistoricalObjectiveMappingRequestKey,
  type ObjectiveMappingRequestHistory,
} from "./mcp-task-objective-mapping-request-key";
import { canonicalJson } from "./shared/canonical-json";

const repositoryFullName = "OpenDigitalProductFactory/opendigitalproductfactory";

function currentPacket(input: {
  itemId: string;
  workroomId: string;
  branchName: string;
  headSha: string;
  artifactCommitSha: string;
  providerBlobId: string;
  baselineId: string;
  evidenceIds?: string[];
}) {
  const objective = `For ${input.itemId} in ${input.workroomId} on ${repositoryFullName}#${input.branchName} at Workroom head ${input.headSha}, independently address objective-mapping using record_initiative_evidence.`;
  return {
    targetAgent: "AGT-WS-PORTFOLIO",
    objective,
    questionPacketSummary: `objective-mapping for ${input.itemId} at ${input.headSha.slice(0, 12)}`,
    requiredToolNames: ["record_initiative_evidence", "read_source_at_version"],
    binding: {
      writerToolName: "record_initiative_evidence",
      itemId: input.itemId,
      gate: "objective-mapping" as const,
      expectedCurrentBaselineId: input.baselineId,
      eligibleEvidenceActivityIds: input.evidenceIds ?? ["evidence-b", "evidence-a"],
      workroomRef: {
        kind: "workroom-head" as const,
        workroomId: input.workroomId,
        repositoryFullName,
        branchName: input.branchName,
        headSha: input.headSha,
      },
      artifactRef: {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName,
        commitSha: input.artifactCommitSha,
        path: `docs/superpowers/specs/${input.itemId.toLowerCase()}-design.md`,
        providerBlobId: input.providerBlobId,
      },
    },
  };
}

function legacyHistory(
  packet: ReturnType<typeof currentPacket>,
  input: Partial<ObjectiveMappingRequestHistory> = {},
): ObjectiveMappingRequestHistory {
  const { workroomRef: _workroomRef, eligibleEvidenceActivityIds: _evidenceIds, ...legacyBinding } = packet.binding;
  const legacyKey = `initiative-readiness:${packet.binding.itemId}:objective-mapping:${packet.binding.workroomRef.headSha}`;
  return {
    taskRunId: "TR-MCP-LEGACY",
    status: "input-required",
    targetAgent: packet.targetAgent,
    objective: packet.objective,
    questionPacketSummary: packet.questionPacketSummary,
    idempotencyKey: legacyKey,
    requiredToolNames: [...packet.requiredToolNames],
    binding: legacyBinding,
    actionEnvelopeStatuses: ["declined"],
    writerExecutions: [{ success: false, hasReceipt: false }],
    ...input,
  };
}

function providerProofs(...history: ObjectiveMappingRequestHistory[]) {
  return new Map(history.map((entry) => [
    entry.taskRunId,
    objectiveMappingHistoricalProviderProofDigest(entry),
  ]));
}

function legacyV2RequestKey(packet: ReturnType<typeof currentPacket>): string {
  const normalized = {
    schemaVersion: 2,
    targetAgent: packet.targetAgent.trim(),
    objective: packet.objective.trim(),
    questionPacketSummary: packet.questionPacketSummary.trim(),
    requiredToolNames: [...new Set(packet.requiredToolNames.map((name) => name.trim()))].sort(),
    binding: {
      writerToolName: packet.binding.writerToolName,
      itemId: packet.binding.itemId,
      gate: packet.binding.gate,
      expectedCurrentBaselineId: packet.binding.expectedCurrentBaselineId ?? null,
      eligibleEvidenceActivityIds: [...packet.binding.eligibleEvidenceActivityIds].sort(),
      workroomRef: packet.binding.workroomRef,
      artifactRef: packet.binding.artifactRef,
    },
  };
  const digest = createHash("sha256").update(canonicalJson(normalized)).digest("hex");
  return `initiative-readiness:${packet.binding.itemId}:objective-mapping:${packet.binding.workroomRef.headSha}:packet-v2:${digest}`;
}

describe("objective-mapping request identity", () => {
  it("issues an authenticated v3 key and never admits a caller-computable v2 key as new work", () => {
    const packet = currentPacket({
      itemId: "BI-AUTHENTIC",
      workroomId: "WC-AUTHENTIC",
      branchName: "fix/authenticated-objective-mapping",
      headSha: "1".repeat(40),
      artifactCommitSha: "2".repeat(40),
      providerBlobId: "3".repeat(40),
      baselineId: "baseline-authentic",
    });

    const issued = createObjectiveMappingRequestKey(packet);
    const forgedV2 = legacyV2RequestKey(packet);

    expect(issued).toMatch(/:packet-v3:[a-f0-9]{64}$/u);
    expect(validateObjectiveMappingRequestKey({ ...packet, requestKey: issued })).toBe(true);
    expect(validateObjectiveMappingRequestKey({ ...packet, requestKey: forgedV2 })).toBe(false);
    expect(validateObjectiveMappingRequestKey({
      ...packet,
      objective: `${packet.objective} caller widened`,
      requestKey: issued,
    })).toBe(false);
  });

  it("fails closed outside tests when no signing secret is configured", () => {
    const packet = currentPacket({
      itemId: "BI-NO-SECRET",
      workroomId: "WC-NO-SECRET",
      branchName: "fix/no-signing-secret",
      headSha: "a".repeat(40),
      artifactCommitSha: "b".repeat(40),
      providerBlobId: "c".repeat(40),
      baselineId: "baseline-no-secret",
    });

    try {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DPF_OBJECTIVE_MAPPING_REQUEST_KEY_SECRET", "");
      vi.stubEnv("AUTH_SECRET", "");
      vi.stubEnv("NEXTAUTH_SECRET", "");

      expect(() => createObjectiveMappingRequestKey(packet)).toThrow(/signing requires/u);
      expect(validateObjectiveMappingRequestKey({
        ...packet,
        requestKey: legacyV2RequestKey(packet),
      })).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts a packet-v2 self-hash only when reading immutable history", () => {
    const packet = currentPacket({
      itemId: "BI-LEGACY-HISTORY",
      workroomId: "WC-LEGACY-HISTORY",
      branchName: "fix/legacy-history",
      headSha: "4".repeat(40),
      artifactCommitSha: "5".repeat(40),
      providerBlobId: "6".repeat(40),
      baselineId: "baseline-legacy-history",
    });
    const legacyKey = legacyV2RequestKey(packet);
    const historical: ObjectiveMappingRequestHistory = {
      ...legacyHistory(packet),
      status: "completed",
      idempotencyKey: legacyKey,
      binding: packet.binding,
      actionEnvelopeStatuses: [],
      writerExecutions: [],
    };

    expect(validateObjectiveMappingRequestKey({ ...packet, requestKey: legacyKey })).toBe(false);
    expect(validateHistoricalObjectiveMappingRequestKey({ ...packet, requestKey: legacyKey })).toBe(true);
    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey: createObjectiveMappingRequestKey(packet) },
      history: [historical],
    })).toEqual({ authorized: true });
  });

  it.each([
    {
      label: "BI-SIG stale packet",
      taskRunId: "TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-5AFED05D3098",
      itemId: "BI-SIG-463E478D",
      workroomId: "WC-113D025E",
      branchName: "fix/initiative-review-complete-pagination",
      headSha: "a6cf3651c8b8d790719d0048b71c1cbf104b74c6",
      artifactCommitSha: "a5b93db0be0d4be7c80698b1de302af0f8a8e2a7",
      providerBlobId: "b9160b02427fd064d3e57677476484ee42e78768",
      baselineId: "baseline-0b1a69ba-a4bd-454b-9290-3c27168bdd2b",
      status: "input-required",
      envelopeStatus: "declined",
      writerSuccess: false,
    },
    {
      label: "BI-2B invalid completed packet",
      taskRunId: "TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-42F4B2BBCDF2",
      itemId: "BI-2B619BC9",
      workroomId: "WC-2D59B324",
      branchName: "fix/typed-async-operation-handle",
      headSha: "bbadd0d0bffbb23ab74234c0282b9194b0eb0dc7",
      artifactCommitSha: "8fc3281111111111111111111111111111111111",
      providerBlobId: "699f000000000000000000000000000000000000",
      baselineId: "baseline-c2b59832-current",
      status: "completed",
      envelopeStatus: "executed",
      writerSuccess: true,
    },
  ])("issues one deterministic successor for $label without mutating $taskRunId", (fixture) => {
    const packet = currentPacket(fixture);
    const requestKey = createObjectiveMappingRequestKey(packet);
    const result = authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey },
      history: [legacyHistory(packet, {
        taskRunId: fixture.taskRunId,
        status: fixture.status,
        actionEnvelopeStatuses: [fixture.envelopeStatus],
        writerExecutions: [{ success: fixture.writerSuccess, hasReceipt: false }],
      })],
      providerProvenImpossibleTaskRunProofs: providerProofs(legacyHistory(packet, {
        taskRunId: fixture.taskRunId,
        status: fixture.status,
        actionEnvelopeStatuses: [fixture.envelopeStatus],
        writerExecutions: [{ success: fixture.writerSuccess, hasReceipt: false }],
      })),
    });

    expect(requestKey).toMatch(
      new RegExp(`^initiative-readiness:${fixture.itemId}:objective-mapping:${fixture.headSha}:packet-v3:[a-f0-9]{64}$`),
    );
    expect(requestKey).not.toBe(
      `initiative-readiness:${fixture.itemId}:objective-mapping:${fixture.headSha}`,
    );
    expect(result).toEqual({ authorized: true });
  });

  it("keeps byte-identical and reordered evidence packets on one request identity", () => {
    const packet = currentPacket({
      itemId: "BI-SIG-463E478D",
      workroomId: "WC-113D025E",
      branchName: "fix/initiative-review-complete-pagination",
      headSha: "a6cf3651c8b8d790719d0048b71c1cbf104b74c6",
      artifactCommitSha: "a5b93db0be0d4be7c80698b1de302af0f8a8e2a7",
      providerBlobId: "b9160b02427fd064d3e57677476484ee42e78768",
      baselineId: "baseline-current",
    });
    const reordered = {
      ...packet,
      binding: { ...packet.binding, eligibleEvidenceActivityIds: ["evidence-a", "evidence-b"] },
    };
    const key = createObjectiveMappingRequestKey(packet);

    expect(createObjectiveMappingRequestKey(packet)).toBe(key);
    expect(createObjectiveMappingRequestKey(reordered)).toBe(key);
    expect(validateObjectiveMappingRequestKey({ ...packet, requestKey: key })).toBe(true);
    expect(validateObjectiveMappingRequestKey({ ...packet, requestKey: `${key}:caller-churn` })).toBe(false);
  });

  it.each([
    ["Workroom", (packet: ReturnType<typeof currentPacket>) => ({
      ...legacyHistory(packet),
      objective: legacyHistory(packet).objective.replace(packet.binding.workroomRef.workroomId, "WC-OTHER"),
    })],
    ["baseline", (packet: ReturnType<typeof currentPacket>) => ({
      ...legacyHistory(packet),
      binding: { ...legacyHistory(packet).binding as object, expectedCurrentBaselineId: "baseline-other" },
    })],
    ["artifact", (packet: ReturnType<typeof currentPacket>) => ({
      ...legacyHistory(packet),
      binding: {
        ...legacyHistory(packet).binding as object,
        artifactRef: { ...packet.binding.artifactRef, providerBlobId: "f".repeat(40) },
      },
    })],
    ["reviewer", (packet: ReturnType<typeof currentPacket>) => ({
      ...legacyHistory(packet),
      targetAgent: "AGT-OTHER",
    })],
    ["tool authority", (packet: ReturnType<typeof currentPacket>) => ({
      ...legacyHistory(packet),
      requiredToolNames: ["read_source_at_version", "record_plan_backlog_coverage"],
    })],
    ["objective", (packet: ReturnType<typeof currentPacket>) => ({
      ...legacyHistory(packet),
      objective: `${packet.objective} widened`,
    })],
    ["summary", (packet: ReturnType<typeof currentPacket>) => ({
      ...legacyHistory(packet),
      questionPacketSummary: `${packet.questionPacketSummary} widened`,
    })],
  ])("fails closed when historical %s identity differs", (_label, mutate) => {
    const packet = currentPacket({
      itemId: "BI-2B619BC9",
      workroomId: "WC-2D59B324",
      branchName: "fix/typed-async-operation-handle",
      headSha: "bbadd0d0bffbb23ab74234c0282b9194b0eb0dc7",
      artifactCommitSha: "8fc3281111111111111111111111111111111111",
      providerBlobId: "699f000000000000000000000000000000000000",
      baselineId: "baseline-current",
    });
    const requestKey = createObjectiveMappingRequestKey(packet);

    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey },
      history: [mutate(packet) as ObjectiveMappingRequestHistory],
    })).toMatchObject({ authorized: false, reason: "immutable-identity-conflict" });
  });

  it.each(["proposed", "approved"])("blocks a successor while a prior %s envelope is active", (status) => {
    const packet = currentPacket({
      itemId: "BI-SIG-463E478D",
      workroomId: "WC-113D025E",
      branchName: "fix/initiative-review-complete-pagination",
      headSha: "a6cf3651c8b8d790719d0048b71c1cbf104b74c6",
      artifactCommitSha: "a5b93db0be0d4be7c80698b1de302af0f8a8e2a7",
      providerBlobId: "b9160b02427fd064d3e57677476484ee42e78768",
      baselineId: "baseline-current",
    });
    const requestKey = createObjectiveMappingRequestKey(packet);

    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey },
      history: [legacyHistory(packet, { actionEnvelopeStatuses: [status] })],
    })).toMatchObject({ authorized: false, reason: "prior-authority-active" });
  });

  it("blocks evidence evolution after an authoritative current-packet writer or receipt", () => {
    const prior = currentPacket({
      itemId: "BI-SIG-463E478D",
      workroomId: "WC-113D025E",
      branchName: "fix/initiative-review-complete-pagination",
      headSha: "a6cf3651c8b8d790719d0048b71c1cbf104b74c6",
      artifactCommitSha: "a5b93db0be0d4be7c80698b1de302af0f8a8e2a7",
      providerBlobId: "b9160b02427fd064d3e57677476484ee42e78768",
      baselineId: "baseline-current",
      evidenceIds: ["evidence-a"],
    });
    const next = {
      ...prior,
      binding: { ...prior.binding, eligibleEvidenceActivityIds: ["evidence-a", "evidence-b"] },
    };
    const requestKey = createObjectiveMappingRequestKey(next);
    const history: ObjectiveMappingRequestHistory = {
      taskRunId: "TR-MCP-CURRENT",
      status: "completed",
      objective: prior.objective,
      questionPacketSummary: prior.questionPacketSummary,
      idempotencyKey: createObjectiveMappingRequestKey(prior),
      binding: prior.binding,
      actionEnvelopeStatuses: ["executed"],
      writerExecutions: [{ success: true, hasReceipt: true }],
      targetAgent: prior.targetAgent,
      requiredToolNames: prior.requiredToolNames,
    };

    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...next, requestKey },
      history: [history],
    })).toMatchObject({ authorized: false, reason: "immutable-identity-conflict" });
  });

  it("allows only a provider-proven impossible legacy artifact to release the current identity", () => {
    const packet = currentPacket({
      itemId: "BI-7A38F667",
      workroomId: "WC-16B8E810",
      branchName: "feat/pet-rescue-operating-system",
      headSha: "9640f133190bc0ed82893f619695a4efe362632c",
      artifactCommitSha: "5249442f8b6221451bc81ad2f77786a6b125e470",
      providerBlobId: "5c44f13ba7663a18e1e8dd881812b04cbb550001",
      baselineId: "baseline-current",
    });
    const historical = legacyHistory(packet, {
      binding: {
        ...legacyHistory(packet).binding,
        expectedCurrentBaselineId: "baseline-ancestor",
        artifactRef: {
          ...packet.binding.artifactRef,
          commitSha: packet.binding.workroomRef.headSha,
          providerBlobId: "c990f13ba7663a18e1e8dd881812b04cbb550002",
        },
      },
      actionEnvelopeStatuses: [],
      writerExecutions: [{ success: false, hasReceipt: false }],
    });
    const requestKey = createObjectiveMappingRequestKey(packet);

    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey },
      history: [historical],
      providerProvenImpossibleTaskRunProofs: providerProofs(historical),
    })).toEqual({ authorized: true });
    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey },
      history: [historical],
      providerProvenImpossibleTaskRunProofs: new Map(),
    })).toMatchObject({ authorized: false, reason: "immutable-identity-conflict" });
  });

  it.each([
    ["active approval", { actionEnvelopeStatuses: ["approved"], writerExecutions: [] }],
    ["successful writer", { actionEnvelopeStatuses: [], writerExecutions: [{ success: true, hasReceipt: false }] }],
    ["writer receipt", { actionEnvelopeStatuses: [], writerExecutions: [{ success: false, hasReceipt: true }] }],
  ])("does not let a classified impossible artifact bypass %s", (_label, authority) => {
    const packet = currentPacket({
      itemId: "BI-7A38F667",
      workroomId: "WC-16B8E810",
      branchName: "feat/pet-rescue-operating-system",
      headSha: "9".repeat(40),
      artifactCommitSha: "5".repeat(40),
      providerBlobId: "6".repeat(40),
      baselineId: "baseline-current",
    });
    const historical = legacyHistory(packet, {
      binding: {
        ...legacyHistory(packet).binding,
        expectedCurrentBaselineId: "baseline-ancestor",
        artifactRef: {
          ...packet.binding.artifactRef,
          commitSha: "9".repeat(40),
          providerBlobId: "7".repeat(40),
        },
      },
      ...authority,
    });

    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey: createObjectiveMappingRequestKey(packet) },
      history: [historical],
      providerProvenImpossibleTaskRunProofs: providerProofs(historical),
    })).toMatchObject({
      authorized: false,
      reason: _label === "active approval" ? "prior-authority-active" : "authoritative-output-exists",
    });
  });

  it("does not let a provider disposition mask a repository, path, or Workroom conflict", () => {
    const packet = currentPacket({
      itemId: "BI-7A38F667",
      workroomId: "WC-16B8E810",
      branchName: "feat/pet-rescue-operating-system",
      headSha: "9".repeat(40),
      artifactCommitSha: "5".repeat(40),
      providerBlobId: "6".repeat(40),
      baselineId: "baseline-current",
    });
    const base = legacyHistory(packet, {
      binding: {
        ...legacyHistory(packet).binding,
        expectedCurrentBaselineId: "baseline-ancestor",
        artifactRef: {
          ...packet.binding.artifactRef,
          commitSha: "9".repeat(40),
          providerBlobId: "7".repeat(40),
        },
      },
      actionEnvelopeStatuses: [],
      writerExecutions: [],
    });
    const conflicts: ObjectiveMappingRequestHistory[] = [
      { ...base, binding: { ...base.binding, artifactRef: { ...base.binding.artifactRef, path: "docs/other.md" } } },
      { ...base, binding: { ...base.binding, artifactRef: { ...base.binding.artifactRef, repositoryFullName: "other/repo" } } },
      { ...base, objective: base.objective.replace("WC-16B8E810", "WC-OTHER") },
    ];

    for (const historical of conflicts) {
      expect(authorizeObjectiveMappingRequestKeyEvolution({
        packet: { ...packet, requestKey: createObjectiveMappingRequestKey(packet) },
        history: [historical],
        providerProvenImpossibleTaskRunProofs: providerProofs(historical),
      })).toMatchObject({ authorized: false, reason: "immutable-identity-conflict" });
    }
  });

  it("does not let one provider-proven row hide a second immutable conflict", () => {
    const packet = currentPacket({
      itemId: "BI-7A38F667",
      workroomId: "WC-16B8E810",
      branchName: "feat/pet-rescue-operating-system",
      headSha: "9".repeat(40),
      artifactCommitSha: "5".repeat(40),
      providerBlobId: "6".repeat(40),
      baselineId: "baseline-current",
    });
    const qualified = legacyHistory(packet, {
      binding: {
        ...legacyHistory(packet).binding,
        expectedCurrentBaselineId: "baseline-ancestor",
        artifactRef: {
          ...packet.binding.artifactRef,
          commitSha: packet.binding.workroomRef.headSha,
          providerBlobId: "7".repeat(40),
        },
      },
      actionEnvelopeStatuses: [],
      writerExecutions: [],
    });
    const conflicting = {
      ...legacyHistory(packet, { taskRunId: "TR-MCP-SECOND-CONFLICT" }),
      binding: {
        ...legacyHistory(packet).binding,
        artifactRef: { ...packet.binding.artifactRef, path: "docs/other-design.md" },
      },
    };

    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey: createObjectiveMappingRequestKey(packet) },
      history: [qualified, conflicting],
      providerProvenImpossibleTaskRunProofs: providerProofs(qualified),
    })).toEqual({
      authorized: false,
      reason: "immutable-identity-conflict",
      taskRunId: "TR-MCP-SECOND-CONFLICT",
    });
  });

  it.each(["submitted", "working", "input-required", "auth-required"])(
    "blocks a different request identity while the prior TaskRun is %s",
    (status) => {
      const packet = currentPacket({
        itemId: "BI-ACTIVE",
        workroomId: "WC-ACTIVE",
        branchName: "fix/active-authority",
        headSha: "a".repeat(40),
        artifactCommitSha: "b".repeat(40),
        providerBlobId: "c".repeat(40),
        baselineId: "baseline-active",
      });
      const historicalPacket = {
        ...packet,
        binding: { ...packet.binding, eligibleEvidenceActivityIds: ["evidence-a"] },
      };
      const historical = legacyHistory(historicalPacket, {
        status,
        idempotencyKey: createObjectiveMappingRequestKey(historicalPacket),
        binding: historicalPacket.binding,
        actionEnvelopeStatuses: [],
        writerExecutions: [],
      });

      expect(authorizeObjectiveMappingRequestKeyEvolution({
        packet: { ...packet, requestKey: createObjectiveMappingRequestKey(packet) },
        history: [historical],
        providerProvenImpossibleTaskRunProofs: new Map(),
      })).toEqual({
        authorized: false,
        reason: "immutable-identity-conflict",
        taskRunId: historical.taskRunId,
      });
    },
  );

  it.each([
    ["target agent", (history: ObjectiveMappingRequestHistory) => ({ ...history, targetAgent: "AGT-OTHER" })],
    ["required tools", (history: ObjectiveMappingRequestHistory) => ({
      ...history,
      requiredToolNames: ["read_source_at_version", "record_plan_backlog_coverage"],
    })],
  ])("does not let provider proof mask a %s conflict", (_label, mutate) => {
    const packet = currentPacket({
      itemId: "BI-STRUCTURAL",
      workroomId: "WC-STRUCTURAL",
      branchName: "fix/structural-authority",
      headSha: "d".repeat(40),
      artifactCommitSha: "e".repeat(40),
      providerBlobId: "f".repeat(40),
      baselineId: "baseline-current",
    });
    const historical = legacyHistory(packet, {
      taskRunId: "TR-MCP-PROVEN",
      binding: {
        ...legacyHistory(packet).binding,
        expectedCurrentBaselineId: "baseline-ancestor",
        artifactRef: {
          ...packet.binding.artifactRef,
          commitSha: packet.binding.workroomRef.headSha,
          providerBlobId: "1".repeat(40),
        },
      },
      actionEnvelopeStatuses: [],
      writerExecutions: [],
    });

    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey: createObjectiveMappingRequestKey(packet) },
      history: [mutate(historical)],
      providerProvenImpossibleTaskRunProofs: providerProofs(historical),
    })).toMatchObject({ authorized: false, reason: "immutable-identity-conflict" });
  });

  it("does not accept a caller-shaped provider disposition on history", () => {
    const packet = currentPacket({
      itemId: "BI-NO-CALLER-PROOF",
      workroomId: "WC-NO-CALLER-PROOF",
      branchName: "fix/no-caller-proof",
      headSha: "2".repeat(40),
      artifactCommitSha: "3".repeat(40),
      providerBlobId: "4".repeat(40),
      baselineId: "baseline-current",
    });
    const historical = legacyHistory(packet, {
      binding: {
        ...legacyHistory(packet).binding,
        expectedCurrentBaselineId: "baseline-ancestor",
        artifactRef: {
          ...packet.binding.artifactRef,
          commitSha: packet.binding.workroomRef.headSha,
          providerBlobId: "5".repeat(40),
        },
      },
    });

    expect("artifactDisposition" in historical).toBe(false);
    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey: createObjectiveMappingRequestKey(packet) },
      history: [historical],
      providerProvenImpossibleTaskRunProofs: new Map(),
    })).toMatchObject({ authorized: false, reason: "immutable-identity-conflict" });
  });

  it("binds provider proof to the exact persisted locator rather than TaskRun id alone", () => {
    const packet = currentPacket({
      itemId: "BI-PROOF-DIGEST",
      workroomId: "WC-PROOF-DIGEST",
      branchName: "fix/proof-digest",
      headSha: "6".repeat(40),
      artifactCommitSha: "7".repeat(40),
      providerBlobId: "8".repeat(40),
      baselineId: "baseline-current",
    });
    const proven = legacyHistory(packet, {
      taskRunId: "TR-MCP-PROVEN-DIGEST",
      binding: {
        ...legacyHistory(packet).binding,
        expectedCurrentBaselineId: "baseline-ancestor",
        artifactRef: {
          ...packet.binding.artifactRef,
          commitSha: packet.binding.workroomRef.headSha,
          providerBlobId: "9".repeat(40),
        },
      },
    });
    const proofs = providerProofs(proven);
    const mutated = {
      ...proven,
      binding: {
        ...proven.binding,
        artifactRef: { ...proven.binding.artifactRef, providerBlobId: "a".repeat(40) },
      },
    };

    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey: createObjectiveMappingRequestKey(packet) },
      history: [mutated],
      providerProvenImpossibleTaskRunProofs: proofs,
    })).toMatchObject({ authorized: false, reason: "immutable-identity-conflict" });
  });

  it("rejects a tampered modern history key and a cross-token same-key identity", () => {
    const packet = currentPacket({
      itemId: "BI-HISTORY-KEY",
      workroomId: "WC-HISTORY-KEY",
      branchName: "fix/history-key",
      headSha: "b".repeat(40),
      artifactCommitSha: "c".repeat(40),
      providerBlobId: "d".repeat(40),
      baselineId: "baseline-current",
    });
    const requestKey = createObjectiveMappingRequestKey(packet);
    const modern = legacyHistory(packet, {
      taskRunId: "TR-MCP-OTHER-TOKEN",
      idempotencyKey: requestKey,
      binding: packet.binding,
      status: "working",
    });

    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey },
      history: [{ ...modern, idempotencyKey: `${requestKey}:tampered` }],
    })).toMatchObject({ authorized: false, reason: "immutable-identity-conflict" });
    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...packet, requestKey },
      history: [modern],
      expectedTaskRunId: "TR-MCP-EXPECTED",
    })).toEqual({
      authorized: false,
      reason: "immutable-identity-conflict",
      taskRunId: "TR-MCP-OTHER-TOKEN",
    });
  });
});
