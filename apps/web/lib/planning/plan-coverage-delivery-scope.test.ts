import { describe, expect, it, vi } from "vitest";
import { readPlanDeliveryScope } from "./plan-coverage-delivery-scope";

const item = { id: "row", itemId: "BI-TEST", workType: "feature", effortSize: "small", title: "Repair", body: "## Acceptance\n- Existing callers recover" };
function database(shape: string, paths: string[] = []) {
  return { workroom: { findFirst: vi.fn(async () => ({ scopeClaims: [
    { workShape: `delivery-${shape}@1.0.0`, recordedAt: "2026-09-27T00:00:00Z" },
    ...paths.map(value => ({ kind: "path", intent: "edit", value })),
  ] })) } };
}
describe("plan delivery scope", () => {
  it.each(["break-fix", "small", "medium"])("binds %s to its actual scope", async shape => {
    const scope = await readPlanDeliveryScope(database(shape), item);
    expect(scope?.shape).toBe(shape);
    expect(scope?.digest).toMatch(/^sha256:/);
    expect(scope?.acceptanceCriteria).toEqual(shape === "medium" ? ["Existing callers recover"] : []);
  });
  it.each(["large", "xlarge", "unknown"])("retains baseline enforcement for %s", async shape => {
    expect(await readPlanDeliveryScope(database(shape), item)).toBeNull();
  });
  it("retains baseline enforcement without a bound room", async () => {
    expect(await readPlanDeliveryScope({}, item)).toBeNull();
  });
  it("uses sensitivity and profile ceilings from readiness", async () => {
    expect(await readPlanDeliveryScope(database("small", ["apps/web/lib/auth/access.ts"]), item)).toBeNull();
    expect((await readPlanDeliveryScope(database("small", ["apps/web/lib/auth/access.ts"]), { ...item, workType: "bug" }))?.shape).toBe("medium");
  });
  it("binds changed acceptance, declared paths and classification", async () => {
    const original = await readPlanDeliveryScope(database("medium"), item);
    for (const changed of [{ ...item, body: item.body + "\n- New criterion" }, { ...item, workType: "bug" }]) {
      expect((await readPlanDeliveryScope(database("medium"), changed))?.digest).not.toBe(original?.digest);
    }
    expect((await readPlanDeliveryScope(database("medium", ["apps/web/lib/a.ts"]), item))?.digest).not.toBe(original?.digest);
  });
});

