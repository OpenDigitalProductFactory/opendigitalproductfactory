import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isRecord } from "@/lib/shared/coerce";
import { verifyMaintenanceEpoch } from "../../../../scripts/lib/maintenance-epoch-receipt.mjs";
import { readSuccessfulMaintenanceRecoveryPoint } from "./recovery-eligibility";

export const MAINTENANCE_EPOCH_RECEIPT_PATH = "/dpf-state/maintenance-epoch-retirement.json";
type EpochRun = {
  runId: string; status: string; targetSha: string | null; deployedSha: string | null;
  startedAt: Date | null; updatedAt: Date; completionEvidence: unknown;
};
type EpochDb = { selfUpgradeRun: {
  findUnique(args: unknown): Promise<EpochRun | null>;
  updateMany(args: unknown): Promise<{ count: number }>;
} };
type ImportResult = { status: "attached" | "replayed" | "raced"; runId: string } | { status: "unavailable" };
type RetirementProbeStep = "read-retirement-receipt" | "parse-retirement-receipt" | "read-transition-secret" | "verify-maintenance-retirement";

/** Server-only import. Environment retirement never grants TaskRun replay or settles effects. */
export async function attachMaintenanceEpochEvidence(deps: {
  db?: EpochDb; now?: Date;
  readEnvelope?: () => Promise<string | null>;
  readSecret?: () => Promise<string>;
  // Internal diagnostic hook; callers must sanitize failures before reporting them.
  onProbeFailure?: (step: RetirementProbeStep, error: unknown) => void;
} = {}): Promise<ImportResult> {
  const unavailable: ImportResult = { status: "unavailable" };
  const bytes = await (deps.readEnvelope ?? (() => readFile(MAINTENANCE_EPOCH_RECEIPT_PATH, "utf8").catch(error => {
    // An absent receipt is missing evidence, not a broken read probe.
    if (error?.code !== "ENOENT") deps.onProbeFailure?.("read-retirement-receipt", error);
    return null;
  })))();
  if (!bytes || bytes.length > 32_768) return unavailable;
  let envelope: unknown, payload: unknown;
  try {
    envelope = JSON.parse(bytes);
    payload = isRecord(envelope) && typeof envelope.payload === "string" ? JSON.parse(envelope.payload) : null;
  } catch (error) {
    deps.onProbeFailure?.("parse-retirement-receipt", error);
    return unavailable;
  }
  // This untrusted identity selects one existing row only. No mutation precedes authentication.
  if (!isRecord(payload) || typeof payload.runId !== "string" || !/^SUR-[A-Za-z0-9-]{1,100}$/.test(payload.runId)) return unavailable;
  const db = deps.db ?? prisma as unknown as EpochDb;
  const run = await db.selfUpgradeRun.findUnique({ where: { runId: payload.runId }, select: {
    runId: true, status: true, targetSha: true, deployedSha: true, startedAt: true, updatedAt: true, completionEvidence: true,
  } });
  if (!run || run.status !== "succeeded" || !run.targetSha || run.deployedSha !== run.targetSha
    || !run.startedAt || !isRecord(run.completionEvidence)) return unavailable;
  const evidence = run.completionEvidence;
  const recovery = readSuccessfulMaintenanceRecoveryPoint(evidence.recoveryPoint, run.runId);
  const readiness = isRecord(evidence.readiness) ? evidence.readiness : null;
  if (!recovery
    || readiness?.result !== "ready" || readiness.mode !== "enforced"
    || readiness.targetSha !== run.targetSha || typeof readiness.imageDigest !== "string") return unavailable;
  let secret: string;
  try {
    secret = await (deps.readSecret ?? (() => readFile("/dpf-state/runtime-transition.secret", "utf8")))();
  } catch (error) {
    deps.onProbeFailure?.("read-transition-secret", error);
    return unavailable;
  }
  let verified: { capturedAt: string };
  try {
    verified = verifyMaintenanceEpoch(envelope, secret.trim(), {
      runId: run.runId, targetSha: run.targetSha, promoterDigest: readiness.imageDigest,
      recoveryPointDigest: createHash("sha256").update(canonicalJson(recovery)).digest("hex"),
      now: (deps.now ?? new Date()).getTime(),
    });
  } catch (error) {
    deps.onProbeFailure?.("verify-maintenance-retirement", error);
    return unavailable;
  }
  const captured = Date.parse(verified.capturedAt), recovered = Date.parse(recovery.createdAt);
  if (!Number.isFinite(recovered) || recovered > captured || run.startedAt.getTime() > captured) return unavailable;
  const prior = evidence.maintenanceEpochRetirement;
  if (prior !== undefined) return canonicalJson(prior) === canonicalJson(envelope)
    ? { status: "replayed", runId: run.runId } : unavailable;
  const write = await db.selfUpgradeRun.updateMany({
    where: { runId: run.runId, updatedAt: run.updatedAt, status: run.status },
    data: { completionEvidence: { ...evidence, maintenanceEpochRetirement: envelope } },
  });
  return { status: write.count === 1 ? "attached" : "raced", runId: run.runId };
}
