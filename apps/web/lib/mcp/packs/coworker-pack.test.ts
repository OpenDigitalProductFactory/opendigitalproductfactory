import { beforeEach, describe, expect, it, vi } from "vitest";

const collab = vi.hoisted(() => ({
  requestCoworker: vi.fn(),
  summonCoworker: vi.fn(),
}));
const external = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/lib/tak/coworker-collaboration", () => ({
  requestCoworker: (...a: unknown[]) => collab.requestCoworker(...a),
  summonCoworker: (...a: unknown[]) => collab.summonCoworker(...a),
}));
vi.mock("@/lib/mcp/external-coworker-task-adapter", () => ({
  dispatchExternalCoworkerTask: (...a: unknown[]) => external.dispatch(...a),
}));

import { coworkerPack } from "./coworker-pack";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = ["request_coworker", "summon_coworker", "find_coworker"];

const initiativeReviewBinding = {
  writerToolName: "record_initiative_evidence",
  itemId: "BI-9DC21917",
  gate: "research",
  artifactRef: {
    kind: "repo-blob-at-commit",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    commitSha: "6dad5759f9e88176c59fecd2c13e6d5b5bdd344d",
    path: "docs/superpowers/plans/2026-08-24-local-ci-control-plane-fencing.md",
    providerBlobId: "a".repeat(40),
  },
};

const eligibleEvidenceActivityIds = ["ACTIVITY-PASS-1", "ACTIVITY-PASS-2"];
const objectiveMappingBinding = {
  ...initiativeReviewBinding,
  gate: "objective-mapping",
  eligibleEvidenceActivityIds,
};

beforeEach(() => {
  vi.clearAllMocks();
  external.dispatch.mockResolvedValue({
    success: false,
    error: "external_handoff_context_required",
    message: "External coworker handoff requires verified PAT context.",
  });
});

