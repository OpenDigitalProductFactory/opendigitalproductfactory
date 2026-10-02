/* eslint-disable @typescript-eslint/no-explicit-any -- shares self-upgrade.test.ts's hoisted mocks, like self-upgrade-handoff.test-support.ts */
// BI-F9EE05E5 plan item 0: the candidate image is built while the portal still
// serves, so new work pauses only for the swap. Registered from
// self-upgrade.test.ts, which owns the mocks (module-size ratchet).
import { expect, it } from "vitest";

export function registerPrebuildTests(input: { mocks: any; runSelfUpgrade: (params: any) => Promise<any> }) {
  const { mocks, runSelfUpgrade } = input;

  it("builds the image before the drain starts, with the swap's inputs", async () => {
    const order: string[] = [];
    mocks.runPrebuild.mockImplementationOnce(async () => { order.push("prebuild"); return { exitCode: 0, stdout: "", stderr: "" }; });
    const startQuiescence = mocks.startQuiescence.getMockImplementation();
    mocks.startQuiescence.mockImplementationOnce(async (...args: unknown[]) => { order.push("drain"); return startQuiescence?.(...args); });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ ok: true, status: "succeeded" });
    expect(order.slice(0, 2)).toEqual(["prebuild", "drain"]);
    const prebuild = mocks.runPrebuild.mock.calls[0][0];
    const swap = mocks.runPromoter.mock.calls[0][0];
    expect(prebuild.phase).toBe("build");
    expect(prebuild.targetSha).toBe(swap.targetSha);
    expect(prebuild.containerName).toBe(`${swap.containerName}-prebuild`);
    expect(prebuild.backupPath).toBe(`${swap.backupPath}/prebuild`);
  });

  it("fails the run before the drain when the prebuild fails: nothing is closed or swapped", async () => {
    mocks.runPrebuild.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "next build: out of memory" });
    const result = await runSelfUpgrade({ triggeredBy: "ops" });
    expect(result).toMatchObject({ ok: false, status: "failed", reason: "prebuild-failed" });
    expect(mocks.startQuiescence).not.toHaveBeenCalled();
    expect(mocks.runPromoter).not.toHaveBeenCalled();
    expect(mocks.failRun).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("prebuild-failed"));
  });
}
