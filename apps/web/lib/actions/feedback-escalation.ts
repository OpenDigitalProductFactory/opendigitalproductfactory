/**
 * Feedback Escalation — the user-facing "Report to the project team" action
 * (BI-6D45BA27, spec 2026-06-06). Wraps the transport/bridge; it is NOT a
 * second GitHub writer. Gated on locally-recorded opt-in consent, the master
 * pause, and contribution mode. Works on installs with no frontier model and
 * no GitHub token (relay path).
 */
"use server";

import { createHash } from "node:crypto";
import { prisma } from "@dpf/db";
import { requireCapability, requireUserId } from "@/lib/actions/shared/guards";
import { getDisplayPseudonym, resolveHiveToken } from "@/lib/build/identity-privacy";
import { loadSource } from "@/lib/build/issue-bridge";
import { buildRedactedFeedbackPayload, selectTransport } from "@/lib/build/feedback-transport";

// Per-install escalation caps (counted from the contribution ledger).
const RATE_LIMIT_MINUTE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_HOUR_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_PER_MINUTE = 5;
const RATE_LIMIT_PER_HOUR = 30;

const LEDGER_TYPE = "feedback";

export type FileUpstreamFeedbackResult =
  | { ok: true; status: "filed"; issueNumber: number | null; url: string }
  | { ok: true; status: "already-filed"; issueNumber: number; url: string | null }
  | { ok: false; status: "blocked" | "skipped" | "failed" | "rate-limited"; reason: string };

async function requireManagePlatformUserId(): Promise<string> {
  return (await requireCapability("manage_platform")).userId;
}

async function enforceEscalationRateLimit(contributor: string): Promise<boolean> {
  const now = Date.now();
  const [inMinute, inHour] = await Promise.all([
    prisma.hiveContributionLedger.count({
      where: {
        contributionType: LEDGER_TYPE,
        contributor,
        createdAt: { gte: new Date(now - RATE_LIMIT_MINUTE_WINDOW_MS) },
      },
    }),
    prisma.hiveContributionLedger.count({
      where: {
        contributionType: LEDGER_TYPE,
        contributor,
        createdAt: { gte: new Date(now - RATE_LIMIT_HOUR_WINDOW_MS) },
      },
    }),
  ]);
  return inMinute < RATE_LIMIT_PER_MINUTE && inHour < RATE_LIMIT_PER_HOUR;
}

/**
 * Server action: escalate a captured report to the upstream project team.
 * Requires an authenticated session; delegates to the auth-free core so the
 * coworker MCP tool (`escalate_feedback_upstream`) can share the same logic.
 * Idempotent: a report already linked to an upstream issue returns
 * `already-filed` without re-posting.
 */
export async function fileUpstreamFeedback(input: {
  reportId: string;
}): Promise<FileUpstreamFeedbackResult> {
  await requireUserId();
  return escalateReportUpstream(input);
}

/**
 * Auth-free escalation core. Callers MUST authorize first (the server action
 * checks the session; the MCP handler runs under an authenticated coworker
 * userId). No personal identity is used downstream — the upstream issue is
 * authored under the install pseudonym.
 */
