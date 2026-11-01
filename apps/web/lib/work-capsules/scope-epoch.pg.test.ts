/** Real PostgreSQL lifecycle/admission races in an isolated disposable schema.
 * Runtime qualification is an explicit known-compatible fixture; these cases
 * do not attest Docker, deployed bytes, authority or a production cohort. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseClient } from "@dpf/db";
import type { ScopeClaim } from "@/lib/work-capsules";
import type { CapsuleDb } from "./work-capsule-store-types";
import { isRecord } from "@/lib/shared/coerce";
const qualification = vi.hoisted(() => ({ before: async () => {}, afterAdmission: async () => {} }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("./activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));
vi.mock("./change-impact-contract", () => ({ planCapsuleChangeImpact: async () => ({ contract: {} }) }));
vi.mock("./scope-epoch-enrollment.server", async original => {
  const actual = await original<typeof import("./scope-epoch-enrollment.server")>();
  return { ...actual, assertScopeEpochEnrollmentReady: async () => {
    await qualification.before();
    return { assertCurrent: async (tx: CapsuleDb) => {
      await actual.lockScopeEpochEnrollmentAdmission(tx); await qualification.afterAdmission();
    } };
  } };
});
import { claimWorkCapsuleScope } from "./scope-claim-store";
import { releaseWorkCapsuleScope } from "./scope-release-store";
import { parseOriginalScopeReleaseTargets } from "./scope-release-targets";
import { workroomBoundaryWriteWhere } from "@/lib/work-management/workroom-boundary-write.server";

const slotUrl = process.env.DATABASE_URL?.trim() ?? "";
const slot = (() => { try { return /^\/dpf_local_ci_[01]$/.test(new URL(slotUrl).pathname) ? slotUrl : ""; } catch { return ""; } })();
const DATABASE_URL = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() || slot;
const SCHEMA = `dpf_scope_epoch_${randomUUID().replaceAll("-", "")}`;
const NOW = new Date("2026-11-01T12:00:00Z"), EXPIRY = new Date("2026-11-02T12:00:00Z");
const actor = { userId: "owner-user", agentId: "assistant", principalId: "owner" };
const incoming = { kind: "path" as const, value: "a.ts", intent: "edit" as const };
type Raw = Pick<ReturnType<typeof createDatabaseClient>, "$queryRaw" | "$executeRaw">;
type Row = { id: string; capsuleId: string; status: string; archivedAt: Date | null; scopeClaims: unknown;
  updatedAt: Date; leaseHolderPrincipalId: string | null; leaseExpiresAt: Date | null };
function latch() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const rec = (value: unknown) => isRecord(value) ? value : {};

/** Small model adapter over the actual Prisma transaction/raw transport. */
function models(tx: Raw): CapsuleDb {
  return {
    $queryRaw: tx.$queryRaw.bind(tx),
    workroom: {
      findUnique: async (args: unknown) => {
        const where = rec(rec(args).where);
        return (await tx.$queryRaw<Row[]>`SELECT * FROM "WorkCapsule" WHERE "id" = ${where.id ?? null} OR "capsuleId" = ${where.capsuleId ?? null}`)[0] ?? null;
      },
      findMany: async () => [],
      create: async () => { throw new Error("No fixture room creation through the model"); },
      findFirst: async () => null,
      update: async (args: unknown) => {
        const input = rec(args), raw = rec(input.where), where = { ...rec(raw.AND), ...raw }, data = rec(input.data);
        const hasScope = Object.hasOwn(where, "scopeClaims"), expectedScope = rec(where.scopeClaims).equals;
        const hasTime = where.updatedAt instanceof Date, hasHolder = Object.hasOwn(where, "leaseHolderPrincipalId"), hasExpiry = Object.hasOwn(where, "leaseExpiresAt");
        const result = await tx.$queryRaw<Row[]>`UPDATE "WorkCapsule"
          SET "scopeClaims" = CASE WHEN ${Object.hasOwn(data, "scopeClaims")} THEN ${JSON.stringify(data.scopeClaims ?? null)}::jsonb ELSE "scopeClaims" END,
              "updatedAt" = clock_timestamp()
          WHERE ("id" = ${where.id ?? null} OR "capsuleId" = ${where.capsuleId ?? null})
            AND (NOT ${hasScope} OR "scopeClaims" = ${JSON.stringify(expectedScope ?? null)}::jsonb)
            AND (NOT ${hasTime} OR "updatedAt" = ${(where.updatedAt as Date | undefined) ?? NOW})
            AND (NOT ${hasHolder} OR "leaseHolderPrincipalId" IS NOT DISTINCT FROM ${where.leaseHolderPrincipalId ?? null})
            AND (NOT ${hasExpiry} OR "leaseExpiresAt" IS NOT DISTINCT FROM ${(where.leaseExpiresAt as Date | undefined) ?? null})
          RETURNING *`;
        if (!result[0]) throw Object.assign(new Error("scope snapshot changed"), { code: "P2025" });
        return result[0];
      },
    },
    workroomActivity: { create: async (args: unknown) => {
      const data = rec(rec(args).data), id = randomUUID();
      await tx.$executeRaw`INSERT INTO "WorkCapsuleActivity" (id, "workCapsuleId", kind, payload)
        VALUES (${id}, ${data.workCapsuleId}, ${data.kind}, ${JSON.stringify(data.payload)}::jsonb)`;
      return { id };
    } },
    runtimeCapabilityTransition: { findFirst: async (args: unknown) => {
      expect(rec(args).where).toHaveProperty("OR");
      return (await tx.$queryRaw`SELECT id FROM "RuntimeCapabilityTransition" WHERE status IN ('pending','applying','host_applied','compensating')
        OR (status = 'rollback_failed' AND failure->>'recoveryRequired' = 'true') LIMIT 1` as Array<{ id: string }>)[0] ?? null;
    } },
    // Scope admission reads through this real transaction client below.
    ...({ selfUpgradeRun: { findFirst: async (args: unknown) => {
      expect(rec(args).where).toHaveProperty("status");
      return (await tx.$queryRaw`SELECT id FROM "SelfUpgradeRun" WHERE status IN ('pending','queued','running') LIMIT 1` as Array<{ id: string }>)[0] ?? null;
    } }, $executeRaw: tx.$executeRaw.bind(tx) } as object),
  };
}

