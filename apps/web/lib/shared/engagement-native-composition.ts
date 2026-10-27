import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { canonicalLocalModelKey } from "../inference/local-model-management";
const hash = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Retained administrator observation of this physical native composition. This
 * is a compatibility catalog, never current host attestation or permission.
 * Runtime observations, exact-body count and current authority remain mandatory. */
export const ENGAGEMENT_NATIVE_COMPOSITION = Object.freeze({
  schemaVersion: 1, kind: "dmr-native-image-messages-v1", observationWorkroom: "WC-6CCF8DAB",
  runtimeVersion: "v1.2.9", engineBuild: "b9879-cuda",
  engineSourceCommit: "72874f559c598b8f89fbb24864868337cf5afb4c",
  engineArchiveDigest: "57130b8af4f80d754ee93e8855e74a9bc6c13e07f99b9becab720cce2658199e",
  logicalModelRef: "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M",
  modelDigest: "sha256:b9c79f8f56a90a86860d20d8025fde1ac0c03ef282b4f439b271abb7e8c72624",
  logicalModelConfigurationDigest: "f2cad47727f7d07e4a51f11c4499d90252ee96b530d7a508a06359ecec91dd40",
  templateDigest: "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041", templateCharacters: 8952,
  inputs: "text-images-and-one-response-function", thinking: false, responseModelIdentity: "dmr-content-addressed-bundle-v1",
  trustBoundary: "native-runtime-and-privileged-host-administrator",
} as const);
export const engagementNativeCatalogDigest = () => hash(ENGAGEMENT_NATIVE_COMPOSITION);
export function interpretEngagementNativeRuntime(raw: { version: unknown; engines: unknown; configurations: unknown; metadata: unknown }) {
  const fail = (): never => { throw new Error("engagement-present-native-composition-unproven"); };
  const c = ENGAGEMENT_NATIVE_COMPOSITION;
  if (!object(raw.version) || raw.version.version !== c.runtimeVersion || !object(raw.engines)
    || raw.engines["llama.cpp"] !== `Running: llama.cpp ${c.engineBuild} (sha256:${c.engineArchiveDigest}) ${c.engineSourceCommit.slice(0, 7)}`
    || Object.entries(raw.engines).some(([k,v]) => k !== "llama.cpp" && typeof v === "string" && v.startsWith("Running"))
    || !Array.isArray(raw.configurations) || raw.configurations.length !== 1 || !object(raw.configurations[0])) return fail();
  const config = raw.configurations[0];
  if (config.Backend !== "llama.cpp" || config.Mode !== "completion" || typeof config.Model !== "string"
    || canonicalLocalModelKey(config.Model) !== canonicalLocalModelKey(c.logicalModelRef) || config.ModelID !== c.modelDigest
    || !object(config.Config) || Object.keys(config.Config).some(k => k !== "context-size")
    || !Number.isSafeInteger(config.Config["context-size"]) || Number(config.Config["context-size"]) <= 0) return fail();
  if (!object(raw.metadata) || raw.metadata.id !== c.modelDigest || !object(raw.metadata.config)
    || hash(raw.metadata.config) !== c.logicalModelConfigurationDigest || !object(raw.metadata.config.gguf)) return fail();
  const tags = raw.metadata.config.gguf["general.tags"];
  if (!(Array.isArray(tags) && tags.includes("image-text-to-text"))
    && !(typeof tags === "string" && tags.split(/[,\s]+/).includes("image-text-to-text"))) return fail();
  const template = raw.metadata.config.gguf["tokenizer.chat_template"];
  if (typeof template !== "string" || template.length !== c.templateCharacters
    || createHash("sha256").update(template).digest("hex") !== c.templateDigest) return fail();
  return { imageInputSupported: true as const, contextTokens: Number(config.Config["context-size"]), runtimeConfigurationDigest: hash(config),
    observationDigest: hash(raw), catalogDigest: engagementNativeCatalogDigest() };
}
