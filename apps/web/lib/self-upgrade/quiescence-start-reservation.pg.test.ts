import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { createHandoffDependencyPostgresFixture } from "../../../../packages/db/src/handoff-dependency-postgres-fixture";
import { reserveQuiescenceStart, advanceOwnedQuiescenceLevel, clearOwnedQuiescenceLevel,
  type QuiescenceReservationDb, type QuiescenceReservationTx } from "./quiescence-start-reservation";

// Only an explicit governed SQL test connection or the canonical CI database.
// The ordinary production DATABASE_URL is never a fallback for this contract.
const configured = process.env.DATABASE_URL?.trim() ?? "";
const databaseUrl = process.env.DPF_LOCAL_CI_TEST_DATABASE_URL?.trim() || process.env.DPF_SQL_TEST_DATABASE_URL?.trim() || process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() || (() => {
  try { return /^\/dpf_local_ci_[01]$/.test(new URL(configured).pathname) ? configured : ""; } catch { return ""; }
})();
const database = databaseUrl ? describe : describe.skip;
const schema = `dpf_handoff_dependency_${randomUUID().replaceAll("-", "")}`;
database("quiescence single-flight — isolated PostgreSQL", () => {
  let pool: Pool;
  let prisma: ReturnType<typeof createHandoffDependencyPostgresFixture>["prisma"];
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    for (const table of ["PlatformConfig", "QuiescenceRun"]) {
      await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    prisma = createHandoffDependencyPostgresFixture(databaseUrl, schema).prisma;
  });
  beforeEach(async () => {
    for (const table of ["PlatformConfig", "QuiescenceRun"]) await pool.query(`TRUNCATE TABLE "${schema}"."${table}"`);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); }
  });
  const data = (runId: string) => ({ runId, status: "pending", trigger: "manual", triggerRefId: `inference-runtime:${runId}`,
    targetVersion: "a".repeat(40), targetBundleHash: "b".repeat(64), budgetMs: 300000, initialSnapshot: {}, enteredStateAt: {}, forcedSurfaces: [] });
  const reserve = (runId: string) => reserveQuiescenceStart({ db: prisma as unknown as QuiescenceReservationDb,
    configKey: "portal.quiescence", runData: data(runId), ifBusy: "refuse", now: new Date() });

  it("admits exactly one of two concurrent native starts before either worker owns an execution slot", async () => {
    const results = await Promise.allSettled([reserve("QR-native-one"), reserve("QR-native-two")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.quiescenceRun.count()).toBe(1);
    const current = await prisma.platformConfig.findUniqueOrThrow({ where: { key: "portal.quiescence" } });
    expect(current.value).toMatchObject({ level: "normal" });
    expect((current.value as { runId: string }).runId).toBe((results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<{ runId: string }>).value.runId);
  });
  it("retains the parked owner's drain and refuses another coordinator's advance", async () => {
    await reserve("QR-native-original");
    await prisma.quiescenceRun.update({ where: { runId: "QR-native-original" }, data: { status: "ready-to-swap" } });
    await advanceOwnedQuiescenceLevel({ db: prisma as unknown as QuiescenceReservationDb, configKey: "portal.quiescence",
      level: "draining", runId: "QR-native-original", now: new Date() });
    await expect(reserve("QR-native-foreign")).rejects.toThrow(/owns/);
    await expect(advanceOwnedQuiescenceLevel({ db: prisma as unknown as QuiescenceReservationDb, configKey: "portal.quiescence",
      level: "swapping", runId: "QR-native-foreign", now: new Date() })).rejects.toThrow(/owns/);
    expect((await prisma.platformConfig.findUniqueOrThrow({ where: { key: "portal.quiescence" } })).value)
      .toMatchObject({ level: "draining", runId: "QR-native-original" });
  });
  it("cannot resurrect a stale fence after a concurrent terminal transition and owned clear", async () => {
    await reserve("QR-terminal-race");
    const terminal = await pool.connect();
    let committed = false;
    let reachedValidation!: () => void;
    const validation = new Promise<void>(resolve => { reachedValidation = resolve; });
    const db: QuiescenceReservationDb = { $transaction: body => prisma.$transaction(async tx => body({
      platformConfig: tx.platformConfig, quiescenceRun: tx.quiescenceRun,
      $executeRaw: async (strings, ...values) => {
        if (strings.join("?").includes("FOR UPDATE")) reachedValidation();
        return tx.$executeRaw(strings, ...values);
      },
    } as QuiescenceReservationTx)) };
    try {
      await terminal.query("BEGIN");
      await terminal.query(`UPDATE "${schema}"."QuiescenceRun" SET status='failed' WHERE "runId"=$1`, ["QR-terminal-race"]);
      const advance = advanceOwnedQuiescenceLevel({ db, configKey: "portal.quiescence", level: "draining", runId: "QR-terminal-race", now: new Date() });
      // A stale ordinary SELECT could finish the advance before this terminal
      // transaction commits. The actual row lock must reach validation first.
      const first = await Promise.race([validation.then(() => "validation"), advance.then(() => "advanced", () => "refused")]);
      expect(first).toBe("validation");
      await terminal.query("COMMIT"); committed = true;
      await expect(advance).rejects.toThrow(/owns/);
      await clearOwnedQuiescenceLevel({ db: prisma as unknown as QuiescenceReservationDb,
        configKey: "portal.quiescence", expectedRunId: "QR-terminal-race", now: new Date() });
      expect((await prisma.platformConfig.findUniqueOrThrow({ where: { key: "portal.quiescence" } })).value)
        .toMatchObject({ level: "normal", runId: null });
    } finally { if (!committed) await terminal.query("ROLLBACK"); terminal.release(); }
  });
});
