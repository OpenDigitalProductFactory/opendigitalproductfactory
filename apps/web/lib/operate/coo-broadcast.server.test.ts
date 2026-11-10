import { describe, expect, it, vi } from "vitest";
import { COO_BROADCAST_ACK_KIND, COO_BROADCAST_ASK_KIND } from "./coo-broadcast";
import { executeCooBroadcastAck, executeCooBroadcastAsk, type CooBroadcastDb } from "./coo-broadcast.server";

function fakeDb(rooms: Array<Record<string, unknown>>, relations: Array<Record<string, unknown>>): CooBroadcastDb & {
  activities: Array<Record<string, unknown>>;
} {
  const activities: Array<Record<string, unknown>> = [];
  return {
    activities,
    workroom: {
      findUnique: async (args: unknown) => {
        const where = (args as { where: Record<string, string> }).where;
        return rooms.find((row) => row.capsuleId === where.capsuleId) ?? null;
      },
      findMany: async (args: unknown) => {
        const ids = (args as { where: { id: { in: string[] } } }).where.id.in;
        return rooms.filter((row) => ids.includes(String(row.id)));
      },
    },
    workroomRelation: {
      findMany: async () => relations,
    },
    workroomActivity: {
      findFirst: async (args: unknown) => {
        const where = (args as { where: { commandScopeKey: string; commandKey: string } }).where;
        return activities.find((row) =>
          row.commandScopeKey === where.commandScopeKey && row.commandKey === where.commandKey) ?? null;
      },
      create: async (args: unknown) => {
        const data = (args as { data: Record<string, unknown> }).data;
        activities.push(data);
        return data;
      },
    },
  };
}

describe("executeCooBroadcastAsk", () => {
  it("writes ask rows down contains, posts where asked, and never dispatches a stage", async () => {
    const db = fakeDb([
      { id: "p-root", capsuleId: "WC-ROOT", workItemId: "wi-root", title: "Root" },
      { id: "p-child", capsuleId: "WC-CHILD", workItemId: "wi-child", title: "Child" },
    ], [
      { fromWorkroomId: "p-root", toWorkroomId: "p-child", relation: "contains" },
      { fromWorkroomId: "p-root", toWorkroomId: "p-other", relation: "depends-on" },
    ]);
    const postMessage = vi.fn();
    const result = await executeCooBroadcastAsk({
      db,
      capsuleId: "WC-ROOT",
      body: "Pause new intake.",
      commandKey: "ask-1",
      actor: { userId: "user-1", agentId: "AGT-EXT-GROK" },
      postMessage,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ commandKey: "ask-1", asked: 2, posted: 2, dispatchInvoked: false });
    expect(db.activities.map((row) => row.kind)).toEqual([COO_BROADCAST_ASK_KIND, COO_BROADCAST_ASK_KIND]);
    expect(db.activities.map((row) => row.commandScopeKey).sort()).toEqual([
      `${COO_BROADCAST_ASK_KIND}:WC-CHILD`,
      `${COO_BROADCAST_ASK_KIND}:WC-ROOT`,
    ]);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(result.data).not.toHaveProperty("stageKey");
  });

  it("is idempotent for the same commandKey and room", async () => {
    const db = fakeDb([
      { id: "p-root", capsuleId: "WC-ROOT", workItemId: null, title: "Root" },
    ], []);
    const first = await executeCooBroadcastAsk({
      db, capsuleId: "WC-ROOT", body: "Status please.", commandKey: "ask-dup",
      actor: { userId: null, agentId: "AGT-EXT-GROK" },
    });
    const second = await executeCooBroadcastAsk({
      db, capsuleId: "WC-ROOT", body: "Status please.", commandKey: "ask-dup",
      actor: { userId: null, agentId: "AGT-EXT-GROK" },
    });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(db.activities).toHaveLength(1);
    expect(second.data).toMatchObject({ dispatchInvoked: false });
  });
});

describe("executeCooBroadcastAck", () => {
  it("records an acknowledgement and never dispatches a stage", async () => {
    const db = fakeDb([{ id: "p-child", capsuleId: "WC-CHILD", title: "Child" }], []);
    const result = await executeCooBroadcastAck({
      db,
      capsuleId: "WC-CHILD",
      commandKey: "ask-1",
      actor: { userId: "user-1", agentId: null },
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ commandKey: "ask-1", capsuleId: "WC-CHILD", dispatchInvoked: false });
    expect(db.activities).toEqual([expect.objectContaining({
      kind: COO_BROADCAST_ACK_KIND,
      commandKey: "ask-1",
      commandScopeKey: `${COO_BROADCAST_ACK_KIND}:WC-CHILD`,
    })]);
  });
});
