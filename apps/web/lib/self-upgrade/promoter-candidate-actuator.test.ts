import { describe, expect, it } from "vitest";

import { buildCandidateArgs, candidateThroughPrivateActuator, createCandidateLauncher } from "./promoter-candidate-actuator";
import type { SelfUpgradeConfig } from "./config";
import type { PromoterInstallBinding } from "./promoter-actuator";
import type { ResolvedPromoterArtifact } from "./promoter-artifact";

const runId = "SUR-CAND1";
const targetSha = "a".repeat(40);
const builderImageId = `sha256:${"b".repeat(64)}`;
const builtImageId = `sha256:${"c".repeat(64)}`;
const binding: PromoterInstallBinding = { project: "dpf", installPath: "/Users/op/dpf" };
const config = { sourceMode: "upstream", useIsolatedWorkspace: true } as SelfUpgradeConfig;
const artifact = { digest: builtImageId, sourceSha: targetSha } as unknown as ResolvedPromoterArtifact;
const request = (overrides: Record<string, unknown> = {}) => ({ owner: { kind: "self-upgrade", runId }, input: { targetSha, ...overrides } });

function harness(options: { run?: { status: string; deployedSha: string | null } | null; config?: SelfUpgradeConfig;
  built?: string; resolved?: ResolvedPromoterArtifact } = {}) {
  const launched: string[][] = [];
  const resolved: Array<{ promoterImage: string; targetSha: string }> = [];
  const launch = createCandidateLauncher({
    binding,
    readConfig: async () => options.config ?? config,
    readRun: async () => (options.run === undefined ? { status: "running", deployedSha: targetSha } : options.run),
    inspectImageId: async () => builderImageId,
    run: async (args) => {
      launched.push(args);
      return { exitCode: 0, stdout: options.built ?? `{"ok":true,"image":"dpf-promoter:${targetSha}","imageId":"${builtImageId}"}\n`, stderr: "" };
    },
    resolve: async (params) => { resolved.push(params); return options.resolved ?? artifact; },
  });
  return { launch, launched, resolved };
}

describe("buildCandidateArgs", () => {
  it("mounts only the workspace read-only and the promoter's socket, pinned to the builder image ID", () => {
    const args = buildCandidateArgs({ name: `dpf-promoter-${runId}-candidate`, runId, project: "dpf",
      workspaceHostPath: "/Users/op/dpf/.upgrade-workspace", builderImageId, targetSha });
    const mounts = args.flatMap((arg, index) => (arg === "-v" ? [args[index + 1]] : []));
    expect(mounts).toEqual(["/Users/op/dpf/.upgrade-workspace:/workspace:ro", "/var/run/docker.sock:/var/run/docker.sock"]);
    expect(args.slice(-4)).toEqual(["--entrypoint", "node", builderImageId, "/promoter/promoter-candidate-build.mjs"]);
    expect(args).toContain(`DPF_CANDIDATE_INPUT=${JSON.stringify({ targetSha })}`);
    expect(args.join(" ")).not.toMatch(/--privileged|--pid[ =]|--network[ =]host|--cap-add/);
  });
});

describe("createCandidateLauncher", () => {
  it("builds from the derived workspace and returns the artifact it resolved itself", async () => {
    const h = harness();
    await expect(h.launch(request())).resolves.toBe(artifact);
    expect(h.launched).toHaveLength(1);
    expect(h.launched[0]).toContain("/Users/op/dpf/.upgrade-workspace:/workspace:ro");
    expect(h.resolved).toEqual([{ promoterImage: `dpf-promoter:${targetSha}`, targetSha }]);
  });

  it.each([
    ["a settled run", { run: { status: "succeeded", deployedSha: targetSha } }],
    ["an unknown run", { run: null }],
    ["a target the run does not expect", { run: { status: "running", deployedSha: "f".repeat(40) } }],
    ["a release-mode install", { config: { ...config, sourceMode: "release" } as unknown as SelfUpgradeConfig }],
    ["a workspace outside the install", { config: { ...config, upgradeWorkspaceHostPath: "/etc" } as SelfUpgradeConfig }],
  ])("refuses %s before any launch", async (_label, options) => {
    const h = harness(options as never);
    await expect(h.launch(request())).rejects.toThrow("promoter_candidate_admission_refused");
    expect(h.launched).toHaveLength(0);
  });

  it("refuses malformed owners and inputs", async () => {
    const h = harness();
    await expect(h.launch({ ...request(), owner: { kind: "self-upgrade", runId: "SUR-1; rm" } })).rejects.toThrow();
    await expect(h.launch(request({ workspace: "/etc" }))).rejects.toThrow();
    await expect(h.launch(request({ targetSha: "abc" }))).rejects.toThrow();
    expect(h.launched).toHaveLength(0);
  });

  it("resolves an operator-configured promoter without building", async () => {
    const h = harness({ config: { ...config, promoterImage: "ghcr.io/acme/dpf-promoter:v1" } as SelfUpgradeConfig });
    await h.launch(request());
    expect(h.launched).toHaveLength(0);
    expect(h.resolved).toEqual([{ promoterImage: "ghcr.io/acme/dpf-promoter:v1", targetSha }]);
  });

  it("fails on a failed build, a foreign tag or a resolved identity that differs from the built image", async () => {
    await expect(harness({ built: '{"ok":false,"reason":"build-failed"}' }).launch(request())).rejects.toThrow("promoter_candidate_build_failed: build-failed");
    await expect(harness({ built: `{"ok":true,"image":"dpf-promoter:other","imageId":"${builtImageId}"}` }).launch(request())).rejects.toThrow("promoter_candidate_build_failed");
    await expect(harness({ resolved: { ...artifact, digest: builderImageId } as ResolvedPromoterArtifact }).launch(request()))
      .rejects.toThrow("promoter_candidate_identity_mismatch");
  });
});

describe("candidateThroughPrivateActuator", () => {
  it("stays local without the actuator and sends only the owner and target with it", async () => {
    const bodies: unknown[] = [];
    await expect(candidateThroughPrivateActuator({ runId, targetSha }, async () => false, async () => artifact)).resolves.toBeNull();
    await expect(candidateThroughPrivateActuator({ runId, targetSha }, async () => true, async (body) => { bodies.push(body); return artifact; }))
      .resolves.toEqual(artifact);
    expect(bodies).toEqual([request()]);
  });

  it("never builds locally after a lost or mismatched reply", async () => {
    await expect(candidateThroughPrivateActuator({ runId, targetSha }, async () => true, async () => { throw new Error("lost"); })).rejects.toThrow("lost");
    await expect(candidateThroughPrivateActuator({ runId, targetSha }, async () => true, async () => ({ ...artifact, sourceSha: "f".repeat(40) })))
      .rejects.toThrow("promoter_candidate_unconfirmed");
  });
});
