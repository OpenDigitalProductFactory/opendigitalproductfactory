import { beforeEach, describe, expect, it, vi } from "vitest";

const actuator = vi.hoisted(() => ({
  mounted: vi.fn(async () => true),
  sandbox: vi.fn(async () => ({ containerId: "c".repeat(64), name: "dpf-sandbox-1", running: true })),
  restart: vi.fn(async () => ({ service: "sandbox", container: "dpf-sandbox-1" })),
  exec: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
}));
vi.mock("../../../../../scripts/lib/scope-writer-observation.mjs", async (load) => ({
  ...await load<object>(), usesPrivateActuator: actuator.mounted, readActuatorSandbox: actuator.sandbox, restartActuatorService: actuator.restart,
}));
vi.mock("@/lib/workroom-runtime/sandbox-exec", async (load) => ({ ...await load<object>(), execSandbox: actuator.exec }));

import { inspectDockerContainer } from "./sandbox-admin";
import { runSandboxRecoveryCommand } from "./sandbox-recovery";

beforeEach(() => { actuator.restart.mockClear(); actuator.exec.mockClear(); });

describe("sandbox admin and recovery in the qualified portal (BI-224F56F1)", () => {
  it("reports only the sandbox the actuator observed", async () => {
    await expect(inspectDockerContainer("dpf-sandbox-1")).resolves.toMatchObject({ containerId: "c".repeat(64), running: true,
      status: "running", composeProjectName: null, composeWorkingDir: null });
    await expect(inspectDockerContainer("dpf-portal-1")).resolves.toBeNull();
  });

  it("routes exec to the sandbox, start and restart to the actuator restart, and refuses anything else", async () => {
    await expect(runSandboxRecoveryCommand("docker", ["exec", "dpf-sandbox-1", "sh", "-lc", "git status"])).resolves.toBe("ok");
    expect(actuator.exec).toHaveBeenCalledWith(["exec", "dpf-sandbox-1", "sh", "-lc", "git status"], { timeout: 30_000 });
    await runSandboxRecoveryCommand("docker", ["restart", "dpf-sandbox-1"]);
    await runSandboxRecoveryCommand("docker", ["start", "c".repeat(64)]);
    expect(actuator.restart).toHaveBeenCalledTimes(2);
    for (const args of [["restart", "dpf-portal-1"], ["rm", "-f", "dpf-sandbox-1"], ["restart", "dpf-sandbox-1", "--time", "0"]]) {
      await expect(runSandboxRecoveryCommand("docker", args)).rejects.toThrow("sandbox_recovery_target_unproven");
    }
    expect(actuator.restart).toHaveBeenCalledTimes(2);
  });
});