describe("coworker pack — registration", () => {
  it("exposes exactly the collaboration + discovery tools with a handler each", () => {
    expect(coworkerPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(coworkerPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of coworkerPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("mirrors the agent-grant gating source exactly (R3 no-drift)", () => {
    // request_coworker/summon_coworker are advise-safe coordination, ungated in
    // TOOL_TO_GRANTS — pack.grants is empty, so there is nothing to drift against.
    expect(coworkerPack.grants).toEqual({});
    for (const [name, grants] of Object.entries(coworkerPack.grants)) {
      expect(TOOL_TO_GRANTS[name], name).toEqual(grants);
    }
    // find_coworker is a real read-only discovery tool, gated centrally so it is
    // discoverable/callable over MCP (BI-5FB59BC6).
    expect(TOOL_TO_GRANTS["find_coworker"]).toEqual(["backlog_read"]);
  });

  it.each(["request_coworker", "summon_coworker"])("%s advertises the external request key", (toolName) => {
    const schema = coworkerPack.definitions.find((definition) => definition.name === toolName)?.inputSchema;
    expect(schema?.properties).toHaveProperty("requestKey");
  });

  it.each(["request_coworker", "summon_coworker"])("%s advertises the immutable initiative-review packet", (toolName) => {
    const schema = coworkerPack.definitions.find((definition) => definition.name === toolName)?.inputSchema;
    expect(schema?.properties).toHaveProperty("requiredToolNames");
    expect(schema?.properties).toHaveProperty("initiativeReviewBinding");
  });

  it.each(["request_coworker", "summon_coworker"])(
    "%s advertises bounded objective-mapping evidence IDs in the immutable binding",
    (toolName) => {
      const schema = coworkerPack.definitions.find((definition) => definition.name === toolName)?.inputSchema;
      const properties = schema?.properties as Record<string, unknown> | undefined;
      const bindingSchema = properties?.["initiativeReviewBinding"] as {
        properties?: Record<string, unknown>;
      } | undefined;

      expect(bindingSchema?.properties).toMatchObject({
        eligibleEvidenceActivityIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: 500,
          uniqueItems: true,
        },
      });
    },
  );
});

describe("coworker pack — handler behavior (delegation preserved)", () => {
  it("request_coworker fails closed when neither a portal thread nor verified external context exists", async () => {
    const res = await coworkerPack.handlers.request_coworker(
      { targetAgent: "ea-architect", objective: "review schema" },
      "u1",
      {},
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("external_handoff_context_required");
    expect(collab.requestCoworker).not.toHaveBeenCalled();
    expect(external.dispatch).toHaveBeenCalledOnce();
  });

  it.each(["codex-cli/0.9", "claude-code/2.1", "grok-cli/0.3", "dpf-embedded/1.0", "generic-mcp/1.0"])(
    "routes a threadless %s request through the shared external adapter",
    async (callerClient) => {
      external.dispatch.mockResolvedValue({
        success: true,
        entityId: "TR-MCP-REVIEW",
        message: "Queued governed external coworker handoff.",
        data: { status: "completed" },
      });
      const objective = "Review BI-B131F357 at repo commit 544830a, design path docs/superpowers/specs/recovery.md.";
      const res = await coworkerPack.handlers.request_coworker(
        {
          targetAgent: "AGT-WS-REVIEW",
          objective,
          questionPacketSummary: "Independent immutable design review",
          requestKey: "initiative-review:BI-B131F357:544830a",
          requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
          initiativeReviewBinding,
        },
        "u1",
        {
          apiTokenId: "token-1",
          authSource: "pat",
          tokenScope: "write",
          callerClient,
          userContext: { platformRole: null, isSuperuser: true },
        },
      );

      expect(res).toMatchObject({ success: true, entityId: "TR-MCP-REVIEW" });
      expect(external.dispatch).toHaveBeenCalledWith(expect.objectContaining({
        collaborationKind: "handoff",
        targetAgent: "AGT-WS-REVIEW",
        objective,
        requestKey: "initiative-review:BI-B131F357:544830a",
        title: "Independent immutable design review",
        requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
        initiativeReviewBinding,
        userId: "u1",
      }));
      expect(collab.requestCoworker).not.toHaveBeenCalled();
      external.dispatch.mockClear();
    },
  );

  it("request_coworker rejects missing targetAgent/objective", async () => {
    const res = await coworkerPack.handlers.request_coworker(
      { targetAgent: "", objective: "" },
      "u1",
      { threadId: "T-1" },
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_params");
    expect(collab.requestCoworker).not.toHaveBeenCalled();
  });

  it("request_coworker delegates and threads context + acting user through", async () => {
    collab.requestCoworker.mockResolvedValue({ childThreadId: "T-child", targetLabel: "Enterprise Architect" });
    const res = await coworkerPack.handlers.request_coworker(
      { targetAgent: "ea-architect", objective: "review schema", tier: 3 },
      "actor-9",
      { threadId: "T-parent", agentId: "AGT-1", routeContext: "/build" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("T-child");
    expect(res.message).toContain("Enterprise Architect");
    const [arg, userArg] = collab.requestCoworker.mock.calls[0];
    expect(arg).toMatchObject({
      parentThreadId: "T-parent",
      targetAgent: "ea-architect",
      objective: "review schema",
      tier: 3,
      enteredVia: "handoff",
      callerAgentId: "AGT-1",
      routeContext: "/build",
    });
    expect(userArg).toBe("actor-9");
  });

  it("request_coworker maps delegation failure to handoff_failed", async () => {
    collab.requestCoworker.mockRejectedValue(new Error("boom"));
    const res = await coworkerPack.handlers.request_coworker(
      { targetAgent: "ea-architect", objective: "review" },
      "u1",
      { threadId: "T-1" },
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("handoff_failed");
    expect(res.message).toBe("boom");
  });

  it("summon_coworker fails closed without verified external context", async () => {
    const res = await coworkerPack.handlers.summon_coworker(
      { targetAgent: "ea-architect", objective: "help" },
      "u1",
      {},
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("external_handoff_context_required");
    expect(collab.summonCoworker).not.toHaveBeenCalled();
  });

  it("routes an external summon through the same task adapter with summon provenance", async () => {
    external.dispatch.mockResolvedValue({
      success: true,
      entityId: "TR-MCP-SUMMON",
      message: "Queued governed external coworker summon.",
      data: { status: "working" },
    });
    const objective = "Independently approve the immutable initiative design and record the spec-approval receipt.";
    const res = await coworkerPack.handlers.summon_coworker(
      {
        targetAgent: "AGT-WS-REVIEW",
        objective,
        requestKey: "initiative-review:BI-B131F357:spec-approval:544830a",
        requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
        initiativeReviewBinding,
      },
      "u1",
      {
        apiTokenId: "token-1",
        authSource: "pat",
        tokenScope: "write",
        callerClient: "codex-cli/0.9",
        userContext: { platformRole: null, isSuperuser: true },
      },
    );

    expect(res).toMatchObject({ success: true, entityId: "TR-MCP-SUMMON" });
    expect(external.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      collaborationKind: "summon",
      targetAgent: "AGT-WS-REVIEW",
      objective,
      requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
      initiativeReviewBinding,
    }));
    expect(collab.summonCoworker).not.toHaveBeenCalled();
  });

  it.each([
    ["request_coworker", "handoff"],
    ["summon_coworker", "summon"],
  ] as const)("%s preserves the complete objective-mapping binding", async (toolName, collaborationKind) => {
    external.dispatch.mockResolvedValue({
      success: true,
      entityId: "TR-MCP-MAPPING",
      message: "Queued governed external coworker task.",
      data: { status: "working" },
    });

    const result = await coworkerPack.handlers[toolName](
      {
        targetAgent: "AGT-WS-PORTFOLIO",
        objective: "Map every current objective to eligible passing evidence.",
        requestKey: "initiative-readiness:BI-9DC21917:objective-mapping:abc123",
        requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
        initiativeReviewBinding: objectiveMappingBinding,
      },
      "u1",
      {
        apiTokenId: "token-1",
        authSource: "pat",
        tokenScope: "write",
        callerClient: "codex-cli/0.9",
        userContext: { platformRole: null, isSuperuser: true },
      },
    );

    expect(result.success).toBe(true);
    expect(external.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      collaborationKind,
      initiativeReviewBinding: objectiveMappingBinding,
    }));
  });

  it("summon_coworker delegates and returns the summon confirmation", async () => {
    collab.summonCoworker.mockResolvedValue({ childThreadId: "T-c", targetLabel: "Finance Specialist" });
    const res = await coworkerPack.handlers.summon_coworker(
      { targetAgent: "finance", objective: "reconcile" },
      "u1",
      { threadId: "T-1", agentId: "AGT-2" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("T-c");
    expect(res.message).toContain("Finance Specialist");
    expect(collab.summonCoworker).toHaveBeenCalledOnce();
  });
});
