import { describe, expect, it } from "vitest";
import { runtimeTransitionHostContext, runtimeTransitionHostPlatform } from "./runtime-transition-host-context";

describe("runtime transition install context", () => {
  const env = { DPF_HOST_INSTALL_PATH: "C:/DPF", DPF_STATE_DIR_HOST: "C:/state", GHCR_OWNER: "fixture-owner" };
  const host = { installMode: "consumer", installPath: "C:/DPF", imageTag: "v2026.10.15-dev-recovery.92", platform: "win32", arch: "amd64", composeProjectName: "recorded-project", composeFiles: ["docker-compose.yml", "docker-compose.release.yml", "docker-compose.edge.yml"] };

  it("preserves the recorded chain/project and mounts the canonical release env", () => {
    expect(runtimeTransitionHostContext(host, { ...env, DPF_SELF_UPGRADE_COMPOSE_FILES: "docker-compose.yml", COMPOSE_PROJECT_NAME: "other" })).toMatchObject({
      composeFiles: host.composeFiles, composeProject: "recorded-project", composeEnvFileHostPath: "C:/DPF/.env",
      hostIdentity: { platform: "win32", arch: "amd64", provenance: "install-state" },
    });
  });
  it("reuses the canonical consumer compatibility overlay when no chain was recorded", () => {
    expect(runtimeTransitionHostContext({ ...host, composeFiles: undefined }, env).composeFiles).toEqual(["docker-compose.yml", "docker-compose.release.yml"]);
  });
  it("rejects a different canonical install before launching the promoter", () => {
    expect(() => runtimeTransitionHostContext({ ...host, installPath: "D:/other" }, env)).toThrow("runtime_transition_install_identity_mismatch");
  });
  it("rejects contradictory host platform evidence", () => {
    expect(() => runtimeTransitionHostContext({ ...host, platform: "linux" }, env)).toThrow("host_identity_contradictory");
  });
  it("retains source-mode launch defaults without inventing release state", () => {
    expect(runtimeTransitionHostContext(undefined, env)).toEqual({ hostInstallPath: "C:/DPF", stateDirHostPath: "C:/state", composeFiles: ["docker-compose.yml"], composeProject: "dpf" });
  });
  it.each([["win32", "windows"], ["darwin", "macos"], ["linux", "linux"]])("uses observed %s host rather than container platform", (platform, expected) => {
    expect(runtimeTransitionHostPlatform({ platform })).toBe(expected);
  });
  it("refuses an unverifiable reconciliation platform", () => {
    expect(() => runtimeTransitionHostPlatform({ platform: "unsupported" })).toThrow("runtime_transition_host_platform_unverifiable");
  });
});
