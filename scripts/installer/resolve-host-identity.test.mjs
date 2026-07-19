import assert from "node:assert/strict";
import test from "node:test";

import { resolveHostIdentity } from "./resolve-host-identity.mjs";

for (const [env, expected] of [
  [{ DPF_HOST_PLATFORM: "win32", DPF_HOST_ARCH: "amd64" }, { platform: "win32", arch: "amd64", capabilityHostPlatform: "windows" }],
  [{ DPF_HOST_PLATFORM: "windows", DPF_HOST_ARCH: "x64" }, { platform: "win32", arch: "amd64", capabilityHostPlatform: "windows" }],
  [{ DPF_HOST_PLATFORM: "darwin", DPF_HOST_ARCH: "arm64" }, { platform: "darwin", arch: "arm64", capabilityHostPlatform: "macos" }],
  [{ DPF_HOST_PLATFORM: "macos", DPF_HOST_ARCH: "x86_64" }, { platform: "darwin", arch: "x86_64", capabilityHostPlatform: "macos" }],
  [{ DPF_HOST_PLATFORM: "linux", DPF_HOST_ARCH: "x64" }, { platform: "linux", arch: "amd64", capabilityHostPlatform: "linux" }],
]) test(`maps explicit installer-owned host identity: ${env.DPF_HOST_PLATFORM}/${env.DPF_HOST_ARCH}`, () => {
  assert.deepEqual(resolveHostIdentity({ state: {}, env }), { ...expected, provenance: "explicit" });
});

// An N-1 caller (any portal built before the readiness contract landed) sends no
// DPF_HOST_* env at all. Canonical platform/arch in install-state.json is written by
// the installer itself — the same authority tier as the .env keys — so it resolves
// rather than failing closed and wedging the install. Container `process.platform` is
// still never consulted.
for (const [state, expected] of [
  [{ platform: "win32", arch: "amd64" }, { platform: "win32", arch: "amd64", capabilityHostPlatform: "windows" }],
  [{ platform: "windows", arch: "x86_64" }, { platform: "win32", arch: "x86_64", capabilityHostPlatform: "windows" }],
  [{ platform: "linux", arch: "amd64" }, { platform: "linux", arch: "amd64", capabilityHostPlatform: "linux" }],
  [{ platform: "macos", arch: "arm64" }, { platform: "darwin", arch: "arm64", capabilityHostPlatform: "macos" }],
]) test(`installer-owned install-state resolves without caller env: ${state.platform}/${state.arch}`, () => {
  assert.deepEqual(resolveHostIdentity({ state, env: {} }), { ...expected, provenance: "install-state" });
});

test("install-state identity still cross-checks the host path evidence it is given", () => {
  assert.deepEqual(resolveHostIdentity({ state: { platform: "win32", arch: "amd64" }, env: { DPF_HOST_INSTALL_PATH: "D:\\DPF", DPF_STATE_DIR_HOST: "C:\\.dpf" } }), {
    platform: "win32", arch: "amd64", capabilityHostPlatform: "windows", provenance: "install-state",
  });
});

test("bounded legacy Windows evidence resolves an unsupported state", () => {
  assert.deepEqual(resolveHostIdentity({ state: { platform: "unsupported", arch: "amd64", installPath: "D:\\DPF", stateDir: "C:\\.dpf" }, env: { DPF_HOST_INSTALL_PATH: "D:\\DPF", DPF_STATE_DIR_HOST: "C:\\.dpf" } }), {
    platform: "win32", arch: "amd64", capabilityHostPlatform: "windows", provenance: "legacy-windows-paths",
  });
});

for (const [input, error] of [
  [{ state: { platform: "unsupported", arch: "x64" }, env: { DPF_HOST_INSTALL_PATH: "D:\\DPF", DPF_STATE_DIR_HOST: "D:\\.dpf" } }, "host_identity_unverifiable"],
  [{ state: { platform: "unsupported", arch: "amd64", installPath: "D:\\DPF", stateDir: "C:\\.dpf" }, env: { DPF_HOST_INSTALL_PATH: "E:\\DPF", DPF_STATE_DIR_HOST: "C:\\.dpf" } }, "host_identity_contradictory"],
  [{ state: { platform: "linux", arch: "x64" }, env: {} }, "host_identity_unverifiable"],
  [{ state: { platform: "unsupported", arch: "amd64" }, env: {} }, "host_identity_unverifiable"],
  [{ state: { platform: "win32", arch: "amd64" }, env: { DPF_HOST_PLATFORM: "linux", DPF_HOST_ARCH: "amd64" } }, "host_identity_contradictory"],
  [{ state: { platform: "linux", arch: "amd64" }, env: { DPF_HOST_INSTALL_PATH: "D:\\DPF", DPF_STATE_DIR_HOST: "C:\\.dpf" } }, "host_identity_contradictory"],
  [{ state: { platform: "win32", arch: "amd64" }, env: { DPF_HOST_INSTALL_PATH: "/opt/dpf", DPF_STATE_DIR_HOST: "/var/lib/dpf" } }, "host_identity_contradictory"],
]) test(`fails closed: ${error} ${JSON.stringify(input)}`, () => {
  assert.throws(() => resolveHostIdentity(input), new RegExp(error));
});
