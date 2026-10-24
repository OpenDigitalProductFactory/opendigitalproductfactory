// Cross-install operational control plane · Slice 2 Increment 2 (BI-648F01A0).
//
// Capture THIS install's operational posture as the projectable source the
// minimized `operational-posture` record is built from. Every value here is a
// SUMMARY read off the substrate the operator already sees locally — the served
// version (`loadPlatformVersion`), the patch-posture severity totals
// (`getPatchPosture`), the runtime-target registry, and the canonical estate
// size. Nothing host-identifying is returned; the projection template and the
// contract validator then enforce that again on the way out.
//
// DB-injected so the capture runs under unit test with a mock store.

import { INVENTORY_ENTITY_CANONICAL_WHERE } from "@dpf/db/inventory-entity-lifecycle";
import type {
  PostureHealthStatus,
  PostureRuntimeSummaryV1,
} from "@dpf/db/federated-operational-posture-contract";

import { getPatchPosture, type PatchPostureDb } from "@/lib/patch/patch-posture";
import { loadPlatformVersion, type PlatformVersion } from "@/lib/platform/version";
import type { RuntimeTargetStatus } from "@/lib/runtime-coordination/types";

import type { ProjectableOperationalPostureSource } from "./operational-posture-projection";

/** A runtime target that is serving, or being verified on, counts as healthy. */
const HEALTHY_RUNTIME_STATUSES: ReadonlySet<RuntimeTargetStatus> = new Set([
  "running",
  "verifying",
  "verified",
]);

/** Terminal targets are not part of the live footprint at all. */
const RETIRED_RUNTIME_STATUSES: ReadonlySet<RuntimeTargetStatus> = new Set([
  "released",
  "expired",
]);

export interface OperationalPostureCaptureDb extends PatchPostureDb {
  runtimeTarget: {
    findMany(args: unknown): Promise<Array<{ status: string }>>;
  };
  inventoryEntity: {
    count(args: unknown): Promise<number>;
  };
}

export interface OperationalPostureCaptureDeps {
  loadVersion?: () => Promise<PlatformVersion>;
  now?: Date;
}

/** The sha this install serves, in preference order: git sha, image marker,
 *  source content hash. `unknown` only when no identity was baked in at all. */
export function servedShaFromVersion(version: PlatformVersion): string {
  return version.gitSha
    ?? version.imageVersion?.raw
    ?? version.sourceContentHash
    ?? "unknown";
}

export function summarizeRuntimeTargets(targets: Array<{ status: string }>): PostureRuntimeSummaryV1 {
  const live = targets.filter((target) => !RETIRED_RUNTIME_STATUSES.has(target.status as RuntimeTargetStatus));
  const healthy = live.filter((target) => HEALTHY_RUNTIME_STATUSES.has(target.status as RuntimeTargetStatus));
  return { targetCount: live.length, healthyCount: healthy.length };
}

/** Self-reported band. `offline` is never self-reported — only a receiver that
 *  stops hearing from us can honestly say that (Slice 3 ages the record). */
export function deriveHealthStatus(input: {
  criticalFindings: number;
  runtime: PostureRuntimeSummaryV1;
}): PostureHealthStatus {
  if (input.criticalFindings > 0) return "degraded";
  if (input.runtime.healthyCount < input.runtime.targetCount) return "degraded";
  return "healthy";
}

export async function captureLocalOperationalPosture(
  db: OperationalPostureCaptureDb,
  deps: OperationalPostureCaptureDeps = {},
): Promise<ProjectableOperationalPostureSource> {
  const now = deps.now ?? new Date();
  const [version, patch, targets, estateItemCount] = await Promise.all([
    (deps.loadVersion ?? loadPlatformVersion)(),
    // The open set is bounded by the daily sweep; a high limit keeps the
    // severity totals honest without loading the finding rows into the record.
    getPatchPosture(db, { status: "open", limit: 5_000 }),
    db.runtimeTarget.findMany({ select: { status: true } }),
    db.inventoryEntity.count({ where: INVENTORY_ENTITY_CANONICAL_WHERE }),
  ]);
  const bySeverity = patch.totals.bySeverity;
  const patchPosture = {
    critical: bySeverity.critical ?? 0,
    high: bySeverity.high ?? 0,
    medium: bySeverity.medium ?? 0,
    low: bySeverity.low ?? 0,
  };
  const runtime = summarizeRuntimeTargets(targets);
  return {
    servedVersion: version.version,
    servedSha: servedShaFromVersion(version),
    patchPosture,
    health: {
      status: deriveHealthStatus({ criticalFindings: patchPosture.critical, runtime }),
      estateItemCount,
    },
    runtime,
    capturedAt: now,
    updatedAt: now,
  };
}
