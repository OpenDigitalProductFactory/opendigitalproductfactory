import { describe, expect, it, vi } from "vitest";

import { computeDemandPayloadDigest, type DemandEnvelopeV1 } from "@dpf/db/federated-demand-contract";

import {
  adoptIncomingDemand,
  handleIncomingDemand,
  setIncomingDemandDisposition,
  type AdoptDemandIngest,
  type DemandExchangeDb,
  type DemandMirrorRow,
} from "./demand-exchange";

const envelope = (overrides: Partial<DemandEnvelopeV1> = {}): DemandEnvelopeV1 => {
  const value: DemandEnvelopeV1 = {
    specVersion: "dpf.demand/1",
    envelopeId: "dem_01",
    originInstallationId: "inst_origin",
    originRecordRef: "ref_01",
    originVersion: 1,
    route: [],
    audience: "internal",
    title: "Shared demand",
    summary: "A minimized demand summary",
    workType: "feature",
    signal: { occurrenceCount: 1 },
    attribution: "organization",
    createdAt: "2026-07-20T05:00:00.000Z",
    updatedAt: "2026-07-20T05:00:00.000Z",
    payloadDigest: "sha256:pending",
    ...overrides,
  };
  if (overrides.payloadDigest === undefined) value.payloadDigest = computeDemandPayloadDigest(value);
  return value;
};

function demandDb(existing: Partial<DemandMirrorRow> | null) {
  const row = existing ? {
    mirrorId: "fdm_existing",
    federationLinkId: "link_1",
    peerRecordRef: "inst_origin:ref_01",
    localRecordRef: null,
    ...existing,
  } as DemandMirrorRow : null;
  const findUnique = vi.fn().mockResolvedValue(row);
  const create = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: existing ? 1 : 0 });
  return {
    db: { federatedRecordMirror: { findUnique, create, updateMany } } as unknown as DemandExchangeDb,
    findUnique,
    create,
    updateMany,
  };
}

