import { beforeEach, describe, expect, it, vi } from "vitest";

import type { A2aRequestV1 } from "@dpf/db/federated-a2a-contract";

import { handleIncomingA2aRequest, type A2aIngressDb, type A2aOperationHandlers } from "./a2a-ingress";
import { signA2aRequest } from "./a2a-request-signing";
import { deriveDeviceId, generateInstanceSigningKeypair } from "./instance-identity";

const sender = generateInstanceSigningKeypair();
const stranger = generateInstanceSigningKeypair();
const SENDER_DID = deriveDeviceId(sender.signingPublicKey);
const SELF_DID = `did_${"b".repeat(64)}`;
const NOW = new Date("2026-11-14T12:00:00.000Z");

function unsigned(overrides: Record<string, unknown> = {}) {
  return {
    specVersion: "dpf.a2a-request/1" as const,
    requestId: "a2r_01JZ0000000000000000000001",
    operation: "task.submitted" as const,
    createdAt: "2026-11-14T11:59:00.000Z",
    notAfter: "2026-11-17T11:59:00.000Z",
    targetInstallationDid: SELF_DID,
    organizationRef: "org-1",
    requesterEnvironmentClass: "production",
    senderTaskId: "TR-sender-1",
    contextId: "ctx-1",
    provenance: { actingAgentGaid: "gaid:priv:dpf.internal:agt-a", delegatingAgentGaid: null },
    payload: { offerId: "offer-1", requestedOutcome: "Check the build." },
    ...overrides,
  };
}

function signed(overrides: Record<string, unknown> = {}, key = sender): A2aRequestV1 {
  return signA2aRequest(unsigned(overrides), key);
}

type Row = { mirrorId: string; localRecordRef: string | null; payload: unknown };

function fakeDb(link: Record<string, unknown> | null = {}) {
  const rows = new Map<string, Row>();
  const db = {
    federationLink: {
      findUnique: vi.fn(async () => link === null ? null : {
        linkId: "link-1",
        role: "same-org-peer",
        linkState: "trusted",
        revokedAt: null,
        quarantinedAt: null,
        peerDeviceId: SENDER_DID,
        peerOrganizationRef: "org-1",
        ...link,
      }),
    },
    federatedRecordMirror: {
      findUnique: vi.fn(async ({ where }: { where: { federationLinkId_recordType_peerRecordRef: { peerRecordRef: string } } }) =>
        rows.get(where.federationLinkId_recordType_peerRecordRef.peerRecordRef) ?? null),
      create: vi.fn(async ({ data }: { data: Row & { peerRecordRef: string } }) => {
        rows.set(data.peerRecordRef, data);
        return data;
      }),
    },
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(db)),
  };
  return { db: db as unknown as A2aIngressDb & typeof db, rows };
}

function handlers(): A2aOperationHandlers & { submitted: ReturnType<typeof vi.fn>; readState: ReturnType<typeof vi.fn> } {
  const submitted = vi.fn(async () => ({ started: true as const, receiverTaskId: "CE-RECEIVER-1", state: "submitted" }));
  const readState = vi.fn(async () => "working");
  return { "task.submitted": { start: submitted, readState }, submitted, readState };
}

const context = { selfInstallationDid: SELF_DID, now: NOW, a2aEnabled: true };

