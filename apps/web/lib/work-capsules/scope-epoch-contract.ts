/** Packaged scope-writer compatibility, independent of reassessment owners.
 * A declaration and its byte hashes bind qualification evidence; the functional
 * gate supplies the behavioral proof. They are not authority or runtime access. */
export const SCOPE_EPOCH_WRITER_CONTRACT_VERSION = 1;
export const SCOPE_EPOCH_WRITER_PATHS = [
  "apps/web/lib/work-capsules.ts",
  "apps/web/lib/work-capsules/scope-epoch-writer-probe.mjs",
  "apps/web/lib/work-capsules/work-capsule-store.ts",
  "apps/web/lib/work-capsules/scope-claim-store.ts",
  "apps/web/lib/work-capsules/scope-release-store.ts",
  "apps/web/lib/work-capsules/scope-input.ts",
  "apps/web/lib/work-capsules/scope-metadata.mjs",
  "apps/web/lib/work-management/workroom-posture-claim.ts",
  "apps/web/lib/work-management/workroom-shape-claim.ts",
  "apps/web/lib/work-management/workroom-boundary-claim.ts",
  "apps/web/lib/work-capsules/scope-release-targets.ts",
  "apps/web/lib/work-capsules/scope-release-preflight.ts",
  "apps/web/lib/work-capsules/scope-release-authorization.ts",
  "apps/web/lib/work-capsules/scope-release-consequence.ts",
  "apps/web/lib/work-capsules/scope-epoch-enrollment.server.ts",
  "apps/web/lib/work-capsules/mcp-handlers.ts",
  "apps/web/lib/work-capsules/command-receipts.ts",
  "apps/web/lib/work-capsules/receipted-tool.ts",
  "apps/web/lib/work-capsules/declare-break-fix.ts",
  "apps/web/lib/mcp/packs/work-capsules-pack.ts",
  "apps/web/lib/govern/authority/coworker-tool-authority-gate.ts",
  "apps/web/lib/mcp-governed-execute.ts",
  "apps/web/lib/actions/workroom-posture.ts",
  "apps/web/lib/actions/workroom-boundary.ts",
  "apps/web/lib/work-management/workroom-sensitivity-review.server.ts",
  "apps/web/lib/queue/functions/workroom-drive-children.ts",
  "apps/web/lib/queue/functions/workroom-overseer-run.ts",
  "apps/web/scripts/ux-sweep-fixture-core.mjs",
] as const;
export type ScopeEpochWriterContract = {
  schemaVersion: 1; version: 1; sourceSha: string; sourceContentHash: string;
  contractSha256: string; writers: Record<string, string>;
};
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function validateScopeEpochWriterContract(value: unknown): ScopeEpochWriterContract {
  if (!record(value) || Object.keys(value).length !== 6 || value.schemaVersion !== 1 || value.version !== SCOPE_EPOCH_WRITER_CONTRACT_VERSION
    || typeof value.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(value.sourceSha)
    || !hash(value.sourceContentHash) || !hash(value.contractSha256) || !record(value.writers)
    || Object.keys(value.writers).length !== SCOPE_EPOCH_WRITER_PATHS.length
    || SCOPE_EPOCH_WRITER_PATHS.some(path => !hash((value.writers as Record<string, unknown>)[path]))) {
    throw new Error("scope-writer-compatibility-unproven");
  }
  return value as ScopeEpochWriterContract;
}
