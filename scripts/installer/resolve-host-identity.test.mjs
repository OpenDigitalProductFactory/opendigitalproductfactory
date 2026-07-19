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

test("bounded legacy Windows evidence resolves an unsupported state", () => {
  assert.deepEqual(resolveHostIdentity({ state: { platform: "unsupported", arch: "amd64", installPath: "D:\\DPF", stateDir: "C:\\.dpf" }, env: { DPF_HOST_INSTALL_PATH: "D:\\DPF", DPF_STATE_DIR_HOST: "C:\\.dpf" } }), {
    platform: "win32", arch: "amd64", capabilityHostPlatform: "windows", provenance: "legacy-windows-paths",
  });
});

for (const [input, error] of [
  [{ state: { platform: "unsupported", arch: "x64" }, env: { DPF_HOST_INSTALL_PATH: "D:\\DPF", DPF_STATE_DIR_HOST: "D:\\.dpf" } }, "host_identity_unverifiable"],
  [{ state: { platform: "unsupported", arch: "amd64", installPath: "D:\\DPF", stateDir: "C:\\.dpf" }, env: { DPF_HOST_INSTALL_PATH: "E:\\DPF", DPF_STATE_DIR_HOST: "C:\\.dpf" } }, "host_identity_contradictory"],
  [{ state: { platform: "linux", arch: "amd64" }, env: {} }, "host_identity_unverifiable"],
  [{ state: { platform: "win32", arch: "amd64" }, env: { DPF_HOST_PLATFORM: "linux", DPF_HOST_ARCH: "amd64" } }, "host_identity_contradictory"],
]) test(`fails closed: ${error} ${JSON.stringify(input)}`, () => {
  assert.throws(() => resolveHostIdentity(input), new RegExp(error));
});
