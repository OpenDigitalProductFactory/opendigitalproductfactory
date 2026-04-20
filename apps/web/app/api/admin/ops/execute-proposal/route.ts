// Superuser-only: force-execute a pending AgentActionProposal via the same
// code path approveProposal uses. This exists for operational recovery when
// an autonomous build cycle emits a proposal-mode tool call that has no
// interactive UI to approve it (e.g. the overnight autonomous E2E mission
// emitting contribute_to_hive under contributionMode=contribute_all).
//
// In normal interactive builds, users click Approve in the coworker panel
// and this endpoint is unused. The tool-definition-level `autoApproveWhen`
// predicate (see contribute_to_hive in mcp-tools.ts) eliminates the need for
// this endpoint on new runs; it remains for draining proposals that were
// created BEFORE that predicate landed.

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { NextResponse } from "next/server";
import { PLATFORM_TOOLS, executeTool } from "@/lib/mcp-tools";
import { can } from "@/lib/permissions";

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.isSuperuser) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
  if (tool?.requiredCapability && !can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    tool.requiredCapability,
  )) {
    return NextResponse.json({ error: "Insufficient capability for tool" }, { status: 403 });
  }

  await prisma.agentActionProposal.update({
    where: { proposalId },
    data: { status: "approved", decidedAt: new Date(), decidedById: session.user.id },
  });

  const result = await executeTool(
    proposal.actionType,
    proposal.parameters as Record<string, unknown>,
    session.user.id,
    { agentId: proposal.agentId, threadId: proposal.threadId },
  );

  await prisma.agentActionProposal.update({
    where: { proposalId },
    data: result.success
      ? {
          status: "executed",
          executedAt: new Date(),
          ...(result.entityId !== undefined ? { resultEntityId: result.entityId } : {}),
        }
      : {
          status: "failed",
          ...(result.error !== undefined ? { resultError: result.error } : {}),
        },
  });

  return NextResponse.json({ ok: result.success, result });
}
