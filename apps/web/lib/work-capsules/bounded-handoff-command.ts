import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

export class BoundedHandoffRefusal extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "BoundedHandoffRefusal"; }
}
export type BoundedHandoffRequest = {
  phase: "request"; commandId: string; capsuleId: string;
  expectedLeaseHolderPrincipalId: string; expectedExecutorKind: string; expectedExecutorRef: string;
  targetAgentId: string; toExecutorKind: string; toExecutorRef: string;
  handoffManifest: Record<string, unknown>; reason?: string;
};
export type BoundedHandoffAcknowledgement = {
  phase: "acknowledge"; commandId: string; capsuleId: string; requestId: string;
};
export type BoundedHandoffCommand = BoundedHandoffRequest | BoundedHandoffAcknowledgement;
export const handoffDigest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const invalid = (message: string): never => { throw new BoundedHandoffRefusal("handoff-invalid-input", message); };
function required(params: Record<string, unknown>, key: string, limit = 500): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit) return invalid(key + " is required and must fit its length limit.");
  return value.trim();
}
function assertJson(value: unknown, depth = 0): void {
  if (depth > 20) invalid("The handoff manifest is too deeply nested.");
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) { value.forEach((entry) => assertJson(entry, depth + 1)); return; }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    Object.values(value).forEach((entry) => assertJson(entry, depth + 1)); return;
  }
  invalid("The handoff manifest must contain JSON values only.");
}
/** Parse before receipt lookup. Explicit unknown phases or fields never enter the legacy writer. */
export function parseBoundedHandoffCommand(params: Record<string, unknown>): BoundedHandoffCommand | null {
  if (!Object.hasOwn(params, "phase")) return null;
  const phase = params.phase;
  if (phase !== "request" && phase !== "acknowledge") return invalid("phase must be request or acknowledge.");
  const allowed = new Set(phase === "request"
    ? ["phase", "commandId", "capsuleId", "expectedLeaseHolderPrincipalId", "expectedExecutorKind", "expectedExecutorRef", "targetAgentId", "toExecutorKind", "toExecutorRef", "handoffManifest", "reason"]
    : ["phase", "commandId", "capsuleId", "requestId"]);
  if (Object.keys(params).some((key) => !allowed.has(key))) return invalid("The handoff phase contains an unsupported field.");
  const common = { commandId: required(params, "commandId", 200), capsuleId: required(params, "capsuleId", 200) };
  if (phase === "acknowledge") return { phase, ...common, requestId: required(params, "requestId", 200) };
  const manifest = params.handoffManifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return invalid("handoffManifest with nextAction is required.");
  assertJson(manifest);
  required(manifest as Record<string, unknown>, "nextAction", 4000);
  if (canonicalJson(manifest).length > 16000) return invalid("The handoff manifest is too large.");
  const reason = Object.hasOwn(params, "reason") ? required(params, "reason", 2000) : undefined;
  return { phase, ...common,
    expectedLeaseHolderPrincipalId: required(params, "expectedLeaseHolderPrincipalId", 200),
    expectedExecutorKind: required(params, "expectedExecutorKind", 100), expectedExecutorRef: required(params, "expectedExecutorRef"),
    targetAgentId: required(params, "targetAgentId", 200), toExecutorKind: required(params, "toExecutorKind", 100), toExecutorRef: required(params, "toExecutorRef"),
    handoffManifest: JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>, ...(reason ? { reason } : {}) };
}
