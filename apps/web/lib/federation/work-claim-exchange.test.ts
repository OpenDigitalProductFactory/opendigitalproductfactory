import { describe, expect, it, vi } from "vitest";

import { validateDemandResponseV1, workClaimEnvelopeId, type DemandResponseV1 } from "@dpf/db/federated-demand-contract";

vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition: vi.fn().mockResolvedValue(undefined) }));

import {
  FEDERATED_CLAIM_LEASE_MS,
  applyWorkClaimDecision,
  handleIncomingWorkClaimRequest,
  reconcileFederatedWorkClaims,
  requestWorkClaim,
  type ClaimForPeer,
  type WorkClaimHomeDb,
  type WorkClaimRequesterDb,
} from "./work-claim-exchange";

const now = new Date("2026-11-12T00:00:00.000Z"); // clock-bomb-guard: allow injected clock; the code reads no wall clock
const HOME = "inst_00000000000000000000000000000001";
const DEV = "inst_00000000000000000000000000000002";
const OTHER = "inst_00000000000000000000000000000003";
const identity = { installationId: DEV, projectionSecret: "secret" };
const trustedLink = { linkId: "link_1", role: "same-org-peer", linkState: "trusted", revokedAt: null, quarantinedAt: null, peerInstallationId: DEV };

function claimRequest(overrides: Partial<NonNullable<DemandResponseV1["workClaim"]>> = {}): DemandResponseV1 {
  const workClaim = {
    itemId: "BI-HOME", action: "claim" as const, requesterInstallationId: DEV, requesterWorkroomId: "WC-DEV",
    repositoryFullName: "org/repo", headBranch: "feat/x", ...overrides,
  };
  return {
    specVersion: "dpf.demand-response/1", responseId: "rsp_1", envelopeId: workClaimEnvelopeId(workClaim.itemId),
    originInstallationId: HOME, originRecordRef: workClaim.itemId, responseKind: "help-offer",
    responderAttribution: "organization", workClaim, createdAt: now.toISOString(), payloadDigest: "sha256:x",
  };
}

