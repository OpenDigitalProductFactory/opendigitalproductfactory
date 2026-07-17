import { describe, expect, it } from "vitest";

import {
  canonicalRedactedHash,
  createDurableConnectorAudit,
  executeCallbackTransaction,
} from "./audit";

describe("durable connector audit", () => {
  it("hashes canonical redacted input and writes the Prisma-shaped audit row", async () => {
    const rows: unknown[] = [];
    const audit = createDurableConnectorAudit({
      repository: { create: async (args) => { rows.push(args); } },
      now: () => new Date("2026-07-17T12:00:00.000Z"),
    });

    await audit.record({
      connectorId: "postmark-email",
      actor: { coworkerId: "cw-1", userId: "user-1" },
      operation: "connect",
      redactedInput: { z: 2, token: "adapter-redacted", a: 1 },
      responseKind: "success",
      resultCount: 1,
      durationMs: 12,
    });

    expect(rows).toEqual([{ data: {
      calledAt: new Date("2026-07-17T12:00:00.000Z"),
      integration: "postmark-email",
      coworkerId: "cw-1",
      userId: "user-1",
      toolName: "connect",
      argsHash: canonicalRedactedHash({ a: 1, token: "adapter-redacted", z: 2 }),
      responseKind: "success",
      resultCount: 1,
      durationMs: 12,
      errorCode: null,
      errorMessage: null,
    } }]);
    expect(JSON.stringify(rows)).not.toContain("raw-secret");
  });

  it.each(["connect", "disconnect", "health", "refresh", "sync", "callback"] as const)(
    "supports the %s operation",
    async (operation) => {
      const rows: unknown[] = [];
      const audit = createDurableConnectorAudit({ repository: { create: async (args) => { rows.push(args); } } });
      await audit.record({
        connectorId: "connector", actor: { coworkerId: "cw", userId: null }, operation,
        redactedInput: {}, responseKind: "success", durationMs: 0,
      });
      expect(rows).toHaveLength(1);
    },
  );

  it("fails closed when a durable audit write fails", async () => {
    const audit = createDurableConnectorAudit({ repository: { create: async () => { throw new Error("db down"); } } });
    await expect(audit.record({
      connectorId: "connector", actor: { coworkerId: "cw", userId: null }, operation: "sync",
      redactedInput: {}, responseKind: "error", durationMs: 1,
    })).rejects.toThrow("Connector audit persistence failed");
  });
});

type Receipt = {
  connectorId: string; deliveryKey: string; requestHash: string; status: string;
  responseCode: number | null; domainEntityId: string | null; acknowledgment: unknown;
  dispatchPending: boolean; completedAt: Date | null;
};

