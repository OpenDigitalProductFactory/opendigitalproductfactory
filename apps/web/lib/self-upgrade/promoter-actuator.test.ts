import { describe, expect, it } from "vitest";

import {
  admitRuntimeTransitionLaunch,
  admitSelfUpgradeLaunch,
  launchPromoterAtActuator,
  launchThroughPrivateActuator,
  readPromoterInstallBinding,
  requestPromoterLaunchThroughActuator,
  type PromoterInstallBinding,
  type RuntimeHostContext,
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
    const launches: Array<{ params: PromoterParams }> = [];
    const result = await launchPromoterAtActuator(request(), {
      binding, readConfig: async () => config, hostContexts: async () => [], activeTransitionIds: async () => [],
      run: async (launched) => { launches.push({ params: launched }); return { exitCode: 0, stdout: "x".repeat(300 * 1024), stderr: "" }; },
    });
    expect(result.exitCode).toBe(0);
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(260 * 1024);
    expect(launches).toHaveLength(1);
    expect(launches[0]!.params.launchOwner).toEqual({ kind: "self-upgrade", runId });
  });

  it("never launches a refused request", async () => {
    let launched = 0;
    await expect(launchPromoterAtActuator(request({ composeProject: "peer" }), {
      binding, readConfig: async () => config, hostContexts: async () => [], activeTransitionIds: async () => [],
      run: async () => { launched++; return { exitCode: 0, stdout: "", stderr: "" }; },
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

  it("keeps a runtime-capability owner pending with EX_TEMPFAIL on a lost reply", async () => {
    const result = await requestPromoterLaunchThroughActuator(launchParams, { kind: "runtime-capability", transitionId: "RCT-1" },
      async () => { throw new Error("lost"); });
    expect(result.exitCode).toBe(75);
  });
});

describe("admitRuntimeTransitionLaunch", () => {
  const contexts: RuntimeHostContext[] = [
    { hostInstallPath: "/Users/op/dpf", stateDirHostPath: "/Users/op/.dpf", composeFiles: ["docker-compose.yml"], composeProject: "dpf" },
    { hostInstallPath: "/Users/op/dpf", stateDirHostPath: "/Users/op/.dpf", composeFiles: ["docker-compose.yml", "docker-compose.macos.yml"],
      composeProject: "dpf", composeEnvFileHostPath: "/Users/op/dpf/.env", hostIdentity: { platform: "darwin", arch: "arm64", provenance: "install-state" } },
  ];
  const runtime = { ...binding, transitionSecretFileHostPath: "/Users/op/.dpf/runtime-transition.secret", appUrl: undefined };
  const base = (overrides: Record<string, unknown> = {}) => ({
    ...contexts[1], targetSha: "a".repeat(40), promoterImage: `sha256:${"b".repeat(64)}`,
    backupPath: "/backups/runtime-capability-transition", healthUrl: "http://localhost:3000/api/health", ...overrides,
  });
  const apply = (overrides: Record<string, unknown> = {}) => ({
    owner: { kind: "runtime-capability", transitionId: "RCT-1" },
    params: base({ runtimeCapabilityTransitionId: "RCT-1", containerName: "dpf-promoter-RCT-1", timeoutMs: 600_000,
      runtimeCapabilityEnvelope: "e".repeat(64), runtimeCapabilitySignature: "c".repeat(64),
      runtimeCapabilitySecretFileHostPath: "/Users/op/.dpf/runtime-transition.secret", ...overrides }),
  });
  const authority = (operation: string, overrides: Record<string, unknown> = {}) => ({
    owner: { kind: "runtime-authority", operation },
    params: base({ runtimeTransitionAuthorityOperation: operation, timeoutMs: 60_000, ...overrides }),
  });
  const active = async () => ["RCT-9"];

  it("admits an apply whose host context matches an install-derived context", async () => {
    const admitted = await admitRuntimeTransitionLaunch(apply(), runtime, contexts, active);
    expect(admitted.launchOwner).toEqual({ kind: "runtime-capability", transitionId: "RCT-1" });
  });

  it("admits a rollback action owned by its transition", async () => {
    await expect(admitRuntimeTransitionLaunch(apply({ runtimeCapabilityTransitionId: "RCT-1-rollback", containerName: "dpf-promoter-RCT-1-rollback" }),
      runtime, contexts, active)).resolves.toBeTruthy();
  });

  it.each([
    ["hostInstallPath", "/Users/other/dpf"],
    ["stateDirHostPath", "/tmp/state"],
    ["composeProject", "peer"],
    ["composeFiles", ["docker-compose.yml", "docker-compose.linux.yml"]],
    ["runtimeCapabilitySecretFileHostPath", "/tmp/secret"],
    ["backupPath", "/backups/other"],
    ["healthUrl", "http://attacker/api/health"],
    ["containerName", "dpf-promoter-RCT-2"],
    ["promoterImage", "evil:latest"],
    ["targetSha", "main"],
    ["installStateMigrationEnvelope", "e".repeat(64)],
  ])("refuses an apply with a mismatched %s", async (key, value) => {
    await expect(admitRuntimeTransitionLaunch(apply({ [key]: value }), runtime, contexts, active)).rejects.toThrow("promoter_actuator_admission_refused");
  });

  it("binds each authority operation to its fixed container and inputs", async () => {
    await expect(admitRuntimeTransitionLaunch(authority("reserve", { runtimeCapabilityTransitionId: "RCT-1",
      containerName: "dpf-promoter-authority-RCT-1" }), runtime, contexts, active)).resolves.toBeTruthy();
    await expect(admitRuntimeTransitionLaunch(authority("release", { runtimeCapabilityTransitionId: "RCT-1",
      runtimeTransitionAuthorityToken: "f".repeat(64), containerName: "dpf-promoter-authority-release-RCT-1" }), runtime, contexts, active)).resolves.toBeTruthy();
    await expect(admitRuntimeTransitionLaunch(authority("reserve", { runtimeCapabilityTransitionId: "RCT-1",
      containerName: "dpf-promoter-authority-release-RCT-1" }), runtime, contexts, active)).rejects.toThrow();
    await expect(admitRuntimeTransitionLaunch(authority("release", { runtimeCapabilityTransitionId: "RCT-1",
      containerName: "dpf-promoter-authority-release-RCT-1" }), runtime, contexts, active)).rejects.toThrow();
    await expect(admitRuntimeTransitionLaunch(authority("delete-everything", { containerName: "dpf-promoter-x" }), runtime, contexts, active)).rejects.toThrow();
  });

  it("derives the active transition set for reconciliation instead of trusting the caller", async () => {
    const minimal = { hostInstallPath: "/Users/op/dpf", stateDirHostPath: "/Users/op/.dpf", targetSha: "runtime-capability-transition",
      backupPath: "/backups/runtime-capability-transition", healthUrl: "http://localhost:3000/api/health",
      runtimeTransitionAuthorityOperation: "reconcile", runtimeTransitionActiveIds: [], containerName: "dpf-promoter-authority-reconcile", timeoutMs: 60_000 };
    const admitted = await admitRuntimeTransitionLaunch({ owner: { kind: "runtime-authority", operation: "reconcile" }, params: minimal },
      runtime, contexts, active);
    expect(admitted.runtimeTransitionActiveIds).toEqual(["RCT-9"]);
  });
});

describe("launchThroughPrivateActuator routing", () => {
  it("leaves build, readiness and dry-run promoter work on the existing path", async () => {
    const { launchThroughPrivateActuator } = await import("./promoter-actuator");
    for (const params of [{ phase: "build" }, { dryRun: true }, {}]) {
      expect(await launchThroughPrivateActuator({ ...params, launchOwner: undefined } as unknown as PromoterParams, async () => true)).toBeNull();
    }
  });
});

describe("self-upgrade prebuild and readiness stages", () => {
  const prebuild = (overrides: Record<string, unknown> = {}) => {
    const { installStateMigrationEnvelope: _e, installStateMigrationSignature: _s, installStateMigrationRunId: _r,
      maintenanceRecoveryPointDigest: _m, ...rest } = params();
    void _e; void _s; void _r; void _m;
    return { owner: { kind: "self-upgrade", runId, stage: "prebuild" },
      params: { ...rest, phase: "build", containerName: `dpf-promoter-${runId}-prebuild`,
        backupPath: `/backups/self-upgrade/${runId}/prebuild`, timeoutMs: 75 * 60_000, ...overrides } };
  };
  const readiness = (overrides: Record<string, unknown> = {}) => {
    const { installStateMigrationEnvelope: _e, installStateMigrationSignature: _s, installStateMigrationRunId: _r,
      maintenanceRecoveryPointDigest: _m, canonicalInstallPath: _c, ...rest } = params();
    void _e; void _s; void _r; void _m; void _c;
    return { owner: { kind: "self-upgrade", runId, stage: "readiness" },
      params: { ...rest, containerName: `dpf-promoter-readiness-${runId}`, ...overrides } };
  };

  it("admits a prebuild bound to its own container and backup path", () => {
    const admitted = admitSelfUpgradeLaunch(prebuild(), binding, config);
    expect(admitted.stage).toBe("prebuild");
    expect(admitted.params.phase).toBe("build");
  });

  it("admits readiness without a canonical path or migration envelope", () => {
    expect(admitSelfUpgradeLaunch(readiness(), binding, config).stage).toBe("readiness");
  });

  it.each([
    ["prebuild container", () => prebuild({ containerName: `dpf-promoter-${runId}` })],
    ["prebuild backup", () => prebuild({ backupPath: `/backups/self-upgrade/${runId}` })],
    ["prebuild without build phase", () => prebuild({ phase: undefined })],
    ["prebuild with migration envelope", () => prebuild({ installStateMigrationEnvelope: "e".repeat(64) })],
    ["prebuild host path", () => prebuild({ hostInstallPath: "/Users/other" })],
    ["readiness container", () => readiness({ containerName: `dpf-promoter-${runId}` })],
    ["readiness with caller artifact", () => readiness({ artifact: { digest: "sha256:x" } })],
    ["readiness with build phase", () => readiness({ phase: "build" })],
    ["readiness backup host path", () => readiness({ backupHostPath: "/tmp" })],
    ["unknown stage", () => ({ ...readiness(), owner: { kind: "self-upgrade", runId, stage: "teardown" } })],
  ])("refuses %s", (_label, build) => {
    expect(() => admitSelfUpgradeLaunch(build(), binding, config)).toThrow("promoter_actuator_admission_refused");
  });

  it("runs prebuild only while the owning run is running, and re-resolves readiness artifacts itself", async () => {
    const calls: string[] = [];
    const deps = (status: string) => ({
      binding, readConfig: async () => config, hostContexts: async () => [], activeTransitionIds: async () => [],
      readRunStatus: async () => status,
      run: async (launched: PromoterParams) => { calls.push(`run:${launched.containerName}`); return { exitCode: 0, stdout: "", stderr: "" }; },
      readiness: async (launched: PromoterParams) => { calls.push(`readiness:${launched.containerName}`); return { exitCode: 0, stdout: "{}", stderr: "" }; },
    });
    await launchPromoterAtActuator(prebuild(), deps("running"));
    await launchPromoterAtActuator(readiness(), deps("running"));
    await expect(launchPromoterAtActuator(prebuild(), deps("failed"))).rejects.toThrow();
    await expect(launchPromoterAtActuator(readiness(), deps("succeeded"))).rejects.toThrow();
    expect(calls).toEqual([`run:dpf-promoter-${runId}-prebuild`, `readiness:dpf-promoter-readiness-${runId}`]);
  });
});

describe("prebuild and readiness routing", () => {
  const on = async () => true;
  it("sends a prebuild as its run's prebuild stage and leaves dry runs local", async () => {
    const { launchThroughPrivateActuator } = await import("./promoter-actuator");
    const bodies: unknown[] = [];
    const send = async (body: unknown) => { bodies.push(body); return { exitCode: 0, stdout: "", stderr: "" }; };
    const prebuild = { ...params(), phase: "build", launchOwner: { kind: "self-upgrade", runId } } as unknown as PromoterParams;
    await launchThroughPrivateActuator(prebuild, on, send);
    expect((bodies[0] as { owner: unknown }).owner).toEqual({ kind: "self-upgrade", runId, stage: "prebuild" });
    expect(await launchThroughPrivateActuator({ ...prebuild, dryRun: true }, on, send)).toBeNull();
    expect(await launchThroughPrivateActuator({ ...prebuild, launchOwner: undefined }, on, send)).toBeNull();
    expect(bodies).toHaveLength(1);
  });

  it("sends readiness keyed by its run name without the caller's artifact", async () => {
    const { readinessThroughPrivateActuator } = await import("./promoter-actuator");
    const bodies: Array<{ owner: unknown; params: Record<string, unknown> }> = [];
    const send = async (body: unknown) => { bodies.push(body as never); return { exitCode: 0, stdout: "{}", stderr: "" }; };
    const readiness = { ...params(), containerName: `dpf-promoter-readiness-${runId}`, artifact: { digest: "sha256:caller" } };
    await readinessThroughPrivateActuator(readiness as never, on, send);
    expect(bodies[0]!.owner).toEqual({ kind: "self-upgrade", runId, stage: "readiness" });
    expect(bodies[0]!.params.artifact).toBeUndefined();
    expect(await readinessThroughPrivateActuator({ ...readiness, containerName: "other" } as never, on, send)).toBeNull();
    expect(await readinessThroughPrivateActuator(readiness as never, async () => false, send)).toBeNull();
  });
});

describe("the swap's drain fence at the actuator boundary (BI-3C3CCC59)", () => {
  const swap = (owner: Record<string, unknown>) => ({ owner: { kind: "self-upgrade", runId, ...owner }, params: params() });
  const deps = (fenceCalls: string[], order: string[]) => ({
    binding, readConfig: async () => config, hostContexts: async () => [], activeTransitionIds: async () => [],
    swapFence: (owner: { runId: string; quiescenceRunId?: string }) => owner.quiescenceRunId
      ? async () => { fenceCalls.push(`${owner.quiescenceRunId}:${owner.runId}`); order.push("fence"); } : undefined,
    run: async (_params: PromoterParams, assertAdmission?: () => Promise<void>) => {
      await assertAdmission?.();
      order.push("launch");
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });

  it("re-checks the named drain before the launch and keeps it on the admitted owner", async () => {
    const fenceCalls: string[] = [], order: string[] = [];
    await launchPromoterAtActuator(swap({ quiescenceRunId: "QR-2026-11-25-abcd" }), deps(fenceCalls, order));
    expect(fenceCalls).toEqual([`QR-2026-11-25-abcd:${runId}`]);
    expect(order).toEqual(["fence", "launch"]);
  });

  it("names a drain only on the swap stage and only in the quiescence run format", () => {
    expect(admitSelfUpgradeLaunch(swap({ quiescenceRunId: "QR-1" }), binding, config).owner)
      .toEqual({ kind: "self-upgrade", runId, quiescenceRunId: "QR-1" });
    for (const owner of [{ quiescenceRunId: "SUR-OTHER" }, { quiescenceRunId: "QR-1; rm" }, { quiescenceRunId: 7 },
      { quiescenceRunId: "QR-1", stage: "prebuild" }]) {
      expect(() => admitSelfUpgradeLaunch(swap(owner), binding, config)).toThrow();
    }
  });

  it("holds the portal-side fence before the request and sends nothing when it fails", async () => {
    const sent: unknown[] = [];
    const launch = { ...params(), launchOwner: { kind: "self-upgrade", runId, quiescenceRunId: "QR-1" } } as unknown as PromoterParams;
    await expect(launchThroughPrivateActuator(launch, async () => true, async (body) => { sent.push(body); return { exitCode: 0, stdout: "", stderr: "" }; },
      async () => { throw new Error("admission-reopened-before-swap"); })).rejects.toThrow("admission-reopened-before-swap");
    expect(sent).toHaveLength(0);
    await launchThroughPrivateActuator(launch, async () => true, async (body) => { sent.push(body); return { exitCode: 0, stdout: "", stderr: "" }; },
      async () => undefined);
    expect(sent).toEqual([expect.objectContaining({ owner: { kind: "self-upgrade", runId, quiescenceRunId: "QR-1" } })]);
  });
});
