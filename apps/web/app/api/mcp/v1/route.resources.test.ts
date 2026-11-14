// BI-ED52AB82: Work Rooms as MCP resources through the governed route.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/mcp-api-token", () => ({ resolveMcpApiToken: vi.fn() }));
vi.mock("@/lib/mcp/session-token", () => ({ verifyMcpSessionToken: vi.fn() }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceConfig: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: vi.fn() } }));
vi.mock("@dpf/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    agent: { findFirst: vi.fn() },
    taskRun: { findFirst: vi.fn(), findMany: vi.fn() },
    mcpToolSession: { findUnique: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock("@/lib/tak/agent-grants", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/tak/agent-grants")>()),
  getAgentToolGrantsAsync: vi.fn(),
}));

const roomDeps = vi.hoisted(() => ({
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  count: vi.fn(),
  resolveWorkItem: vi.fn(),
}));
vi.mock("@/lib/mcp/room-resources.server", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/mcp/room-resources.server")>()),
  defaultRoomResourceDeps: async () => ({
    db: {
      mcpResourceSubscription: { upsert: roomDeps.upsert, deleteMany: roomDeps.deleteMany, count: roomDeps.count },
      workroomParticipant: { findMany: vi.fn().mockResolvedValue([]) },
    },
    now: () => new Date("2026-11-12T00:00:00.000Z"),
    resolveWorkItem: roomDeps.resolveWorkItem,
    agentPrincipalId: async () => "principal-1",
    agentGrants: async () => ["work_room_read"],
    roomAccess: async () => "content",
  }),
}));
const fanout = vi.hoisted(() => ({ register: vi.fn(), replay: vi.fn() }));
vi.mock("@/lib/mcp/room-update-fanout.server", () => ({ roomUpdateFanout: () => fanout }));
const stream = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/lib/mcp/task-status-stream", () => ({ openMcpTaskStatusStream: (...args: unknown[]) => stream.open(...args) }));

import { prisma } from "@dpf/db";
import { resolveMcpApiToken } from "@/lib/auth/mcp-api-token";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { getQuiescenceConfig } from "@/lib/self-upgrade/quiescence";
import { GET, POST } from "./route";

const resolveMock = resolveMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const govMock = governedExecuteTool as unknown as ReturnType<typeof vi.fn>;
const URI = "dpf://rooms/backlog-item%3ABI-ED52AB82/messages";
const coworkerToken = {
  tokenId: "tok-1", userId: "user-1", agentId: "AGT-EXT-CLAUDE",
  scopes: ["work_room_read"], scope: "read", capability: "read",
};

function rpc(method: string, params?: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/mcp/v1", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer dpfmcp_X", "User-Agent": "claude-code/2.1 (test)", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method, ...(params ? { params } : {}) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getQuiescenceConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ level: "normal", runId: null, enteredAt: null });
  (prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ isSuperuser: false, isActive: true, groups: [] });
  resolveMock.mockResolvedValue(coworkerToken);
  roomDeps.resolveWorkItem.mockResolvedValue({ id: "wi-1" });
  roomDeps.count.mockResolvedValue(0);
  roomDeps.upsert.mockResolvedValue({});
  roomDeps.deleteMany.mockResolvedValue({ count: 1 });
  govMock.mockResolvedValue({ success: true, message: "1 newest message(s)", data: { caseKey: "backlog-item:BI-ED52AB82", messages: [{ messageId: "m1", body: "hi" }] } });
  stream.open.mockResolvedValue(new Response("", { status: 200 }));
});

describe("resources/* on /api/mcp/v1 (BI-ED52AB82)", () => {
  it("advertises subscribable resources at initialize", async () => {
    const res = await POST(rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
    const body = await res.json();
    expect(body.result.capabilities.resources).toEqual({ subscribe: true });
  });

  it("reads a room through the governed read_room_messages call", async () => {
    const res = await POST(rpc("resources/read", { uri: URI }));
    const body = await res.json();
    expect(govMock).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "read_room_messages",
      rawParams: { caseKey: "backlog-item:BI-ED52AB82" },
      userId: "user-1",
      context: expect.objectContaining({ agentId: "AGT-EXT-CLAUDE", apiTokenId: "tok-1" }),
    }));
    expect(body.id).toBe(9);
    expect(body.result.contents[0]).toMatchObject({ uri: URI, mimeType: "application/json" });
    expect(JSON.parse(body.result.contents[0].text).messages[0].messageId).toBe("m1");
  });

  it("refuses an unadmitted reader with the read's own refusal and no content", async () => {
    govMock.mockResolvedValue({ success: false, error: "forbidden", message: "Not admitted to read backlog-item:BI-ED52AB82 (not-admitted)." });
    const body = await (await POST(rpc("resources/read", { uri: URI }))).json();
    expect(body.error).toMatchObject({ code: -32600, data: { uri: URI, error: "forbidden" } });
    expect(body.result).toBeUndefined();
  });

  it("subscribes an admitted coworker and stores the subscription", async () => {
    const body = await (await POST(rpc("resources/subscribe", { uri: URI }))).json();
    expect(body).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
    expect(govMock).toHaveBeenCalledWith(expect.objectContaining({ toolName: "read_room_messages", rawParams: { caseKey: "backlog-item:BI-ED52AB82", limit: 1 } }));
    expect(roomDeps.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { subscriberKey_uri: { subscriberKey: "token:tok-1", uri: URI } },
    }));
  });

  it("stores nothing for a credential that cannot read rooms", async () => {
    resolveMock.mockResolvedValue({ ...coworkerToken, scopes: ["backlog_read"] });
    const body = await (await POST(rpc("resources/subscribe", { uri: URI }))).json();
    expect(body.error).toMatchObject({ code: -32600 });
    expect(govMock).not.toHaveBeenCalled();
    expect(roomDeps.upsert).not.toHaveBeenCalled();
  });

  it("stores nothing for an unadmitted subscriber", async () => {
    govMock.mockResolvedValue({ success: false, error: "forbidden", message: "Not admitted." });
    const body = await (await POST(rpc("resources/subscribe", { uri: URI }))).json();
    expect(body.error).toMatchObject({ code: -32600 });
    expect(roomDeps.upsert).not.toHaveBeenCalled();
  });

  it("returns -32002 for a room that does not exist", async () => {
    govMock.mockResolvedValue({ success: false, error: "not_found", message: "No Work Room found for backlog-item:BI-ED52AB82." });
    const body = await (await POST(rpc("resources/subscribe", { uri: URI }))).json();
    expect(body.error).toMatchObject({ code: -32002, data: { uri: URI } });
  });

  it("unsubscribes and lists templates", async () => {
    expect((await (await POST(rpc("resources/unsubscribe", { uri: URI }))).json()).result).toEqual({});
    const templates = (await (await POST(rpc("resources/templates/list"))).json()).result.resourceTemplates;
    expect(templates[0].uriTemplate).toBe("dpf://rooms/{caseKey}/messages");
  });

  it("accepts a resources notification with 202 and no body", async () => {
    const req = new Request("http://localhost:3000/api/mcp/v1", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer dpfmcp_X" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "resources/subscribe", params: { uri: URI } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    expect(roomDeps.upsert).not.toHaveBeenCalled();
  });

  it("opens the GET stream with the room lane", async () => {
    await GET(new Request("http://localhost:3000/api/mcp/v1", {
      method: "GET",
      headers: { Authorization: "Bearer dpfmcp_X", Accept: "text/event-stream" },
    }));
    expect(stream.open).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ tokenId: "tok-1", agentId: "AGT-EXT-CLAUDE" }), { rooms: fanout });
  });
});
