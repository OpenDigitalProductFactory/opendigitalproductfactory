import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createReviewPostgresFixture } from "../../test-support/review-postgres-fixture";
import { lockNonprodEnvironment } from "@/lib/nonprod/environment-lease-lock";
import { settleObsoleteLeaseReleaseEnvelopes, type ObsoleteReleaseDb } from "./obsolete-lease-envelope";
import { obsoleteEnvelope, obsoleteTarget } from "./obsolete-lease-envelope.test-fixtures";

const configured = process.env.DATABASE_URL;
const leased = (() => { try { return process.env.DPF_NONPROD_LEASE_ID && configured
  && /^\/dpf_local_ci_\d+$/.test(new URL(configured).pathname) ? configured : undefined; } catch { return undefined; } })();
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL ?? leased;
const schema = `review_obsolete_${randomUUID().replaceAll("-", "")}`;
const tables = ["NonProductionEnvironmentLease", "CoworkerActionEnvelope", "ToolExecution"];
let now = new Date();
let transactionErrors: unknown[] = [];
function barrier() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}
async function reach(signal: Promise<void>, work: Promise<unknown>) {
  await Promise.race([signal, work.then(() => { throw new Error("Operation ended before its race barrier"); })]);
}

describe.skipIf(!url)("obsolete release settlement on isolated leased PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  beforeAll(async () => {
    fixture = await createReviewPostgresFixture({ url: url!, schema, tables });
    await fixture.pool.query(`CREATE TRIGGER "NonProductionEnvironmentLease_admission_history"
      BEFORE INSERT OR UPDATE ON "NonProductionEnvironmentLease"
      FOR EACH ROW EXECUTE FUNCTION public.nonprod_lease_preserve_admission_history()`);
  });
  beforeEach(async () => {
    now = new Date();
    transactionErrors = [];
    await fixture.pool.query(`TRUNCATE "ToolExecution", "CoworkerActionEnvelope", "NonProductionEnvironmentLease"`);
    const { toolExecutions, argsJson, ...envelope } = obsoleteEnvelope();
    await fixture.db.coworkerActionEnvelope.create({ data: { ...envelope, argsJson: argsJson as any,
      status: "approved", threadId: "synthetic-thread", rationale: "Release an unused test reservation",
      expiresAt: new Date(now.getTime() + 60_000) } });
    await fixture.db.toolExecution.create({ data: { ...toolExecutions[0], parameters: toolExecutions[0].parameters as any,
      result: toolExecutions[0].result as any, threadId: "", executionMode: "external-jsonrpc" } });
    const { admissionHistoryVersion, firstAdmittedAt, ...target } = obsoleteTarget();
    const fresh = await fixture.db.$transaction(async tx => {
      const [{ createdAt }] = await tx.$queryRaw<Array<{ createdAt: Date }>>`SELECT CURRENT_TIMESTAMP::timestamp(3) AS "createdAt"`;
      return tx.nonProductionEnvironmentLease.create({ data: { ...target, createdAt, status: "queued", releasedAt: null,
        ownerProvider: "codex", purpose: "synthetic isolated race test", url: "http://fixture.invalid", ports: [], expiresAt: now } });
    });
    expect(fresh, "Fresh fixture must acquire database-owned birth history")
      .toMatchObject({ admissionHistoryVersion: 1, firstAdmittedAt: null });
    now = new Date();
    await fixture.db.nonProductionEnvironmentLease.update({ where: { leaseId: "NPEL-unused" },
      data: { status: "cancelled", releasedAt: now } });
  });
  afterAll(async () => { await fixture?.close(); });
  const port = (transform?: (tx: any) => any): ObsoleteReleaseDb => ({
    coworkerActionEnvelope: fixture.db.coworkerActionEnvelope,
    nonProductionEnvironmentLease: fixture.db.nonProductionEnvironmentLease,
    $transaction: (run: any) => fixture.db.$transaction(tx => run(transform ? transform(tx) : tx), { timeout: 15_000 })
      .catch(error => { transactionErrors.push(error); throw error; }),
  } as unknown as ObsoleteReleaseDb);
  async function audit() {
    return fixture.db.toolExecution.findMany({ orderBy: { id: "asc" } });
  }

  it("cancels the exact obsolete request without authorizing or dispatching a handler", async () => {
    const before = await audit(), original = await fixture.db.coworkerActionEnvelope.findFirstOrThrow();
    const result = await settleObsoleteLeaseReleaseEnvelopes(port(), now);
    expect(transactionErrors).toEqual([]);
    expect(result).toMatchObject({ cancelled: 1, inconclusive: 0 });
    expect(await fixture.db.coworkerActionEnvelope.findFirstOrThrow()).toEqual({ ...original, status: "cancelled", resolvedAt: now });
    expect(await audit()).toEqual(before); // Zero new handler/audit executions.
  });

  it("loses to revival holding the canonical environment lock", async () => {
    const held = barrier(), release = barrier(), entered = barrier();
    const before = await audit();
    const revival = fixture.db.$transaction(async tx => {
      await lockNonprodEnvironment(tx, "local-integration-ci"); held.open();
      await release.promise;
      await tx.nonProductionEnvironmentLease.update({ where: { leaseId: "NPEL-unused" },
        data: { status: "queued", releasedAt: null } });
    }, { timeout: 15_000 });
    await reach(held.promise, revival);
    const settlement = settleObsoleteLeaseReleaseEnvelopes(port(tx => { entered.open(); return tx; }), now);
    try { await reach(entered.promise, settlement); release.open(); await revival;
      expect(await settlement).toMatchObject({ cancelled: 0, skipped: 1, inconclusive: 0 });
      expect((await fixture.db.coworkerActionEnvelope.findFirstOrThrow()).status).toBe("approved");
      expect(await audit()).toEqual(before);
    } finally { release.open(); await Promise.allSettled([revival, settlement]); }
  });

  it("loses to an execution reservation that acquired the envelope row first", async () => {
    const reserved = barrier(), release = barrier(), attempted = barrier();
    const before = await audit();
    const reservation = fixture.db.$transaction(async tx => {
      const result = await tx.coworkerActionEnvelope.updateMany({ where: { id: "approval", status: "approved", resolvedAt: null },
        data: { resolvedAt: now } }); reserved.open(); await release.promise; return result.count;
    }, { timeout: 15_000 });
    await reach(reserved.promise, reservation);
    const settlement = settleObsoleteLeaseReleaseEnvelopes(port(tx => new Proxy(tx, { get(target, key) {
      if (key === "coworkerActionEnvelope") return { updateMany: (args: any) => {
        attempted.open(); return target.coworkerActionEnvelope.updateMany(args);
      } };
      return Reflect.get(target, key);
    } })), now);
    try { await reach(attempted.promise, settlement); release.open(); expect(await reservation).toBe(1);
      expect(await settlement).toMatchObject({ cancelled: 0, skipped: 1, inconclusive: 0 });
      expect(await fixture.db.coworkerActionEnvelope.findFirstOrThrow()).toMatchObject({ status: "approved", resolvedAt: now });
      expect(await audit()).toEqual(before);
    } finally { release.open(); await Promise.allSettled([reservation, settlement]); }
  });

  it("wins the cancellation CAS before a competing execution reservation", async () => {
    const cancelled = barrier(), release = barrier(), attempted = barrier();
    const before = await audit();
    const settlement = settleObsoleteLeaseReleaseEnvelopes(port(tx => new Proxy(tx, { get(target, key) {
      if (key === "coworkerActionEnvelope") return { updateMany: async (args: any) => {
        const result = await target.coworkerActionEnvelope.updateMany(args);
        cancelled.open(); await release.promise; return result;
      } };
      return Reflect.get(target, key);
    } })), now);
    await reach(cancelled.promise, settlement);
    const reservation = fixture.db.$transaction(async tx => {
      attempted.open(); return tx.coworkerActionEnvelope.updateMany({ where: { id: "approval", status: "approved", resolvedAt: null },
        data: { resolvedAt: now } });
    }, { timeout: 15_000 });
    try { await reach(attempted.promise, reservation); release.open();
      expect(await settlement).toMatchObject({ cancelled: 1, inconclusive: 0 });
      expect((await reservation).count).toBe(0);
      expect((await fixture.db.coworkerActionEnvelope.findFirstOrThrow()).status).toBe("cancelled");
      expect(await audit()).toEqual(before);
    } finally { release.open(); await Promise.allSettled([reservation, settlement]); }
  });
});
