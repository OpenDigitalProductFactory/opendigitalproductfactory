// BI-224F56F1 repair round 1: where a promoter launch runs decides how it runs.
// An install without the private actuator keeps the original `docker run --rm`
// launch for every owner; only the actuator uses the durable owned launch.
import { describe, expect, it, vi } from "vitest";

const durable = vi.hoisted(() => ({ runAdmittedPromoter: vi.fn(async () => ({ exitCode: 0, stdout: "durable", stderr: "" })) }));
vi.mock("./promoter-launch", () => durable);
// Artifact resolution is faked to a pinned local image; everything after it is
// the real local launch path.
const pinned = `sha256:${"c".repeat(64)}`;
vi.mock("./promoter-artifact", async importOriginal => ({
  ...await importOriginal<typeof import("./promoter-artifact")>(),
  buildCompatiblePromoterCommand: async <T,>(params: T, build: (p: T) => { command: string; args: string[] }) =>
    build({ ...params, promoterImage: pinned }),
}));
// The container-state probe finds nothing in the way.
vi.mock("node:child_process", async importOriginal => {
  const { EventEmitter } = await import("node:events");
  return { ...await importOriginal<typeof import("node:child_process")>(), spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    setImmediate(() => child.emit("close", 1));
    return child;
  }) };
});
const local = vi.hoisted(() => ({ calls: [] as Array<{ command: string; args: string[] }> }));
vi.mock("@/lib/shared/run-process-with-budget", () => ({
  runProcessWithBudget: vi.fn(async (command: string, args: string[]) => {
    local.calls.push({ command, args });
    return { exitCode: 0, stdout: "promoted", stderr: "" };
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
  it("keeps the original `docker run --rm` launch for an owned launch when no actuator is involved", async () => {
    durable.runAdmittedPromoter.mockClear();
    local.calls.length = 0;
    await expect(runPromoterAtDaemon(owned)).resolves.toMatchObject({ exitCode: 0, stdout: "promoted" });
    expect(durable.runAdmittedPromoter).not.toHaveBeenCalled();
    const launch = local.calls.at(-1)!;
    expect(launch.command).toBe("docker");
    expect(launch.args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(launch.args).toEqual(expect.arrayContaining(["--name", "dpf-promoter-SUR-1", pinned]));
    expect(local.calls.flatMap(call => call.args)).not.toContain("create");
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
