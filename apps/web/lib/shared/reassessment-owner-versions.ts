export const REASSESSMENT_PROTOCOL_VERSION = 2;
export const REASSESSMENT_OWNERS = Object.freeze(["transport", "approval", "worker", "writer"] as const);
export type ReassessmentOwner = typeof REASSESSMENT_OWNERS[number];
export const REASSESSMENT_OWNER_VERSIONS = Object.freeze({ transport: 2, approval: 2, worker: 2, writer: 2 });
export const REASSESSMENT_OWNER_PATHS = Object.freeze({
  transport: "mcp-task-reassessment-transport.ts",
  approval: "govern/authority/coworker-tool-authority-gate.ts",
  worker: "mcp-task-execution.ts",
  writer: "backlog/initiative-readiness/bound-review-effect.ts",
});
export type ReassessmentCapabilityInfo = {
  schemaVersion: 1; sourceSha: string; sourceContentHash: string; contractSha256: string;
  owners: Record<ReassessmentOwner, { version: number; sourceSha256: string }>;
};
export type ReassessmentRuntimeCompatibility = ReassessmentCapabilityInfo & { configDigest: string };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function refuseReassessmentCompatibility(): never {
  throw Object.assign(new Error("reassessment-compatibility-unproven"), { code: "reassessment-compatibility-unproven" });
}

/** Each actual owner asserts its declared protocol at its effect boundary. */
export function assertReassessmentOwnerSupport(owner: ReassessmentOwner, declaredVersion: number): void {
  if (declaredVersion !== REASSESSMENT_PROTOCOL_VERSION || REASSESSMENT_OWNER_VERSIONS[owner] !== declaredVersion) refuseReassessmentCompatibility();
}

export function validateReassessmentCapabilityInfo(value: unknown): ReassessmentCapabilityInfo {
  if (!object(value) || !exactKeys(value, ["schemaVersion", "sourceSha", "sourceContentHash", "contractSha256", "owners"])
    || value.schemaVersion !== 1 || typeof value.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(value.sourceSha)
    || !digest(value.sourceContentHash) || !digest(value.contractSha256) || !object(value.owners)
    || !exactKeys(value.owners, REASSESSMENT_OWNERS)) refuseReassessmentCompatibility();
  for (const owner of REASSESSMENT_OWNERS) {
    const support = value.owners[owner];
    if (!object(support) || !exactKeys(support, ["version", "sourceSha256"]) || !digest(support.sourceSha256)
      || typeof support.version !== "number") refuseReassessmentCompatibility();
    assertReassessmentOwnerSupport(owner, support.version);
  }
  return value as ReassessmentCapabilityInfo;
}

export function validateReassessmentRuntimeCompatibility(value: unknown): ReassessmentRuntimeCompatibility {
  if (!object(value) || !exactKeys(value, ["schemaVersion", "configDigest", "sourceSha", "sourceContentHash", "contractSha256", "owners"])
    || typeof value.configDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.configDigest)) refuseReassessmentCompatibility();
  const { configDigest, ...info } = value;
  return { ...validateReassessmentCapabilityInfo(info), configDigest };
}
