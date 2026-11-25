import { describe, expect, it } from "vitest";

import {
  admitSelfUpgradeLaunch,
  launchPromoterAtActuator,
  readPromoterInstallBinding,
  requestPromoterLaunchThroughActuator,
  type PromoterInstallBinding,
} from "./promoter-actuator";
import type { PromoterParams } from "./promoter";
import type { SelfUpgradeConfig } from "./config";
import { PROMOTER_ALREADY_RUNNING_EXIT_CODE } from "./promoter-exit-codes";

const runId = "SUR-ABC123";
const binding: PromoterInstallBinding = {
  project: "dpf", installPath: "/Users/op/dpf", stateDirHostPath: "/Users/op/.dpf",
  composeFiles: ["docker-compose.yml", "docker-compose.macos.yml"], healthUrl: "http://portal:3000/api/health",
};
const config = { useIsolatedWorkspace: true } as SelfUpgradeConfig;
const params = (): Record<string, unknown> => ({
  hostInstallPath: "/Users/op/dpf/.upgrade-workspace",
  canonicalInstallPath: "/Users/op/dpf",
  targetSha: "a".repeat(40),
  backupPath: `/backups/self-upgrade/${runId}`,
  backupHostPath: "/Users/op/dpf/backups",
  composeEnvFileHostPath: "/Users/op/dpf/.env",
  composeFiles: ["docker-compose.yml", "docker-compose.macos.yml"],
  composeProject: "dpf",
  healthUrl: "http://portal:3000/api/health",
  promoterImage: `sha256:${"b".repeat(64)}`,
  stateDirHostPath: "/Users/op/.dpf",
  installStateMigrationEnvelope: "e".repeat(64),
  installStateMigrationSignature: "c".repeat(64),
  installStateMigrationRunId: runId,
  maintenanceRecoveryPointDigest: "d".repeat(64),
  containerName: `dpf-promoter-${runId}`,
});
const request = (overrides: Record<string, unknown> = {}) => ({
  owner: { kind: "self-upgrade", runId },
  params: { ...params(), ...overrides },
});

describe("readPromoterInstallBinding", () => {
  it("binds only the install's own Compose interpolation", () => {
    expect(readPromoterInstallBinding({
      PROMOTE_COMPOSE_PROJECT: "dpf", DPF_HOST_INSTALL_PATH: "/Users/op/dpf", DPF_STATE_DIR_HOST: "/Users/op/.dpf",
      DPF_SELF_UPGRADE_COMPOSE_FILES: "docker-compose.yml docker-compose.macos.yml",
    })).toEqual({ project: "dpf", installPath: "/Users/op/dpf", stateDirHostPath: "/Users/op/.dpf",
      composeFiles: ["docker-compose.yml", "docker-compose.macos.yml"], backupsHostPath: undefined,
      backupPathOverride: undefined, healthUrl: undefined });
  });

  it("refuses unsafe paths, projects and Compose file names", () => {
    expect(() => readPromoterInstallBinding({ PROMOTE_COMPOSE_PROJECT: "dpf", DPF_HOST_INSTALL_PATH: "/Users/op/../etc" })).toThrow();
    expect(() => readPromoterInstallBinding({ PROMOTE_COMPOSE_PROJECT: "DPF!", DPF_HOST_INSTALL_PATH: "/Users/op/dpf" })).toThrow();
    expect(() => readPromoterInstallBinding({ PROMOTE_COMPOSE_PROJECT: "dpf", DPF_HOST_INSTALL_PATH: "/Users/op/dpf",
      DPF_SELF_UPGRADE_COMPOSE_FILES: "../evil.yml" })).toThrow();
  });
});

