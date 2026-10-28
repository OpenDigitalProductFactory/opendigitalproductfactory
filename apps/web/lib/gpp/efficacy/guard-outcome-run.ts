// BI-FEDD8F45 — the platform's reading of a submitted guard outcome run.
// Design: docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md §4.1–§4.2.
//
// The client builds the record (scripts/lib/guard-outcome-record.mjs); the
// platform validates it here before writing it. The two validators are kept in
// step by the shared fixture in guard-outcome-run.test.ts: the portal image
// does not ship scripts/, so the platform cannot import the client's.

import { createHash } from "node:crypto";

export const GUARD_OUTCOME_SCHEMA = "guard-outcome-run.v1";
export const GUARD_OUTCOME_RUNNERS = ["pregate", "pre-push-gate", "guard-loop"] as const;
export const GUARD_VERDICTS = ["passed", "refused", "self-test-failed", "runner-failed", "skipped"] as const;
export const GUARD_RESULT_KINDS = ["guard", "aggregate", "hook"] as const;
export const GUARD_OVERRIDE_KINDS = ["skip-env", "local-ci-override", "gate-infrastructure-unavailable"] as const;

export const GUARD_OUTCOME_OPERATION = {
  run: "guard-outcome.run",
  declarations: "guard-outcome.declarations",
  classification: "guard-outcome.classification",
  retirementReview: "guard-outcome.retirement-review",
} as const;

/** Limits from the design §4.2. */
export const MAX_RECORDS_PER_CALL = 20;
export const MAX_GUARDS_PER_RECORD = 400;
export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_DECLARATIONS_BYTES = 256 * 1024;

export type GuardOutcomeRunner = (typeof GUARD_OUTCOME_RUNNERS)[number];
export type GuardVerdict = (typeof GUARD_VERDICTS)[number];
export type GuardResultKind = (typeof GUARD_RESULT_KINDS)[number];
export type GuardRunOverride = { kind: (typeof GUARD_OVERRIDE_KINDS)[number]; code: string; reason: string };

export type GuardResult = {
  guardId: string;
  kind: GuardResultKind;
  guardDigest: string;
  baselineDigest: string | null;
  verdict: GuardVerdict;
  durationMs: number;
};

export type GuardOutcomeRun = {
  schema: typeof GUARD_OUTCOME_SCHEMA;
  runId: string;
  runner: GuardOutcomeRunner;
  startedAt: string;
  durationMs: number;
  diff: {
    cloneKey: string;
    branch: string;
    baseSha: string | null;
    headSha: string;
    patchId: string | null;
    dirty: boolean;
  };
  override: GuardRunOverride | null;
  declarationsDigest: string | null;
  guards: GuardResult[];
};

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const CLONE_KEY_RE = /^[0-9a-f]{16}$/;
const RUN_ID_RE = /^[0-9a-f-]{36}$/;
const GUARD_ID_RE = /^(loop|policy|hook):[A-Za-z0-9._-]{1,120}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export type GuardOutcomeRunValidation =
  | { valid: true; run: GuardOutcomeRun }
  | { valid: false; runId: string | null; reason: string };

/** Validate one submitted record. The reason names the first failing fields. */
export function validateGuardOutcomeRun(value: unknown): GuardOutcomeRunValidation {
  const runId = isRecord(value) && typeof value.runId === "string" && RUN_ID_RE.test(value.runId) ? value.runId : null;
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, runId, reason: "record is not an object" };
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_RECORD_BYTES) {
    return { valid: false, runId, reason: `record exceeds ${MAX_RECORD_BYTES} bytes` };
  }
  if (value.schema !== GUARD_OUTCOME_SCHEMA) errors.push("schema");
  if (!runId) errors.push("runId");
  if (!includes(GUARD_OUTCOME_RUNNERS, value.runner)) errors.push("runner");
  if (typeof value.startedAt !== "string" || Number.isNaN(Date.parse(value.startedAt))) errors.push("startedAt");
  if (!isNonNegative(value.durationMs)) errors.push("durationMs");
  const diff = isRecord(value.diff) ? value.diff : {};
  if (typeof diff.cloneKey !== "string" || !CLONE_KEY_RE.test(diff.cloneKey)) errors.push("diff.cloneKey");
  if (typeof diff.branch !== "string" || !BRANCH_RE.test(diff.branch)) errors.push("diff.branch");
  if (typeof diff.headSha !== "string" || !SHA_RE.test(diff.headSha)) errors.push("diff.headSha");
  if (diff.baseSha !== null && (typeof diff.baseSha !== "string" || !SHA_RE.test(diff.baseSha))) errors.push("diff.baseSha");
  if (diff.patchId !== null && (typeof diff.patchId !== "string" || !SHA_RE.test(diff.patchId))) errors.push("diff.patchId");
  if (typeof diff.dirty !== "boolean") errors.push("diff.dirty");
  const override = value.override;
  if (
    override !== null &&
    !(isRecord(override) && includes(GUARD_OVERRIDE_KINDS, override.kind) && typeof override.code === "string" && typeof override.reason === "string")
  ) {
    errors.push("override");
  }
  if (value.declarationsDigest !== null && (typeof value.declarationsDigest !== "string" || !DIGEST_RE.test(value.declarationsDigest))) {
    errors.push("declarationsDigest");
  }
  if (!Array.isArray(value.guards)) {
    errors.push("guards");
  } else if (value.guards.length > MAX_GUARDS_PER_RECORD) {
    errors.push(`guards (more than ${MAX_GUARDS_PER_RECORD})`);
  } else {
    value.guards.forEach((guard: unknown, index: number) => {
      const g = isRecord(guard) ? guard : {};
      if (typeof g.guardId !== "string" || !GUARD_ID_RE.test(g.guardId)) errors.push(`guards[${index}].guardId`);
      if (!includes(GUARD_RESULT_KINDS, g.kind)) errors.push(`guards[${index}].kind`);
      if (typeof g.guardDigest !== "string" || !DIGEST_RE.test(g.guardDigest)) errors.push(`guards[${index}].guardDigest`);
      if (g.baselineDigest !== null && (typeof g.baselineDigest !== "string" || !DIGEST_RE.test(g.baselineDigest))) {
        errors.push(`guards[${index}].baselineDigest`);
      }
      if (!includes(GUARD_VERDICTS, g.verdict)) errors.push(`guards[${index}].verdict`);
      if (!isNonNegative(g.durationMs)) errors.push(`guards[${index}].durationMs`);
    });
  }
  if (errors.length > 0) return { valid: false, runId, reason: `invalid: ${errors.slice(0, 8).join(", ")}` };
  return { valid: true, run: value as unknown as GuardOutcomeRun };
}

function rowId(prefix: string, key: string): string {
  return `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

/** Primary key of a run row: a repeated runId collides, which is the idempotence. */
export function guardOutcomeRunRowId(runId: string): string {
  return rowId("gor", runId);
}

export function guardOutcomeClassificationRowId(runId: string, guardId: string): string {
  return rowId("goc", `${runId}:${guardId}`);
}

export function guardDeclarationsRowId(digest: string): string {
  return rowId("god", digest);
}

export function guardRetirementReviewRowId(origin: string): string {
  return rowId("gorr", origin);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
