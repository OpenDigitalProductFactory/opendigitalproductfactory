import { ENGAGEMENT_RESPONSE_ENCODING } from "../routing/engagement-captured-messages";
import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { parseTaskExecutionFence, type TaskExecutionFence } from "../shared/task-execution-fence";
import { capturedJsonValue } from "../shared/captured-effect-store";
import { parseEngagementTaskBinding, ENGAGEMENT_READ_TOOLS, type EngagementTaskBinding } from "./engagement-task-binding";

export type EngagementPresentLimits = {
  perTaskTokens: number; maxOutputTokens: number; timeoutMs: number; maxProviderStarts: number;
  maxToolCalls: number; maxSourceBytes: number; maxImageBytes: number; maxImagePixels: number;
};
export type EngagementPresentPolicy = {
  schemaVersion: 1; kind: "engagement-present-assessment-v1";
  originalBinding: EngagementTaskBinding; originalTaskRunId: string; originalRequestDigest: string;
  originalFence: TaskExecutionFence; historicalConsumption: "retain-unknown"; originalReplay: false; maxCandidates: 1;
  issuedAt: string; expiresAt: string; readers: typeof ENGAGEMENT_READ_TOOLS;
  budgetConfigurationDigest: string; providerConfigurationDigest: string; compositionDigest: string;
  limits: EngagementPresentLimits; responseEncoding: typeof ENGAGEMENT_RESPONSE_ENCODING;
  sourceBasis: { kind: "rendered-ux-with-static-source-v1"; fullGuidance: true; wikiRetrieval: "postgres-lexical";
    omittedCategories: ["stylesheet", "script-implementation"]; fullRawSourceModelCoverage: false };
};
type PolicySource = Pick<EngagementPresentPolicy, "originalTaskRunId" | "originalRequestDigest" | "originalFence" |
  "issuedAt" | "budgetConfigurationDigest" | "providerConfigurationDigest" | "compositionDigest" | "limits"> & { binding: EngagementTaskBinding };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): string => createHash("sha256").update(canonicalJson(v)).digest("hex");
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const iso = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function validLimits(v: unknown): v is EngagementPresentLimits {
  if (!object(v) || !exact(v, ["perTaskTokens", "maxOutputTokens", "timeoutMs", "maxProviderStarts", "maxToolCalls",
    "maxSourceBytes", "maxImageBytes", "maxImagePixels"]) || !Object.values(v).every(positive)) return false;
  return Number(v.maxOutputTokens) <= 8192 && Number(v.maxOutputTokens) < Number(v.perTaskTokens)
    && Number(v.timeoutMs) <= 180_000 && Number(v.maxProviderStarts) <= 12 && Number(v.maxToolCalls) <= 40
    && Number(v.maxSourceBytes) <= 250_000 && Number(v.maxImageBytes) <= 4_000_000 && Number(v.maxImagePixels) <= 40_000_000;
}

/** This decoder proves shape, never authority. Issuance and admission also
 * require canonical owner records and the current native governed decision. */
export function parseEngagementPresentPolicy(value: unknown): EngagementPresentPolicy | null {
  try { capturedJsonValue(value); } catch { return null; }
  if (!object(value) || !exact(value, ["schemaVersion", "kind", "originalBinding", "originalTaskRunId", "originalRequestDigest",
    "originalFence", "historicalConsumption", "originalReplay", "maxCandidates", "issuedAt", "expiresAt", "readers",
    "budgetConfigurationDigest", "providerConfigurationDigest", "compositionDigest", "limits", "sourceBasis", "responseEncoding"])
    || value.schemaVersion !== 1 || value.kind !== "engagement-present-assessment-v1"
    || value.historicalConsumption !== "retain-unknown" || value.originalReplay !== false || value.maxCandidates !== 1
    || typeof value.originalTaskRunId !== "string" || !/^TR-MCP-[A-Za-z0-9_-]{1,300}$/.test(value.originalTaskRunId)
    || !digest(value.originalRequestDigest) || ![value.budgetConfigurationDigest, value.providerConfigurationDigest, value.compositionDigest].every(digest)
    || !iso(value.issuedAt) || !iso(value.expiresAt) || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) !== 15 * 60_000
    || canonicalJson(value.readers) !== canonicalJson(ENGAGEMENT_READ_TOOLS) || !validLimits(value.limits)
    || canonicalJson(value.responseEncoding) !== canonicalJson(ENGAGEMENT_RESPONSE_ENCODING)) return null;
  const binding = parseEngagementTaskBinding(value.originalBinding), fence = parseTaskExecutionFence(value.originalFence), basis = value.sourceBasis;
  if (!binding || binding.presentAssessment || binding.serviceId !== "svc-ux-design-critique" || !binding.visualEvidenceRef
    || !/^CE-[A-F0-9]{8}$/.test(binding.engagementId) || !fence || fence.requestDigest !== value.originalRequestDigest
    || !object(basis) || !exact(basis, ["kind", "fullGuidance", "wikiRetrieval", "omittedCategories", "fullRawSourceModelCoverage"])
    || basis.kind !== "rendered-ux-with-static-source-v1" || basis.fullGuidance !== true || basis.wikiRetrieval !== "postgres-lexical" || basis.fullRawSourceModelCoverage !== false
    || canonicalJson(basis.omittedCategories) !== canonicalJson(["stylesheet", "script-implementation"])) return null;
  return { ...value, originalBinding: binding, originalFence: fence } as EngagementPresentPolicy;
}

/** Server-only policy construction from already loaded canonical records.
 * No caller-supplied approval flags or arbitrary policy content are accepted. */
export function issueEngagementPresentPolicy(source: PolicySource): EngagementPresentPolicy {
  const value = { schemaVersion: 1, kind: "engagement-present-assessment-v1", originalBinding: source.binding,
    originalTaskRunId: source.originalTaskRunId, originalRequestDigest: source.originalRequestDigest, originalFence: source.originalFence,
    historicalConsumption: "retain-unknown", originalReplay: false, maxCandidates: 1,
    issuedAt: source.issuedAt, expiresAt: iso(source.issuedAt) ? new Date(Date.parse(source.issuedAt) + 15 * 60_000).toISOString() : "",
    readers: ENGAGEMENT_READ_TOOLS, responseEncoding: ENGAGEMENT_RESPONSE_ENCODING, budgetConfigurationDigest: source.budgetConfigurationDigest,
    providerConfigurationDigest: source.providerConfigurationDigest, compositionDigest: source.compositionDigest, limits: source.limits,
    sourceBasis: { kind: "rendered-ux-with-static-source-v1", fullGuidance: true, wikiRetrieval: "postgres-lexical",
      omittedCategories: ["stylesheet", "script-implementation"], fullRawSourceModelCoverage: false } };
  const parsed = parseEngagementPresentPolicy(value);
  if (!parsed) throw new Error("engagement-present-policy-unproven");
  return parsed;
}
export const engagementPresentPolicyDigest = (policy: unknown): string => hash(capturedJsonValue(policy));
/** No token, source, provider, revision or caller key replenishes this CE's one allowance. */
export function presentAssessmentRequestKey(engagementId: string): string {
  if (!/^CE-[A-F0-9]{8}$/.test(engagementId)) throw new Error("engagement-present-id-invalid");
  return `engagement-present-v1-${hash({ engagementId })}`;
}