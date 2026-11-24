import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./delivery-queue", () => ({ scheduleFederationDeliveryJob: vi.fn(async () => ({ itemId: "JOB-1" })) }));

import { deliverA2aRequestRow, queueA2aRequest, readPeerDelivery, type A2aOutboxDb } from "./a2a-outbox";
import { verifyA2aRequestSignature } from "./a2a-request-signing";
import { scheduleFederationDeliveryJob } from "./delivery-queue";
import { deriveDeviceId, generateInstanceSigningKeypair } from "./instance-identity";

const key = generateInstanceSigningKeypair();
const SELF_DID = deriveDeviceId(key.signingPublicKey);
const PEER_DID = `did_${"b".repeat(64)}`;
const NOW = new Date("2026-11-14T12:00:00.000Z");

function fakeDb() {
  const mirrors = new Map<string, Record<string, unknown>>();
  const taskRuns = new Map<string, { taskRunId: string; a2aMetadata: unknown }>([
    ["TR-sender-1", { taskRunId: "TR-sender-1", a2aMetadata: { fanout: false } }],
  ]);
  const db = {
    federatedRecordMirror: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { mirrors.set(String(data.mirrorId), data); return data; }),
      update: vi.fn(async ({ where, data }: { where: { mirrorId: string }; data: Record<string, unknown> }) => {
        mirrors.set(where.mirrorId, { ...mirrors.get(where.mirrorId), ...data });
      }),
    },
    taskRun: {
      findUnique: vi.fn(async ({ where }: { where: { taskRunId: string } }) => taskRuns.get(where.taskRunId) ?? null),
      update: vi.fn(async ({ where, data }: { where: { taskRunId: string }; data: { a2aMetadata: unknown } }) => {
        taskRuns.set(where.taskRunId, { taskRunId: where.taskRunId, a2aMetadata: data.a2aMetadata });
      }),
    },
  };
  return { db: db as unknown as A2aOutboxDb & typeof db, mirrors, taskRuns };
}

const signing = { installationId: "inst_x", projectionSecret: "secret", deviceId: SELF_DID, signingPublicKey: key.signingPublicKey, signingPrivateKey: key.signingPrivateKey };

async function queued(db: A2aOutboxDb) {
  return queueA2aRequest(db, {
    linkId: "link-1",
    operation: "task.submitted",
    payload: { offerId: "offer-1", requestedOutcome: "Check the build." },
    senderTaskRunId: "TR-sender-1",
    contextId: "ctx-1",
    provenance: { actingAgentGaid: "gaid:priv:dpf.internal:agt-a", delegatingAgentGaid: null },
    targetInstallationDid: PEER_DID,
    organizationRef: "org-1",
    requesterEnvironmentClass: "production",
    signing,
    now: NOW,
  });
}