describe.skipIf(!DATABASE_URL)("scope epochs with real PostgreSQL locks", () => {
  let pool: Pool, prisma: ReturnType<typeof createDatabaseClient>;
  const db = (): CapsuleDb => ({ ...models(prisma), $transaction: fn => prisma.$transaction(tx => fn(models(tx)), { timeout: 15_000, maxWait: 10_000 }) });
  const claim = (claims: Array<Pick<ScopeClaim, "kind" | "value" | "intent">> = [incoming], principal = "owner") => claimWorkCapsuleScope({ db: db(), capsuleId: "WC-EPOCH-PG", claims,
    actor: { ...actor, principalId: principal }, now: NOW });
  const read = async () => (await prisma.$queryRaw<Row[]>`SELECT * FROM "WorkCapsule" WHERE id = 'original-row'`)[0]!;
  const targets = (row: Row) => {
    const value = parseOriginalScopeReleaseTargets(row.scopeClaims);
    if (!value) throw new Error("Expected committed complete targets");
    return value;
  };
  const release = (claims: NonNullable<ReturnType<typeof parseOriginalScopeReleaseTargets>>) => releaseWorkCapsuleScope({ db: db(),
    capsuleId: "WC-EPOCH-PG", expectedRoomId: "original-row", claims, actor, ownScopeOnly: true, now: NOW });
  const activityCount = async () => Number((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "WorkCapsuleActivity"`)[0]!.count);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 6, options: `-c search_path=${SCHEMA}` });
    await pool.query(`CREATE SCHEMA "${SCHEMA}"`);
    const url = new URL(DATABASE_URL); url.searchParams.set("options", `-c search_path=${SCHEMA}`);
    prisma = createDatabaseClient(url.toString());
    await pool.query(`CREATE TABLE "WorkCapsule" (id TEXT PRIMARY KEY, "capsuleId" TEXT UNIQUE NOT NULL, status TEXT NOT NULL,
      "archivedAt" TIMESTAMPTZ(3), "scopeClaims" JSONB NOT NULL, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
      "leaseHolderPrincipalId" TEXT, "leaseExpiresAt" TIMESTAMPTZ(3));
      CREATE TABLE "WorkCapsuleActivity" (id TEXT PRIMARY KEY, "workCapsuleId" TEXT REFERENCES "WorkCapsule"(id), kind TEXT, payload JSONB);
      CREATE TABLE "SelfUpgradeRun" (id TEXT PRIMARY KEY, status TEXT);
      CREATE TABLE "RuntimeCapabilityTransition" (id TEXT PRIMARY KEY, status TEXT, failure JSONB);`);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    if (pool) { try { await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`); } finally { await pool.end(); } }
  });
  beforeEach(async () => {
    qualification.before = async () => {}; qualification.afterAdmission = async () => {};
    await pool.query(`TRUNCATE "WorkCapsuleActivity", "WorkCapsule", "SelfUpgradeRun", "RuntimeCapabilityTransition";`);
    await pool.query(`INSERT INTO "WorkCapsule" (id,"capsuleId",status,"scopeClaims","updatedAt","leaseHolderPrincipalId","leaseExpiresAt") VALUES ($1,$2,'working',$3,$4,'owner',$5)`,
      ["original-row", "WC-EPOCH-PG", JSON.stringify([{ ...incoming, recordedAt: NOW.toISOString(), recordedByPrincipalId: "owner" }]), NOW, EXPIRY]);
  });

  it("publishes only the winning epoch under concurrent legacy enrollment", async () => {
    const ready = latch(); let entrants = 0;
    qualification.before = async () => { if (++entrants === 2) ready.resolve(); await ready.promise; };
    const outcomes = await Promise.allSettled([claim(), claim()]);
    expect(outcomes.filter(value => value.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(value => value.status === "rejected")).toHaveLength(1);
    const winner = outcomes.find(value => value.status === "fulfilled")!;
    expect(winner.status === "fulfilled" ? targets(winner.value)[0]!.releaseEpoch : null).toBe(targets(await read())[0]!.releaseEpoch);
    expect(await activityCount()).toBe(1);
  });

  it("never releases a reacquired epoch through the old request", async () => {
    const original = targets(await claim()); await release(original);
    const reacquired = targets(await claim());
    expect(reacquired[0]!.releaseEpoch).not.toBe(original[0]!.releaseEpoch);
    const count = await activityCount();
    await expect(release(original)).rejects.toThrow("Original scope-release target");
    expect(targets(await read())).toEqual(reacquired); expect(await activityCount()).toBe(count);
  });

  it("does not publish a pre-release acquisition snapshot after a concurrent release commits", async () => {
    const original = targets(await claim()), admitted = latch(), proceed = latch();
    qualification.afterAdmission = async () => { admitted.resolve(); await proceed.promise; };
    const acquisition = claim([{ ...incoming, intent: "read" }]); await admitted.promise;
    await release(original); proceed.resolve();
    await expect(acquisition).rejects.toThrow("scope or lease changed");
    expect((await read()).scopeClaims).toEqual([]); expect(await activityCount()).toBe(2);
    qualification.afterAdmission = async () => {};
    expect(targets(await claim())[0]!.releaseEpoch).not.toBe(original[0]!.releaseEpoch);
  });

  it("rechecks an old release after a concurrent replacement commits under the room lock", async () => {
    const original = targets(await claim()), written = latch(), commit = latch();
    const replacement = prisma.$transaction(async tx => {
      const scoped = models(tx);
      const result = await claimWorkCapsuleScope({ db: { ...scoped, $transaction: fn => fn(scoped) }, capsuleId: "WC-EPOCH-PG",
        claims: [{ ...incoming, intent: "read" }], actor, now: NOW });
      written.resolve(); await commit.promise; return result;
    }, { timeout: 15_000 });
    await written.promise;
    const oldRelease = release(original);
    // Let the separate transport enter its transaction while the writer owns the row.
    await pool.query("SELECT 1"); commit.resolve();
    const current = targets(await replacement);
    await expect(oldRelease).rejects.toThrow("Original scope-release target");
    expect(targets(await read())).toEqual(current); expect(await activityCount()).toBe(2);
  });

  it("rotates owner and intent changes rather than preserving an ABA target", async () => {
    const original = targets(await claim());
    await prisma.$executeRaw`UPDATE "WorkCapsule" SET "leaseHolderPrincipalId" = 'new-owner', "updatedAt" = clock_timestamp() WHERE id = 'original-row'`;
    const changed = targets(await claim([{ ...incoming, intent: "read" }], "new-owner"));
    expect(changed[0]!.releaseEpoch).not.toBe(original[0]!.releaseEpoch);
    const count = await activityCount();
    await expect(release(original)).rejects.toThrow("Original scope-release target");
    expect(await activityCount()).toBe(count); expect(targets(await read())).toEqual(changed);
  });

  it("refuses a whole batch when one original target has changed", async () => {
    const second = { ...incoming, value: "b.ts" }, original = targets(await claim([incoming, second]));
    await claim([{ ...incoming, intent: "read" }]);
    const before = await read(), count = await activityCount();
    await expect(release(original)).rejects.toThrow("Original scope-release target");
    expect((await read()).scopeClaims).toEqual(before.scopeClaims); expect(await activityCount()).toBe(count);
  });

  it("a full-array posture snapshot cannot restore a replaced epoch", async () => {
    await claim(); const before = await read(); await release(targets(before)); const current = await claim();
    await expect(models(prisma).workroom.update({ where: workroomBoundaryWriteWhere(before),
      data: { scopeClaims: [...before.scopeClaims as unknown[], { workroomShape: "change-consequential" }] } })).rejects.toThrow("snapshot changed");
    expect(targets(await read())).toEqual(targets(current));
  });

  for (const carrier of ["upgrade", "runtime"] as const) {
    it(`refuses enrollment when ${carrier} admission wins the lock`, async () => {
      const locked = latch(), commit = latch();
      const admission = prisma.$transaction(async tx => {
        if (carrier === "upgrade") {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('self-upgrade-admission'))`;
          await tx.$executeRaw`INSERT INTO "SelfUpgradeRun" (id,status) VALUES ('admitted','pending')`;
        } else {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('runtime-capability-transition'))`;
          await tx.$executeRaw`INSERT INTO "RuntimeCapabilityTransition" (id,status) VALUES ('admitted','pending')`;
        }
        locked.resolve(); await commit.promise;
      }, { timeout: 15_000 });
      await locked.promise;
      const effect = claim(); commit.resolve(); await admission;
      await expect(effect).rejects.toThrow("canonical-transition-active");
      expect(await activityCount()).toBe(0);
      expect((await read()).scopeClaims).not.toEqual(expect.arrayContaining([expect.objectContaining({ releaseEpoch: expect.any(String) })]));
    });

    it(`commits enrollment before a later ${carrier} admission can pass the same lock`, async () => {
      const qualified = latch(), commit = latch();
      qualification.afterAdmission = async () => { qualified.resolve(); await commit.promise; };
      const acquisition = claim(); await qualified.promise;
      const admission = prisma.$transaction(async tx => {
        if (carrier === "upgrade") await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('self-upgrade-admission'))`;
        else await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('runtime-capability-transition'))`;
        const row = (await tx.$queryRaw<Row[]>`SELECT * FROM "WorkCapsule" WHERE id = 'original-row'`)[0]!;
        return targets(row);
      }, { timeout: 15_000 });
      commit.resolve(); const committed = targets(await acquisition);
      expect(await admission).toEqual(committed);
    });
  }
});