function homeDb(options: { link?: unknown; item?: unknown; held?: unknown } = {}) {
  const update = vi.fn().mockResolvedValue({});
  const activity = vi.fn().mockResolvedValue({});
  const db: WorkClaimHomeDb = {
    federationLink: {
      findUnique: vi.fn().mockResolvedValue(options.link === undefined ? trustedLink : options.link),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    backlogItem: { findFirst: vi.fn().mockResolvedValue(options.item === undefined ? { id: "row-home", itemId: "BI-HOME", body: "owned here" } : options.item) },
    workroom: { findFirst: vi.fn().mockResolvedValue(options.held ?? null), update },
    workroomActivity: { create: activity },
  };
  return { db, update, activity };
}

describe("handleIncomingWorkClaimRequest — the home decides (AC-PAC-06, AC-PAC-07)", () => {
  it("grants a free item by recording a Workroom whose executor is the requesting installation", async () => {
    const { db, update } = homeDb();
    const claimForPeer: ClaimForPeer = vi.fn().mockResolvedValue({ claimed: true, capsuleId: "WC-HOME-PROXY" });
    const decision = await handleIncomingWorkClaimRequest(db, "link_1", claimRequest(), { selfInstallationId: HOME, claimForPeer, now });
    const leaseExpiresAt = new Date(now.getTime() + FEDERATED_CLAIM_LEASE_MS);
    expect(decision).toEqual({ decision: "granted", homeWorkroomId: "WC-HOME-PROXY", leaseExpiresAt: leaseExpiresAt.toISOString() });
    expect(claimForPeer).toHaveBeenCalledWith({
      itemId: "BI-HOME", repositoryFullName: "org/repo", headBranch: "feat/x",
      worktreePath: `federation://${DEV}/WC-DEV`, executorRef: `federation:${DEV}:WC-DEV`, linkId: "link_1",
    });
    expect(update).toHaveBeenCalledWith({
      where: { capsuleId: "WC-HOME-PROXY" },
      data: { leaseExpiresAt, lastSyncedAt: now, workspaceState: { federatedPeerClaim: { linkId: "link_1", lastRequestAt: now.toISOString() } } },
    });
  });

  it("refuses a second installation while the first holds the item, naming the holder", async () => {
    const { db } = homeDb({ link: { ...trustedLink, linkId: "link_2", peerInstallationId: OTHER } });
    const claimForPeer: ClaimForPeer = vi.fn().mockResolvedValue({
      claimed: false,
      holders: [{ capsuleId: "WC-HOME-PROXY", executorKind: "federated-peer", executorRef: `federation:${DEV}:WC-DEV`, leaseExpiresAt: now }],
    });
    const decision = await handleIncomingWorkClaimRequest(db, "link_2", claimRequest({ requesterInstallationId: OTHER, requesterWorkroomId: "WC-OTHER" }), {
      selfInstallationId: HOME, claimForPeer, now,
    });
    expect(decision).toMatchObject({
      decision: "refused", reason: "held-elsewhere",
      holder: { installationId: DEV, workroomId: "WC-DEV", leaseExpiresAt: now.toISOString() },
    });
  });

  it("names this installation when its own Workroom holds the item", async () => {
    const { db } = homeDb();
    const claimForPeer: ClaimForPeer = vi.fn().mockResolvedValue({
      claimed: false, holders: [{ capsuleId: "WC-LOCAL", executorKind: "claude-desktop", executorRef: "session", leaseExpiresAt: null }],
    });
    const decision = await handleIncomingWorkClaimRequest(db, "link_1", claimRequest(), { selfInstallationId: HOME, claimForPeer, now });
    expect(decision).toMatchObject({ decision: "refused", holder: { installationId: HOME, workroomId: "WC-LOCAL" } });
    if (decision.decision === "refused") expect(decision.message).toContain("this installation");
  });

  it("renews the requester's own claim without deciding it again", async () => {
    const held = { id: "r1", capsuleId: "WC-HOME-PROXY", backlogItemId: "BI-HOME", status: "ready", executorKind: "federated-peer", executorRef: `federation:${DEV}:WC-DEV`, repositoryFullName: "org/repo", headBranch: "feat/x", leaseExpiresAt: now };
    const { db, update } = homeDb({ held });
    const claimForPeer = vi.fn();
    const decision = await handleIncomingWorkClaimRequest(db, "link_1", claimRequest({ action: "renew" }), { selfInstallationId: HOME, claimForPeer, now });
    expect(decision).toMatchObject({ decision: "renewed", homeWorkroomId: "WC-HOME-PROXY" });
    expect(claimForPeer).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { capsuleId: "WC-HOME-PROXY" } }));
  });

  it("decides a renewal afresh once the requester's claim is gone, so a takeover holds", async () => {
    const { db } = homeDb({ held: null });
    const claimForPeer: ClaimForPeer = vi.fn().mockResolvedValue({
      claimed: false, holders: [{ capsuleId: "WC-NEW", executorKind: "claude-desktop", executorRef: "s", leaseExpiresAt: null }],
    });
    const decision = await handleIncomingWorkClaimRequest(db, "link_1", claimRequest({ action: "renew" }), { selfInstallationId: HOME, claimForPeer, now });
    expect(decision).toMatchObject({ decision: "refused", holder: { workroomId: "WC-NEW" } });
  });

  it("closes the claim on release", async () => {
    const held = { id: "r1", capsuleId: "WC-HOME-PROXY", backlogItemId: "BI-HOME", status: "ready", executorKind: "federated-peer", executorRef: `federation:${DEV}:WC-DEV`, repositoryFullName: "org/repo", headBranch: "feat/x", leaseExpiresAt: now };
    const { db, update, activity } = homeDb({ held });
    const decision = await handleIncomingWorkClaimRequest(db, "link_1", claimRequest({ action: "release", releaseReason: "abandoned" }), {
      selfInstallationId: HOME, claimForPeer: vi.fn(), now,
    });
    expect(decision).toEqual({ decision: "released" });
    expect(update).toHaveBeenCalledWith({
      where: { capsuleId: "WC-HOME-PROXY" },
      data: {
        status: "abandoned", leaseExpiresAt: now, lastSyncedAt: now,
        workspaceState: { federatedPeerClaim: { linkId: "link_1", lastRequestAt: now.toISOString() } },
      },
    });
    expect(activity).toHaveBeenCalled();
  });

  it("refuses an item that is itself a mirror here, and any link that is not a trusted same-organization peer", async () => {
    const mirror = homeDb({ item: { id: "r", itemId: "BI-HOME", body: `x\n[origin:federatedWork:${OTHER}:BI-HOME]` } });
    expect(await handleIncomingWorkClaimRequest(mirror.db, "link_1", claimRequest(), { selfInstallationId: HOME, claimForPeer: vi.fn(), now }))
      .toMatchObject({ decision: "refused", reason: "not-home" });
    for (const link of [null, { ...trustedLink, role: "service-provider" }, { ...trustedLink, linkState: "pending" }, { ...trustedLink, revokedAt: now }]) {
      const { db } = homeDb({ link });
      expect(await handleIncomingWorkClaimRequest(db, "link_1", claimRequest(), { selfInstallationId: HOME, claimForPeer: vi.fn(), now }))
        .toMatchObject({ decision: "refused", reason: "link-not-eligible" });
    }
  });
});

