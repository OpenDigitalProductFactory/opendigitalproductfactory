import { describe, expect, it } from "vitest";

import {
  authorizeObjectiveMappingRequestKeyEvolution,
  createObjectiveMappingRequestKey,
  validateObjectiveMappingRequestKey,
  type ObjectiveMappingRequestHistory,
} from "./mcp-task-objective-mapping-request-key";

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
    objective: packet.objective,
    idempotencyKey: legacyKey,
    binding: legacyBinding,
    actionEnvelopeStatuses: ["declined"],
    writerExecutions: [{ success: false, hasReceipt: false }],
    ...input,
  };
}

describe("objective-mapping request identity", () => {
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
    });

    expect(requestKey).toMatch(
      new RegExp(`^initiative-readiness:${fixture.itemId}:objective-mapping:${fixture.headSha}:packet-v2:[a-f0-9]{64}$`),
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
      objective: "current packet",
      idempotencyKey: createObjectiveMappingRequestKey(prior),
      binding: prior.binding,
      actionEnvelopeStatuses: ["executed"],
      writerExecutions: [{ success: true, hasReceipt: true }],
    };

    expect(authorizeObjectiveMappingRequestKeyEvolution({
      packet: { ...next, requestKey },
      history: [history],
    })).toMatchObject({ authorized: false, reason: "authoritative-output-exists" });
  });
});
