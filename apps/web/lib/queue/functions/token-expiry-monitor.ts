// apps/web/lib/queue/functions/token-expiry-monitor.ts
// Phase 6 of the 2026-04-24 GitHub auth 2FA readiness spec.
//
// Daily scheduled scan over CredentialEntry rows that carry a known
// `tokenExpiresAt` timestamp. For each, compute days-until-expiry, map to a
// severity tier, and upsert a `PlatformNotification` row keyed on
// (category="token-expiry", subjectId=providerId).
//
// Severity tiers
//   > 30 days       → no notification (resolve any prior open one)
//   <= 30 && > 14   → info
//   <= 14 && >  7   → warning
//   <=  7 && >  0   → critical
//   <=  0           → expired
//
// Idempotency
//   - Same severity as the existing open notification → no-op (no new row).
//   - Different severity → resolve the old (set resolvedAt=now) AND create
//     a fresh row at the new severity.
//
// Note on tiers
//   Tier 1 (Device Flow OAuth-app tokens) have no expiry and are never
//   recorded with tokenExpiresAt; the query simply skips them. Tier 3
//   (classic PATs) usually have no expiry. Only Tier 2 (fine-grained PAT
//   with the `github-authentication-token-expiration` header captured by
//   `validateGitHubToken`, Phase 3) populates tokenExpiresAt and so is the
//   only tier this monitor actually fires on.

import { cron } from "inngest";
import { inngest } from "../inngest-client";

type Severity = "info" | "warning" | "critical" | "expired";

interface SeverityDecision {
  severity: Severity | null;
  daysUntilExpiry: number;
}

export function classifyExpiry(now: Date, expiresAt: Date): SeverityDecision {
  const daysUntilExpiry = Math.floor(
    (expiresAt.getTime() - now.getTime()) / 86_400_000,
  );
  if (daysUntilExpiry > 30) return { severity: null, daysUntilExpiry };
  if (daysUntilExpiry > 14) return { severity: "info", daysUntilExpiry };
  if (daysUntilExpiry > 7) return { severity: "warning", daysUntilExpiry };
  if (daysUntilExpiry > 0) return { severity: "critical", daysUntilExpiry };
  return { severity: "expired", daysUntilExpiry };
}

export function buildMessage(severity: Severity, daysUntilExpiry: number): string {
  switch (severity) {
    case "info":
      return `Your GitHub token expires in ${daysUntilExpiry} days. Reconnect ahead of expiry.`;
    case "warning":
      return `Your GitHub token expires in ${daysUntilExpiry} days. Reconnect soon.`;
    case "critical":
      return `Your GitHub token expires in ${daysUntilExpiry} days. Reconnect now to avoid disruption.`;
    case "expired":
      return "Your GitHub token has expired. Reconnect to resume contributing.";
  }
}

/**
 * The actual scan logic, exported separately so unit tests can drive it
 * without going through the Inngest harness. The Inngest function below is
 * a thin wrapper that calls this inside `step.run`.
 */
export async function runTokenExpiryScan(): Promise<{
  scanned: number;
  notificationsCreated: number;
  notificationsResolved: number;
}> {
  const { prisma } = await import("@dpf/db");
  const now = new Date();

  const credentials = await prisma.credentialEntry.findMany({
    where: {
      tokenExpiresAt: { not: null },
      status: "active",
    },
    select: {
      providerId: true,
      tokenExpiresAt: true,
      status: true,
    },
  });

  let notificationsCreated = 0;
  let notificationsResolved = 0;

  for (const cred of credentials) {
    if (!cred.tokenExpiresAt) continue;

    const decision = classifyExpiry(now, cred.tokenExpiresAt);

    // Above the 30-day window — make sure no stale open notification lingers.
    if (decision.severity === null) {
      const result = await prisma.platformNotification.updateMany({
        where: {
          category: "token-expiry",
          subjectId: cred.providerId,
          resolvedAt: null,
        },
        data: { resolvedAt: now },
      });
      notificationsResolved += result.count;
      continue;
    }

    // Within an alert tier — look for an existing open notification.
    const existing = await prisma.platformNotification.findFirst({
      where: {
        category: "token-expiry",
        subjectId: cred.providerId,
        resolvedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing && existing.severity === decision.severity) {
      // Same tier as last time — no-op (idempotent).
      continue;
    }

    if (existing) {
      // Different tier — resolve the old open notification(s) for this subject.
      const result = await prisma.platformNotification.updateMany({
        where: {
          category: "token-expiry",
          subjectId: cred.providerId,
          resolvedAt: null,
        },
        data: { resolvedAt: now },
      });
      notificationsResolved += result.count;
    }

    await prisma.platformNotification.create({
      data: {
        severity: decision.severity,
        category: "token-expiry",
        subjectId: cred.providerId,
        message: buildMessage(decision.severity, decision.daysUntilExpiry),
      },
    });
    notificationsCreated += 1;
  }

  return {
    scanned: credentials.length,
    notificationsCreated,
    notificationsResolved,
  };
}

export const tokenExpiryMonitor = inngest.createFunction(
  { id: "ops/token-expiry-monitor", retries: 2, triggers: [cron("0 9 * * *")] },
  async ({ step }) => {
    return await step.run("scan-token-expiry", async () => runTokenExpiryScan());
  },
);
