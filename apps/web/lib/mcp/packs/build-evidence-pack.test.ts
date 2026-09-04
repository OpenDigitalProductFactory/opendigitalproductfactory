import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  backlogItemFindUnique: vi.fn(),
  backlogItemFindFirst: vi.fn(),
  backlogItemCreate: vi.fn(),
  backlogItemUpdate: vi.fn(),
  activityCreate: vi.fn(),
  toolExecutionFindUnique: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: {
      findUnique: (...a: unknown[]) => db.backlogItemFindUnique(...a),
      findFirst: (...a: unknown[]) => db.backlogItemFindFirst(...a),
      create: (...a: unknown[]) => db.backlogItemCreate(...a),
      update: (...a: unknown[]) => db.backlogItemUpdate(...a),
    },
    backlogItemActivity: {
      create: (...a: unknown[]) => db.activityCreate(...a),
    },
    toolExecution: {
      findUnique: (...a: unknown[]) => db.toolExecutionFindUnique(...a),
    },
  },
}));

const localIntegration = vi.hoisted(() => ({ recordLocalIntegrationResult: vi.fn() }));
vi.mock("@/lib/nonprod/local-integration", () => localIntegration);

import { buildEvidencePack } from "./build-evidence-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

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

  it("record_execution_evidence validates a supplied ToolExecution reference", async () => {
    db.backlogItemFindUnique.mockResolvedValue({ id: "row-1" });
    db.toolExecutionFindUnique.mockResolvedValue({ id: "te-1", success: false });
    const res = await buildEvidencePack.handlers.record_execution_evidence(
      {
        itemId: "BI-1",
        kind: "test_pass",
        summary: "green",
        toolExecutionId: "te-1",
      },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_tool_execution");
    expect(db.activityCreate).not.toHaveBeenCalled();
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

  it("uses the canonical registry in the MCP enum", () => {
    const definition = buildEvidencePack.definitions.find((entry) => entry.name === "record_execution_evidence");
    const properties = definition?.inputSchema.properties as
      | Record<string, { enum?: unknown[] }>
      | undefined;
    expect(properties?.kind.enum).toContain("migration_pass");
    expect(properties?.kind.enum).toContain("ux_fail");
    expect(properties?.kind.enum).toContain("source_verified");
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