function requesterDb(options: { room?: Record<string, unknown>; body?: string | null; mirror?: unknown; existing?: unknown } = {}) {
  const room = {
    id: "room-1", capsuleId: "WC-DEV", backlogItemId: "BI-HOME", repositoryFullName: "org/repo", headBranch: "feat/x",
    status: "ready", workspaceState: { deliveryAgreement: { schemaVersion: 1 } }, ...options.room,
  };
  const create = vi.fn().mockResolvedValue({});
  const mirrorUpdate = vi.fn().mockResolvedValue({});
  const roomUpdate = vi.fn().mockResolvedValue({});
  const activity = vi.fn().mockResolvedValue({});
  const db = {
    workQueue: { upsert: vi.fn().mockResolvedValue({ id: "q" }) },
    workItem: { upsert: vi.fn().mockResolvedValue({ itemId: "job" }), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    workroom: { findUnique: vi.fn().mockResolvedValue(room), findMany: vi.fn().mockResolvedValue([room]), update: roomUpdate },
    workroomActivity: { create: activity },
    backlogItem: { findFirst: vi.fn().mockResolvedValue({
      id: "row", itemId: "BI-HOME", body: options.body === undefined ? `x\n[origin:federatedWork:${HOME}:BI-HOME]` : options.body,
    }) },
    federatedRecordMirror: {
      findFirst: vi.fn().mockResolvedValue(options.mirror === undefined ? { federationLinkId: "link_1" } : options.mirror),
      findMany: vi.fn().mockResolvedValue([{ localRecordRef: "BI-HOME" }]),
      findUnique: vi.fn().mockResolvedValue(options.existing ?? null),
      create, update: mirrorUpdate,
    },
  } as unknown as WorkClaimRequesterDb;
  return { db, create, mirrorUpdate, roomUpdate, activity, room };
}


describe("handleIncomingWorkClaimRequest — a request speaks only for its own connection", () => {
  const heldByDev = {
    id: "r1", capsuleId: "WC-HOME-PROXY", backlogItemId: "BI-HOME", status: "ready", executorKind: "federated-peer",
    executorRef: `federation:${DEV}:WC-DEV`, repositoryFullName: "org/repo", headBranch: "feat/x",
    leaseExpiresAt: new Date(now.getTime() + FEDERATED_CLAIM_LEASE_MS),
    workspaceState: { federatedPeerClaim: { linkId: "link_1", lastRequestAt: new Date(now.getTime() - 60_000).toISOString() } },
  };

  it("refuses a peer that names another installation, so it cannot release or renew that installation's claim", async () => {
    const { db, update } = homeDb({ link: { ...trustedLink, linkId: "link_2", peerInstallationId: OTHER }, held: heldByDev });
    for (const action of ["release", "renew", "claim"] as const) {
      const decision = await handleIncomingWorkClaimRequest(db, "link_2", claimRequest({
        action, ...(action === "release" ? { releaseReason: "abandoned" as const } : {}),
      }), { selfInstallationId: HOME, claimForPeer: vi.fn(), now });
      expect(decision).toMatchObject({ decision: "refused", reason: "link-not-eligible" });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("pins the connection to the installation that first asks over it", async () => {
    const { db } = homeDb({ link: { ...trustedLink, peerInstallationId: null } });
    const claimForPeer: ClaimForPeer = vi.fn().mockResolvedValue({ claimed: true, capsuleId: "WC-HOME-PROXY" });
    const decision = await handleIncomingWorkClaimRequest(db, "link_1", claimRequest(), { selfInstallationId: HOME, claimForPeer, now });
    expect(decision).toMatchObject({ decision: "granted" });
    expect(db.federationLink.updateMany).toHaveBeenCalledWith({
      where: { linkId: "link_1", OR: [{ peerInstallationId: null }, { peerInstallationId: DEV }] },
      data: { peerInstallationId: DEV },
    });
  });

  it("refuses when the connection was pinned to another installation in the meantime", async () => {
    const { db } = homeDb({ link: { ...trustedLink, peerInstallationId: null } });
    vi.mocked(db.federationLink.updateMany).mockResolvedValue({ count: 0 });
    const claimForPeer = vi.fn();
    const decision = await handleIncomingWorkClaimRequest(db, "link_1", claimRequest(), { selfInstallationId: HOME, claimForPeer, now });
    expect(decision).toMatchObject({ decision: "refused", reason: "link-not-eligible" });
    expect(claimForPeer).not.toHaveBeenCalled();
  });

  it("ignores a replayed older request, so a stale release cannot undo a newer claim", async () => {
    const { db, update } = homeDb({ held: heldByDev });
    const older = { ...claimRequest({ action: "release", releaseReason: "abandoned" }), createdAt: new Date(now.getTime() - 120_000).toISOString() };
    const decision = await handleIncomingWorkClaimRequest(db, "link_1", older, { selfInstallationId: HOME, claimForPeer: vi.fn(), now });
    expect(decision).toMatchObject({ decision: "refused", reason: "stale-request" });
    expect(update).not.toHaveBeenCalled();
  });

  it("answers the same request delivered twice the same way, so a lost acknowledgement never turns a held claim into a refusal", async () => {
    const appliedAt = now.toISOString();
    const held = { ...heldByDev, workspaceState: { federatedPeerClaim: { linkId: "link_1", lastRequestAt: appliedAt } } };
    for (const action of ["claim", "renew"] as const) {
      const { db, update } = homeDb({ held });
      const claimForPeer = vi.fn();
      const again = { ...claimRequest({ action }), createdAt: appliedAt };
      const decision = await handleIncomingWorkClaimRequest(db, "link_1", again, { selfInstallationId: HOME, claimForPeer, now });
      expect(decision).toMatchObject({ decision: action === "claim" ? "granted" : "renewed", homeWorkroomId: "WC-HOME-PROXY" });
      expect(claimForPeer).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { capsuleId: "WC-HOME-PROXY" } }));
    }
    // A release delivered again finds its claim already closed and answers released.
    const { db } = homeDb({ held: null });
    const release = { ...claimRequest({ action: "release", releaseReason: "finished" }), createdAt: appliedAt };
    expect(await handleIncomingWorkClaimRequest(db, "link_1", release, { selfInstallationId: HOME, claimForPeer: vi.fn(), now }))
      .toEqual({ decision: "released" });
  });

  it("closes a lapsed claim and decides the request afresh, so a takeover is not undone by a late renewal", async () => {
    const lapsed = { ...heldByDev, leaseExpiresAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) };
    const { db, update } = homeDb({ held: lapsed });
    const claimForPeer: ClaimForPeer = vi.fn().mockResolvedValue({
      claimed: false, holders: [{ capsuleId: "WC-TAKEOVER", executorKind: "claude-desktop", executorRef: "s", leaseExpiresAt: null }],
    });
    const decision = await handleIncomingWorkClaimRequest(db, "link_1", claimRequest({ action: "renew" }), { selfInstallationId: HOME, claimForPeer, now });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { capsuleId: "WC-HOME-PROXY" }, data: expect.objectContaining({ status: "abandoned" }),
    }));
    expect(decision).toMatchObject({ decision: "refused", reason: "held-elsewhere", holder: { workroomId: "WC-TAKEOVER" } });
  });

  it("answers any other refusal of the ordinary claim path as a decision, not a delivery failure", async () => {
    const { db } = homeDb();
    const claimForPeer: ClaimForPeer = vi.fn().mockResolvedValue({ claimed: false, refusedReason: "Unknown repository org/repo." });
    const decision = await handleIncomingWorkClaimRequest(db, "link_1", claimRequest(), { selfInstallationId: HOME, claimForPeer, now });
    expect(decision).toMatchObject({ decision: "refused", reason: "not-claimable" });
    if (decision.decision === "refused") expect(decision.message).toContain("Unknown repository org/repo.");
  });
});

