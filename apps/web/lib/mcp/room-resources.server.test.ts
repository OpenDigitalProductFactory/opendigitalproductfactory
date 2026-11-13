import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  dispatchRoomResourceMethod,
  governedReadVia,
  listRoomResources,
  listRoomResourceTemplates,
  readRoomResource,
  roomPushAdmitted,
  subscribeRoomResource,
  unsubscribeRoomResource,
  type GovernedRoomRead,
  type RoomResourceDeps,
} from "./room-resources.server";

const NOW = new Date("2026-11-12T00:00:00.000Z");
const URI = "dpf://rooms/backlog-item%3ABI-ED52AB82/messages";
const auth = { tokenId: "tok-1", userId: "user-1", agentId: "AGT-EXT-CLAUDE", oauthFamilyKey: "fam-1", scope: "read", capability: "read", scopes: ["work_room_read"] };

function makeDeps(overrides: Partial<RoomResourceDeps> = {}) {
  const db = {
    mcpResourceSubscription: {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    mcpApiToken: { findUnique: vi.fn().mockResolvedValue({ revokedAt: null, expiresAt: null }) },
    workItem: { findUnique: vi.fn().mockResolvedValue({ id: "wi-1", itemId: "wi-1", sourceType: "backlog-item", sourceId: "BI-ED52AB82", title: "Room", evidence: null, assignedToAgentId: null, assignedToUserId: null }) },
    workroomParticipant: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const deps: RoomResourceDeps = {
    db,
    now: () => NOW,
    resolveWorkItem: vi.fn().mockResolvedValue({ id: "wi-1", title: "Room" }),
    agentPrincipalId: vi.fn().mockResolvedValue("principal-cuid-1"),
    agentGrants: vi.fn().mockResolvedValue(["work_room_read"]),
    roomAccess: vi.fn().mockResolvedValue("content"),
    ...overrides,
  };
  return { deps, db };
}

const okRead: GovernedRoomRead = vi.fn(async () => ({ kind: "ok" as const, data: { caseKey: "backlog-item:BI-ED52AB82", messages: [] } }));

beforeEach(() => vi.clearAllMocks());

describe("resources/read", () => {
  it("serves the room through the governed read_room_messages call and returns it as JSON contents", async () => {
    const read = vi.fn(async () => ({ kind: "ok" as const, data: { caseKey: "backlog-item:BI-ED52AB82", messages: [{ messageId: "m1" }] } }));
    const outcome = await readRoomResource({ uri: URI }, read);
    expect(read).toHaveBeenCalledWith({ caseKey: "backlog-item:BI-ED52AB82" });
    expect(outcome).toEqual({
      kind: "ok",
      result: { contents: [{ uri: URI, mimeType: "application/json", text: JSON.stringify({ caseKey: "backlog-item:BI-ED52AB82", messages: [{ messageId: "m1" }] }) }] },
    });
  });

  it("returns -32002 for a room that does not exist (MCP resources: resource not found)", async () => {
    const read = vi.fn(async () => ({ kind: "refused" as const, error: "not_found", message: "No Work Room found." }));
    expect(await readRoomResource({ uri: URI }, read)).toEqual({ kind: "error", code: -32002, message: "No Work Room found.", data: { uri: URI } });
  });

  it("returns the refusal for an unadmitted reader and never the content", async () => {
    const read = vi.fn(async () => ({ kind: "refused" as const, error: "forbidden", message: "Not admitted." }));
    expect(await readRoomResource({ uri: URI }, read)).toEqual({ kind: "error", code: -32600, message: "Not admitted.", data: { uri: URI, error: "forbidden" } });
  });

  it("refuses a URI that is not a room resource before any read", async () => {
    const read = vi.fn();
    const outcome = await readRoomResource({ uri: "file:///etc/passwd" }, read as never);
    expect(outcome).toMatchObject({ kind: "error", code: -32602 });
    expect(read).not.toHaveBeenCalled();
  });

  it("passes a transport-level refusal (scope step-up) through unchanged", async () => {
    const response = new Response("{}", { status: 403 });
    const read = vi.fn(async () => ({ kind: "response" as const, response }));
    expect(await readRoomResource({ uri: URI }, read)).toEqual({ kind: "response", response });
  });
});

describe("resources/subscribe", () => {
  it("proves admission with a governed read, then stores the subscription under the refresh family", async () => {
    const { deps, db } = makeDeps();
    const outcome = await subscribeRoomResource({ uri: URI }, auth, okRead, deps);
    expect(outcome).toEqual({ kind: "ok", result: {} });
    expect(okRead).toHaveBeenCalledWith({ caseKey: "backlog-item:BI-ED52AB82", limit: 1 });
    expect(db.mcpResourceSubscription.upsert).toHaveBeenCalledWith({
      where: { subscriberKey_uri: { subscriberKey: "family:fam-1", uri: URI } },
      create: { subscriberKey: "family:fam-1", uri: URI, caseKey: "backlog-item:BI-ED52AB82", workItemId: "wi-1", expiresAt: new Date("2026-11-13T00:00:00.000Z") },
      update: { workItemId: "wi-1", caseKey: "backlog-item:BI-ED52AB82", expiresAt: new Date("2026-11-13T00:00:00.000Z") },
    });
  });

  it("stores nothing when the subscriber is not admitted", async () => {
    const { deps, db } = makeDeps();
    const read = vi.fn(async () => ({ kind: "refused" as const, error: "forbidden", message: "Not admitted to read backlog-item:BI-ED52AB82." }));
    const outcome = await subscribeRoomResource({ uri: URI }, auth, read, deps);
    expect(outcome).toMatchObject({ kind: "error", code: -32600 });
    expect(db.mcpResourceSubscription.upsert).not.toHaveBeenCalled();
  });

  it("bounds how many rooms one client may subscribe to", async () => {
    const { deps, db } = makeDeps();
    db.mcpResourceSubscription.count.mockResolvedValue(100);
    const outcome = await subscribeRoomResource({ uri: URI }, auth, okRead, deps);
    expect(outcome).toMatchObject({ kind: "error", code: -32600, data: { error: "subscription_limit" } });
    expect(db.mcpResourceSubscription.upsert).not.toHaveBeenCalled();
  });
});

describe("resources/unsubscribe", () => {
  it("deletes only this subscriber's subscription", async () => {
    const { deps, db } = makeDeps();
    expect(await unsubscribeRoomResource({ uri: URI }, auth, deps)).toEqual({ kind: "ok", result: {} });
    expect(db.mcpResourceSubscription.deleteMany).toHaveBeenCalledWith({ where: { subscriberKey: "family:fam-1", uri: URI } });
  });
});

describe("resources/list", () => {
  it("lists the admitted rooms the coworker takes part in", async () => {
    const { deps, db } = makeDeps();
    db.workroomParticipant.findMany.mockResolvedValue([
      { workroom: { workItem: { id: "wi-1", itemId: "wi-1", sourceType: "backlog-item", sourceId: "BI-ED52AB82", title: "Push", evidence: null, assignedToAgentId: null, assignedToUserId: null } } },
      { workroom: { workItem: { id: "wi-2", itemId: "wi-2", sourceType: "backlog-item", sourceId: "BI-SECRET", title: "Hidden", evidence: null, assignedToAgentId: null, assignedToUserId: null } } },
      { workroom: { workItem: null } },
    ]);
    (deps.roomAccess as ReturnType<typeof vi.fn>).mockImplementation(async (_a: unknown, item: { id: string }) => (item.id === "wi-1" ? "content" : "none"));
    const outcome = await listRoomResources(auth, deps);
    expect(outcome).toEqual({
      kind: "ok",
      result: { resources: [{ uri: URI, name: "backlog-item:BI-ED52AB82", title: "Push", mimeType: "application/json" }] },
    });
  });

  it("lists nothing for a credential without an acting coworker", async () => {
    const { deps } = makeDeps();
    expect(await listRoomResources({ ...auth, agentId: null }, deps)).toEqual({ kind: "ok", result: { resources: [] } });
  });

  it("publishes the room template", () => {
    expect(listRoomResourceTemplates().resourceTemplates[0]).toMatchObject({ uriTemplate: "dpf://rooms/{caseKey}/messages" });
  });
});

describe("roomPushAdmitted (re-checked on every notification)", () => {
  it("admits a live credential whose coworker holds the read grant and content admission", async () => {
    const { deps } = makeDeps();
    expect(await roomPushAdmitted(auth, ["wi-1"], deps)).toBe(true);
  });

  it("stops at once when room admission is revoked", async () => {
    const { deps } = makeDeps({ roomAccess: vi.fn().mockResolvedValue("discover") });
    expect(await roomPushAdmitted(auth, ["wi-1"], deps)).toBe(false);
  });

  it("requires admission to every room on the path (a child room's message reaches a parent subscriber)", async () => {
    const roomAccess = vi.fn(async (_a: unknown, item: { id: string }) => (item.id === "wi-parent" ? "content" : "none"));
    const { deps, db } = makeDeps({ roomAccess });
    db.workItem.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
    expect(await roomPushAdmitted(auth, ["wi-parent", "wi-child"], deps)).toBe(false);
  });

  it("stops when the credential is revoked or expired", async () => {
    const { deps, db } = makeDeps();
    db.mcpApiToken.findUnique.mockResolvedValueOnce({ revokedAt: NOW, expiresAt: null });
    expect(await roomPushAdmitted(auth, ["wi-1"], deps)).toBe(false);
    db.mcpApiToken.findUnique.mockResolvedValueOnce({ revokedAt: null, expiresAt: new Date(NOW.getTime() - 1) });
    expect(await roomPushAdmitted(auth, ["wi-1"], deps)).toBe(false);
    db.mcpApiToken.findUnique.mockResolvedValueOnce(null);
    expect(await roomPushAdmitted(auth, ["wi-1"], deps)).toBe(false);
  });

  it("does not look up a session-JWT credential as a token row", async () => {
    const { deps, db } = makeDeps();
    expect(await roomPushAdmitted({ ...auth, tokenId: "session:user-1:AGT-EXT-CLAUDE" }, ["wi-1"], deps)).toBe(true);
    expect(db.mcpApiToken.findUnique).not.toHaveBeenCalled();
  });

  it("stops when the coworker or the credential no longer carries the read grant", async () => {
    const { deps } = makeDeps({ agentGrants: vi.fn().mockResolvedValue([]) });
    expect(await roomPushAdmitted(auth, ["wi-1"], deps)).toBe(false);
    const { deps: deps2 } = makeDeps();
    expect(await roomPushAdmitted({ ...auth, scopes: [] }, ["wi-1"], deps2)).toBe(false);
  });

  it("never admits a credential with no acting coworker", async () => {
    const { deps } = makeDeps();
    expect(await roomPushAdmitted({ ...auth, agentId: null }, ["wi-1"], deps)).toBe(false);
  });
});

describe("governedReadVia (resources/* reuse the tools/call path)", () => {
  const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 7, result }), { status: 200 });

  it("calls read_room_messages and returns its data", async () => {
    const callTool = vi.fn(async () => ok({
      content: [{ type: "text", text: JSON.stringify({ success: true, message: "1 newest", data: { caseKey: "k", messages: [] } }) }],
      structuredContent: { caseKey: "k", messages: [] },
      isError: false,
    }));
    expect(await governedReadVia(callTool)({ caseKey: "k" })).toEqual({ kind: "ok", data: { caseKey: "k", messages: [] } });
    expect(callTool).toHaveBeenCalledWith("read_room_messages", { caseKey: "k" });
  });

  it("returns a governed refusal as refused, with the tool's own error code and message", async () => {
    const callTool = vi.fn(async () => ok({
      content: [{ type: "text", text: JSON.stringify({ success: false, error: "forbidden", message: "Not admitted to read k (not-admitted)." }) }],
      isError: true,
    }));
    expect(await governedReadVia(callTool)({ caseKey: "k" })).toEqual({
      kind: "refused", error: "forbidden", message: "Not admitted to read k (not-admitted).",
    });
  });

  it("treats a non-JSON refusal text (token lacks the grant) as forbidden", async () => {
    const callTool = vi.fn(async () => ok({ content: [{ type: "text", text: "Token lacks the required scope for read_room_messages." }], isError: true }));
    expect(await governedReadVia(callTool)({ caseKey: "k" })).toEqual({
      kind: "refused", error: "forbidden", message: "Token lacks the required scope for read_room_messages.",
    });
  });

  it("passes a JSON-RPC error or step-up challenge through as the response", async () => {
    const response = new Response(JSON.stringify({ jsonrpc: "2.0", id: 7, error: { code: -32600, message: "insufficient_scope" } }), { status: 403 });
    expect(await governedReadVia(vi.fn(async () => response))({ caseKey: "k" })).toEqual({ kind: "response", response });
  });
});

