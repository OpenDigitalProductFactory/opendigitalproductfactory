import { beforeEach, describe, expect, it, vi } from "vitest";

const { getQuiescenceConfigMock } = vi.hoisted(() => ({
  getQuiescenceConfigMock: vi.fn(),
}));

vi.mock("@/lib/auth/mcp-api-token", () => ({ resolveMcpApiToken: vi.fn() }));
vi.mock("@/lib/mcp/session-token", () => ({ verifyMcpSessionToken: vi.fn() }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceConfig: getQuiescenceConfigMock,
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: vi.fn(),
  executeAutonomousAgenticLoop: vi.fn(),
  resolveAutonomousWorkAgent: vi.fn(),
  resolveAutonomousWorkTools: vi.fn(),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    taskRun: { findFirst: vi.fn(), update: vi.fn() },
    agentThread: { upsert: vi.fn() },
    taskMessage: { create: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { resolveMcpApiToken } from "@/lib/auth/mcp-api-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { POST } from "./route";

const resolveMock = vi.mocked(resolveMcpApiToken);
const govMock = vi.mocked(governedExecuteTool);
const userMock = vi.mocked(prisma.user.findUnique);

const META_KEY = "com.opendigitalproductfactory/authorization-handle";

function toolRequest(params: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/mcp/v1", {
    method: "POST",
    headers: { Authorization: "Bearer dpfmcp_WRITE", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 91, method: "tools/call", params }),
  });
}

const ARGS = {
  title: "Permit carriage",
  objective: "Verify the permit handle reaches the monitor",
  source: "operator",
  idempotencyKey: "permit-meta-test",
};

beforeEach(() => {
  vi.resetAllMocks();
  getQuiescenceConfigMock.mockResolvedValue({ level: "normal", runId: null, enteredAt: null });
  userMock.mockResolvedValue({
    isSuperuser: true,
    isActive: true,
    groups: [{ platformRole: { roleId: "HR-000" } }],
  } as never);
  resolveMock.mockResolvedValue({
    tokenId: "tok_write",
    userId: "u1",
    agentId: "AGT-CAPSULE",
    scopes: ["work_capsule_write"],
    capability: "write",
    scope: "write",
  });
  govMock.mockResolvedValue({ success: true, message: "ok", data: { capsuleId: "WC-1" } });
});

// GPP Phase 2, PR-C: an MCP client replays a permit handle in tools/call
// params._meta under the settled extension key (BI-899C3844). Additive only.
describe("POST tools/call — permit handle carriage", () => {
  it("passes params._meta[authorization-handle] to the monitor as context.permitHandle", async () => {
    await POST(toolRequest({ name: "create_workroom", arguments: ARGS, _meta: { [META_KEY]: "GPM-abc" } }));

    expect(govMock).toHaveBeenCalledOnce();
    expect(govMock.mock.calls[0]![0].context).toMatchObject({ permitHandle: "GPM-abc" });
    expect(govMock.mock.calls[0]![0].rawParams).toEqual(ARGS);
  });

  it("a request without _meta produces the same monitor arguments as today", async () => {
    await POST(toolRequest({ name: "create_workroom", arguments: ARGS }));
    await POST(toolRequest({ name: "create_workroom", arguments: ARGS, _meta: { [META_KEY]: "GPM-abc" } }));

    const [plain, carried] = govMock.mock.calls.map((call) => call[0]);
    expect(plain!.context).not.toHaveProperty("permitHandle");
    const { permitHandle, ...carriedContext } = carried!.context!;
    expect(permitHandle).toBe("GPM-abc");
    expect({ ...carried!, context: carriedContext }).toEqual(plain);
  });

  it.each([
    ["a non-string handle", { [META_KEY]: 42 }],
    ["an empty handle", { [META_KEY]: "" }],
    ["another _meta key", { "io.opendigitalproductfactory/permit": "GPM-abc" }],
    ["a non-object _meta", "GPM-abc"],
  ])("ignores %s", async (_label, meta) => {
    await POST(toolRequest({ name: "create_workroom", arguments: ARGS, _meta: meta }));
    expect(govMock.mock.calls[0]![0].context).not.toHaveProperty("permitHandle");
  });
});