import { checkPlanBacklogCoverage, recordPlanBacklogCoverage, type PlanBacklogCoverageDb } from "./plan-backlog-coverage";
const planArtifactRef = { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo", commitSha: "a".repeat(40), path: "docs/superpowers/plans/example.md", providerBlobId: "b".repeat(40) };
const traceability = { requirementRefs: ["requirement"], contractRefs: ["contract"], flowRefs: ["flow"], verificationRefs: ["AC-TEST-001"] };
const resolvePlan = vi.fn(async () => ({ ok: true as const, artifact: { digest: "sha256:plan", bytes: Buffer.from("requirement contract flow AC-TEST-001"), authorPrincipalId: "p", authorAgentId: "a", authorEmail: "author@example.com" } }));

describe("proportional coverage round trip", () => {
  function fixture() {
    const activityCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => ({ id: "activity-receipt-1" }));
    const db: PlanBacklogCoverageDb = {
      $queryRaw: async <T>(strings: TemplateStringsArray) => (strings.join("").includes('FROM "WorkCapsule"')
        ? [{ id: "workroom-row", createdByPrincipalId: "p" }] : [{ id: "parent-row" }]) as T,
      backlogItem: { findUnique: async () => null, findMany: async () => [] },
      backlogItemActivity: { create: activityCreate, findMany: async () => [] },
    };
    let shape = "break-fix";
    let body = "Repair the duplicate registration";
    db.backlogItem.findUnique = vi.fn(async () => ({
      id: "parent-row", itemId: "BI-PARENT", effortSize: "medium", workType: "bug", body,
    }));
    db.workroom = { findFirst: vi.fn(async () => ({ scopeClaims: [
      { workShape: `delivery-${shape}@1.0.0`, recordedAt: "2026-09-27T00:00:00Z" },
    ] })) };
    db.$transaction = vi.fn(async work => work(db));
    db.backlogItemActivity.findMany = vi.fn(async () => []);
    db.backlogItemActivity.findUnique = vi.fn(async () => ({
      id: "activity-receipt-1", backlogItemId: "parent-row", kind: "plan_backlog_coverage",
      payload: activityCreate.mock.calls[0]?.[0]?.data.payload,
    }));
    const record = () => recordPlanBacklogCoverage({
      itemId: "BI-PARENT", planPath: planArtifactRef.path, planArtifactRef,
      decision: "atomic", rationale: "All migration and verification parts must ship together.",
      deliverables: [{ key: "repair", title: "Repair", independentlyShippable: false, ...traceability }],
      userId: "user-1", db, resolveArtifact: resolvePlan,
    });
    const check = () => checkPlanBacklogCoverage({
      itemId: "BI-PARENT", planPath: planArtifactRef.path, receiptId: "activity-receipt-1", db, resolveArtifact: resolvePlan,
    });
    return { record, check, activityCreate, db, setShape: (value: string) => { shape = value; }, setBody: (value: string) => { body = value; } };
  }
  it("records and revalidates a fix without inventing a spec baseline", async () => {
    const f = fixture();
    expect(await f.record()).toMatchObject({ ok: true });
    expect(f.activityCreate.mock.calls[0]?.[0]?.data.payload).toMatchObject({ schemaVersion: 3, deliveryScope: { shape: "break-fix" } });
    expect(f.activityCreate.mock.calls[0]?.[0]?.data.payload).not.toHaveProperty("scopeBaselineId");
    expect(await f.check()).toMatchObject({ ok: true, valid: true });
    f.setShape("large");
    expect(await f.check()).toMatchObject({ ok: false, code: "receipt-invalid" });
  });
  it("rejects a changed backlog scope", async () => {
    const f = fixture();
    expect(await f.record()).toMatchObject({ ok: true });
    f.setBody("The repair now includes another subsystem");
    expect(await f.check()).toMatchObject({ ok: false, code: "receipt-invalid" });
  });
  it("preserves approved baseline criteria even for proportional work", async () => {
    const f = fixture();
    f.db.backlogItemActivity.findMany = vi.fn(async () => [{ payload: {
      baselineId: "approved", artifactDigest: "sha256:approved", supersedesBaselineId: null,
      objectiveStatements: [{ objectiveId: "requirement" }],
      acceptanceStatements: [{ acceptanceId: "AC-TEST-001" }, { acceptanceId: "AC-APPROVED-002" }],
    } }]);
    expect(await f.record()).toMatchObject({ ok: false, code: "traceability-incomplete" });
    expect(f.activityCreate).not.toHaveBeenCalled();
  });
  it("invalidates proportional coverage when a baseline is subsequently approved", async () => {
    const f = fixture();
    expect(await f.record()).toMatchObject({ ok: true });
    f.db.backlogItemActivity.findMany = vi.fn(async () => [{ payload: {
      baselineId: "approved", artifactDigest: "sha256:approved", supersedesBaselineId: null,
      objectiveStatements: [{ objectiveId: "requirement" }], acceptanceStatements: [{ acceptanceId: "AC-TEST-001" }],
    } }]);
    expect(await f.check()).toMatchObject({ ok: false, code: "receipt-invalid" });
    expect(await f.record()).toMatchObject({ ok: true });
    expect(f.activityCreate.mock.calls[1]?.[0]?.data.payload).toMatchObject({ schemaVersion: 2, scopeBaselineId: "approved" });
  });
  it("does not replace malformed baseline history with proportional coverage", async () => {
    const f = fixture();
    f.db.backlogItemActivity.findMany = vi.fn(async () => [{ payload: { baselineId: "incomplete" } }]);
    expect(await f.record()).toMatchObject({ ok: false, code: "traceability-incomplete" });
  });
  it("rejects unknown receipt versions instead of treating them as legacy", async () => {
    const f = fixture();
    expect(await f.record()).toMatchObject({ ok: true });
    (f.activityCreate.mock.calls[0][0].data.payload as Record<string, unknown>).schemaVersion = 4;
    expect(await f.check()).toMatchObject({ ok: false, code: "receipt-invalid" });
  });
  it("requires medium acceptance criteria and their presence in the plan", async () => {
    const f = fixture(); f.setShape("medium");
    expect(await f.record()).toMatchObject({ ok: false, code: "traceability-incomplete" });
    f.setBody("## Acceptance\n- Criterion absent from the immutable plan");
    expect(await f.record()).toMatchObject({ ok: false, code: "traceability-incomplete" });
    f.setBody("## Acceptance\n- AC-TEST-001");
    expect(await f.record()).toMatchObject({ ok: true });
    expect(await f.check()).toMatchObject({ ok: true });
  });
  it("still rejects changed immutable authorship", async () => {
    const f = fixture();
    f.db.$queryRaw = async <T>() => [{ id: "parent-row", createdByPrincipalId: "someone-else" }] as T;
    expect(await f.record()).toMatchObject({ ok: false, code: "plan-artifact-invalid" });
    expect(f.activityCreate).not.toHaveBeenCalled();
  });
});
