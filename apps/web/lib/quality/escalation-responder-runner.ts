// Wires the autonomous escalation-responder sweep (BI-0ACD9AB2 §14 dial-up) with
// prisma, a real bootstrap-owner principal, and the server-callable kernel
// consult. Called by the 15-minute issue-report-triage cron. Advisory only — it
// pre-computes the WWMD recommendation so the /ops attention lens shows it
// without an operator click; it never disposes of the build.

import { prisma } from "@dpf/db";
import { resolveScheduledOwnerUserId } from "@/lib/queue/scheduled-owner";
import { evaluateBuildStudioDecision } from "@/lib/build/decision-service";
import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";
import { runEscalationResponderSweep } from "@/lib/quality/escalation-responder";

const SWEEP_BATCH = 10;

export async function runEscalationResponder(): Promise<{ consulted: number; failed: number }> {
  // Resolve a REAL principal (the oldest active superuser, the bootstrap install
  // owner) — never the banned "system" sentinel. This is the sanctioned pattern
  // for autonomous platform work on the owner's behalf (scheduled-owner.ts).
  const ownerUserId = await resolveScheduledOwnerUserId();

  return runEscalationResponderSweep({
    getCandidates: async () =>
      prisma.platformIssueReport.findMany({
        where: {
          status: ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK,
          responderDecidedAt: null,
        },
        orderBy: { createdAt: "asc" },
        take: SWEEP_BATCH,
        select: {
          reportId: true,
          title: true,
          description: true,
          selfFixClass: true,
          featureBuildId: true,
        },
      }),

    consult: (request) => evaluateBuildStudioDecision({ userId: ownerUserId, request }),

    store: async (reportId, decision) => {
      await prisma.platformIssueReport.update({
        where: { reportId },
        data: {
          // A named type lacks the index signature Prisma's JSON input wants; the
          // codebase's canonical cast (see tests/build-lifecycle.test.ts).
          responderDecision: decision as unknown as import("@dpf/db").Prisma.InputJsonValue,
          responderDecidedAt: new Date(),
        },
      });
    },
  });
}