function callbackHarness() {
  const state = { receipts: new Map<string, Receipt>(), audits: [] as unknown[], domains: [] as string[] };
  const snapshot = () => structuredClone(state);
  const restore = (saved: ReturnType<typeof snapshot>) => {
    state.receipts = saved.receipts; state.audits = saved.audits; state.domains = saved.domains;
  };
  const tx = {
    integrationCallbackReceipt: {
      findUnique: async ({ where: { connectorId_deliveryKey: key } }: any) =>
        state.receipts.get(`${key.connectorId}:${key.deliveryKey}`) ?? null,
      create: async ({ data }: any) => {
        const key = `${data.connectorId}:${data.deliveryKey}`;
        if (state.receipts.has(key)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const row = { ...data, responseCode: null, domainEntityId: null, acknowledgment: null,
          dispatchPending: false, completedAt: null } as Receipt;
        state.receipts.set(key, row); return row;
      },
      update: async ({ where: { connectorId_deliveryKey: key }, data }: any) => {
        const mapKey = `${key.connectorId}:${key.deliveryKey}`;
        const row = { ...state.receipts.get(mapKey)!, ...data };
        state.receipts.set(mapKey, row); return row;
      },
    },
    integrationToolCallLog: { create: async ({ data }: any) => { state.audits.push(data); return data; } },
  };
  const client = {
    integrationCallbackReceipt: tx.integrationCallbackReceipt,
    $transaction: async <T>(operation: (transaction: typeof tx) => Promise<T>) => {
      const saved = snapshot();
      try { return await operation(tx); } catch (error) { restore(saved); throw error; }
    },
  };
  return { state, tx, client };
}

describe("callback idempotency", () => {
  it("atomically creates one domain entity, callback audit, receipt, and stored acknowledgment", async () => {
    const harness = callbackHarness();
    const input = {
      client: harness.client,
      connectorId: "postmark-email", deliveryKey: "message-1", redactedRequest: { kind: "inbound" },
      performDomainWrite: async () => { harness.state.domains.push("inbound-1"); return {
        domainEntityId: "inbound-1", responseCode: 200, acknowledgment: { ok: true, inboundId: "inbound-1" },
        dispatchPending: true,
      }; },
    };
    const first = await executeCallbackTransaction(input);
    const replay = await executeCallbackTransaction({ ...input, performDomainWrite: async () => { throw new Error("duplicate write"); } });

    expect(first.acknowledgment).toEqual({ ok: true, inboundId: "inbound-1" });
    expect(replay).toMatchObject({ replayed: true, acknowledgment: first.acknowledgment });
    expect(harness.state.domains).toEqual(["inbound-1"]);
    expect(harness.state.audits).toHaveLength(1);
    expect(harness.state.audits[0]).toMatchObject({ coworkerId: "external-webhook", userId: null, toolName: "callback" });
  });

  it("rolls back the domain write, audit, and receipt when the transaction fails", async () => {
    const harness = callbackHarness();
    harness.tx.integrationToolCallLog.create = async () => { throw new Error("audit unavailable"); };
    await expect(executeCallbackTransaction({
      client: harness.client, connectorId: "postmark-email", deliveryKey: "message-2", redactedRequest: {},
      performDomainWrite: async () => { harness.state.domains.push("inbound-2"); return {
        domainEntityId: "inbound-2", responseCode: 200, acknowledgment: { ok: true }, dispatchPending: false,
      }; },
    })).rejects.toThrow("audit unavailable");
    expect(harness.state.domains).toEqual([]);
    expect(harness.state.receipts.size).toBe(0);
  });

  it("persists pending dispatch and drains it idempotently on replay", async () => {
    const harness = callbackHarness();
    let attempts = 0;
    const responder = async () => { attempts += 1; if (attempts === 1) throw new Error("temporary"); };
    const base = {
      client: harness.client, connectorId: "postmark-email", deliveryKey: "message-3", redactedRequest: {}, responder,
      performDomainWrite: async () => ({ domainEntityId: "inbound-3", responseCode: 200,
        acknowledgment: { ok: true }, dispatchPending: true }),
    };
    const first = await executeCallbackTransaction(base);
    expect(first.operationalError).toBe("callback_dispatch_failed");
    expect([...harness.state.receipts.values()][0].dispatchPending).toBe(true);
    const replay = await executeCallbackTransaction(base);
    expect(replay.replayed).toBe(true);
    expect(attempts).toBe(2);
    expect([...harness.state.receipts.values()][0].dispatchPending).toBe(false);
  });

  it("rejects delivery-key reuse for a different redacted request identity", async () => {
    const harness = callbackHarness();
    const base = {
      client: harness.client, connectorId: "postmark-email", deliveryKey: "message-4",
      performDomainWrite: async () => ({ domainEntityId: "inbound-4", responseCode: 200,
        acknowledgment: { ok: true }, dispatchPending: false }),
    };
    await executeCallbackTransaction({ ...base, redactedRequest: { identity: "one" } });
    await expect(executeCallbackTransaction({
      ...base, redactedRequest: { identity: "two" },
    })).rejects.toMatchObject({ code: "callback_delivery_identity_conflict" });
    expect(harness.state.domains).toHaveLength(0);
  });

  it("recovers a concurrent unique-key loser from the committed receipt", async () => {
    const request = { kind: "inbound" };
    const receipt: Receipt = {
      connectorId: "postmark-email", deliveryKey: "message-5",
      requestHash: canonicalRedactedHash(request), status: "completed", responseCode: 200,
      domainEntityId: "inbound-5", acknowledgment: { ok: true }, dispatchPending: false,
      completedAt: new Date(),
    };
    const client = {
      integrationCallbackReceipt: { findUnique: async () => receipt },
      $transaction: async () => { throw Object.assign(new Error("concurrent unique"), { code: "P2002" }); },
    } as any;
    const result = await executeCallbackTransaction({
      client, connectorId: "postmark-email", deliveryKey: "message-5", redactedRequest: request,
      performDomainWrite: async () => { throw new Error("must not write twice"); },
    });
    expect(result).toMatchObject({ replayed: true, domainEntityId: "inbound-5" });
  });
});
