import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { createMemoryFederationStore } from "./durable-state";
import { absorbPeerLedgerIntoDb, syncPeerLedgerFromDb, toLedgerLink, type LedgerLinkRow, type PeerLedgerDb } from "./peer-ledger";

const at = new Date("2026-08-28T19:16:38.019Z");

function dbRow(overrides: Partial<LedgerLinkRow> = {}): LedgerLinkRow {
  return {
    linkId: "link_37ca", role: "same-org-peer", peerAuthorityUrl: "http://192.168.0.152:3000",
    peerInstallationId: `inst_${"f".repeat(32)}`, peerDeviceId: null, peerOrganizationRef: "Operator production",
    localOrganizationId: null, tokenHash: "hash-of-inbound", tokenPrefix: "dpflink_HA5X",
    peerTokenEnc: "enc:peer-token", approvedAtLocal: at, approvedAtPeer: at, approvedByPrincipalId: "PRN-1",
    enrolledAt: at, quarantinedAt: null, quarantineReason: null, revokedAt: null,
    metadata: { proposedProjection: { includeSlices: ["demand"] } },
    principal: { displayName: "Operator production" },
    ...overrides,
  };
}

describe("syncPeerLedgerFromDb", () => {
  it("writes every non-revoked link with the inbound hash and the peer token in clear", async () => {
    const store = createMemoryFederationStore();
    const db = { federationLink: { findMany: vi.fn().mockResolvedValue([dbRow()]), findUnique: vi.fn() }, $transaction: vi.fn() };
    const result = await syncPeerLedgerFromDb(db, { store, decrypt: (v) => v.replace("enc:", ""), now: at });
    expect(result).toEqual({ written: true, links: 1 });
    expect(db.federationLink.findMany.mock.calls[0]![0].where).toEqual({ revokedAt: null });
    expect(store.ledger!.links[0]).toMatchObject({
      linkId: "link_37ca", tokenHash: "hash-of-inbound", peerToken: "peer-token",
      approvedAtLocal: at.toISOString(), displayName: "Operator production",
    });
  });

  it("reports an unwritable directory instead of throwing", async () => {
    const store = createMemoryFederationStore({ available: false });
    const db = { federationLink: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() }, $transaction: vi.fn() };
    expect(await syncPeerLedgerFromDb(db, { store })).toEqual({ written: false, links: 0 });
  });
});

describe("absorbPeerLedgerIntoDb", () => {
  it("recreates a link the database lacks — trusted, with the same hash and a re-encrypted peer token", async () => {
    const store = createMemoryFederationStore({
      ledger: { schemaVersion: 1, writtenAt: at.toISOString(), links: [toLedgerLink(dbRow(), (v) => v.replace("enc:", ""))] },
    });
    const created: Record<string, unknown>[] = [];
    const tx = {
      principal: { create: vi.fn(async (args: { data: { principalId: string } }) => ({ id: `id-${args.data.principalId}` })) },
      principalAlias: { create: vi.fn() },
      federationLink: { create: vi.fn(async (args: { data: Record<string, unknown> }) => { created.push(args.data); return {}; }) },
    };
    const db = {
      federationLink: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const result = await absorbPeerLedgerIntoDb(db as unknown as PeerLedgerDb, { store, encrypt: (v) => `enc2:${v}`, now: at });
    expect(result).toEqual({ absorbed: ["link_37ca"], skipped: 0, failed: [] });
    expect(created[0]).toMatchObject({
      linkId: "link_37ca", linkState: "trusted", tokenHash: "hash-of-inbound", peerTokenEnc: "enc2:peer-token",
      principalId: "id-principal_link_37ca", peerInstallationId: `inst_${"f".repeat(32)}`,
    });
  });

  it("never overwrites a link the database already holds, and survives a missing ledger", async () => {
    const store = createMemoryFederationStore({
      ledger: { schemaVersion: 1, writtenAt: at.toISOString(), links: [toLedgerLink(dbRow(), (v) => v)] },
    });
    const db = {
      federationLink: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ linkId: "link_37ca" }) },
      $transaction: vi.fn(),
    };
    expect(await absorbPeerLedgerIntoDb(db, { store })).toEqual({ absorbed: [], skipped: 1, failed: [] });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(await absorbPeerLedgerIntoDb(db, { store: createMemoryFederationStore() })).toEqual({ absorbed: [], skipped: 0, failed: [] });
  });
});
