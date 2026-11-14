/** BI-B14253CD: actual initial-owner CAS and atomic audit on admitted PostgreSQL.
 * This fixture never accepts the worktree's DATABASE_URL or touches public rows.
 * Source-unit coverage is separate; these cases are unrun until a governed lease
 * supplies an explicit canonical CI test URL and the runner executes this file.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@dpf/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createReviewPostgresFixture } from "../../test-support/review-postgres-fixture";
import { confirmPlatformFundingOwner, readPlatformFundingSetup } from "./platform-funding-setup";

const explicit = process.env.DPF_LOCAL_CI_TEST_DATABASE_URL?.trim()
  || process.env.DPF_SQL_TEST_DATABASE_URL?.trim() || process.env.DPF_JOBS_TEST_DATABASE_URL?.trim();
const lease = process.env.DPF_NONPROD_LEASE_ID?.trim();
function admittedUrl(): string | undefined {
  if (!explicit || !lease) return undefined;
  let parsed: URL;
  try { parsed = new URL(explicit); } catch { throw new Error("Funding PostgreSQL qualification requires a valid explicit admitted test URL."); }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || !/^\/dpf_local_ci_[01]$/.test(parsed.pathname)) {
    throw new Error("Funding PostgreSQL qualification refuses a database outside the canonical local-CI slots.");
  }
  return explicit;
}
const url = admittedUrl();
const schema = `review_funding_${randomUUID().replaceAll("-", "")}`;
const tables = ["User", "UserGroup", "PlatformRole", "Principal", "PrincipalAlias", "Organization",
  "DecisionPerspectiveProfile", "DecisionPerspectiveProfileVersion", "PlatformConfig"];
const installationId = `did_${"a".repeat(64)}`;
type Tx = Prisma.TransactionClient;
type Run<T> = (tx: Tx) => Promise<T>;
function barrier() { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; }
async function reach(signal: Promise<void>, work: Promise<unknown>) {
  await Promise.race([signal, work.then(() => { throw new Error("Operation ended before its PostgreSQL barrier."); })]);
}

describe.skipIf(!url)("platform funding ownership on isolated leased PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  beforeAll(async () => { fixture = await createReviewPostgresFixture({ url: url!, schema, tables }); });
  afterAll(async () => { await fixture?.close(); });
  beforeEach(async () => {
    await fixture.pool.query('ALTER TABLE "PlatformConfig" DROP CONSTRAINT IF EXISTS "funding_setup_no_audit"');
    await fixture.pool.query(`TRUNCATE ${tables.map(name => `"${name}"`).join(", ")}`);
    await fixture.db.user.create({ data: { id: "funding-user", email: "funding-owner@example.invalid", passwordHash: "invalid-test-hash", isActive: true, isSuperuser: true } });
    await fixture.db.principal.create({ data: { id: "funding-person", principalId: "PRN-funding-pg", kind: "human", status: "active", displayName: "Synthetic funding owner" } });
    await fixture.db.principalAlias.create({ data: { principalId: "funding-person", aliasType: "user", issuer: "", aliasValue: "funding-user" } });
    await fixture.db.organization.create({ data: { id: "funding-org", orgId: "ORG-funding-pg", name: "Synthetic funding organization", slug: "funding-pg", topAccountablePrincipalId: "funding-person" } });
    await fixture.db.decisionPerspectiveProfile.create({ data: { profileId: "mark-dpf-platform", name: "Synthetic platform policy", kind: "platform", status: "active" } });
    await fixture.db.decisionPerspectiveProfileVersion.create({ data: { versionId: "funding-pg-v1", profileId: "mark-dpf-platform", versionNumber: 1, materialFingerprint: "synthetic-material-v1" } });
    await fixture.db.decisionPerspectiveProfile.update({ where: { profileId: "mark-dpf-platform" }, data: { currentVersionId: "funding-pg-v1" } });
    await fixture.db.platformConfig.create({ data: { key: "federation.identity", value: { deviceId: installationId } } });
  });

  async function params() {
    const result = await readPlatformFundingSetup(fixture.db, { userId: "funding-user" });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.status).toBe("available");
    expect(result.data.organizations).toHaveLength(1);
    return { organizationId: "funding-org", expectedDigest: result.data.organizations[0]!.expectedDigest,
      attestation: true, reason: "Synthetic exact initial ownership confirmation." };
  }
  const profile = () => fixture.db.decisionPerspectiveProfile.findUniqueOrThrow({ where: { profileId: "mark-dpf-platform" } });
  const audits = () => fixture.db.platformConfig.findMany({ where: { key: { startsWith: "platform-funding-setup.v1:audit:" } } });
  function confirm(input: Record<string, unknown>, db: PrismaClient = fixture.db) {
    return confirmPlatformFundingOwner(db, { userId: "funding-user", params: input, context: { governedSource: "rest" } });
  }
  /** The production service still opens the real Serializable transaction; only observation barriers are wrapped. */
  function observed(transform: (tx: Tx) => Tx): PrismaClient {
    return new Proxy(fixture.db, { get(client, key) {
      if (key === "$transaction") return <T>(work: Run<T>, options: { isolationLevel?: Prisma.TransactionIsolationLevel }) =>
        client.$transaction(tx => work(transform(tx)), { ...options, timeout: 10_000 });
      const value = Reflect.get(client, key);
      return typeof value === "function" ? value.bind(client) : value;
    } });
  }

  it("lets only one actual Serializable owner CAS win across competing confirmations", async () => {
    const input = await params();
    const atCas = barrier(), release = barrier(); let arrivals = 0;
    const candidate = observed(tx => new Proxy(tx, { get(client, key) {
      if (key === "decisionPerspectiveProfile") return new Proxy(client.decisionPerspectiveProfile, { get(model, method) {
        if (method === "updateMany") return async (args: Prisma.DecisionPerspectiveProfileUpdateManyArgs) => {
          arrivals += 1; if (arrivals === 2) atCas.open(); await release.promise;
          return model.updateMany(args);
        };
        const value = Reflect.get(model, method); return typeof value === "function" ? value.bind(model) : value;
      } });
      const value = Reflect.get(client, key); return typeof value === "function" ? value.bind(client) : value;
    } }));
    const pending = [confirm(input, candidate), confirm({ ...input, reason: "A competing exact confirmation." }, candidate)];
    try {
      await reach(atCas.promise, Promise.all(pending)); release.open();
      const results = await Promise.all(pending);
      expect(arrivals).toBe(2);
      expect(results.filter(result => result.ok)).toHaveLength(1);
      expect(results.filter(result => !result.ok)).toMatchObject([{ ok: false, error: "funding-setup-stale" }]);
      expect(await profile()).toMatchObject({ ownerPrincipalId: "funding-person", ownerOrganizationId: "funding-org", currentVersionId: "funding-pg-v1" });
      expect(await fixture.db.decisionPerspectiveProfileVersion.findUniqueOrThrow({ where: { versionId: "funding-pg-v1" } })).toMatchObject({ promotedByPrincipalId: null });
      expect(await audits()).toHaveLength(1);
    } finally { release.open(); await Promise.allSettled(pending); }
  });

  it("rolls back an actual owner update when the database refuses its audit insert", async () => {
    const input = await params(); let observedOwnerWrite = false;
    await fixture.pool.query(`ALTER TABLE "PlatformConfig" ADD CONSTRAINT "funding_setup_no_audit" CHECK (key NOT LIKE 'platform-funding-setup.v1:audit:%')`);
    const candidate = observed(tx => new Proxy(tx, { get(client, key) {
      if (key === "decisionPerspectiveProfile") return new Proxy(client.decisionPerspectiveProfile, { get(model, method) {
        if (method === "updateMany") return async (args: Prisma.DecisionPerspectiveProfileUpdateManyArgs) => {
          const changed = await model.updateMany(args); observedOwnerWrite = changed.count === 1; return changed;
        };
        const value = Reflect.get(model, method); return typeof value === "function" ? value.bind(model) : value;
      } });
      const value = Reflect.get(client, key); return typeof value === "function" ? value.bind(client) : value;
    } }));
    await expect(confirm(input, candidate)).rejects.toThrow();
    expect(observedOwnerWrite).toBe(true);
    expect(await profile()).toMatchObject({ ownerPrincipalId: null, ownerOrganizationId: null });
    expect(await audits()).toEqual([]);
    expect(await fixture.db.platformConfig.count()).toBe(1);
  });

  it("rereads actual organization authority inside the transaction after the preview", async () => {
    const input = await params(); const entered = barrier(), release = barrier();
    const candidate = observed(tx => new Proxy(tx, { get(client, key) {
      if (key === "user") return new Proxy(client.user, { get(model, method) {
        if (method === "findUnique") return async (args: Prisma.UserFindUniqueArgs) => {
          entered.open(); await release.promise; return model.findUnique(args);
        };
        const value = Reflect.get(model, method); return typeof value === "function" ? value.bind(model) : value;
      } });
      const value = Reflect.get(client, key); return typeof value === "function" ? value.bind(client) : value;
    } }));
    const pending = confirm(input, candidate);
    try {
      await reach(entered.promise, pending);
      await fixture.db.organization.update({ where: { id: "funding-org" }, data: { topAccountablePrincipalId: null } });
      release.open();
      expect(await pending).toMatchObject({ ok: false, error: "funding-setup-not-authorized" });
      expect(await profile()).toMatchObject({ ownerPrincipalId: null, ownerOrganizationId: null });
      expect(await audits()).toEqual([]);
    } finally { release.open(); await Promise.allSettled([pending]); }
  });

  it("retains an exact repeat without mutation and refuses the copied-installation replay", async () => {
    const input = await params(); const first = await confirm(input);
    expect(first).toMatchObject({ ok: true, data: { status: "confirmed" } });
    expect(await confirm(input)).toMatchObject({ ok: true, data: { status: "already-recorded" } });
    const before = await audits(); expect(before).toHaveLength(1);
    await fixture.db.platformConfig.update({ where: { key: "federation.identity" }, data: { value: { deviceId: `did_${"b".repeat(64)}` } } });
    expect(await confirm(input)).toMatchObject({ ok: false });
    expect(await audits()).toEqual(before);
  });
});
