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
      responseKind: "error",
      resultCount: 1,
      durationMs: 12,
      error: {
        kind: "authentication",
        safeMessage: "Authorization: Bearer raw-bearer Basic raw-basic https://user:pass@example.test/?token=query-secret supplied-secret payload-fragment",
        sensitiveValues: ["supplied-secret", "payload-fragment"],
      },
    });

    expect(rows).toEqual([{ data: {
      calledAt: new Date("2026-07-17T12:00:00.000Z"),
      integration: "postmark-email",
      coworkerId: "cw-1",
      userId: "user-1",
      toolName: "connect",
      argsHash: canonicalRedactedHash({ a: 1, token: "adapter-redacted", z: 2 }),
      responseKind: "error",
      resultCount: 1,
      durationMs: 12,
      errorCode: "authentication",
      errorMessage: "Authorization: Bearer [REDACTED] Basic [REDACTED] https://[REDACTED]@example.test/?token=[REDACTED] [REDACTED] [REDACTED]",
    } }]);
    for (const secret of ["raw-bearer", "raw-basic", "user:pass", "query-secret", "supplied-secret", "payload-fragment"]) {
      expect(JSON.stringify(rows)).not.toContain(secret);
    }
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
  auditPending: boolean; auditData: unknown;
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
          dispatchPending: false, completedAt: null, auditPending: false, auditData: null } as Receipt;
        state.receipts.set(key, row); return row;
      },
      update: async ({ where: { connectorId_deliveryKey: key }, data }: any) => {
        const mapKey = `${key.connectorId}:${key.deliveryKey}`;
        const row = { ...state.receipts.get(mapKey)!, ...data };
        state.receipts.set(mapKey, row); return row;
      },
      updateMany: async ({ where, data }: any) => {
        const mapKey = `${where.connectorId}:${where.deliveryKey}`;
        const existing = state.receipts.get(mapKey);
        if (!existing || existing.auditPending !== where.auditPending) return { count: 0 };
        state.receipts.set(mapKey, { ...existing, ...data });
        return { count: 1 };
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

  it("returns the committed acknowledgment and preserves pending audit when audit delivery fails", async () => {
    const harness = callbackHarness();
    harness.tx.integrationToolCallLog.create = async () => { throw new Error("audit unavailable"); };
    const result = await executeCallbackTransaction({
      client: harness.client, connectorId: "postmark-email", deliveryKey: "message-2", redactedRequest: {},
      performDomainWrite: async () => { harness.state.domains.push("inbound-2"); return {
        domainEntityId: "inbound-2", responseCode: 200, acknowledgment: { ok: true }, dispatchPending: false,
      }; },
    });
    expect(result).toMatchObject({ acknowledgment: { ok: true }, operationalErrors: ["callback_audit_pending"] });
    expect(harness.state.domains).toEqual(["inbound-2"]);
    expect(harness.state.receipts.size).toBe(1);
    expect([...harness.state.receipts.values()][0]).toMatchObject({ status: "completed", auditPending: true });
    harness.tx.integrationToolCallLog.create = async ({ data }: any) => { harness.state.audits.push(data); return data; };
    const replay = await executeCallbackTransaction({
      client: harness.client, connectorId: "postmark-email", deliveryKey: "message-2", redactedRequest: {},
      performDomainWrite: async () => { throw new Error("must replay"); },
    });
    expect(replay.replayed).toBe(true);
    expect(harness.state.audits).toHaveLength(1);
    expect([...harness.state.receipts.values()][0].auditPending).toBe(false);
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
    expect(first.operationalErrors).toEqual(["callback_dispatch_failed"]);
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
      completedAt: new Date(), auditPending: false, auditData: null,
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

  it("races two transactions after both observe an absent receipt and creates one result", async () => {
    const receiptKey = "postmark-email:message-6";
    const state = { receipt: null as Receipt | null, domains: [] as string[], audits: [] as unknown[] };
    let claimArrivals = 0;
    let releaseClaims!: () => void;
    const claimsReached = new Promise<void>((resolve) => { releaseClaims = resolve; });
    let winnerCommitted!: () => void;
    const committed = new Promise<void>((resolve) => { winnerCommitted = resolve; });
    let initialTransactions = 0;

    const sharedDelegate = {
      findUnique: async () => state.receipt,
      create: async () => { throw new Error("unexpected create after claim race"); },
      update: async ({ data }: any) => { state.receipt = { ...state.receipt!, ...data }; return state.receipt; },
      updateMany: async ({ where, data }: any) => {
        if (!state.receipt || state.receipt.auditPending !== where.auditPending) return { count: 0 };
        state.receipt = { ...state.receipt, ...data }; return { count: 1 };
      },
    };
    const auditDelegate = { create: async ({ data }: any) => { state.audits.push(data); return data; } };
    const client = {
      integrationCallbackReceipt: sharedDelegate,
      $transaction: async <T>(operation: (transaction: any) => Promise<T>) => {
        const transactionNumber = initialTransactions++;
        if (transactionNumber >= 2) return operation({
          integrationCallbackReceipt: sharedDelegate, integrationToolCallLog: auditDelegate,
        });
        let localReceipt: Receipt | null = null;
        const tx = {
          integrationCallbackReceipt: {
            ...sharedDelegate,
            findUnique: async () => null,
            create: async ({ data }: any) => {
              const claimNumber = claimArrivals++;
              if (claimArrivals === 2) releaseClaims();
              await claimsReached;
              if (claimNumber === 1) {
                await committed;
                throw Object.assign(new Error("unique claim lost"), { code: "P2002" });
              }
              localReceipt = { ...data, responseCode: null, domainEntityId: null,
                acknowledgment: null, dispatchPending: false, auditPending: false,
                auditData: null, completedAt: null } as Receipt;
              return localReceipt;
            },
            update: async ({ data }: any) => {
              localReceipt = { ...localReceipt!, ...data }; return localReceipt;
            },
          },
          integrationToolCallLog: auditDelegate,
        };
        try {
          const result = await operation(tx);
          if (localReceipt) state.receipt = localReceipt;
          winnerCommitted();
          return result;
        } catch (error) {
          throw error;
        }
      },
    };
    let writes = 0;
    const input = {
      client: client as any, connectorId: "postmark-email", deliveryKey: "message-6",
      redactedRequest: { kind: "inbound" },
      performDomainWrite: async () => {
        writes += 1; state.domains.push("inbound-6");
        return { domainEntityId: "inbound-6", responseCode: 200,
          acknowledgment: { ok: true, inboundId: "inbound-6" }, dispatchPending: false };
      },
    };
    const [left, right] = await Promise.all([
      executeCallbackTransaction(input), executeCallbackTransaction(input),
    ]);
    expect(claimArrivals).toBe(2);
    expect(writes).toBe(1);
    expect(state.domains).toEqual(["inbound-6"]);
    expect(state.receipt).toMatchObject({ connectorId: "postmark-email", deliveryKey: "message-6", status: "completed" });
    expect(`${state.receipt!.connectorId}:${state.receipt!.deliveryKey}`).toBe(receiptKey);
    expect(state.audits).toHaveLength(1);
    expect(left.acknowledgment).toEqual(right.acknowledgment);
  });

  it("reports audit and dispatch failures together and replay drains each independently", async () => {
    const harness = callbackHarness();
    harness.tx.integrationToolCallLog.create = async () => { throw new Error("audit down"); };
    let dispatchAttempts = 0;
    const responder = async () => { dispatchAttempts += 1; throw new Error("dispatch down"); };
    const base = {
      client: harness.client, connectorId: "postmark-email", deliveryKey: "message-7",
      redactedRequest: {}, responder,
      performDomainWrite: async () => ({ domainEntityId: "inbound-7", responseCode: 200,
        acknowledgment: { ok: true }, dispatchPending: true }),
    };
    const first = await executeCallbackTransaction(base);
    expect(new Set(first.operationalErrors)).toEqual(new Set(["callback_audit_pending", "callback_dispatch_failed"]));
    harness.tx.integrationToolCallLog.create = async ({ data }: any) => { harness.state.audits.push(data); return data; };
    const second = await executeCallbackTransaction(base);
    expect(second.operationalErrors).toEqual(["callback_dispatch_failed"]);
    expect(harness.state.audits).toHaveLength(1);
    expect([...harness.state.receipts.values()][0]).toMatchObject({ auditPending: false, dispatchPending: true });
    expect(dispatchAttempts).toBe(2);
  });
});