describe("handleIncomingA2aRequest (BI-B45BBD8A)", () => {
  let h: ReturnType<typeof handlers>;
  beforeEach(() => { h = handlers(); });

  it("AC-1: a signed request over a trusted same-org link creates one receiver-owned task and returns its id", async () => {
    const { db, rows } = fakeDb();
    const receipt = await handleIncomingA2aRequest(db, { linkId: "link-1", activity: "dpf.a2a.task.submitted.v1", record: signed() }, context, h);

    expect(receipt).toEqual({
      specVersion: "dpf.a2a-receipt/1",
      requestId: "a2r_01JZ0000000000000000000001",
      outcome: "accepted",
      receiverTaskId: "CE-RECEIVER-1",
      state: "submitted",
    });
    expect(h.submitted).toHaveBeenCalledTimes(1);
    expect(h.submitted.mock.calls[0]![1]).toMatchObject({ linkId: "link-1" });
    expect(rows.get("a2r_01JZ0000000000000000000001")).toMatchObject({ localRecordRef: "CE-RECEIVER-1" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("AC-1: a retry with the same requestId returns the same task and creates nothing", async () => {
    const { db } = fakeDb();
    const request = signed();
    await handleIncomingA2aRequest(db, { linkId: "link-1", activity: "dpf.a2a.task.submitted.v1", record: request }, context, h);
    const again = await handleIncomingA2aRequest(db, { linkId: "link-1", activity: "dpf.a2a.task.submitted.v1", record: request }, context, h);

    expect(again).toMatchObject({ outcome: "duplicate", receiverTaskId: "CE-RECEIVER-1", state: "working" });
    expect(h.submitted).toHaveBeenCalledTimes(1);
  });

  it("AC-2: the same requestId with different content is refused without mutation", async () => {
    const { db } = fakeDb();
    await handleIncomingA2aRequest(db, { linkId: "link-1", activity: "dpf.a2a.task.submitted.v1", record: signed() }, context, h);
    const changed = await handleIncomingA2aRequest(db, {
      linkId: "link-1",
      activity: "dpf.a2a.task.submitted.v1",
      record: signed({ payload: { offerId: "offer-2", requestedOutcome: "Something else." } }),
    }, context, h);

    expect(changed).toMatchObject({ outcome: "rejected", reason: "request-id-conflict" });
    expect(h.submitted).toHaveBeenCalledTimes(1);
  });

  const refusals: Array<[string, () => { link?: Record<string, unknown> | null; record?: unknown; activity?: string; ctx?: Partial<typeof context> }, string]> = [
    ["the flag is off", () => ({ ctx: { a2aEnabled: false } }), "disabled"],
    ["the link is unknown", () => ({ link: null }), "link-not-eligible"],
    ["the link is cross-organization", () => ({ link: { role: "service-provider" } }), "link-not-eligible"],
    ["the link is revoked", () => ({ link: { revokedAt: new Date() } }), "link-not-eligible"],
    ["the link is quarantined", () => ({ link: { quarantinedAt: new Date() } }), "link-not-eligible"],
    ["the link has no attested peer DID", () => ({ link: { peerDeviceId: null } }), "link-not-eligible"],
    ["the request is malformed", () => ({ record: { ...signed(), requestId: "" } }), "malformed"],
    ["the CloudEvent type does not match the operation", () => ({ activity: "dpf.a2a.room.message-proposed.v1" }), "malformed"],
    ["a stranger's key signed it", () => ({ record: signed({}, stranger) }), "bad-signature"],
    ["the payload was altered after signing", () => ({ record: { ...signed(), payload: { offerId: "offer-9" } } }), "bad-signature"],
    ["it names another installation", () => ({ record: signed({ targetInstallationDid: `did_${"c".repeat(64)}` }) }), "not-for-this-installation"],
    ["it names another organization", () => ({ record: signed({ organizationRef: "org-2" }) }), "organization-mismatch"],
    ["notAfter has passed", () => ({ record: signed({ createdAt: "2026-11-10T00:00:00.000Z", notAfter: "2026-11-11T00:00:00.000Z" }) }), "expired"],
    ["its lifetime is longer than the receiver allows", () => ({ record: signed({ notAfter: "2026-12-30T00:00:00.000Z" }) }), "lifetime-too-long"],
  ];

  it.each(refusals)("AC-3: refuses before writing when %s", async (_label, setup, reason) => {
    const s = setup();
    const { db, rows } = fakeDb(s.link === undefined ? {} : s.link);
    const receipt = await handleIncomingA2aRequest(db, {
      linkId: "link-1",
      activity: s.activity ?? "dpf.a2a.task.submitted.v1",
      record: s.record ?? signed(),
    }, { ...context, ...s.ctx }, h);

    expect(receipt).toMatchObject({ outcome: "rejected", reason });
    expect(h.submitted).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it("a handler's refusal is returned as the receipt and records no inbox row", async () => {
    const { db, rows } = fakeDb();
    h.submitted.mockResolvedValueOnce({ started: false, reason: "target-unavailable" });
    const receipt = await handleIncomingA2aRequest(db, { linkId: "link-1", activity: "dpf.a2a.task.submitted.v1", record: signed() }, context, h);

    expect(receipt).toMatchObject({ outcome: "rejected", reason: "target-unavailable" });
    expect(rows.size).toBe(0);
  });
});
