// apps/web/lib/release-health/runner.ts
// BI-3630773C — release verification health check runner.
//
// One poll: read the latest stamp from GitHub, persist it, and keep the
// operator notification in sync. The founding incident: the v6.0.0 stamp's
// verify gate failed on 2026-06-08 and sat unnoticed in the GitHub CI
// dashboard for two days — masking an installer-breaking bug — until the
// v6.1.0 stamp hit the same wall. A red verify gate means a
// published-but-unverified release; that must reach the operator without
// them watching CI.
//
// Notification lifecycle (mirrors contributor-inventory-sync):
//   - red stamp (verify-failed / publish-failed) → one PlatformNotification
//     per run id (notifiedRunId in state dedupes across polls).
//   - a later stamp verifying green → resolve all open release-verification
//     notifications. An in-progress re-stamp does NOT resolve — the failed
//     release stays alerted until a green verify actually lands.

import {
  readLatestReleaseStamp,
  type ReleaseRunsDeps,
  type ReleaseStampSnapshot,
} from "./release-runs-reader";
import { loadReleaseHealthState, saveReleaseHealthState } from "./state";

export const RELEASE_VERIFICATION_NOTIFICATION_CATEGORY = "release-verification";

export type ReleaseHealthCheckResult =
  | {
      ok: true;
      snapshot: ReleaseStampSnapshot | null;
      notificationCreated: boolean;
      notificationsResolved: number;
    }
  | { ok: false; error: string };

export async function runReleaseHealthCheck(
  deps: ReleaseRunsDeps & { now?: Date } = {},
): Promise<ReleaseHealthCheckResult> {
  const now = deps.now ?? new Date();

  const read = await readLatestReleaseStamp(deps);
  if (!read.ok) {
    // Offline / rate-limited / API error: keep the previous state untouched
    // (the card keeps showing the last known truth) and retry next tick.
    return { ok: false, error: read.error };
  }

  const prior = await loadReleaseHealthState();
  const snapshot = read.latest;
  const verifiedTarget =
    snapshot?.status === "verified" &&
    snapshot.runConclusion === "success" &&
    prior?.snapshot?.status === "verified" &&
    prior.snapshot.runConclusion === "success" &&
    prior.snapshot.runId === snapshot.runId &&
    prior.snapshot.tag === snapshot.tag &&
    prior.snapshot.headSha === snapshot.headSha
      ? (prior.verifiedTarget ?? null)
      : null;

  let notificationCreated = false;
  let notificationsResolved = 0;

  const isRed =
    snapshot !== null &&
    (snapshot.status === "verify-failed" || snapshot.status === "publish-failed");

  if (isRed && prior?.notifiedRunId !== snapshot.runId) {
    await createRedStampNotification(snapshot);
    notificationCreated = true;
  } else if (snapshot?.status === "verified") {
    notificationsResolved = await resolveOpenNotifications(now);
  }

  await saveReleaseHealthState({
    snapshot,
    checkedAt: now.toISOString(),
    notifiedRunId: isRed ? snapshot.runId : (prior?.notifiedRunId ?? null),
    verifiedTarget,
  });

  return { ok: true, snapshot, notificationCreated, notificationsResolved };
}

async function createRedStampNotification(
  snapshot: ReleaseStampSnapshot,
): Promise<void> {
  const { prisma } = await import("@dpf/db");
  // verify-failed is the silent-bad-release case (images are live but
  // unverified) — critical. publish-failed means the stamp itself broke and
  // nothing new shipped — warning.
  const severity = snapshot.status === "verify-failed" ? "critical" : "warning";
  const message =
    snapshot.status === "verify-failed"
      ? `Release ${snapshot.tag} published but its install verification FAILED — the release is live and unverified. Run: ${snapshot.runUrl}`
      : `Release stamp ${snapshot.tag} failed before publishing completed. Run: ${snapshot.runUrl}`;
  await prisma.platformNotification.create({
    data: {
      severity,
      category: RELEASE_VERIFICATION_NOTIFICATION_CATEGORY,
      subjectId: snapshot.tag,
      message,
    },
  });
}

async function resolveOpenNotifications(now: Date): Promise<number> {
  const { prisma } = await import("@dpf/db");
  const result = await prisma.platformNotification.updateMany({
    where: {
      category: RELEASE_VERIFICATION_NOTIFICATION_CATEGORY,
      resolvedAt: null,
    },
    data: { resolvedAt: now },
  });
  return result.count;
}
