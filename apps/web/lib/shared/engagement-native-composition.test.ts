import { describe, expect, it } from "vitest";
import metadata from "../inference/fixtures/reassessment-native-model.json";
import { ENGAGEMENT_NATIVE_COMPOSITION as catalog, engagementNativeCatalogDigest, interpretEngagementNativeRuntime } from "./engagement-native-composition";
const configuration = () => ({ Backend: "llama.cpp", Mode: "completion", Model: catalog.logicalModelRef,
  ModelID: catalog.modelDigest, Config: { "context-size": 40960 } });
const observations = () => ({ version: { version: catalog.runtimeVersion }, engines: { "llama.cpp":
  `Running: llama.cpp ${catalog.engineBuild} (sha256:${catalog.engineArchiveDigest}) ${catalog.engineSourceCommit.slice(0, 7)}` },
  configurations: [configuration()], metadata: { ...structuredClone(metadata), id: catalog.modelDigest } });
describe("engagement native image composition", () => {
  it("pins the observed DEV composition separately from the text-only initiative catalog", () => {
    expect(catalog).toMatchObject({ runtimeVersion: "v1.2.9", engineBuild: "b9879-cuda",
      modelDigest: "sha256:b9c79f8f56a90a86860d20d8025fde1ac0c03ef282b4f439b271abb7e8c72624",
      inputs: "text-images-and-one-response-function" });
    expect(engagementNativeCatalogDigest()).toMatch(/^[a-f0-9]{64}$/);
    expect(interpretEngagementNativeRuntime(observations())).toMatchObject({ contextTokens: 40960 });
  });
  it.each(["version", "engines", "configurations", "metadata"] as const)("refuses changed or missing %s before count", key => {
    expect(() => interpretEngagementNativeRuntime({ ...observations(), [key]: null })).toThrow();
  });
  it("refuses ambiguous loaded configurations and model/template substitutions", () => {
    const raw = observations();
    expect(() => interpretEngagementNativeRuntime({ ...raw, configurations: [configuration(), configuration()] })).toThrow();
    expect(() => interpretEngagementNativeRuntime({ ...raw, metadata: { ...raw.metadata, id: "sha256:" + "0".repeat(64) } })).toThrow();
    const changed = structuredClone(raw); changed.metadata.config.gguf["tokenizer.chat_template"] += " ";
    expect(() => interpretEngagementNativeRuntime(changed)).toThrow();
    expect(() => interpretEngagementNativeRuntime({ ...raw, configurations: [{ ...configuration(), Config: {} }] })).toThrow();
  });
});
