import { describe, expect, it, vi } from "vitest";

import { validateDeploymentDeclarationV1 } from "@dpf/db/federated-deployment-declaration-contract";

import {
  buildDeploymentDeclaration,
  declaredDeploymentRows,
  DECLARING_LINK_ROLES,
  handleIncomingDeploymentDeclaration,
  queueDeploymentDeclaration,
  RECEIVING_LINK_ROLES,
} from "./deployment-declaration-exchange";

const identity = { installationId: "inst_abc", organizationId: "org_1" } as never;
const now = new Date("2026-10-01T12:00:00Z");
const link = { linkId: "link_1", peerAuthorityUrl: "https://vendor.example", peerTokenEnc: "enc" };

describe("buildDeploymentDeclaration", () => {
  it("builds a valid declared record carrying only the country", () => {
    const { record, violations } = buildDeploymentDeclaration({ identity, state: "declared", countryCode: "DE", now });
    expect(violations).toEqual([]);
    expect(record).toMatchObject({ state: "declared", countryCode: "DE", originInstallationId: "inst_abc" });
    expect(validateDeploymentDeclarationV1(record)).toEqual([]);
  });

  it("builds a withdrawal with no country", () => {
    const { record, violations } = buildDeploymentDeclaration({ identity, state: "withdrawn", countryCode: "DE", now });
    expect(violations).toEqual([]);
    expect(record.countryCode).toBeNull();
  });

  it("refuses a declaration without a valid country", () => {
    expect(buildDeploymentDeclaration({ identity, state: "declared", countryCode: null, now }).violations)
      .toContain("countryCode:invalid");
  });
});

describe("link roles", () => {
  it("declares only upward, toward the organization this install federates under", () => {
    expect([...DECLARING_LINK_ROLES]).toEqual(["managed-by", "channel-downstream"]);
    expect([...RECEIVING_LINK_ROLES]).toEqual(["manages", "channel-upstream"]);
  });
});

function outboxDb(existing: unknown = null) {
  return {
    federatedRecordMirror: {
      findUnique: vi.fn(async () => existing),
      findMany: vi.fn(),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    federationLink: { findMany: vi.fn() },
    federationDeliveryJob: { upsert: vi.fn(async () => ({})) },
  } as never as Parameters<typeof queueDeploymentDeclaration>[0];
}

describe("queueDeploymentDeclaration", () => {
  it("writes a local-canonical outbox row for the link", async () => {
    const db = outboxDb();
    const { record } = buildDeploymentDeclaration({ identity, state: "declared", countryCode: "DE", now });
    const result = await queueDeploymentDeclaration(db, { link, record, now, schedule: vi.fn() });
    expect(result.action).toBe("queued");
    const created = (db.federatedRecordMirror.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(created).toMatchObject({
      federationLinkId: "link_1",
      recordType: "deployment-declaration",
      canonicalSide: "local",
      syncStatus: "pending",
    });
    expect(created.payload.record.countryCode).toBe("DE");
  });

  it("advances the version past an earlier row so a withdrawal always wins", async () => {
    const db = outboxDb({ mirrorId: "m1", version: BigInt(now.getTime() + 5), syncStatus: "synced", payload: {} });
    const { record } = buildDeploymentDeclaration({ identity, state: "withdrawn", countryCode: null, now });
    const result = await queueDeploymentDeclaration(db, { link, record, now, schedule: vi.fn() });
    expect(result.originVersion).toBe(now.getTime() + 6);
    const updated = (db.federatedRecordMirror.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(validateDeploymentDeclarationV1(updated.payload.record)).toEqual([]);
  });
});

function mirrorDb(existing: unknown = null) {
  return {
    federatedRecordMirror: {
      findUnique: vi.fn(async (_args: unknown) => existing as never),
      create: vi.fn(async (_args: unknown) => ({})),
      updateMany: vi.fn(async (_args: unknown) => ({ count: 1 })),
    },
  };
}

describe("handleIncomingDeploymentDeclaration", () => {
  it("rejects an invalid or leaky record", async () => {
    const { record } = buildDeploymentDeclaration({ identity, state: "declared", countryCode: "DE", now });
    const result = await handleIncomingDeploymentDeclaration(mirrorDb(), "link_1", { ...record, latitude: 1 } as never);
    expect(result.action).toBe("rejected");
  });

  it("mirrors a declaration as a peer-canonical record", async () => {
    const db = mirrorDb();
    const { record } = buildDeploymentDeclaration({ identity, state: "declared", countryCode: "DE", now });
    expect((await handleIncomingDeploymentDeclaration(db, "link_1", record)).action).toBe("created");
    expect((db.federatedRecordMirror.create.mock.calls[0]![0] as { data: unknown }).data).toMatchObject({
      recordType: "deployment-declaration",
      canonicalSide: "peer",
      syncStatus: "synced",
    });
  });

  it("marks the mirror withdrawn when the install withdraws", async () => {
    const declared = buildDeploymentDeclaration({ identity, state: "declared", countryCode: "DE", now }).record;
    const db = mirrorDb({ mirrorId: "m1", version: BigInt(declared.originVersion), syncStatus: "synced", payload: { record: declared } });
    const withdrawn = buildDeploymentDeclaration({
      identity, state: "withdrawn", countryCode: null, now: new Date(now.getTime() + 1000),
    }).record;
    expect((await handleIncomingDeploymentDeclaration(db, "link_1", withdrawn)).action).toBe("updated");
    expect((db.federatedRecordMirror.updateMany.mock.calls[0]![0] as { data: unknown }).data).toMatchObject({ syncStatus: "withdrawn" });
  });

  it("ignores an older delivery", async () => {
    const later = buildDeploymentDeclaration({ identity, state: "declared", countryCode: "FR", now: new Date(now.getTime() + 5000) }).record;
    const db = mirrorDb({ mirrorId: "m1", version: BigInt(later.originVersion), syncStatus: "synced", payload: { record: later } });
    const older = buildDeploymentDeclaration({ identity, state: "declared", countryCode: "DE", now }).record;
    expect((await handleIncomingDeploymentDeclaration(db, "link_1", older)).action).toBe("conflict");
    expect(db.federatedRecordMirror.updateMany).not.toHaveBeenCalled();
  });
});

describe("declaredDeploymentRows (AC-DCD-COUNT-1)", () => {
  const declared = (installationId: string, countryCode: string, at: number) =>
    buildDeploymentDeclaration({ identity: { installationId } as never, state: "declared", countryCode, now: new Date(at) }).record;

  it("counts each declaring install once, in its country", () => {
    const rows = declaredDeploymentRows([
      { syncStatus: "synced", payload: { record: declared("inst_a", "DE", 1) } },
      { syncStatus: "synced", payload: { record: declared("inst_a", "DE", 2) } },
      { syncStatus: "synced", payload: { record: declared("inst_b", "BR", 3) } },
    ]);
    expect(rows).toEqual([
      { siteId: "install:inst_a", country: "DE" },
      { siteId: "install:inst_b", country: "BR" },
    ]);
  });

  it("excludes withdrawn mirrors", () => {
    const withdrawn = buildDeploymentDeclaration({
      identity: { installationId: "inst_c" } as never, state: "withdrawn", countryCode: null, now: new Date(4),
    }).record;
    expect(declaredDeploymentRows([
      { syncStatus: "withdrawn", payload: { record: withdrawn } },
      { syncStatus: "withdrawn", payload: { record: declared("inst_d", "FR", 5) } },
    ])).toEqual([]);
  });
});