describe("requestWorkClaim — the requester asks the home (§5.2, §5.3)", () => {
  it("queues a valid help-offer naming the item, the requester, its Workroom and branch, and marks the Workroom unconfirmed", async () => {
    const { db, create, roomUpdate } = requesterDb();
    const result = await requestWorkClaim(db, { capsuleId: "WC-DEV", action: "claim", identity, now });
    expect(result).toMatchObject({ queued: true });
    const row = create.mock.calls[0]![0].data;
    expect(row).toMatchObject({ federationLinkId: "link_1", recordType: "demand-response", canonicalSide: "local", localRecordRef: "work-claim:WC-DEV", syncStatus: "pending" });
    expect(row.payload.activity).toBe("dpf.demand.help-offered");
    const response = row.payload.envelope as DemandResponseV1;
    expect(validateDemandResponseV1(response)).toEqual([]);
    expect(response).toMatchObject({
      originInstallationId: HOME, originRecordRef: "BI-HOME", envelopeId: "work:BI-HOME",
      workClaim: { itemId: "BI-HOME", action: "claim", requesterInstallationId: DEV, requesterWorkroomId: "WC-DEV", repositoryFullName: "org/repo", headBranch: "feat/x" },
    });
    expect(roomUpdate).toHaveBeenCalledWith({
      where: { capsuleId: "WC-DEV" },
      data: { workspaceState: expect.objectContaining({
        deliveryAgreement: { schemaVersion: 1 },
        federatedClaim: expect.objectContaining({ state: "requested", homeInstallationId: HOME, homeItemId: "BI-HOME", federationLinkId: "link_1" }),
      }) },
    });
  });

  it("replaces an undelivered older request rather than queueing a second", async () => {
    const { db, create, mirrorUpdate } = requesterDb({ existing: { mirrorId: "fwc_old" } });
    await requestWorkClaim(db, { capsuleId: "WC-DEV", action: "renew", identity, now });
    expect(create).not.toHaveBeenCalled();
    expect(mirrorUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { mirrorId: "fwc_old" } }));
  });

  it("asks nothing for an item that lives here, or one no connection carries", async () => {
    expect(await requestWorkClaim(requesterDb({ body: "local item" }).db, { capsuleId: "WC-DEV", action: "claim", identity, now }))
      .toMatchObject({ queued: false });
    expect(await requestWorkClaim(requesterDb({ mirror: null }).db, { capsuleId: "WC-DEV", action: "claim", identity, now }))
      .toMatchObject({ queued: false });
  });
});

