import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReviewPostgresFixture } from "../../test-support/review-postgres-fixture";
import { prepareApprovalFixtures, cleanupApprovalFixtures, createApprovalFixtureEnvelope, approvalFixtureScope } from "../../scripts/approval-disclosure-fixtures";

const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `review_approval_fixture_${randomUUID().replaceAll("-", "")}`;
const tables = ["User", "Principal", "AgentThread", "TaskRun", "WorkCapsule", "CoworkerActionEnvelope", "AgentMessage", "AuthorizationDecisionLog"];
describe.skipIf(!url)("approval presentation fixture against migrated PostgreSQL constraints", () => {
  let fixture: Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  const userId = randomUUID(), principalId = randomUUID();
  beforeAll(async () => {
    fixture = await createReviewPostgresFixture({ url: url!, schema, tables });
    // LIKE omits foreign keys. Copy the real migrated definitions, including
    // envelope thread/user constraints absent from the Prisma relation model.
    const constraints = await fixture.pool.query<{ name: string; ddl: string }>(`
      SELECT k.conname AS name, format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
        $1::text, c.relname, k.conname, pg_get_constraintdef(k.oid)) AS ddl
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class target ON target.oid=k.confrelid
      WHERE n.nspname='public' AND k.contype='f'
        AND c.relname=ANY($2::text[]) AND target.relname=ANY($2::text[])
    `, [schema, tables]);
    expect(constraints.rows.map(row => row.name)).toContain("CoworkerActionEnvelope_threadId_fkey");
    for (const row of constraints.rows)
      await fixture.pool.query(row.ddl.replaceAll("REFERENCES public.", `REFERENCES "${schema}".`));
    const foreign = await fixture.pool.query(`SELECT k.conname FROM pg_constraint k
      JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class target ON target.oid=k.confrelid JOIN pg_namespace tn ON tn.oid=target.relnamespace
      WHERE n.nspname=$1 AND k.contype='f' AND tn.nspname<>$1`, [schema]);
    expect(foreign.rows).toEqual([]);
    await fixture.db.user.create({ data: { id: userId, email: `${userId}@example.test`, passwordHash: "disabled-test-fixture", isActive: false } });
    await fixture.db.principal.create({ data: { id: principalId, principalId: `PRN-${principalId}`, kind: "human", displayName: "Isolated approval fixture" } });
  });
  afterAll(async () => { await fixture?.close(); });
  const sample = { key: "report", tool: "record_workroom_evidence", args: {} };
  it("rejects a missing conversation, then admits report, handover and research only with their parents", async () => {
    const scope = approvalFixtureScope("ux-approval-100-1", userId, principalId);
    await expect(createApprovalFixtureEnvelope(fixture.db, scope, sample)).rejects.toThrow();
    await prepareApprovalFixtures(fixture.db, scope);
    try {
      for (const key of ["report", "handover", "research"])
        await createApprovalFixtureEnvelope(fixture.db, scope, { ...sample, key });
      expect(await fixture.db.coworkerActionEnvelope.count()).toBe(3);
      expect(await fixture.db.agentThread.count({ where: { id: scope.threadId } })).toBe(1);
    } finally { await cleanupApprovalFixtures(fixture.db, scope); }
    expect(await fixture.db.coworkerActionEnvelope.count()).toBe(0);
    expect(await fixture.db.agentThread.count()).toBe(0);
    expect(await fixture.db.taskRun.count()).toBe(0);
    expect(await fixture.db.workroom.count()).toBe(0);
  });
  it("cleans only its own run and preserves a second run for the same user", async () => {
    const a = approvalFixtureScope("ux-approval-101-1", userId, principalId);
    const b = approvalFixtureScope("ux-approval-102-1", userId, principalId);
    await prepareApprovalFixtures(fixture.db, a);
    await prepareApprovalFixtures(fixture.db, b);
    try {
      await createApprovalFixtureEnvelope(fixture.db, a, sample);
      await createApprovalFixtureEnvelope(fixture.db, b, sample);
      await cleanupApprovalFixtures(fixture.db, a);
      expect(await fixture.db.agentThread.count({ where: { id: b.threadId } })).toBe(1);
      expect(await fixture.db.coworkerActionEnvelope.count({ where: { threadId: b.threadId } })).toBe(1);
    } finally { await cleanupApprovalFixtures(fixture.db, a); await cleanupApprovalFixtures(fixture.db, b); }
  });
  it("rolls back the Workroom when creating its required conversation fails", async () => {
    const scope = approvalFixtureScope("ux-approval-103-1", "missing-user", principalId);
    await expect(prepareApprovalFixtures(fixture.db, scope)).rejects.toThrow();
    expect(await fixture.db.workroom.count({ where: { capsuleId: scope.roomId } })).toBe(0);
  });
});