export async function escalateReportUpstream(input: {
  reportId: string;
}): Promise<FileUpstreamFeedbackResult> {
  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: {
      upstreamFeedbackOptIn: true,
      hiveContributionsPaused: true,
      contributionMode: true,
      upstreamRelayUrl: true,
    },
  });

  if (!config?.upstreamFeedbackOptIn) {
    return { ok: false, status: "blocked", reason: "Upstream feedback is off. Turn it on to send reports to the project team." };
  }
  if (config.hiveContributionsPaused) {
    return { ok: false, status: "blocked", reason: "Hive contributions are paused." };
  }
  if (config.contributionMode === "private" || config.contributionMode === "fork_only") {
    return { ok: false, status: "blocked", reason: "This install keeps everything on your own system (private)." };
  }

  const report = await prisma.platformIssueReport.findUnique({
    where: { reportId: input.reportId },
    select: { id: true, upstreamIssueNumber: true, upstreamIssueUrl: true },
  });
  if (!report) {
    return { ok: false, status: "failed", reason: `Report ${input.reportId} not found.` };
  }
  if (report.upstreamIssueNumber != null) {
    return { ok: true, status: "already-filed", issueNumber: report.upstreamIssueNumber, url: report.upstreamIssueUrl };
  }

  const pseudonym = await getDisplayPseudonym();

  if (!(await enforceEscalationRateLimit(pseudonym))) {
    return { ok: false, status: "rate-limited", reason: "Too many reports sent recently. Try again shortly." };
  }

  const source = await loadSource("issue-report", report.id);
  if (!source) {
    return { ok: false, status: "failed", reason: `Report ${input.reportId} could not be loaded.` };
  }

  const payload = buildRedactedFeedbackPayload({ source, pseudonym });
  const hasToken = (await resolveHiveToken()) != null;
  const transport = selectTransport({ upstreamRelayUrl: config.upstreamRelayUrl, hasToken });

  const result = await transport.file(payload, { reportRowId: report.id });
  if (result.status === "skipped") {
    return { ok: false, status: "skipped", reason: result.reason };
  }
  if (result.status === "failed") {
    return { ok: false, status: "failed", reason: result.error };
  }

  // Persist the upstream link for the relay path. Guarded on null so the direct
  // bridge path (which persists internally) is never overwritten.
  await prisma.platformIssueReport.updateMany({
    where: { id: report.id, upstreamIssueNumber: null },
    data: {
      upstreamIssueNumber: result.issueNumber,
      upstreamIssueUrl: result.url,
      upstreamSyncedAt: new Date(),
    },
  });

  await prisma.hiveContributionLedger.create({
    data: {
      contributionType: LEDGER_TYPE,
      contributor: pseudonym,
      summary: `Feedback escalated upstream: ${payload.localRef} → ${result.url}`,
      payloadHash: createHash("sha256").update(payload.body).digest("hex"),
      status: "submitted",
      redactionStatus: "redacted",
    },
  });

  return { ok: true, status: "filed", issueNumber: result.issueNumber, url: result.url };
}

export type UpstreamFeedbackConsent = {
  optIn: boolean;
  relayConfigured: boolean;
  forkOnly: boolean;
  paused: boolean;
};

/** Read the current upstream-feedback consent + availability for the UI/coworker. */
export async function getUpstreamFeedbackConsent(): Promise<UpstreamFeedbackConsent> {
  await requireUserId();
  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: {
      upstreamFeedbackOptIn: true,
      upstreamRelayUrl: true,
      contributionMode: true,
      hiveContributionsPaused: true,
    },
  });
  return {
    optIn: config?.upstreamFeedbackOptIn ?? false,
    relayConfigured: Boolean(config?.upstreamRelayUrl),
    // `forkOnly` retains its name for back-compat with consumers; true when the
    // install is private (legacy "fork_only" included).
    forkOnly: config?.contributionMode === "private" || config?.contributionMode === "fork_only",
    paused: config?.hiveContributionsPaused ?? false,
  };
}

/** Record (or revoke) upstream-feedback opt-in consent locally. */
export async function setUpstreamFeedbackOptIn(input: {
  enabled: boolean;
}): Promise<{ ok: true; optIn: boolean }> {
  const userId = await requireManagePlatformUserId();
  await prisma.platformDevConfig.update({
    where: { id: "singleton" },
    data: {
      upstreamFeedbackOptIn: input.enabled,
      upstreamFeedbackOptInAt: input.enabled ? new Date() : null,
      upstreamFeedbackOptInById: input.enabled ? userId : null,
    },
  });
  return { ok: true, optIn: input.enabled };
}