describe("applyWorkClaimDecision", () => {
  const requested = { state: "requested", federationLinkId: "link_1", homeInstallationId: HOME, homeItemId: "BI-HOME", lastAction: "claim", requestedAt: now.toISOString(), decidedAt: null, homeWorkroomId: null, leaseExpiresAt: null, holder: null, message: null };

  it("confirms the Workroom when the home grants the claim", async () => {
    const { db, roomUpdate, activity } = requesterDb({ room: { workspaceState: { federatedClaim: requested } } });
    await applyWorkClaimDecision(db, "WC-DEV", { decision: "granted", homeWorkroomId: "WC-HOME", leaseExpiresAt: "2026-11-18T00:00:00.000Z" }, now); // clock-bomb-guard: allow fixture string
    expect(roomUpdate.mock.calls[0]![0].data.workspaceState.federatedClaim).toMatchObject({ state: "granted", homeWorkroomId: "WC-HOME" });
    expect(activity).not.toHaveBeenCalled();
  });

  it("records the refusal and the holder, telling the Workroom to stop before a pull request", async () => {
    const { db, roomUpdate, activity } = requesterDb({ room: { workspaceState: { federatedClaim: requested } } });
    const holder = { installationId: HOME, workroomId: "WC-LOCAL", leaseExpiresAt: null };
    await applyWorkClaimDecision(db, "WC-DEV", { decision: "refused", reason: "held-elsewhere", holder, message: "BI-HOME is already being worked." }, now);
    expect(roomUpdate.mock.calls[0]![0].data.workspaceState.federatedClaim).toMatchObject({ state: "refused", holder });
    expect(activity.mock.calls[0]![0].data).toMatchObject({ workCapsuleId: "room-1", kind: "federated-claim-refused" });
    expect(activity.mock.calls[0]![0].data.summary).toContain("Stop before opening a pull request");
  });
});

