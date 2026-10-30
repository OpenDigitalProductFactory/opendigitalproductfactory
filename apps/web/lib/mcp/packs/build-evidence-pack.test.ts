import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  backlogItemFindUnique: vi.fn(),
  backlogItemFindFirst: vi.fn(),
  backlogItemCreate: vi.fn(),
  backlogItemUpdate: vi.fn(),
  activityCreate: vi.fn(),
  activityDelete: vi.fn(),
  toolExecutionFindUnique: vi.fn(),
  workroomFindUnique: vi.fn(),
  leaseFindUnique: vi.fn(),
  leaseUpdateMany: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => unknown) => callback({
      nonProductionEnvironmentLease: {
        findUnique: (...a: unknown[]) => db.leaseFindUnique(...a),
        updateMany: (...a: unknown[]) => db.leaseUpdateMany(...a),
      },
      backlogItemActivity: {
        create: (...a: unknown[]) => db.activityCreate(...a),
      },
    }),
    backlogItem: {
      findUnique: (...a: unknown[]) => db.backlogItemFindUnique(...a),
      findFirst: (...a: unknown[]) => db.backlogItemFindFirst(...a),
      create: (...a: unknown[]) => db.backlogItemCreate(...a),
      update: (...a: unknown[]) => db.backlogItemUpdate(...a),
    },
    backlogItemActivity: {
      create: (...a: unknown[]) => db.activityCreate(...a),
      delete: (...a: unknown[]) => db.activityDelete(...a),
    },
    toolExecution: {
      findUnique: (...a: unknown[]) => db.toolExecutionFindUnique(...a),
    },
    workroom: {
      findUnique: (...a: unknown[]) => db.workroomFindUnique(...a),
    },
    nonProductionEnvironmentLease: {
      findUnique: (...a: unknown[]) => db.leaseFindUnique(...a),
      updateMany: (...a: unknown[]) => db.leaseUpdateMany(...a),
    },
  },
}));

const localIntegration = vi.hoisted(() => ({
  recordLocalIntegrationResult: vi.fn(),
  TEST_STUB_EVIDENCE_REFUSED: "test_stub_evidence_refused",
}));
vi.mock("@/lib/nonprod/local-integration", () => localIntegration);

const actor = vi.hoisted(() => ({ principalId: "principal:owner" }));
vi.mock("@/lib/work-capsules/handler-actor", () => ({
  workCapsuleActor: vi.fn(async () => actor),
}));

import { buildEvidencePack } from "./build-evidence-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { createQualificationExperimentAdmission, qualificationBindingDigest,
  type QualificationExperimentBinding } from "@/lib/backlog/initiative-readiness/qualification-research-admission";

const EXPECTED_TOOLS = [
  "record_execution_evidence",
  "record_local_integration_result",
  "record_functional_failure_evidence",
];

