import { describe, expect, it } from "vitest";
import { MANAGED_INFERENCE_BASE_URL, resolveManagedInferenceEndpoint } from "./managed-runtime-selection";

const selected = () => ({ platform: "darwin", arch: "arm64", managedInference: {
  schemaVersion: 1, mode: "native", actionKey: "RA-TEST", nodeId: "edge-test", device: "Apple M5 Max", port: 12436,
  sourceSha: "a".repeat(40), profileSha256: "b".repeat(64), runtimeManifestSha256: "c".repeat(64),
  qualificationReportSha256: "d".repeat(64), baselineEngineSha256: "e".repeat(64),
} });

describe("managed inference installation selection", () => {
  it("leaves existing installations unchanged and selects only the fixed qualified Mac endpoint", () => {
    expect(resolveManagedInferenceEndpoint({ platform: "linux" })).toBeNull();
    expect(resolveManagedInferenceEndpoint(selected())).toBe(MANAGED_INFERENCE_BASE_URL);
    const reverted = selected(); reverted.managedInference.mode = "docker";
    expect(resolveManagedInferenceEndpoint(reverted)).toBeNull();
  });
  it("blocks new requests throughout transition or uncertain restoration", () => {
    for (const mode of ["transitioning", "uncertain"]) {
      const state = selected(); state.managedInference.mode = mode;
      expect(() => resolveManagedInferenceEndpoint(state)).toThrow(/transition|uncertain/);
    }
  });
  it("rejects foreign hardware, unbound state and arbitrary URLs or ports", () => {
    for (const change of [
      { platform: "win32" }, { arch: "amd64" },
      { managedInference: { ...selected().managedInference, device: "Apple M4 Max" } },
      { managedInference: { ...selected().managedInference, runtimeManifestSha256: "" } },
      { managedInference: { ...selected().managedInference, port: 8080 } },
      { managedInference: { ...selected().managedInference, endpoint: "http://remote.invalid" } },
      { managedInference: null },
    ]) expect(() => resolveManagedInferenceEndpoint({ ...selected(), ...change })).toThrow(/invalid|qualified/i);
  });
});
