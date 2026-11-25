// BI-224F56F1 repair round 1: where a promoter launch runs decides how it runs.
// An install without the private actuator keeps the original `docker run --rm`
// launch for every owner; only the actuator uses the durable owned launch.
import { describe, expect, it, vi } from "vitest";

const durable = vi.hoisted(() => ({ runAdmittedPromoter: vi.fn(async () => ({ exitCode: 0, stdout: "durable", stderr: "" })) }));
vi.mock("./promoter-launch", () => durable);
// The local path's first Docker call fails, so the test never reaches a real daemon.
const local = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock("@/lib/shared/run-process-with-budget", () => ({
  runProcessWithBudget: vi.fn(async (_command: string, args: string[]) => {
    local.calls.push(args);
    return { exitCode: 1, stdout: "", stderr: "fixture: no daemon" };
  }),
}));

import { runPromoterAtDaemon, usesDurablePromoterLaunch, type PromoterParams } from "./promoter";

const owned = { targetSha: "a".repeat(40), backupPath: "/backups/x", healthUrl: "http://localhost:3000/api/health",
  containerName: "dpf-promoter-SUR-1", launchOwner: { kind: "self-upgrade", runId: "SUR-1" } } as unknown as PromoterParams;

describe("usesDurablePromoterLaunch", () => {
  it("is only ever true at the actuator, for an owned, real, non-build launch", () => {
    expect(usesDurablePromoterLaunch(owned, "actuator")).toBe(true);
    expect(usesDurablePromoterLaunch(owned, "local")).toBe(false);
    expect(usesDurablePromoterLaunch({ ...owned, launchOwner: undefined }, "actuator")).toBe(false);
    expect(usesDurablePromoterLaunch({ ...owned, dryRun: true }, "actuator")).toBe(false);
    expect(usesDurablePromoterLaunch({ ...owned, phase: "build" } as PromoterParams, "actuator")).toBe(false);
  });
});

describe("runPromoterAtDaemon launch site", () => {
  it("keeps the original local launch path for an owned launch when no actuator is involved", async () => {
    durable.runAdmittedPromoter.mockClear();
    local.calls.length = 0;
    await runPromoterAtDaemon(owned).catch(() => undefined);
    expect(durable.runAdmittedPromoter).not.toHaveBeenCalled();
    expect(local.calls.length).toBeGreaterThan(0);
    expect(local.calls.flat()).not.toContain("create");
  });

  it("uses the durable owned launch only when the actuator calls it", async () => {
    durable.runAdmittedPromoter.mockClear();
    await expect(runPromoterAtDaemon(owned, undefined, "actuator")).resolves.toMatchObject({ stdout: "durable" });
    expect(durable.runAdmittedPromoter).toHaveBeenCalledTimes(1);
  });
});

describe("actuator wiring", () => {
  it("the private actuator entry launches promoters at the actuator site", async () => {
    const { readFile } = await import("node:fs/promises");
    const entry = await readFile(new URL("../platform-runtime/portal-actuator-entry.ts", import.meta.url), "utf8");
    expect(entry).toMatch(/run: \(params, assertAdmission\) => promoter\.runPromoterAtDaemon\(params, assertAdmission, "actuator"\)/);
  });
});
