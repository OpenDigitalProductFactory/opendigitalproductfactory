// BI-0012E6CA AC-REASK — "Ask again" re-raises an expired, unanswered request.
import { describe, expect, it, vi } from "vitest";

import {
  fingerprintCoworkerApprovalBinding,
  type CoworkerApprovalBinding,
} from "@/lib/govern/authority/coworker-authority-decision";

import { reraiseEnvelope, type EnvelopeReraiseDb } from "./envelope-reraise";

const NOW = new Date("2026-10-01T09:00:00.000Z");
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

const BINDING: CoworkerApprovalBinding = {
  actingHumanUserId: "user-1",
  actingAgentId: "AGT-EXT-CODEX",
  chainId: null,
  taskRunId: null,
  toolName: "merge_backlog_items",
  subject: { kind: "platform", id: "dpf" },
  routeContext: null,
  inputFingerprint: "input-1",
  sensitivity: "internal",
  decisionVersionFingerprint: "policy-1",
};
const FINGERPRINT = fingerprintCoworkerApprovalBinding(BINDING);

function source(over: Record<string, unknown> = {}) {
  return {
    id: "ENV-OLD",
    coworkerAgentId: "AGT-EXT-CODEX",
    delegatingUserId: "user-1",
    threadId: "thr-1",
    chatMessageId: null,
    manifestActionId: "merge_backlog_items",
    argsJson: { approvalBinding: BINDING },
    rationale: "Merge the duplicate.",
    status: "expired",
    taskRunId: null,
    delegationChainId: null,
    authorityDecisionId: "AUTH-1",
    inputFingerprint: "input-1",
    approvalBindingFingerprint: FINGERPRINT,
    expiresAt: new Date("2026-10-01T04:15:00.000Z"),
    createdAt: new Date("2026-10-01T04:00:00.000Z"),
    resolvedAt: new Date("2026-10-01T08:17:00.000Z"),
    ...over,
  };
}

const PROPOSAL = {
  threadId: "thr-1", agentId: "AGT-EXT-CODEX", userId: "user-1", toolName: "merge_backlog_items",
  parameters: { canonicalItemId: "BI-A", duplicateItemId: "BI-B" },
  result: { error: "approval_required", data: { envelopeId: "ENV-OLD" } },
  routeContext: null, auditClass: null, capabilityId: null, summary: null, apiTokenId: "tok-1",
  taskRunId: null, skillId: null, delegatingUserId: "user-1", chatMessageId: null, delegationChainId: null,
};

