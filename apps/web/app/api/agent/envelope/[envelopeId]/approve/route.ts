// Pseudo-User Contract (spec §6.4) — user-side envelope approval route.
//
// POST /api/agent/envelope/:envelopeId/approve
//
// Records the user's consent for a coworker-proposed destructive action.
// Validates auth, calls approveEnvelope (which enforces the delegating-user
// check and the state-machine invariants from BI-0F9C291C part 1), and
// returns the updated envelope row.
//
// Status flips from `proposed` to `approved`. The actual underlying-tool
// execution happens AFTER approval — kicked off either by the chat
// handler when it sees the envelope flip, or by the agent calling
// screen_dispatch_action (which lives in PR #1386 and will be refactored
// to call markEnvelopeExecuted / markEnvelopeFailed via envelope-actions
// once the chat handler integration lands in BI-DF6079E9 part 2). The
// approval audit row is committed BEFORE that side effect — see the
// design rationale on envelope-actions.ts.
//
// BI-0F9C291C / EP-COWORKER-INTERACTIVITY.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { runApprovedExternalRequest, runApprovedPlatformRequest } from "@/lib/coworker/approved-request-run";
import type { ApprovedRequestRun, PlatformRequestRun } from "@/lib/coworker/approved-request-run-types";
import { approveEnvelope } from "@/lib/coworker/envelope-actions";
import { recordApprovalOutcome } from "@/lib/coworker/approval-outcome-store";

type RouteContext = {
  params: Promise<{ envelopeId: string }>;
};

export const dynamic = "force-dynamic";

/** What is recorded for a platform run: a settled run is its recorded outcome (BI-C8EC05C9). */
function recordablePlatformRun(run: PlatformRequestRun): ApprovedRequestRun {
  if (run.status !== "settled") return run;
  return run.outcome === "executed"
    ? { status: "executed", message: run.message, ...(run.entityId ? { entityId: run.entityId } : {}) }
    : { status: "failed", message: run.message };
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { envelopeId } = await context.params;
  if (!envelopeId || typeof envelopeId !== "string") {
    return NextResponse.json({ error: "envelopeId required" }, { status: 400 });
  }

  const result = await approveEnvelope(envelopeId, session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.httpStatus });
  }

  // BI-12E5DD91: the approval completes the call it approved. A direct MCP
  // call runs here, once, through the governed executor; a call parked inside
  // an external task resumes that task (BI-9FD11E5E). The approval itself is
  // already recorded, so a run that cannot happen is reported, never an error.
  // BI-C8EC05C9: a call the platform parked for itself (its park row carries
  // the approval-resume marker) is checked FIRST, because a converted
  // scheduled request has a TaskRun and is not an external task to resume.
  // Without the marker this falls through to the external path unchanged.
  const execution = await runApprovedPlatformRequest(envelopeId).then(
    (platform) => (platform ? recordablePlatformRun(platform) : runApprovedExternalRequest(envelopeId)),
  ).catch((error: unknown) => ({
    status: "failed" as const,
    message: error instanceof Error ? error.message : "The approved action could not be run.",
  }));
  const response = { ok: true, envelope: result.envelope, execution };
  try {
    await recordApprovalOutcome(envelopeId, session.user.id, execution);
  } catch {
    // Approval/execution may already have happened. Never return an ordinary
    // retryable decision error that invites another authorization attempt.
    return NextResponse.json({ ...response,
      outcomeWarning: "The decision was saved, but its result could not be saved. Do not approve again; your assistant must check the target before retrying.",
    });
  }
  return NextResponse.json(response);
}
