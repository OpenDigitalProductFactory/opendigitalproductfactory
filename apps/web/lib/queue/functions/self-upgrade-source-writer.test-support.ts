/* eslint-disable @typescript-eslint/no-explicit-any -- shares self-upgrade.test.ts's hoisted mocks, like self-upgrade-prebuild.test-support.ts */
// BI-224F56F1 (owner decision DI-250233FBDD9B): in the qualified portal the
// install checkout is read-only, so the upstream refresh and source preparation
// run through the authorized source writer. Registered from self-upgrade.test.ts,
// which owns the mocks (module-size ratchet).
import { afterEach, expect, it } from "vitest";

const SHA = "abc1234deadbeef";

export function registerSourceWriterRoutingTests(input: { mocks: any; runSelfUpgrade: (params: any) => Promise<any> }) {
  const { mocks, runSelfUpgrade } = input;
  afterEach(() => {
    mocks.usesPrivateActuator.mockReset().mockResolvedValue(false);
    mocks.sourceWriterThroughPrivateActuator.mockReset().mockResolvedValue(null);
    mocks.updateRunPlan.mockReset();
  });
  const qualify = (prep: unknown = { ok: true, mode: "upstream", stamp: SHA, upstreamSha: SHA }) => {
    mocks.usesPrivateActuator.mockResolvedValue(true);
    mocks.updateRunPlan.mockImplementation(async (runId: string) => ({ runId }));
    mocks.sourceWriterThroughPrivateActuator.mockImplementation(async (request: { operation: string }) =>
      request.operation === "refresh-upstream-head" ? { ok: true, upstreamSha: SHA } : prep);
  };
  const requests = () => mocks.sourceWriterThroughPrivateActuator.mock.calls.map(([request]: [unknown]) => request);
  const localWrites = () => mocks.defaultGitRunner.mock.calls.filter(([args]: [string[]]) => args.includes("fetch"));

  it("keeps local git preparation when the private actuator is not mounted", async () => {
    await runSelfUpgrade({ triggeredBy: "ops" });
    expect(mocks.prepareUpgradeSource).toHaveBeenCalled();
    expect(localWrites().length).toBeGreaterThan(0);
  });

  it("refreshes upstream and prepares through the source writer for an existing run", async () => {
    qualify();
    await runSelfUpgrade({ triggeredBy: "scheduled", force: true });
    expect(requests()).toEqual([
      { owner: { kind: "upstream-refresh" }, operation: "refresh-upstream-head", input: { remote: "origin", branch: "main" } },
      { owner: { kind: "self-upgrade", runId: "SUR-AAAABBBB" }, operation: "prepare-upgrade-source",
        input: { sourceMode: "upstream", remote: "origin", branch: "main", installBranch: "dpf/install", isolatedWorkspace: false } },
    ]);
    // The run exists before preparation and is then claimed, never duplicated.
    expect(mocks.createRun).toHaveBeenCalledOnce();
    expect(mocks.createRun.mock.invocationCallOrder[0]).toBeLessThan(mocks.sourceWriterThroughPrivateActuator.mock.invocationCallOrder[1]!);
    expect(mocks.updateRunPlan).toHaveBeenCalledWith("SUR-AAAABBBB", expect.anything());
    expect(mocks.prepareUpgradeSource).not.toHaveBeenCalled();
    expect(localWrites()).toHaveLength(0);
  });

  it("prepares a pre-created run without creating another", async () => {
    qualify();
    await runSelfUpgrade({ triggeredBy: "ops", runId: "SUR-QUEUED1", force: true });
    expect(requests()[1]).toMatchObject({ owner: { kind: "self-upgrade", runId: "SUR-QUEUED1" } });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("fails the owned run when the writer refuses, without a local fallback", async () => {
    qualify({ ok: false, reason: "prep-error", message: "The authorized source writer did not confirm the operation." });
    const result = await runSelfUpgrade({ triggeredBy: "ops", force: true });
    expect(result).toMatchObject({ ok: false });
    expect(mocks.createRun).toHaveBeenCalledOnce();
    expect(mocks.updateRunPlan).toHaveBeenCalledWith("SUR-AAAABBBB", expect.anything());
    expect(mocks.prepareUpgradeSource).not.toHaveBeenCalled();
    expect(mocks.runPromoter).not.toHaveBeenCalled();
  });

  it("skips with no target when the writer's refresh yields no upstream head", async () => {
    qualify();
    mocks.sourceWriterThroughPrivateActuator.mockResolvedValueOnce({ ok: false, reason: "no-target" });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ skipped: true, reason: "no-target" });
    expect(localWrites()).toHaveLength(0);
    expect(mocks.prepareUpgradeSource).not.toHaveBeenCalled();
  });
}