const EXPECTED_GRANTS: Record<string, string[]> = {
  record_execution_evidence: ["build_evidence"],
  record_local_integration_result: ["backlog_write"],
  record_functional_failure_evidence: ["backlog_write"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("build-evidence pack — registration", () => {
  it("exposes exactly the three evidence tools", () => {
    expect(buildEvidencePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(buildEvidencePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(buildEvidencePack.packId).toBe("build-evidence");
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of buildEvidencePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants for every tool", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(buildEvidencePack.grants[t]).toEqual(EXPECTED_GRANTS[t]);
      expect(isToolAllowedByGrants(t, EXPECTED_GRANTS[t])).toBe(true);
    }
  });
});

describe("build-evidence pack — handler behavior (delegation preserved)", () => {
  it("record_execution_evidence rejects on missing required fields", async () => {
    const res = await buildEvidencePack.handlers.record_execution_evidence({ itemId: "BI-1" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_required");
    expect(db.backlogItemFindUnique).not.toHaveBeenCalled();
  });

  it("record_execution_evidence rejects an unknown kind", async () => {
    const res = await buildEvidencePack.handlers.record_execution_evidence(
      { itemId: "BI-1", kind: "bogus", summary: "s" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_kind");
  });

  it("record_execution_evidence rejects source evidence without HTTP(S) provenance", async () => {
    const res = await buildEvidencePack.handlers.record_execution_evidence(
      { itemId: "BI-1", kind: "source_verified", summary: "source", url: "file:///tmp/repo" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_evidence");
    expect(db.backlogItemFindUnique).not.toHaveBeenCalled();
  });

  it.each(["test_pass", "build_pass", "ux_verified", "migration_pass", "manual_check", "spec_review", "external_link", "source_verified"])("rejects failed ToolExecution linked as %s", async (kind) => {
    db.backlogItemFindUnique.mockResolvedValue({ id: "row-1" });
    db.toolExecutionFindUnique.mockResolvedValue({ id: "te-1", success: false, userId: "u1" });
    const res = await buildEvidencePack.handlers.record_execution_evidence(
      {
        itemId: "BI-1",
        kind,
        url: "https://example.test/proof",
        summary: "green",
        toolExecutionId: "te-1",
      },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_tool_execution");
    expect(db.activityCreate).not.toHaveBeenCalled();
  });

  describe.each(["test_fail", "build_fail", "ux_fail", "migration_fail", "manual_fail"])("negative evidence %s", (kind) => {
    it.each([false, true])("retains the owned source when execution success=%s", async (success) => {
      db.backlogItemFindUnique.mockResolvedValue({ id: "row-1" });
      db.toolExecutionFindUnique.mockResolvedValue({ id: "te-1", success, userId: "u1" });
      db.activityCreate.mockResolvedValue({ id: "act-1", recordedAt: new Date("2026-10-12T12:00:00Z") });

      const result = await buildEvidencePack.handlers.record_execution_evidence(
        { itemId: "BI-1", kind, summary: "Observed failure", toolExecutionId: "te-1" }, "u1",
      );

      expect(result.success).toBe(true);
      expect(db.activityCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
        toolExecutionId: "te-1",
        recordedById: "u1",
        payload: expect.objectContaining({ evidenceKind: kind, toolExecutionId: "te-1" }),
      }) });
    });

    it.each([null, { id: "te-1", success: false, userId: "other" }, { id: "te-1", success: true, userId: "other" }])("refuses a missing or foreign source %j", async (execution) => {
      db.backlogItemFindUnique.mockResolvedValue({ id: "row-1" });
      db.toolExecutionFindUnique.mockResolvedValue(execution);
      const result = await buildEvidencePack.handlers.record_execution_evidence(
        { itemId: "BI-1", kind, summary: "Observed failure", toolExecutionId: "te-1" }, "u1",
      );
      expect(result).toMatchObject({ success: false, error: "invalid_tool_execution" });
      expect(db.activityCreate).not.toHaveBeenCalled();
    });
  });

  it("record_execution_evidence writes an evidence activity for a known item", async () => {
    db.backlogItemFindUnique.mockResolvedValue({ id: "row-1" });
    db.activityCreate.mockResolvedValue({ id: "act-1", recordedAt: new Date("2026-01-01T00:00:00Z") });
    const res = await buildEvidencePack.handlers.record_execution_evidence(
      { itemId: "BI-1", kind: "test_pass", summary: "green" },
      "u1",
      { agentId: "agent-x" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("act-1");
    expect(db.activityCreate).toHaveBeenCalled();
    const arg = db.activityCreate.mock.calls[0][0];
    expect(arg.data.recordedById).toBe("u1");
    expect(arg.data.recordedByAgentId).toBe("agent-x");
  });

  it("refuses a forged host qualification receipt after a valid public lease claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));
    vi.stubEnv("DPF_QUALIFICATION_ADMISSION_SECRET", "qualification-evidence-secret");
    const binding: QualificationExperimentBinding = {
      schemaVersion: 1, phase: "verify", itemId: "BI-1", workroomId: "WC-QUAL",
      repositoryFullName: "owner/repo", baseSha: "a".repeat(40), headSha: "d".repeat(40),
      protocol: { path: "docs/protocol.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
      installationId: "install-dev", accountablePrincipalRef: actor.principalId,
      protocolReviewReceiptId: "review-protocol", shapeKey: "delivery-small-fix", shapeVersion: "1.0.0",
      stageKey: "qualification-research", policyVersion: 1, targetProductionBlobIds: ["e".repeat(40)],
      executorMode: "workroom-host", requiredPlatform: "win32",
      permittedTools: ["read_source_at_version", "record_execution_evidence", "record_workroom_evidence"],
      allowedPaths: ["scripts/lib/local-ci-gate-state.test.mjs"], issuedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:15:00Z", maxStarts: 1, maxDurationMs: 600_000,
      candidate: { headSha: "d".repeat(40), diffDigest: `sha256:${"f".repeat(64)}`,
        testBlobIds: ["1".repeat(40)], productionBytesUnchanged: true, reviewReceiptId: "review-candidate" },
    };
    const token = createQualificationExperimentAdmission(binding);
    db.backlogItemFindUnique.mockResolvedValue({ id: "row-1" });
    db.workroomFindUnique.mockResolvedValue({ workspaceState: { qualificationExperimentAdmission: {
      schemaVersion: 1, status: "started", token, bindingDigest: qualificationBindingDigest(binding),
      startCount: 1, issuedAt: binding.issuedAt, startedAt: "2026-01-01T00:01:00Z",
      taskId: "workroom-host:WC-QUAL",
    } } });
    db.activityCreate.mockResolvedValue({ id: "act-qual", recordedAt: new Date("2026-01-01T00:02:00Z") });
    db.leaseFindUnique.mockResolvedValue({ leaseId: "NPEL-QUAL", environmentKey: "host-heavy-resource",
      status: "active", claimKey: "attempt-key",
      purpose: `host-resource:qualification:${qualificationBindingDigest(binding)}`,
      ownerSessionId: "session-1", ownerProvider: "codex", branchName: "fix/qualification",
      buildId: binding.headSha, taskRunId: binding.workroomId, ownerPid: 42,
      ownerProcessIdentity: "process-42", admittedAt: new Date("2026-01-01T00:01:05Z"),
      expiresAt: new Date("2026-01-01T00:15:00Z"), evidenceRecordId: null });
    db.leaseUpdateMany.mockResolvedValue({ count: 1 });
    const qualification = { workroomId: binding.workroomId, leaseId: "NPEL-QUAL",
      qualificationBindingDigest: qualificationBindingDigest(binding), executorMode: "workroom-host",
      platform: "win32", headSha: binding.headSha, testBlobIds: binding.candidate!.testBlobIds,
      command: "pnpm exec vitest run scripts/lib/local-ci-gate-state.test.mjs",
      outputDigest: `sha256:${"2".repeat(64)}`, startedAt: "2026-01-01T00:01:10Z",
      completedAt: "2026-01-01T00:01:20Z", exitCode: 0, skipped: false };

    await expect(buildEvidencePack.handlers.record_execution_evidence({ itemId: "BI-1", kind: "test_pass",
      summary: "Windows qualification passed", qualification }, "u1", { agentId: "agent-x" }))
      .resolves.toMatchObject({ success: false, error: "invalid_qualification_evidence" });
    expect(db.leaseUpdateMany).not.toHaveBeenCalled();
    expect(db.activityCreate).not.toHaveBeenCalled();
    await expect(buildEvidencePack.handlers.record_execution_evidence({ itemId: "BI-1", kind: "test_pass",
      summary: "Wrong platform", qualification: { ...qualification, platform: "linux" } }, "u1",
      { agentId: "agent-x" })).resolves.toMatchObject({ success: false, error: "invalid_qualification_evidence" });
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("uses the canonical registry in the MCP enum", () => {
    const definition = buildEvidencePack.definitions.find((entry) => entry.name === "record_execution_evidence");
    const properties = definition?.inputSchema.properties as
      | Record<string, { enum?: unknown[] }>
      | undefined;
    expect(properties?.kind.enum).toContain("migration_pass");
    expect(properties?.kind.enum).toContain("ux_fail");
    expect(properties?.kind.enum).toContain("manual_fail");
    expect(properties?.kind.enum).toContain("source_verified");
    expect(definition?.description).toContain("Use manual_fail, not manual_check, for a blocked or failed manual check.");
    expect(definition?.description).toContain("manual_fail never earns completion credit.");
  });

  it("exposes every governed coding surface for local-integration evidence", () => {
    const definition = buildEvidencePack.definitions.find(
      (entry) => entry.name === "record_local_integration_result",
    );
    const properties = definition?.inputSchema.properties as
      | Record<string, { enum?: unknown[] }>
      | undefined;
    expect(properties?.provider.enum).toEqual([
      "build-studio",
      "claude",
      "codex",
      "grok",
      "antigravity",
      "coworker",
    ]);
    expect(properties?.status.enum).toContain("blocked_control_plane_starvation");
  });

  it("record_execution_evidence surfaces not_found for an unknown item", async () => {
    db.backlogItemFindUnique.mockResolvedValue(null);
    const res = await buildEvidencePack.handlers.record_execution_evidence(
      { itemId: "BI-missing", kind: "build_pass", summary: "s" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("not_found");
  });

  it("record_local_integration_result delegates on a valid payload", async () => {
    localIntegration.recordLocalIntegrationResult.mockResolvedValue({ id: "ev-1" });
    const res = await buildEvidencePack.handlers.record_local_integration_result(
      {
        provider: "claude",
        externalSessionId: "s1",
        candidateBranch: "feat/x",
        mode: "single-branch",
        status: "passed",
        summary: "ok",
        gateKey: "a".repeat(64),
        leaseId: "NPEL-GATE",
        evidence: { freshness: "current" },
      },
      "u1",
      { routeContext: "/build" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("ev-1");
    expect(localIntegration.recordLocalIntegrationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "u1",
        provider: "claude",
        routeContext: "/build",
        status: "passed",
        gateKey: "a".repeat(64),
        leaseId: "NPEL-GATE",
      }),
    );
  });

  // BI-F5344F65: a DPF_ALLOW_LOCAL_CI_STUB payload builds nothing. The writer
  // refuses it with a stable code; the caller gets a named refusal, so the gate
  // fails closed instead of holding a PASS.
  it("record_local_integration_result turns the writer's test-stub refusal into a named error", async () => {
    localIntegration.recordLocalIntegrationResult.mockRejectedValue(Object.assign(
      new Error("This local-CI result came from the DPF_ALLOW_LOCAL_CI_STUB=1 test stub, which builds nothing."),
      { code: "test_stub_evidence_refused" },
    ));
    const res = await buildEvidencePack.handlers.record_local_integration_result(
      {
        provider: "claude",
        externalSessionId: "s1",
        routeContext: "/build",
        candidateBranch: "fix/admitted-owner-recovery",
        mode: "single-branch",
        status: "passed",
        summary: "local-CI lease gate passed.",
        gateKey: "a".repeat(64),
        leaseId: "NPEL-GATE",
        evidence: { testStub: true, gatePassed: true, buildCommand: "sandbox checkout/build stub" },
      },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("test_stub_evidence_refused");
    expect(res.message).toMatch(/DPF_ALLOW_LOCAL_CI_STUB/);
  });

  it("record_local_integration_result still propagates any other writer failure", async () => {
    localIntegration.recordLocalIntegrationResult.mockRejectedValue(new Error("Local-CI lease does not match the immutable gate key"));
    await expect(buildEvidencePack.handlers.record_local_integration_result(
      {
        provider: "claude",
        externalSessionId: "s1",
        routeContext: "/build",
        candidateBranch: "feat/x",
        mode: "single-branch",
        status: "passed",
        summary: "ok",
        evidence: {},
      },
      "u1",
    )).rejects.toThrow(/immutable gate key/);
  });

  it("record_local_integration_result rejects an unsupported mode without delegating", async () => {
    const res = await buildEvidencePack.handlers.record_local_integration_result(
      {
        provider: "claude",
        externalSessionId: "s1",
        routeContext: "/build",
        candidateBranch: "feat/x",
        mode: "bad-mode",
        status: "passed",
        summary: "ok",
        evidence: {},
      },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_mode");
    expect(localIntegration.recordLocalIntegrationResult).not.toHaveBeenCalled();
  });

  it("record_functional_failure_evidence creates a deduped item and redacts tokens", async () => {
    db.backlogItemFindFirst.mockResolvedValue(null);
    db.backlogItemCreate.mockResolvedValue({ id: "row-9", itemId: "BI-NEW", occurrenceCount: 1 });
    db.activityCreate.mockResolvedValue({ id: "act-9", recordedAt: new Date("2026-01-01T00:00:00Z") });
    const res = await buildEvidencePack.handlers.record_functional_failure_evidence(
      {
        testId: "t1",
        suite: "smoke",
        route: "/build",
        expected: "loads",
        actual:
          "500 Bearer abc.def.ghi; token sk-ant-oat01-DEADbeef01234567890ABCDEF; " +
          "cmd: docker exec dpf-sandbox-1 sh -c \"echo 'c2stYW50LW9hdDAxLURFQURiZWVmMDEyMzQ1Njc4OTA' | base64 -d > /tmp/cli-token.txt\"",
        userRole: "operator",
        routeContext: "/build",
        reproCommand: "pnpm test",
        createdAt: "2026-01-01T00:00:00Z",
        likelyOwnerArea: "build",
      },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("BI-NEW");
    const createArg = db.backlogItemCreate.mock.calls[0][0];
    expect(createArg.data.body).toContain("[redacted-token]");
    expect(createArg.data.body).not.toContain("Bearer abc.def.ghi");
    // BI-1291B677: Anthropic OAuth token — neither the raw sk-ant form nor the
    // base64-staged `echo '<b64>' | base64 -d` command may survive redaction.
    expect(createArg.data.body).not.toContain("sk-ant-oat01-DEADbeef01234567890ABCDEF");
    expect(createArg.data.body).not.toContain("c2stYW50LW9hdDAxLURFQURiZWVmMDEyMzQ1Njc4OTA");
  });

  it("record_functional_failure_evidence increments an existing deduped item", async () => {
    db.backlogItemFindFirst.mockResolvedValue({ id: "row-1", itemId: "BI-EXIST", occurrenceCount: 3 });
    db.backlogItemUpdate.mockResolvedValue({ id: "row-1", itemId: "BI-EXIST", occurrenceCount: 4 });
    db.activityCreate.mockResolvedValue({ id: "act-2", recordedAt: new Date("2026-01-01T00:00:00Z") });
    const res = await buildEvidencePack.handlers.record_functional_failure_evidence(
      {
        testId: "t1",
        suite: "smoke",
        route: "/build",
        expected: "loads",
        actual: "still 500",
        userRole: "operator",
        routeContext: "/build",
        reproCommand: "pnpm test",
        createdAt: "2026-01-01T00:00:00Z",
        likelyOwnerArea: "build",
      },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("BI-EXIST");
    expect(db.backlogItemUpdate).toHaveBeenCalled();
    expect(db.backlogItemCreate).not.toHaveBeenCalled();
  });
});