describe("reconcileFederatedWorkClaims (§5.2 step 4)", () => {
  const granted = (requestedAt: Date) => ({ state: "granted", federationLinkId: "link_1", homeInstallationId: HOME, homeItemId: "BI-HOME", lastAction: "claim", requestedAt: requestedAt.toISOString(), decidedAt: null, homeWorkroomId: "WC-HOME", leaseExpiresAt: null, holder: null, message: null });

  it("renews a live granted claim once an hour", async () => {
    const stale = requesterDb({ room: { workspaceState: { federatedClaim: granted(new Date(now.getTime() - 2 * 60 * 60 * 1000)) } } });
    expect(await reconcileFederatedWorkClaims(stale.db, { identity, now })).toEqual({ renewed: 1, released: 0 });
    expect((stale.create.mock.calls[0]![0].data.payload.envelope as DemandResponseV1).workClaim?.action).toBe("renew");
    const fresh = requesterDb({ room: { workspaceState: { federatedClaim: granted(new Date(now.getTime() - 60_000)) } } });
    expect(await reconcileFederatedWorkClaims(fresh.db, { identity, now })).toEqual({ renewed: 0, released: 0 });
  });

  it("releases the claim once the Workroom has ended", async () => {
    const ended = requesterDb({ room: { status: "complete", workspaceState: { federatedClaim: granted(now) } } });
    expect(await reconcileFederatedWorkClaims(ended.db, { identity, now })).toEqual({ renewed: 0, released: 1 });
    expect((ended.create.mock.calls[0]![0].data.payload.envelope as DemandResponseV1).workClaim).toMatchObject({ action: "release", releaseReason: "finished" });
  });
});
