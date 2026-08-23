import { beforeEach, describe, expect, it, vi } from "vitest";

const collab = vi.hoisted(() => ({
  requestCoworker: vi.fn(),
  summonCoworker: vi.fn(),
}));
const remote = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("@/lib/tak/coworker-collaboration", () => ({
  requestCoworker: (...a: unknown[]) => collab.requestCoworker(...a),
  summonCoworker: (...a: unknown[]) => collab.summonCoworker(...a),
}));
vi.mock("@/lib/mcp-task-submit", () => ({
  submitRemoteCoworkerTask: (...args: unknown[]) => remote.submit(...args),
}));

import { coworkerPack } from "./coworker-pack";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = ["request_coworker", "summon_coworker", "find_coworker"];

beforeEach(() => {
  vi.clearAllMocks();
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
});

describe("coworker pack — handler behavior (delegation preserved)", () => {
  it("request_coworker requires a deterministic request key without caller thread context", async () => {
    const res = await coworkerPack.handlers.request_coworker(
      { targetAgent: "ea-architect", objective: "review schema" },
      "u1",
      {},
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_requestKey");
    expect(collab.requestCoworker).not.toHaveBeenCalled();
  });

  it("routes an external no-thread request through the governed remote task substrate", async () => {
    remote.submit.mockResolvedValue({
      kind: "result",
      result: { taskRunId: "TASK-REMOTE", status: "working", idempotentReplay: false },
    });
    const res = await coworkerPack.handlers.request_coworker(
      {
        targetAgent: "AGT-WS-REVIEW",
        objective: "Review the exact initiative design artifact.",
        requestKey: "BI-F0715C9C:design-review:sha256",
      },
      "u1",
      { apiTokenId: "token-1", authSource: "pat", tokenScope: "write", routeContext: "/build" },
    );

    expect(res).toMatchObject({ success: true, entityId: "TASK-REMOTE" });
    expect(remote.submit).toHaveBeenCalledWith(expect.objectContaining({
      token: expect.objectContaining({ tokenId: "token-1", capability: "write", source: "pat" }),
      params: expect.objectContaining({
        agentId: "AGT-WS-REVIEW",
        idempotencyKey: "BI-F0715C9C:design-review:sha256",
        riskClass: "bounded-write",
      }),
    }));
    expect(collab.requestCoworker).not.toHaveBeenCalled();
  });

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

  it("summon_coworker requires caller thread context", async () => {
    const res = await coworkerPack.handlers.summon_coworker(
      { targetAgent: "ea-architect", objective: "help" },
      "u1",
      {},
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_threadId");
    expect(collab.summonCoworker).not.toHaveBeenCalled();
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
