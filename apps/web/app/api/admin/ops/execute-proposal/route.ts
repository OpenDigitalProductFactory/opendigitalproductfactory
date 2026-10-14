// Superuser-only: force-execute a pending AgentActionProposal through the same
// convert-and-run core approveProposal uses (lib/actions/proposal-convert-and-run.ts).
// It exists for operational recovery when an autonomous run emitted a
// proposal-mode tool call that has no interactive UI to approve it.
//
// Approval convergence PR-C (BI-04E5A511, spec D5/D6): the call runs through
// the reference monitor, never a direct executeTool, so the proposal's own
// coworker grants, room, hooks and audit apply exactly as for any coworker
// call; a refusal leaves the proposal `proposed`. The route keeps its own
// { ok, result } response and status codes and writes no system message or
// decision log of its own. The shared-secret X-Ops-Token path, which acted as
// a resolved user with a synthetic role, is removed (waiver W3, WWMD
// DI-587137D2BB72): a superuser session is the only way in.

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { NextResponse } from "next/server";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { can } from "@/lib/permissions";
import { convertAndRunProposal } from "@/lib/actions/proposal-convert-and-run";

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.isSuperuser) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const actingUserId = session.user.id;
  const userContext = { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser };

  const body = (await req.json().catch(() => ({}))) as { proposalId?: string };
  const proposalId = typeof body.proposalId === "string" ? body.proposalId : null;
  if (!proposalId) {
    return NextResponse.json({ error: "proposalId required" }, { status: 400 });
  }

  const proposal = await prisma.agentActionProposal.findUnique({ where: { proposalId } });
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }
  if (proposal.status !== "proposed") {
    return NextResponse.json({ error: `Proposal already ${proposal.status}` }, { status: 409 });
  }

  const tool = PLATFORM_TOOLS.find((t) => t.name === proposal.actionType);
  if (tool?.requiredCapability && !can(userContext, tool.requiredCapability)) {
    return NextResponse.json({ error: "Insufficient capability for tool" }, { status: 403 });
  }

  const outcome = await convertAndRunProposal(
    proposal,
    { userId: actingUserId, userContext },
    { threadRecord: false },
  );
  if (outcome.kind === "already-decided") {
    // Another decision won the compare-and-set between the read above and now.
    return NextResponse.json({ error: "Proposal already decided" }, { status: 409 });
  }
  return NextResponse.json({ ok: outcome.kind === "ran" && outcome.result.success, result: outcome.result });
}