function fakeDb(row: ReturnType<typeof source> | null, active: unknown = null) {
  const tx = {
    coworkerActionEnvelope: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "ENV-NEW", ...args.data })),
    },
    toolExecution: { create: vi.fn(async () => ({ id: "exec-new" })) },
  };
  const db = {
    coworkerActionEnvelope: {
      findUnique: vi.fn(async () => row),
      findFirst: vi.fn(async () => active),
    },
    toolExecution: { findFirst: vi.fn(async () => PROPOSAL) },
    $transaction: vi.fn(async (work: (t: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return { db: db as unknown as EnvelopeReraiseDb, raw: db, tx };
}

describe("reraiseEnvelope (AC-REASK)", () => {
  it("mints a fresh proposed request copied from the expired one, linked back, with a fresh durable lifetime", async () => {
    const { db, tx } = fakeDb(source());
    const classify = vi.fn(async () => "irreversible" as const);

    const result = await reraiseEnvelope("ENV-OLD", "user-1", { db, classify, now: NOW });

    expect(result).toMatchObject({ ok: true, data: { id: "ENV-NEW", status: "proposed" } });
    expect(classify).toHaveBeenCalledWith({
      toolName: "merge_backlog_items",
      params: { canonicalItemId: "BI-A", duplicateItemId: "BI-B" },
      userId: "user-1",
    });
    expect(tx.coworkerActionEnvelope.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "proposed",
        delegatingUserId: "user-1",
        coworkerAgentId: "AGT-EXT-CODEX",
        manifestActionId: "merge_backlog_items",
        approvalBindingFingerprint: FINGERPRINT,
        argsJson: { approvalBinding: BINDING, reraisedFrom: "ENV-OLD" },
        expiresAt: new Date(NOW.getTime() + SEVEN_DAYS),
        resolvedAt: null,
      }),
    });
    // The new card shows the proposed content and an approval can find the call.
    expect(tx.toolExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        toolName: "merge_backlog_items",
        parameters: PROPOSAL.parameters,
        result: { error: "approval_required", data: { envelopeId: "ENV-NEW" } },
        success: false,
        executionMode: "proposal",
        envelopeId: null,
      }),
    });
    // An already-expired source is not rewritten.
    expect(tx.coworkerActionEnvelope.updateMany).not.toHaveBeenCalled();
  });

  it("sizes the fresh lifetime by the CURRENT classification: outward stays short", async () => {
    const { db, tx } = fakeDb(source());
    await reraiseEnvelope("ENV-OLD", "user-1", { db, classify: async () => "outward", now: NOW });
    const created = tx.coworkerActionEnvelope.create.mock.calls[0]![0] as { data: { expiresAt: Date } };
    expect(created.data.expiresAt).toEqual(new Date(NOW.getTime() + FIFTEEN_MINUTES));
  });

  it("settles a lapsed proposed source as expired before re-raising it", async () => {
    const { db, tx } = fakeDb(source({ status: "proposed", resolvedAt: null }));
    await reraiseEnvelope("ENV-OLD", "user-1", { db, classify: async () => null, now: NOW });
    expect(tx.coworkerActionEnvelope.updateMany).toHaveBeenCalledWith({
      where: { id: "ENV-OLD", status: "proposed", resolvedAt: null, expiresAt: { lte: NOW } },
      data: { status: "expired", resolvedAt: NOW },
    });
  });

  it("is delegate-only", async () => {
    const { db, tx } = fakeDb(source());
    const result = await reraiseEnvelope("ENV-OLD", "someone-else", { db, classify: async () => null, now: NOW });
    expect(result).toMatchObject({ ok: false, httpStatus: 403 });
    expect(tx.coworkerActionEnvelope.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a live proposal", { status: "proposed", expiresAt: new Date(NOW.getTime() + 60_000), resolvedAt: null }],
    ["a declined request", { status: "declined" }],
    ["an executed request", { status: "executed" }],
    ["an approved request that lapsed before it ran", {
      argsJson: { approvalBinding: BINDING, humanApproval: { userId: "user-1", approvedAt: "2026-10-01T04:05:00.000Z" } },
    }],
    ["a policy authorization that lapsed", { argsJson: { approvalBinding: BINDING, policyAuthority: { maxUses: 1 } } }],
  ])("refuses %s", async (_label, over) => {
    const { db, tx } = fakeDb(source(over));
    const result = await reraiseEnvelope("ENV-OLD", "user-1", { db, classify: async () => null, now: NOW });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(tx.coworkerActionEnvelope.create).not.toHaveBeenCalled();
  });

  it("refuses when the stored binding no longer proves the exact call", async () => {
    const { db, tx } = fakeDb(source({ approvalBindingFingerprint: "tampered" }));
    const result = await reraiseEnvelope("ENV-OLD", "user-1", { db, classify: async () => null, now: NOW });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
    expect(tx.coworkerActionEnvelope.create).not.toHaveBeenCalled();
  });

  it("returns the live request when the same call was already asked again", async () => {
    const live = { ...source({ id: "ENV-LIVE", status: "proposed", resolvedAt: null }) };
    const { db, tx } = fakeDb(source(), live);
    const result = await reraiseEnvelope("ENV-OLD", "user-1", { db, classify: async () => null, now: NOW });
    expect(result).toMatchObject({ ok: true, data: { id: "ENV-LIVE" } });
    expect(tx.coworkerActionEnvelope.create).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown request", async () => {
    const { db } = fakeDb(null);
    await expect(reraiseEnvelope("ENV-NONE", "user-1", { db, classify: async () => null, now: NOW }))
      .resolves.toMatchObject({ ok: false, httpStatus: 404 });
  });
});