describe("A2A outbox, sender side (BI-B45BBD8A)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queues one signed request on the shared outbox and marks the sender's TaskRun submitted-undelivered", async () => {
    const { db, mirrors, taskRuns } = fakeDb();
    const { requestId, mirrorId } = await queued(db);

    const row = mirrors.get(mirrorId)!;
    expect(row).toMatchObject({ recordType: "a2a-request", canonicalSide: "local", localRecordRef: requestId, syncStatus: "pending", federationLinkId: "link-1" });
    const request = (row.payload as { request: Parameters<typeof verifyA2aRequestSignature>[0] }).request;
    expect(verifyA2aRequestSignature(request, SELF_DID)).toBe(true);
    expect(request).toMatchObject({ senderTaskId: "TR-sender-1", targetInstallationDid: PEER_DID, notAfter: "2026-11-17T12:00:00.000Z" });
    expect(scheduleFederationDeliveryJob).toHaveBeenCalledWith(db, mirrorId, NOW);

    const peer = readPeerDelivery(taskRuns.get("TR-sender-1")!.a2aMetadata, NOW);
    expect(peer).toMatchObject({ federationLinkId: "link-1", requestId, deliveryState: "submitted-undelivered", remoteTaskId: null });
    expect((taskRuns.get("TR-sender-1")!.a2aMetadata as { fanout: boolean }).fanout).toBe(false);
  });

  it("AC-4: on acknowledgement the sender's TaskRun records the peer link and the receiver's task id", async () => {
    const { db, mirrors, taskRuns } = fakeDb();
    const { requestId, mirrorId } = await queued(db);
    const send = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: { ok: true, specVersion: "dpf.a2a-receipt/1", requestId, outcome: "accepted", receiverTaskId: "CE-A2A-R1", state: "submitted" },
    }));

    const outcome = await deliverA2aRequestRow(db, mirrors.get(mirrorId) as never, { peerAuthorityUrl: "https://peer", linkToken: "t", linkId: "link-1" }, { now: NOW, send });

    expect(outcome).toMatchObject({ kind: "sent", acknowledged: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ linkId: "link-1" }), "dpf.a2a.task.submitted.v1", expect.objectContaining({ requestId }), expect.anything());
    expect(readPeerDelivery(taskRuns.get("TR-sender-1")!.a2aMetadata, NOW)).toMatchObject({
      deliveryState: "acknowledged", remoteTaskId: "CE-A2A-R1", remoteState: "submitted", federationLinkId: "link-1",
    });
  });

  it("a refused request is acknowledged as a decision and recorded, not retried", async () => {
    const { db, mirrors, taskRuns } = fakeDb();
    const { requestId, mirrorId } = await queued(db);
    const send = vi.fn(async () => ({
      ok: true, status: 200,
      body: { ok: false, specVersion: "dpf.a2a-receipt/1", requestId, outcome: "rejected", reason: "target-unavailable" },
    }));

    const outcome = await deliverA2aRequestRow(db, mirrors.get(mirrorId) as never, { peerAuthorityUrl: "https://peer", linkToken: "t", linkId: "link-1" }, { now: NOW, send });

    expect(outcome).toMatchObject({ kind: "sent", acknowledged: true });
    expect(readPeerDelivery(taskRuns.get("TR-sender-1")!.a2aMetadata, NOW)).toMatchObject({ deliveryState: "rejected", rejectionReason: "target-unavailable" });
  });

  it("an unreachable peer is not acknowledged, so the shared outbox holds and retries it", async () => {
    const { db, mirrors, taskRuns } = fakeDb();
    const { mirrorId } = await queued(db);
    const send = vi.fn(async () => ({ ok: false, status: 0, error: "connect ECONNREFUSED" }));

    const outcome = await deliverA2aRequestRow(db, mirrors.get(mirrorId) as never, { peerAuthorityUrl: "https://peer", linkToken: "t", linkId: "link-1" }, { now: NOW, send });

    expect(outcome).toMatchObject({ kind: "sent", acknowledged: false, result: { status: 0 } });
    expect(readPeerDelivery(taskRuns.get("TR-sender-1")!.a2aMetadata, NOW)).toMatchObject({ deliveryState: "submitted-undelivered" });
  });

  it("a receipt for another request is not an acknowledgement", async () => {
    const { db, mirrors } = fakeDb();
    const { mirrorId } = await queued(db);
    const send = vi.fn(async () => ({ ok: true, status: 202, body: { specVersion: "dpf.a2a-receipt/1", requestId: "a2r_other0000", outcome: "accepted", receiverTaskId: "X", state: "submitted" } }));

    expect(await deliverA2aRequestRow(db, mirrors.get(mirrorId) as never, { peerAuthorityUrl: "https://peer", linkToken: "t", linkId: "link-1" }, { now: NOW, send }))
      .toMatchObject({ acknowledged: false });
  });

  it("AC-4: past notAfter with no acknowledgement it stops sending and reads expired-undelivered", async () => {
    const { db, mirrors, taskRuns } = fakeDb();
    const { mirrorId } = await queued(db);
    const later = new Date("2026-11-18T00:00:00.000Z");
    const send = vi.fn();

    const outcome = await deliverA2aRequestRow(db, mirrors.get(mirrorId) as never, { peerAuthorityUrl: "https://peer", linkToken: "t", linkId: "link-1" }, { now: later, send });

    expect(outcome).toEqual({ kind: "expired" });
    expect(send).not.toHaveBeenCalled();
    expect(mirrors.get(mirrorId)).toMatchObject({ syncStatus: "withdrawn" });
    expect(readPeerDelivery(taskRuns.get("TR-sender-1")!.a2aMetadata, later)).toMatchObject({ deliveryState: "expired-undelivered" });
  });

  it("reads an unacknowledged request past notAfter as expired-undelivered even before the sweep runs", async () => {
    const { db, taskRuns } = fakeDb();
    await queued(db);
    expect(readPeerDelivery(taskRuns.get("TR-sender-1")!.a2aMetadata, new Date("2026-11-20T00:00:00.000Z")))
      .toMatchObject({ deliveryState: "expired-undelivered" });
  });
});
