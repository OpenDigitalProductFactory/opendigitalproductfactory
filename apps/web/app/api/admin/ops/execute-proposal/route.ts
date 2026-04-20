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
  // Two auth paths:
  //  1. Superuser session (interactive admin)
  //  2. Shared-secret header `X-Ops-Token` matching HIVE_OPS_TOKEN env var
  //     (for recovery of stuck proposals when no session cookie is available,
  //     e.g. during autonomous operator runs). Header path requires the secret
  //     AND a `userId` field in the body naming which user to attribute the
  //     execution to — typically the original build creator.
  const opsToken = process.env.HIVE_OPS_TOKEN;
  const providedToken = req.headers.get("x-ops-token");
  const headerAuth = opsToken && providedToken && providedToken === opsToken;

  let actingUserId: string | null = null;
  let actingUserSuperuser = false;
  let actingUserPlatformRole: string | null = null;

  if (!headerAuth) {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.isSuperuser) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    actingUserId = session.user.id;
    actingUserSuperuser = session.user.isSuperuser;
    actingUserPlatformRole = session.user.platformRole;
  }

  const body = (await req.json().catch(() => ({}))) as { proposalId?: string; userId?: string };
  const proposalId = typeof body.proposalId === "string" ? body.proposalId : null;
  if (!proposalId) {
    return NextResponse.json({ error: "proposalId required" }, { status: 400 });
  }

  // Header-auth path: resolve userId from body, default to build creator
  if (headerAuth) {
    if (typeof body.userId !== "string") {
      // Fallback: resolve from the proposal's build creator
      const proposalLookup = await prisma.agentActionProposal.findUnique({
        where: { proposalId },
        select: { threadId: true },
      });
      if (!proposalLookup) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
      const build = await prisma.featureBuild.findFirst({
        where: { threadId: proposalLookup.threadId },
        select: { createdById: true },
      });
      if (!build?.createdById) {
        return NextResponse.json({ error: "Could not resolve userId for header-auth execution. Provide userId in body." }, { status: 400 });
      }
      actingUserId = build.createdById;
    } else {
      actingUserId = body.userId;
    }
    // Header-auth is a shared-secret bypass — the caller is already authorized
    // to execute ops tasks. We skip the per-user capability check below and
    // treat the acting user as having full platform role for audit purposes.
    const u = await prisma.user.findUnique({
      where: { id: actingUserId },
      select: { isSuperuser: true },
    });
    actingUserSuperuser = !!u?.isSuperuser;
    actingUserPlatformRole = "HR-000";
  }
  if (!actingUserId) {
    return NextResponse.json({ error: "Could not resolve acting user" }, { status: 500 });
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
    { platformRole: actingUserPlatformRole, isSuperuser: actingUserSuperuser },
    tool.requiredCapability,
  )) {
    return NextResponse.json({ error: "Insufficient capability for tool" }, { status: 403 });
  }

  await prisma.agentActionProposal.update({
    where: { proposalId },
    data: { status: "approved", decidedAt: new Date(), decidedById: actingUserId },
  });

  const result = await executeTool(
    proposal.actionType,
    proposal.parameters as Record<string, unknown>,
    actingUserId,
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
