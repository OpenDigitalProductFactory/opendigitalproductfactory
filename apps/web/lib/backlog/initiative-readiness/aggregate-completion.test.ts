import { describe, expect, it, vi } from "vitest";
import { resolveAggregateCompletion } from "./aggregate-completion";
import type { InitiativeReadinessActivity } from "./entry-adapter";

const artifact = { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo",
  commitSha: "a".repeat(40), providerBlobId: "b".repeat(40), path: "docs/superpowers/plans/aggregate.md" };
const digest = `sha256:${"c".repeat(64)}`;
const source = { baselineId: "baseline-1", planArtifact: artifact, planArtifactDigest: digest };
const deliverables = ["BI-A", "BI-B"].map((backlogItemId, i) => ({ key: `child-${i}`, title: backlogItemId,
  independentlyShippable: true, backlogItemId, dependsOn: [] as string[] }));
const payload = () => ({ schemaVersion: 2, decision: "decomposed", scopeBaselineId: "baseline-1",
  planArtifactRef: artifact, planArtifactDigest: digest, deliverables });
function activity(value: unknown = payload(), at = 1, id = "coverage-1"): InitiativeReadinessActivity {
  return { id, kind: "plan_backlog_coverage", gateKey: null, recordedAt: new Date(at), payload: value };
}
function fixture(rows = ["BI-A", "BI-B"].map(itemId => ({ itemId, status: "done" }))) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { findMany, run: (activities = [activity()], current = source) => resolveAggregateCompletion({
    itemId: "BI-PARENT", activities, source: current,
    db: { backlogItem: { findMany } },
  }) };
}

describe("xlarge aggregate completion evidence", () => {
  it("uses actual completed children from the current governed decomposition", async () => {
    const f = fixture();
    expect(await f.run()).toMatchObject({ decomposition: "pass", delivery: "pass", evidenceRefs: ["coverage-1"] });
    expect(f.findMany).toHaveBeenCalledWith({ where: { itemId: { in: ["BI-A", "BI-B"] } },
      select: { itemId: true, status: true } });
  });
  it.each(["open", "in-progress", "awaiting-acceptance", "retired"])("does not count a %s child as done", async status => {
    const result = await fixture([{ itemId: "BI-A", status: "done" }, { itemId: "BI-B", status }]).run();
    expect(result).toMatchObject({ decomposition: "pass", delivery: "missing" });
    expect(result.deliveryReasons.join(" ")).toContain(`BI-B (${status})`);
  });
  it("does not fall back to older valid coverage when the latest is atomic", async () => {
    const f = fixture();
    expect(await f.run([activity(), activity({ ...payload(), decision: "atomic" }, 2, "newer")]))
      .toMatchObject({ decomposition: "malformed", delivery: "missing", evidenceRefs: ["newer"] });
    expect(f.findMany).not.toHaveBeenCalled();
  });
  it.each([
    { ...payload(), scopeBaselineId: "old-baseline" },
    { ...payload(), planArtifactDigest: `sha256:${"d".repeat(64)}` },
    { ...payload(), planArtifactRef: { ...artifact, commitSha: "e".repeat(40) } },
  ])("rejects stale baseline or immutable artifact bindings", async value => {
    const f = fixture();
    expect(await f.run([activity(value)])).toMatchObject({ decomposition: "stale", delivery: "missing" });
    expect(f.findMany).not.toHaveBeenCalled();
  });
  it.each([
    { graph: [{ ...deliverables[0], backlogItemId: "BI-PARENT" }, deliverables[1]] },
    { graph: [{ ...deliverables[0] }, { ...deliverables[1], backlogItemId: "BI-A" }] },
    { graph: [{ ...deliverables[0], dependsOn: ["child-1"] }, { ...deliverables[1], dependsOn: ["child-0"] }] },
    { graph: [{ ...deliverables[0], dependsOn: ["unknown"] }, deliverables[1]] },
    { graph: [{ ...deliverables[0], independentlyShippable: "yes" }, deliverables[1]] },
  ])("rejects self, duplicate, cyclic and malformed deliverable graphs", async ({ graph }) => {
    expect(await fixture().run([activity({ ...payload(), deliverables: graph })]))
      .toMatchObject({ decomposition: "malformed", delivery: "missing" });
  });
  it("requires every mapped child record to exist", async () => {
    expect((await fixture([{ itemId: "BI-A", status: "done" }]).run()).delivery).toBe("missing");
  });
  it("also requires a sequencing child with an explicit BI mapping to be done", async () => {
    const graph = [...deliverables, { key: "sequence", title: "Existing child", independentlyShippable: false, backlogItemId: "BI-C" }];
    const f = fixture([...deliverables.map(row => ({ itemId: row.backlogItemId, status: "done" })), { itemId: "BI-C", status: "open" }]);
    expect(await f.run([activity({ ...payload(), deliverables: graph })])).toMatchObject({ decomposition: "pass", delivery: "missing" });
  });
  it("counts existing mapped children without demanding a different shipping classification", async () => {
    const graph = [deliverables[0], { ...deliverables[1], independentlyShippable: false }];
    expect(await fixture().run([activity({ ...payload(), deliverables: graph })]))
      .toMatchObject({ decomposition: "pass", delivery: "pass" });
  });
  it("does not turn a failed child read into delivery", async () => {
    const f = fixture(); f.findMany.mockRejectedValue(new Error("unavailable"));
    expect(await f.run()).toMatchObject({ decomposition: "missing", delivery: "missing" });
  });
  it("requires coverage even when a parent has merged", async () => {
    const f = fixture();
    expect(await f.run([])).toMatchObject({ decomposition: "missing", delivery: "missing" });
    expect(f.findMany).not.toHaveBeenCalled();
  });
});
