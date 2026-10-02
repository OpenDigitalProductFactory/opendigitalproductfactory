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