describe("handleIncomingDemand", () => {
  it("persists a new envelope as an observed peer-canonical mirror", async () => {
    const { db, create } = demandDb(null);

    const result = await handleIncomingDemand(db, "link_1", "dpf.demand.proposed", envelope(), {
      receivingInstallationId: "inst_receiver",
    });

    expect(result).toMatchObject({ action: "created", originVersion: 1, disposition: "observed" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        federationLinkId: "link_1",
        recordType: "demand-envelope",
        canonicalSide: "peer",
        localRecordRef: null,
        peerRecordRef: "inst_origin:ref_01",
        syncStatus: "synced",
        version: 1,
        payload: expect.objectContaining({ activity: "dpf.demand.proposed", disposition: "observed" }),
      }),
    });
  });

  it("passes a millisecond-epoch originVersion through without truncation (BigInt column — BI-CC8021CE)", async () => {
    // originVersion derives from the source updatedAt epoch in ms (~1.7e12), which
    // exceeds Int (int4, max 2,147,483,647). The mirror.version column is BigInt;
    // create must receive the value unchanged. Before the fix this overflowed with
    // P2020 and NO demand mirror was ever written across a link.
    const msEpochVersion = 1_784_544_648_695;
    expect(msEpochVersion).toBeGreaterThan(2_147_483_647);
    const { db, create } = demandDb(null);

    const result = await handleIncomingDemand(
      db,
      "link_1",
      "dpf.demand.proposed",
      envelope({ originVersion: msEpochVersion }),
    );

    expect(result).toMatchObject({ action: "created", originVersion: msEpochVersion });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: msEpochVersion }) }),
    );
  });

  it("noops an exact retry without writing again", async () => {
    const current = envelope();
    const { db, create, updateMany } = demandDb({
      mirrorId: "fdm_1",
      version: 1n,
      syncStatus: "synced",
      payload: { envelope: current, activity: "dpf.demand.proposed", disposition: "observed" },
    });

    await expect(handleIncomingDemand(db, "link_1", "dpf.demand.proposed", current)).resolves.toMatchObject({
      action: "noop",
      originVersion: 1,
    });
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("advances only to a greater origin version", async () => {
    const current = envelope();
    const { db, updateMany } = demandDb({
      mirrorId: "fdm_1",
      version: 1n,
      syncStatus: "synced",
      payload: { envelope: current, activity: "dpf.demand.proposed", disposition: "observed" },
    });
    const next = envelope({ originVersion: 2, updatedAt: "2026-07-20T05:01:00.000Z" });

    await expect(handleIncomingDemand(db, "link_1", "dpf.demand.updated", next)).resolves.toMatchObject({
      action: "updated",
      originVersion: 2,
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ version: { lt: 2 } }),
      data: expect.objectContaining({ version: 2, syncStatus: "synced" }),
    }));
  });

  it("rejects a stale or same-version payload with a different digest", async () => {
    const current = envelope({ originVersion: 3 });
    const { db, updateMany } = demandDb({
      mirrorId: "fdm_1",
      version: 3n,
      syncStatus: "synced",
      payload: { envelope: current, activity: "dpf.demand.updated", disposition: "followed" },
    });

    await expect(handleIncomingDemand(db, "link_1", "dpf.demand.updated", envelope({
      originVersion: 3,
      title: "Different same-version content",
    }))).resolves.toMatchObject({ action: "conflict", reason: "origin-version-not-advancing" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("records withdrawal as a terminal mirror state", async () => {
    const current = envelope();
    const { db, updateMany } = demandDb({
      mirrorId: "fdm_1",
      version: 1n,
      syncStatus: "synced",
      payload: { envelope: current, activity: "dpf.demand.proposed", disposition: "observed" },
    });

    await expect(handleIncomingDemand(db, "link_1", "dpf.demand.withdrawn", envelope({
      originVersion: 2,
    }))).resolves.toMatchObject({ action: "withdrawn", disposition: "withdrawn" });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ syncStatus: "withdrawn" }),
    }));
  });

  it("rejects an envelope routed back to this installation before persistence", async () => {
    const { db, create } = demandDb(null);
    const routed = envelope({
      route: [{
        installationId: "inst_receiver",
        relationshipKind: "same-organization",
        receivedAt: "2026-07-20T05:00:00.000Z",
        attestationDigest: "sha256:hop",
      }],
    });

    await expect(handleIncomingDemand(db, "link_1", "dpf.demand.proposed", routed, {
      receivingInstallationId: "inst_receiver",
    })).resolves.toEqual({ action: "rejected", violations: ["route:receiver-loop"] });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("received-demand decisions", () => {
  function decisionDb(overrides: Partial<DemandMirrorRow> = {}) {
    const row: DemandMirrorRow = {
      mirrorId: "fdm_1",
      federationLinkId: "link_1",
      peerRecordRef: "inst_origin:ref_01",
      localRecordRef: null,
      version: 1n,
      syncStatus: "synced",
      payload: {
        envelope: envelope(),
        activity: "dpf.demand.proposed",
        disposition: "observed",
        receivedAt: "2026-07-20T05:00:00.000Z",
      },
      ...overrides,
    };
    const update = vi.fn().mockResolvedValue({});
    return {
      db: {
        federatedRecordMirror: {
          findUnique: vi.fn().mockResolvedValue(row),
          create: vi.fn(),
          updateMany: vi.fn(),
          update,
        },
      } as unknown as DemandExchangeDb,
      update,
    };
  }

  it("follows a received envelope without creating a local backlog item", async () => {
    const { db, update } = decisionDb();

    await expect(setIncomingDemandDisposition(db, "fdm_1", "followed")).resolves.toMatchObject({
      disposition: "followed",
    });
    expect(update).toHaveBeenCalledWith({
      where: { mirrorId: "fdm_1" },
      data: { payload: expect.objectContaining({ disposition: "followed" }) },
    });
  });

  it("adopts through the canonical backlog front door and binds immutable origin provenance", async () => {
    const { db, update } = decisionDb();
    const ingest = vi.fn<AdoptDemandIngest>().mockResolvedValue({ id: "backlog-row-1", itemId: "BI-ADOPTED", created: true });

    await expect(adoptIncomingDemand(db, "fdm_1", ingest)).resolves.toEqual({
      action: "adopted",
      itemId: "BI-ADOPTED",
      created: true,
    });
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      title: "Shared demand",
      body: "A minimized demand summary",
      workType: "feature",
      source: "user-request",
      type: "portfolio",
      status: "triaging",
      origin: { kind: "federatedDemand", id: "link_1:inst_origin:ref_01" },
    }));
    expect(update).toHaveBeenCalledWith({
      where: { mirrorId: "fdm_1" },
      data: {
        localRecordRef: "BI-ADOPTED",
        payload: expect.objectContaining({ disposition: "adopted" }),
      },
    });
  });

  it("does not adopt a withdrawn envelope", async () => {
    const { db } = decisionDb({
      syncStatus: "withdrawn",
      payload: {
        envelope: envelope({ originVersion: 2 }),
        activity: "dpf.demand.withdrawn",
        disposition: "withdrawn",
        receivedAt: "2026-07-20T05:02:00.000Z",
      },
    });
    const ingest = vi.fn<AdoptDemandIngest>();

    await expect(adoptIncomingDemand(db, "fdm_1", ingest)).rejects.toThrow(/withdrawn/i);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("returns the existing local item when an envelope was already adopted", async () => {
    const { db } = decisionDb({ localRecordRef: "BI-EXISTING" });
    const ingest = vi.fn<AdoptDemandIngest>();

    await expect(adoptIncomingDemand(db, "fdm_1", ingest)).resolves.toEqual({
      action: "already-adopted",
      itemId: "BI-EXISTING",
      created: false,
    });
    expect(ingest).not.toHaveBeenCalled();
  });
});
