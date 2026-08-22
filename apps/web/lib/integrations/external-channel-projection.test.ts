import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  EXTERNAL_CHANNEL_PROJECTION_STATES,
  EXTERNAL_CHANNEL_PROJECTION_SOURCE_TYPES,
  EXTERNAL_CHANNEL_RESOURCE_KINDS,
  bindExternalChannelProjection,
  canAutomaticallyRetryProjection,
  detachExternalChannelProjection,
  findExternalChannelProjectionByRemote,
  findExternalChannelProjectionBySource,
  fingerprintExternalChannelPayload,
  markExternalChannelProjectionAmbiguous,
  observeExternalChannelProjection,
  reconcileAmbiguousExternalChannelProjection,
  reserveExternalChannelProjection,
  retireExternalChannelProjection,
  sanitizeExternalChannelProjectionMetadata,
} from "./external-channel-projection";

type Row = {
  externalChannelProjectionId: string;
  connectorKey: string;
  connectionId: string;
  credentialId: string | null;
  sourceType: "outbound_draft";
  sourceRef: string;
  sourceVersion: string;
  resourceKind: "post" | "page" | "media";
  locale: string;
  externalRef: string | null;
  externalUrl: string | null;
  localFingerprint: string;
  remoteFingerprint: string | null;
  remoteModifiedAt: Date | null;
  state: "reserved" | "current" | "drifted" | "ambiguous" | "detached";
  metadata: unknown;
  reservedAt: Date;
  projectedAt: Date | null;
  observedAt: Date | null;
  driftedAt: Date | null;
  detachedAt: Date | null;
  lifecycle: "active" | "archived" | "retired" | "superseded" | "merged" | "quarantined";
  lifecycleAt: Date | null;
  lifecycleReason: string | null;
};

const baseRow = (): Row => ({
  externalChannelProjectionId: "ecp-test",
  connectorKey: "wordpress-self-hosted",
  connectionId: "wordpress-site-acme",
  credentialId: "credential-row-1",
  sourceType: "outbound_draft",
  sourceRef: "draft-1",
  sourceVersion: "version-1",
  resourceKind: "post",
  locale: "en-US",
  externalRef: null,
  externalUrl: null,
  localFingerprint: "sha256:local",
  remoteFingerprint: null,
  remoteModifiedAt: null,
  state: "reserved",
  metadata: {},
  reservedAt: new Date("2026-08-22T00:00:00.000Z"),
  projectedAt: null,
  observedAt: null,
  driftedAt: null,
  detachedAt: null,
  lifecycle: "active",
  lifecycleAt: null,
  lifecycleReason: null,
});

function makeDb(initial?: Row | null) {
  let row = initial ?? null;
  const findUnique = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    if (!row) return null;
    if ("externalChannelProjectionId" in where) return where.externalChannelProjectionId === row.externalChannelProjectionId ? row : null;
    return row;
  });
  const create = vi.fn(async ({ data }: { data: Row }) => {
    row = data;
    return row;
  });
  const update = vi.fn(async ({ data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
    if (!row) throw new Error("missing");
    row = { ...row, ...data };
    return row;
  });
  const updateMany = vi.fn(async ({ where, data }: { where: Partial<Row>; data: Partial<Row> }) => {
    if (!row || Object.entries(where).some(([key, value]) => row?.[key as keyof Row] !== value)) return { count: 0 };
    row = { ...row, ...data };
    return { count: 1 };
  });
  return {
    db: { externalChannelProjection: { findUnique, create, update, updateMany } },
    findUnique,
    create,
    update,
    updateMany,
    current: () => row,
  };
}

const reservation = {
  connectorKey: "wordpress-self-hosted",
  connectionId: "wordpress-site-acme",
  credentialId: "credential-row-1",
  sourceType: "outbound_draft" as const,
  sourceId: "draft-1",
  sourceVersion: "version-1",
  resourceKind: "post" as const,
  locale: "en-US",
  localFingerprint: "sha256:local",
  metadata: { authority: "platform" },
};

