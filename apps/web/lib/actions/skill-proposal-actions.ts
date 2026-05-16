"use server";

// Server-action surface for skill proposal review. The pure proposal lifecycle
// lives in `apps/web/lib/skills/proposals.ts`; this module wraps it with
// session-aware authentication checks so the UI can call from a "use client"
// component without leaking the user identity into client code.
//
// Capability check: only platform-role users with `manage_capabilities`
// authority may approve, reject, or roll back skills. (Submit is open per
// MCP convention — anyone can propose.)

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  approveSkillImprovementProposal as actionApprove,
  rejectSkillImprovementProposal as actionReject,
  rollbackSkillToRevision as actionRollback,
} from "@/lib/skills/proposals";

async function requireReviewer(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };
  const platformRole = session.user.platformRole ?? null;
  const userCtx = {
    userId: session.user.id,
    platformRole,
    isSuperuser: session.user.isSuperuser ?? false,
  };
  if (!can(userCtx, "manage_capabilities")) {
    return {
      ok: false,
      error:
        "manage_capabilities capability required to approve, reject, or roll back skill changes.",
    };
  }
  return { ok: true, userId: session.user.id };
}

export async function approveSkillProposalAction(
  proposalId: string,
): Promise<{ ok: true; data: Awaited<ReturnType<typeof actionApprove>> } | { ok: false; error: string }> {
  const auth = await requireReviewer();
  if (!auth.ok) return auth;
  try {
    const data = await actionApprove({ proposalId, reviewerId: auth.userId });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function rejectSkillProposalAction(
  proposalId: string,
  rejectionReason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireReviewer();
  if (!auth.ok) return auth;
  try {
    await actionReject({ proposalId, reviewerId: auth.userId, rejectionReason });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function rollbackSkillAction(
  skillId: string,
  targetVersion: number,
): Promise<{ ok: true; data: Awaited<ReturnType<typeof actionRollback>> } | { ok: false; error: string }> {
  const auth = await requireReviewer();
  if (!auth.ok) return auth;
  try {
    const data = await actionRollback({ skillId, targetVersion, reviewerId: auth.userId });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