// GPP Phase 2, PR-G: the result side. A permit_required refusal's denial
// envelope is lifted onto the tool result's `_meta` under the MCP
// authorization extension's key, and the handle a gate minted for the call is
// returned with its expiry. Additive: every other result has no `_meta`.
describe("POST tools/call — permit result _meta", () => {
  const AUTHZ_KEY = "io.modelcontextprotocol/authorization";
  const authorization = {
    reason: "insufficient_authorization",
    remediation: "available",
    remediationHints: [{
      type: "transaction_authorization",
      condition: "handle_required",
      gate: {
        gateRef: "human-checkpoint-admit@1", title: "An approved human checkpoint for this call", obtain: "out_of_band",
        bindingId: "human-checkpoint-admit", gateKey: "coworker-authority-escalation", authority: "wwwd", admission: "approved-envelope",
      },
    }],
  };

  async function resultOf(params: Record<string, unknown>) {
    const res = await POST(toolRequest(params));
    return ((await res.json()) as { result: Record<string, unknown> }).result;
  }

  it("lifts a permit_required refusal's denial envelope onto result._meta", async () => {
    govMock.mockResolvedValue({
      success: false,
      error: "permit_required",
      message: "create_workroom is waiting on an input: a valid permit is required (handle_required).",
      disposition: "awaiting-input",
      data: { authorization, permit: { condition: "handle_required", verdict: "absent", reason: "no-permit", carriage: META_KEY } },
      governance: { rejected: "permit_required" },
    } as never);

    const result = await resultOf({ name: "create_workroom", arguments: ARGS });

    expect(result.isError).toBe(true);
    expect(result._meta).toEqual({ [AUTHZ_KEY]: authorization });
    // The structured data is unchanged: clients that ignore _meta see what they saw before.
    expect(result.structuredContent).toMatchObject({ authorization });
  });

  it("returns the minted handle and its expiry when a gate admitted the call", async () => {
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    govMock.mockResolvedValue({
      success: true,
      message: "ok",
      data: { capsuleId: "WC-1" },
      governance: {
        durationMs: 3,
        permit: { handle: "gpp1.GPM-1.k1.mac", verdict: "valid" },
        permitHandleExpiresAt: expiresAt,
      },
    });

    const result = await resultOf({ name: "create_workroom", arguments: ARGS });

    expect(result._meta).toEqual({ [META_KEY]: { handle: "gpp1.GPM-1.k1.mac", expiresAt } });
    // The handle is not echoed into the model-facing text block or structuredContent.
    expect(JSON.stringify(result.content)).not.toContain("gpp1.GPM-1");
    expect(JSON.stringify(result.structuredContent)).not.toContain("gpp1.GPM-1");
  });

  it("a result with no permit facts carries no _meta, exactly as before", async () => {
    govMock.mockResolvedValue({ success: true, message: "ok", data: { capsuleId: "WC-1" }, governance: { durationMs: 3 } });

    const result = await resultOf({ name: "create_workroom", arguments: ARGS });

    expect(result).not.toHaveProperty("_meta");
    expect(Object.keys(result).sort()).toEqual(["content", "isError", "structuredContent"]);
  });

  it("another refusal carrying authorization-shaped data is not lifted", async () => {
    govMock.mockResolvedValue({
      success: false, error: "approval_required", message: "held", data: { authorization }, governance: { rejected: "approval_required" },
    } as never);

    const result = await resultOf({ name: "create_workroom", arguments: ARGS });

    expect(result).not.toHaveProperty("_meta");
  });

  it("does not log the handle", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    govMock.mockResolvedValue({
      success: true, message: "ok", data: { capsuleId: "WC-1" },
      governance: { permit: { handle: "gpp1.GPM-SECRET.k1.mac", verdict: "valid" }, permitHandleExpiresAt: new Date(Date.now() + 60_000).toISOString() },
    });

    await resultOf({ name: "create_workroom", arguments: ARGS });

    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("GPM-SECRET");
      spy.mockRestore();
    }
  });
});