describe("external-channel projection contract", () => {
  it("keeps source constants in exact parity with the Prisma closed sets", () => {
    const schema = readFileSync(
      fileURLToPath(new URL("../../../../packages/db/prisma/schema/integrations.prisma", import.meta.url)),
      "utf8",
    );
    for (const value of EXTERNAL_CHANNEL_PROJECTION_STATES) expect(schema).toContain(`  ${value}\n`);
    for (const value of EXTERNAL_CHANNEL_PROJECTION_SOURCE_TYPES) expect(schema).toContain(`  ${value}\n`);
    for (const value of EXTERNAL_CHANNEL_RESOURCE_KINDS) expect(schema).toContain(`  ${value}\n`);
  });

  it("fingerprints canonical JSON independent of object key order", () => {
    expect(fingerprintExternalChannelPayload({ title: "A", terms: { b: 2, a: 1 } }))
      .toBe(fingerprintExternalChannelPayload({ terms: { a: 1, b: 2 }, title: "A" }));
  });

  it("accepts bounded scalar metadata and rejects secrets, content payloads, and oversized values", () => {
    expect(sanitizeExternalChannelProjectionMetadata({ authority: "platform", attempt: 2 })).toEqual({ authority: "platform", attempt: 2 });
    expect(() => sanitizeExternalChannelProjectionMetadata({ applicationPassword: "secret" })).toThrow(/prohibited/i);
    expect(() => sanitizeExternalChannelProjectionMetadata({ body: "full post" })).toThrow(/prohibited/i);
    expect(() => sanitizeExternalChannelProjectionMetadata({ note: "x".repeat(300) })).toThrow(/bounded/i);
    expect(() => sanitizeExternalChannelProjectionMetadata({ nested: { raw: true } })).toThrow(/scalar/i);
  });

  it("reserves a deterministic source binding before a remote create", async () => {
    const { db, create } = makeDb();
    const result = await reserveExternalChannelProjection(db as never, reservation);
    expect(result).toMatchObject({ ok: true, data: { mode: "reserved", projection: { state: "reserved", externalRef: null } } });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0].data.externalChannelProjectionId).toMatch(/^ecp-[a-f0-9]{24}$/);
  });

  it("uses stable connection identity so credential rotation cannot fork the binding", async () => {
    const { db, create, update } = makeDb(baseRow());
    const result = await reserveExternalChannelProjection(db as never, { ...reservation, credentialId: "credential-row-2" });
    expect(result).toMatchObject({ ok: true, data: { mode: "existing", projection: { externalChannelProjectionId: "ecp-test", credentialId: "credential-row-2" } } });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { credentialId: "credential-row-2" } }));
  });

  it("reserves a changed source version against the existing remote identity without creating again", async () => {
    const { db, create } = makeDb({ ...baseRow(), state: "current", externalRef: "42", remoteFingerprint: "sha256:local" });
    const result = await reserveExternalChannelProjection(db as never, {
      ...reservation,
      sourceVersion: "version-2",
      localFingerprint: "sha256:next",
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        mode: "existing",
        projection: { state: "reserved", externalRef: "42", sourceVersion: "version-2", localFingerprint: "sha256:next" },
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses to reserve over unresolved drift, detach, or retirement", async () => {
    for (const state of ["drifted", "detached"] as const) {
      const { db } = makeDb({ ...baseRow(), state });
      await expect(reserveExternalChannelProjection(db as never, { ...reservation, sourceVersion: "version-2" }))
        .resolves.toMatchObject({ ok: false, error: "invalid-state" });
    }
    const { db } = makeDb({ ...baseRow(), lifecycle: "retired" });
    await expect(reserveExternalChannelProjection(db as never, { ...reservation, sourceVersion: "version-2" }))
      .resolves.toMatchObject({ ok: false, error: "invalid-state" });
  });

  it("converges a concurrent unique conflict onto the winning reservation", async () => {
    const winner = baseRow();
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const db = { externalChannelProjection: { findUnique, create, update: vi.fn(), updateMany: vi.fn() } };
    await expect(reserveExternalChannelProjection(db as never, reservation))
      .resolves.toMatchObject({ ok: true, data: { mode: "existing", projection: winner } });
  });

  it("binds a known remote identity once and records projection evidence", async () => {
    const { db } = makeDb(baseRow());
    await expect(bindExternalChannelProjection(db as never, {
      projectionId: "ecp-test",
      externalId: "42",
      externalUrl: "https://example.com/?p=42",
      remoteFingerprint: "sha256:local",
      remoteModifiedAt: new Date("2026-08-22T00:01:00.000Z"),
    })).resolves.toMatchObject({ ok: true, data: { projection: { state: "current", externalRef: "42" } } });
  });

  it("looks up the same binding by source identity or known remote identity", async () => {
    const current = { ...baseRow(), state: "current" as const, externalRef: "42" };
    const { db, findUnique } = makeDb(current);
    await expect(findExternalChannelProjectionBySource(db as never, reservation))
      .resolves.toMatchObject({ externalChannelProjectionId: "ecp-test" });
    await expect(findExternalChannelProjectionByRemote(db as never, {
      connectorKey: "wordpress-self-hosted",
      connectionId: "wordpress-site-acme",
      resourceKind: "post",
      externalId: "42",
    })).resolves.toMatchObject({ externalChannelProjectionId: "ecp-test" });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("quarantines an ambiguous create and blocks automatic retry or normal binding", async () => {
    const { db } = makeDb(baseRow());
    const ambiguous = await markExternalChannelProjectionAmbiguous(db as never, "ecp-test", "request-outcome-unknown");
    expect(ambiguous).toMatchObject({ ok: true, data: { projection: { state: "ambiguous" } } });
    expect(canAutomaticallyRetryProjection(ambiguous.ok ? ambiguous.data.projection : baseRow())).toBe(false);
    await expect(bindExternalChannelProjection(db as never, {
      projectionId: "ecp-test",
      externalId: "43",
      externalUrl: null,
      remoteFingerprint: "sha256:local",
      remoteModifiedAt: null,
    })).resolves.toMatchObject({ ok: false, error: "ambiguous-requires-reconciliation" });
  });

  it("reconciles ambiguity only through the compare-and-set reconciliation path", async () => {
    const { db, updateMany } = makeDb({ ...baseRow(), state: "ambiguous" });
    const result = await reconcileAmbiguousExternalChannelProjection(db as never, {
      projectionId: "ecp-test",
      externalId: "43",
      externalUrl: "https://example.com/?p=43",
      remoteFingerprint: "sha256:local",
      remoteModifiedAt: null,
      evidence: { matchedBy: "operator-selection" },
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { externalChannelProjectionId: "ecp-test", state: "ambiguous" } }));
    expect(result).toMatchObject({ ok: true, data: { projection: { state: "current", externalRef: "43" } } });
  });

  it("observes remote drift without overwriting the approved local fingerprint", async () => {
    const { db, current } = makeDb({ ...baseRow(), state: "current", externalRef: "42", remoteFingerprint: "sha256:local" });
    const result = await observeExternalChannelProjection(db as never, {
      projectionId: "ecp-test",
      remoteFingerprint: "sha256:changed",
      remoteModifiedAt: new Date("2026-08-22T00:02:00.000Z"),
    });
    expect(result).toMatchObject({ ok: true, data: { projection: { state: "drifted", remoteFingerprint: "sha256:changed" } } });
    expect(current()?.localFingerprint).toBe("sha256:local");
  });

  it("detaches or retires without deleting the binding evidence", async () => {
    const detachedDb = makeDb({ ...baseRow(), state: "current", externalRef: "42" });
    await expect(detachExternalChannelProjection(detachedDb.db as never, "ecp-test"))
      .resolves.toMatchObject({ ok: true, data: { projection: { state: "detached", externalRef: "42" } } });
    const retiredDb = makeDb({ ...baseRow(), state: "current", externalRef: "42" });
    await expect(retireExternalChannelProjection(retiredDb.db as never, "ecp-test"))
      .resolves.toMatchObject({ ok: true, data: { projection: { state: "current", lifecycle: "retired", externalRef: "42" } } });
  });
});