describe("dispatchRoomResourceMethod", () => {
  it("answers resources/templates/list without a read", async () => {
    const { deps } = makeDeps();
    const outcome = await dispatchRoomResourceMethod("resources/templates/list", undefined, auth, okRead, deps);
    expect(outcome).toMatchObject({ kind: "ok", result: { resourceTemplates: [expect.objectContaining({ uriTemplate: "dpf://rooms/{caseKey}/messages" })] } });
  });

  it("routes read, subscribe, unsubscribe and list", async () => {
    const { deps } = makeDeps();
    expect(await dispatchRoomResourceMethod("resources/read", { uri: URI }, auth, okRead, deps)).toMatchObject({ kind: "ok", result: { contents: [expect.any(Object)] } });
    expect(await dispatchRoomResourceMethod("resources/subscribe", { uri: URI }, auth, okRead, deps)).toEqual({ kind: "ok", result: {} });
    expect(await dispatchRoomResourceMethod("resources/unsubscribe", { uri: URI }, auth, okRead, deps)).toEqual({ kind: "ok", result: {} });
    expect(await dispatchRoomResourceMethod("resources/list", {}, auth, okRead, deps)).toEqual({ kind: "ok", result: { resources: [] } });
  });

  it("answers method-not-found for a resources method this server does not offer", async () => {
    const { deps } = makeDeps();
    expect(await dispatchRoomResourceMethod("resources/frob", {}, auth, okRead, deps)).toMatchObject({ kind: "error", code: -32601 });
  });
});

describe("resources/list authority", () => {
  it("lists nothing when the credential or the coworker lacks the read grant", async () => {
    const { deps, db } = makeDeps({ agentGrants: vi.fn().mockResolvedValue([]) });
    expect(await listRoomResources(auth, deps)).toEqual({ kind: "ok", result: { resources: [] } });
    expect(db.workroomParticipant.findMany).not.toHaveBeenCalled();
    const { deps: deps2, db: db2 } = makeDeps();
    expect(await listRoomResources({ ...auth, scopes: [] }, deps2)).toEqual({ kind: "ok", result: { resources: [] } });
    expect(db2.workroomParticipant.findMany).not.toHaveBeenCalled();
  });
});