describe("admitSelfUpgradeLaunch", () => {
  it("admits a launch whose host-facing fields match the actuator's own derivation", () => {
    const admitted = admitSelfUpgradeLaunch(request(), binding, config);
    expect(admitted.owner).toEqual({ kind: "self-upgrade", runId });
    expect(admitted.params.hostInstallPath).toBe("/Users/op/dpf/.upgrade-workspace");
  });

  it.each([
    ["composeProject", "peer"],
    ["canonicalInstallPath", "/Users/other/dpf"],
    ["hostInstallPath", "/Users/op/dpf"],
    ["backupHostPath", "/tmp/backups"],
    ["composeEnvFileHostPath", "/Users/op/dpf/other.env"],
    ["backupPath", "/backups/elsewhere"],
    ["stateDirHostPath", "/var/lib/other"],
    ["healthUrl", "http://attacker/api/health"],
    ["containerName", "dpf-promoter-SUR-OTHER"],
    ["installStateMigrationRunId", "SUR-OTHER"],
    ["promoterImage", "dpf-promoter:latest"],
    ["targetSha", "main"],
    ["dryRun", true],
    ["composeFiles", ["docker-compose.yml"]],
    ["composeFiles", ["../../etc/passwd"]],
    ["maintenanceRecoveryPointDigest", undefined],
    ["runtimeTransitionAuthorityOperation", "reserve"],
    ["hostIdentity", { platform: "linux", arch: "arm64", provenance: "caller" }],
  ])("refuses a mismatched or unexpected %s", (key, value) => {
    expect(() => admitSelfUpgradeLaunch(request({ [key]: value }), binding, config)).toThrow("promoter_actuator_admission_refused");
  });

  it("admits the honest stamp of a local working tree", () => {
    expect(() => admitSelfUpgradeLaunch(request({ targetSha: `${"a".repeat(40)}-dirty` }), binding, config)).not.toThrow();
    expect(() => admitSelfUpgradeLaunch(request({ targetSha: `${"a".repeat(40)}-other` }), binding, config)).toThrow();
  });

  it("refuses other owners and extra envelope fields", () => {
    expect(() => admitSelfUpgradeLaunch({ ...request(), owner: { kind: "runtime-capability", transitionId: "RCT-1" } }, binding, config)).toThrow();
    expect(() => admitSelfUpgradeLaunch({ ...request(), extra: true }, binding, config)).toThrow();
    expect(() => admitSelfUpgradeLaunch({ ...request(), owner: { kind: "self-upgrade", runId: "SUR-1; rm -rf /" } }, binding, config)).toThrow();
  });

  it("prefers stored self-upgrade configuration over the binding defaults", () => {
    const stored = { ...config, hostInstallPath: "/srv/dpf", useIsolatedWorkspace: false } as SelfUpgradeConfig;
    expect(() => admitSelfUpgradeLaunch(request({
      hostInstallPath: "/srv/dpf", canonicalInstallPath: "/srv/dpf", backupHostPath: "/srv/dpf/backups",
      composeEnvFileHostPath: "/srv/dpf/.env",
    }), binding, stored)).not.toThrow();
  });
});

describe("launchPromoterAtActuator", () => {
  it("launches the admitted owner and returns bounded streams", async () => {
    const launches: Array<{ params: PromoterParams; owner: unknown }> = [];
    const result = await launchPromoterAtActuator(request(), {
      binding, readConfig: async () => config,
      launch: async (launched, owner) => { launches.push({ params: launched, owner }); return { exitCode: 0, stdout: "x".repeat(300 * 1024), stderr: "" }; },
    });
    expect(result.exitCode).toBe(0);
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(260 * 1024);
    expect(launches).toHaveLength(1);
    expect(launches[0]!.params.launchOwner).toEqual({ kind: "self-upgrade", runId });
  });

  it("never launches a refused request", async () => {
    let launched = 0;
    await expect(launchPromoterAtActuator(request({ composeProject: "peer" }), {
      binding, readConfig: async () => config, launch: async () => { launched++; return { exitCode: 0, stdout: "", stderr: "" }; },
    })).rejects.toThrow();
    expect(launched).toBe(0);
  });
});

describe("requestPromoterLaunchThroughActuator", () => {
  const launchParams = { ...params(), launchOwner: { kind: "self-upgrade", runId } } as unknown as PromoterParams;

  it("sends the owner and parameters without the in-process owner field", async () => {
    const bodies: unknown[] = [];
    const result = await requestPromoterLaunchThroughActuator(launchParams, { kind: "self-upgrade", runId },
      async (body) => { bodies.push(body); return { exitCode: 0, stdout: "ok", stderr: "" }; });
    expect(result).toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
    expect(bodies).toEqual([request()]);
  });

  it("keeps the run pending on a lost or malformed reply", async () => {
    const lost = await requestPromoterLaunchThroughActuator(launchParams, { kind: "self-upgrade", runId },
      async () => { throw new Error("scope_writer_observation_unavailable"); });
    expect(lost.exitCode).toBe(PROMOTER_ALREADY_RUNNING_EXIT_CODE);
    const malformed = await requestPromoterLaunchThroughActuator(launchParams, { kind: "self-upgrade", runId },
      async () => ({ exitCode: "0" }));
    expect(malformed.exitCode).toBe(PROMOTER_ALREADY_RUNNING_EXIT_CODE);
  });

  it("does not send runtime-capability launches yet", async () => {
    let sent = 0;
    const result = await requestPromoterLaunchThroughActuator(launchParams, { kind: "runtime-capability", transitionId: "RCT-1" },
      async () => { sent++; return {}; });
    expect(result.exitCode).toBe(75);
    expect(sent).toBe(0);
  });
});
