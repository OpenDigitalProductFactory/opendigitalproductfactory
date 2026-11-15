import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findMany: (...args: unknown[]) => db.findMany(...args) },
    mcpResourceSubscription: { updateMany: (...args: unknown[]) => db.updateMany(...args) },
  },
}));

import { mcpTaskNotificationBus } from "@/lib/mcp-task-notification-bus";
import { openMcpTaskStatusStream } from "./task-status-stream";

const owner = { tokenId: "token-1", userId: "user-1" };
const task = {
  taskRunId: "TR-MCP-ASYNC-1",
  userId: "user-1",
  title: "Review",
  objective: "Review exact artifact",
  status: "working",
  progressPayload: null,
  createdAt: new Date("2026-08-31T01:00:00.000Z"),
  updatedAt: new Date("2026-08-31T01:00:01.000Z"),
  completedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.findMany.mockResolvedValue([]);
  db.updateMany.mockResolvedValue({ count: 0 });
});

async function readFrames(reader: ReadableStreamDefaultReader<Uint8Array>, count: number): Promise<string> {
  const decoder = new TextDecoder();
  let out = "";
  for (let i = 0; i < count; i += 1) out += decoder.decode((await reader.read()).value);
  return out;
}

describe("openMcpTaskStatusStream", () => {
  it("replays only the token-owned durable task snapshot", async () => {
    db.findMany.mockResolvedValue([task]);
    const response = await openMcpTaskStatusStream(
      new Request("http://localhost:3000/api/mcp/v1"),
      owner,
    );
    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "user-1",
        a2aMetadata: { path: ["apiTokenId"], equals: "token-1" },
      }),
    }));

    const reader = response.body!.getReader();
    const replay = await readFrames(reader, 3);
    expect(replay).toContain('"method":"notifications/tasks/status"');
    expect(replay).toContain('"taskId":"TR-MCP-ASYNC-1"');
    await reader.cancel();
  });

  it("pushes a committed live transition without a polling request", async () => {
    const response = await openMcpTaskStatusStream(
      new Request("http://localhost:3000/api/mcp/v1"),
      owner,
    );
    const reader = response.body!.getReader();
    await readFrames(reader, 2); // : connected, priming id
    mcpTaskNotificationBus.publish(owner.tokenId, { ...task, status: "completed" });
    const pushed = new TextDecoder().decode((await reader.read()).value);
    expect(pushed).toContain('"method":"notifications/tasks/status"');
    expect(pushed).toContain('"status":"completed"');
    await reader.cancel();
  });

  it("rejects a GET client that does not accept an event stream", async () => {
    const response = await openMcpTaskStatusStream(
      new Request("http://localhost:3000/api/mcp/v1", { headers: { Accept: "application/json" } }),
      owner,
    );
    expect(response.status).toBe(406);
    expect(db.findMany).not.toHaveBeenCalled();
  });

  it("opens with a priming event id and carries an id on every frame (MCP resumability)", async () => {
    db.findMany.mockResolvedValue([task]);
    const response = await openMcpTaskStatusStream(new Request("http://localhost:3000/api/mcp/v1"), owner);
    const frames = await readFrames(response.body!.getReader(), 3);
    expect(frames).toMatch(/id: [A-Za-z0-9]{16,64}\.\d+\.1\nretry: \d+\ndata: \n\n/);
    expect(frames).toMatch(/id: [A-Za-z0-9]{16,64}\.\d+\.2\ndata: \{"jsonrpc":"2.0","method":"notifications\/tasks\/status"/);
  });
});

describe("room lane (BI-ED52AB82)", () => {
  const roomOwner = {
    tokenId: "tok-1", userId: "user-1", agentId: "AGT-EXT-CLAUDE", oauthFamilyKey: "fam-1",
    scope: "read", capability: "read", scopes: ["work_room_read"],
  };
  const NOW = new Date("2026-11-12T00:01:00.000Z");

  function fakeFanout() {
    const handles: Array<{ subscriberKey: string; deliver: (uri: string, at: Date) => boolean }> = [];
    const unregister = vi.fn();
    return {
      handles,
      unregister,
      fanout: {
        register: vi.fn((handle: (typeof handles)[number]) => {
          handles.push(handle);
          return unregister;
        }),
        replay: vi.fn().mockResolvedValue(undefined),
      },
    };
  }

  it("registers the stream for its subscriber and pushes a content-free resources/updated frame", async () => {
    const f = fakeFanout();
    const ac = new AbortController();
    const response = await openMcpTaskStatusStream(
      new Request("http://localhost:3000/api/mcp/v1", { signal: ac.signal }), roomOwner, { rooms: f.fanout, now: () => NOW },
    );
    const reader = response.body!.getReader();
    await readFrames(reader, 2);
    expect(f.fanout.register).toHaveBeenCalledWith(expect.objectContaining({ subscriberKey: "family:fam-1" }));
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { subscriberKey: "family:fam-1", expiresAt: { gt: NOW } },
      data: { expiresAt: new Date("2026-11-13T00:01:00.000Z") },
    });
    expect(f.handles[0]!.deliver("dpf://rooms/backlog-item%3ABI-1/messages", new Date("2026-11-12T00:00:59.000Z"))).toBe(true);
    const frame = await readFrames(reader, 1);
    expect(frame).toMatch(/^id: [A-Za-z0-9]+\.1794441659000\.2\n/);
    expect(frame).toContain('"method":"notifications/resources/updated","params":{"uri":"dpf://rooms/backlog-item%3ABI-1/messages"}');
    expect(frame).not.toContain("body");
    expect(f.fanout.replay).not.toHaveBeenCalled();
    ac.abort();
    expect(f.unregister).toHaveBeenCalled();
  });

  it("resumes a stream from Last-Event-ID: same stream id, replay from its watermark less the overlap", async () => {
    const f = fakeFanout();
    const streamId = "a".repeat(32);
    const response = await openMcpTaskStatusStream(
      new Request("http://localhost:3000/api/mcp/v1", { headers: { "Last-Event-ID": `${streamId}.1794441600000` } }),
      roomOwner,
      { rooms: f.fanout, now: () => NOW },
    );
    const frames = await readFrames(response.body!.getReader(), 2);
    expect(frames).toContain(`id: ${streamId}.`);
    // The counter resumes past the earlier connection's ids (now % 1e9 = 441660000, then +1).
    expect(frames).toContain(`id: ${streamId}.1794441660000.441660001`);
    expect(f.fanout.replay).toHaveBeenCalledWith(f.handles[0], new Date(1_794_441_600_000 - 30_000));
  });

  it("ignores a Last-Event-ID it did not issue", async () => {
    const f = fakeFanout();
    await openMcpTaskStatusStream(
      new Request("http://localhost:3000/api/mcp/v1", { headers: { "Last-Event-ID": "forged" } }),
      roomOwner,
      { rooms: f.fanout, now: () => NOW },
    );
    expect(f.fanout.replay).not.toHaveBeenCalled();
  });

  it("opens no room lane for a credential without an acting coworker", async () => {
    const f = fakeFanout();
    await openMcpTaskStatusStream(
      new Request("http://localhost:3000/api/mcp/v1"), { ...roomOwner, agentId: null }, { rooms: f.fanout, now: () => NOW },
    );
    expect(f.fanout.register).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });
});
