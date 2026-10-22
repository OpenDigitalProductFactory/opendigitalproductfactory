import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
/** Retained physical observation, not a claim of fresh host attestation. The
 * trusted administrator boundary invalidates this entry after arbitrary host,
 * binary, environment or startup changes. Typed model/context operations must
 * preserve these content-addressed tokenizer/template semantics or refuse. */
export const REASSESSMENT_NATIVE_COMPOSITION = Object.freeze({
  schemaVersion: 1, kind: "dmr-native-messages-v1", observationWorkroom: "WC-A5703D01",
  runtimeVersion: "v1.2.8", runtimeSourceCommit: "5a3112fdc10bcfe236a7450fcfa7e83ed3c0209e",
  engineSourceCommit: "72874f559c598b8f89fbb24864868337cf5afb4c", engineBuild: "b9879-metal",
  engineExecutableDigest: "0e9095b1a9068961682fa60fa101bdcf40e0b1f1e6b0c44c1616c0611c1d4b26",
  engineArchiveDigest: "b70706f473b4043ca3e0c32704a7fda3412b83bceef0564684187b8011230de8",
  modelDigest: "sha256:66c4f325bc71350f07fb2da4f92455553c7bbc8af5d7ee2095fbeac79b9e66c9", manifestBytes: 1192,
  logicalModelRef: "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M",
  modelConfigurationBytes: 11424, modelConfigurationBytesDigest: "0c8ee016ba9be61836af6cac90d09ed414298ba20e65d2a20bf01d642967e7ae",
  logicalModelConfigurationDigest: "f2cad47727f7d07e4a51f11c4499d90252ee96b530d7a508a06359ecec91dd40",
  ggufDigest: "31629f53165ab6a7dad8c9847dcfd1fdf55829dac1e6e748f4a68581b0033d34",
  projectorDigest: "de2a49866988ea272c43dc2a43ee2662c25725a717ca5b9059ea420a97f53fe8",
  templateDigest: "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041", templateCharacters: 8952,
  templateSidecar: "absent", namedToolTemplate: "absent", rendererOverrides: "absent", inputs: "text-and-function-tools-only",
  trustBoundary: "native-runtime-and-privileged-host-administrator",
} as const);
export const reassessmentNativeCatalogDigest = () => hash(REASSESSMENT_NATIVE_COMPOSITION);


const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const classes = ["minimize_cost", "balanced", "quality_first"];
/** Structural source-catalog check. It never attests a host, admits a task or
 * replaces the persisted server-owned Q/E seal and its observed capture. */
export function validAuditedReassessmentNativeQualification(value: unknown): boolean {
  if (!object(value) || !object(value.nativeRuntime) || !object(value.finiteTokenProof) || !object(value.executionPlan)) return false;
  const runtime = value.nativeRuntime, proof = value.finiteTokenProof, plan = value.executionPlan;
  const keys = ["schemaVersion", "catalogDigest", "observationDigest", "spendAwareBudgetClass", "requestedBudgetClass"];
  if (runtime.schemaVersion !== 2 || Object.keys(runtime).some(key => !keys.includes(key))
    || runtime.catalogDigest !== reassessmentNativeCatalogDigest() || !digest(runtime.observationDigest)
    || !classes.includes(String(runtime.spendAwareBudgetClass))
    || runtime.requestedBudgetClass !== undefined && !classes.includes(String(runtime.requestedBudgetClass))) return false;
  const catalog = REASSESSMENT_NATIVE_COMPOSITION;
  if (Object.keys(proof).length !== 10 || proof.schemaVersion !== 1 || proof.kind !== catalog.kind
    || proof.runtimeVersion !== catalog.runtimeVersion || proof.modelDigest !== catalog.modelDigest
    || proof.engineArtifactDigest !== `sha256:${catalog.engineArchiveDigest}` || proof.engineSourceCommit !== catalog.engineSourceCommit.slice(0, 7)
    || proof.engineIdentity !== `Running: llama.cpp ${catalog.engineBuild} (sha256:${catalog.engineArchiveDigest}) ${catalog.engineSourceCommit.slice(0, 7)}`
    || proof.templateDigest !== catalog.templateDigest || !digest(proof.configDigest)
    || plan.providerId !== "local" || plan.executionChannel !== "local-runtime" || plan.accountAuthMethod !== "none") return false;
  try {
    const url = new URL(String(proof.apiRoot));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

