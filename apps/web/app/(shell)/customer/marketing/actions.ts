"use server";

// Server actions for the marketing approval queue.
// Reference plan: docs/superpowers/plans/2026-05-26-marketing-execution-loop-phase-1.md

import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  assertDraftTransition,
  draftStatusForDecision,
  type OutboundApprovalDecisionValue,
  type OutboundDraftStatus,
} from "@/lib/marketing/execution";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { guardDraftArchetypeFit } from "@/lib/marketing/fit-guard";

type ActionResult =
  | { ok: true; draftId: string; status: OutboundDraftStatus }
  | { ok: false; error: string };

async function requireOperator(): Promise<{ userId: string } | { error: string }> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { error: "Unauthorized" };
  const ctx = { platformRole: user.platformRole ?? null, isSuperuser: user.isSuperuser ?? false };
  if (!can(ctx, "operate_marketing")) return { error: "Insufficient capability: operate_marketing" };
  return { userId: user.id };
}

async function decideOnDraft(
  draftId: string,
  decision: OutboundApprovalDecisionValue,
  editedBody: string | null,
  notes: string | null,
  reviewerUserId: string,
): Promise<ActionResult> {
  const draft = await prisma.outboundDraft.findUnique({
    where: { draftId },
    select: { draftId: true, status: true },
  });
  if (!draft) return { ok: false, error: "Draft not found" };

  const currentStatus = draft.status as OutboundDraftStatus;
  const nextStatus = draftStatusForDecision(decision);
  try {
    assertDraftTransition(currentStatus, nextStatus);
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }

  await prisma.$transaction([
    prisma.outboundApprovalDecision.create({
      data: {
        draftId,
        reviewerUserId,
        decision,
        editedBody: editedBody && editedBody.trim().length > 0 ? editedBody : null,
        notes: notes && notes.trim().length > 0 ? notes : null,
      },
    }),
    prisma.outboundDraft.update({
      where: { draftId },
      data: { status: nextStatus },
    }),
  ]);

  revalidatePath("/customer/marketing");
  return { ok: true, draftId, status: nextStatus };
}

export async function approveOutboundDraftAction(
  draftId: string,
  editedBody?: string,
  notes?: string,
): Promise<ActionResult> {
  const auth = await requireOperator();
  if ("error" in auth) return { ok: false, error: auth.error };

  // Archetype-fit guard: never approve software-platform / off-archetype-block
  // copy for a real audience. Checks the operator's edited body when provided,
  // since they may have fixed the leak before approving.
  const fit = await guardDraftArchetypeFit({ draftId, contentOverride: editedBody ?? null });
  if (fit && !fit.ok) return { ok: false, error: fit.error };

  return decideOnDraft(draftId, "approved", editedBody ?? null, notes ?? null, auth.userId);
}

export async function requestChangesOnDraftAction(
  draftId: string,
  notes: string,
): Promise<ActionResult> {
  const auth = await requireOperator();
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!notes || notes.trim().length === 0) {
    return { ok: false, error: "Notes are required when requesting changes" };
  }
  return decideOnDraft(draftId, "needs-changes", null, notes, auth.userId);
}

export async function rejectOutboundDraftAction(
  draftId: string,
  notes?: string,
): Promise<ActionResult> {
  const auth = await requireOperator();
  if ("error" in auth) return { ok: false, error: auth.error };
  return decideOnDraft(draftId, "rejected", null, notes ?? null, auth.userId);
}

export async function draftMarketingAssetAction(
  assetTaskId: string,
  toneNotes?: string,
): Promise<
  | { ok: true; draftId: string; wordCount: number }
  | { ok: false; error: string }
> {
  const auth = await requireOperator();
  if ("error" in auth) return { ok: false, error: auth.error };

  const { draftMarketingAsset } = await import("@/lib/marketing/draft-builder");
  const result = await draftMarketingAsset({
    assetTaskId,
    toneNotes,
    createdByAgentId: "marketing-specialist",
  });

  if (!result.success) return { ok: false, error: result.error };

  revalidatePath("/customer/marketing");
  return { ok: true, draftId: result.draftId, wordCount: result.wordCount };
}

export async function publishOutboundDraftAction(
  draftId: string,
): Promise<
  | { ok: true; publicationId: string; externalUrl: string | null }
  | { ok: false; error: string }
> {
  const auth = await requireOperator();
  if ("error" in auth) return { ok: false, error: auth.error };

  const { publishApprovedDraft } = await import("@/lib/marketing/publish");
  const result = await publishApprovedDraft({
    draftId,
    publishedByUserId: auth.userId,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/customer/marketing");
  return {
    ok: true,
    publicationId: result.publicationId,
    externalUrl: result.externalUrl,
  };
}
