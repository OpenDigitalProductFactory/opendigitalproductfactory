import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-763D6E01: a Workroom tool call with commandId runs once; without it, unchanged.

const { receiptRows, txClient } = vi.hoisted(() => {
  const receiptRows = new Map<string, Record<string, unknown>>();
  const txClient = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      if (strings.join("?").includes("pg_advisory_xact_lock")) {
        throw new Error("Failed to deserialize column of type 'void'");
      }
      return [{ id: "row-1" }];
    },
    $executeRaw: async () => 1,
    workroomActivity: {
      findFirst: async ({ where }: { where: { commandScopeKey: string; commandKey: string } }) =>
        receiptRows.get(`${where.commandScopeKey}#${where.commandKey}`) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        receiptRows.set(`${data.commandScopeKey}#${data.commandKey}`, { kind: data.kind, payload: data.payload });
        return data;
      },
    },
  };
  return { receiptRows, txClient };
});

vi.mock("@dpf/db", () => ({
  prisma: { ...txClient, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient) },
}));

import { commandDb, receiptedWorkroomTool } from "./receipted-tool";

beforeEach(() => receiptRows.clear());

describe("receiptedWorkroomTool", () => {
  it("passes a call without commandId straight through", async () => {
    const handler = vi.fn(async () => ({ success: true, message: "ok" }));
    const tool = receiptedWorkroomTool("heartbeat", handler);
    await tool({ capsuleId: "WC-1" }, "user-1", { agentId: "AGT-1" });
    await tool({ capsuleId: "WC-1" }, "user-1", { agentId: "AGT-1" });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(receiptRows.size).toBe(0);
  });

  it("runs a command once and returns the first result to a retry", async () => {
    const handler = vi.fn(async () => ({ success: true, message: "renewed", data: { n: 1 } }));
    const tool = receiptedWorkroomTool("heartbeat", handler);
    const first = await tool({ capsuleId: "WC-1", commandId: "c-1" }, "user-1", { agentId: "AGT-1" });
    const second = await tool({ capsuleId: "WC-1", commandId: "c-1" }, "user-1", { agentId: "AGT-1" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("hands the handler the receipt transaction through commandDb()", async () => {
    let seen: unknown;
    const tool = receiptedWorkroomTool("heartbeat", async () => {
      seen = commandDb();
      return { success: true, message: "ok" };
    });
    await tool({ capsuleId: "WC-1", commandId: "c-tx" }, "user-1", undefined);
    expect(seen).toBe(txClient);
  });

  it("stores a refusal and returns the same refusal on retry without running again", async () => {
    const refusal = { success: false, error: "lease_held_by_other", message: "held", data: { holderPrincipalId: "p-2" } };
    const handler = vi.fn(async () => refusal);
    const tool = receiptedWorkroomTool("heartbeat", handler);
    await expect(tool({ capsuleId: "WC-1", commandId: "c-2" }, "user-1", undefined)).resolves.toEqual(refusal);
    await expect(tool({ capsuleId: "WC-1", commandId: "c-2" }, "user-1", undefined)).resolves.toEqual(refusal);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("refuses a command id reused on another room", async () => {
    const tool = receiptedWorkroomTool("heartbeat", async () => ({ success: true, message: "ok" }));
    await tool({ capsuleId: "WC-1", commandId: "c-3" }, "user-1", undefined);
    await expect(tool({ capsuleId: "WC-2", commandId: "c-3" }, "user-1", undefined))
      .resolves.toMatchObject({ success: false, error: "command_id_conflict" });
  });

  it("refuses an oversized command id", async () => {
    const tool = receiptedWorkroomTool("heartbeat", async () => ({ success: true, message: "ok" }));
    await expect(tool({ capsuleId: "WC-1", commandId: "x".repeat(201) }, "user-1", undefined))
      .resolves.toMatchObject({ success: false, error: "invalid_input" });
  });
});
