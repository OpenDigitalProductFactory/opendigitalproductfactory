import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isPrincipalSensitivity } from "@dpf/db/principal-sensitivity";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/permissions";
import { offloadEvidenceOutput } from "@/lib/evidence/bounded-evidence-output";
import { revalidatePortalContext } from "@/lib/portal-context/invalidation";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { readWorkroomBoundaryClaim } from "./workroom-boundary-claim";
import { workroomBoundaryWriteWhere } from "./workroom-boundary-write.server";

const select = { id: true, capsuleId: true, scopeClaims: true, updatedAt: true } as const;
type Room = { id: string; capsuleId: string; scopeClaims: unknown; updatedAt: Date };
function digest(room: Room) {
  return createHash("sha256").update(canonicalJson({ scopeClaims: room.scopeClaims, updatedAt: room.updatedAt.toISOString() })).digest("hex");
}
function state(room: Room) {
  const value = readWorkroomBoundaryClaim(room.scopeClaims)?.sensitivityCeiling;
  return { capsuleId: room.capsuleId, digest: digest(room), classification: value && isPrincipalSensitivity(value) ? value : null,
    needsReview: Boolean(value && !isPrincipalSensitivity(value)) };
}
const refusal = (error: string, message: string): ToolResult => ({ success: false, error, message });
async function administrator(userId: string, db: Prisma.TransactionClient) {
  const user = await currentUserContext(userId, db);
  return Boolean(user && can(user, "manage_platform"));
}

/** Administrative state only: no title, content, membership or historical prose. */
export async function reviewWorkroomSensitivityTool(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  if (typeof params.capsuleId !== "string" || !params.capsuleId.startsWith("WC-")) return refusal("invalid_input", "A Workroom id is required.");
  return prisma.$transaction(async db => {
    if (!await administrator(userId, db)) return refusal("not_authorized", "Platform administration permission is required.");
    const room = await db.workroom.findUnique({ where: { capsuleId: params.capsuleId as string }, select });
    if (!room) return refusal("not_found", "The Workroom could not be found.");
    return { success: true, message: "Loaded classification review state; no room information was returned.", data: state(room) };
  });
}

/** Governed authority consequence; an approved exact call never confers room clearance. */
export async function correctWorkroomSensitivityTool(params: Record<string, unknown>, userId: string, context?: ToolExecutionContext): Promise<ToolResult> {
  if (context?.agentId && !context.approvedAuthorityEnvelopeId) {
    return refusal("classification_review_required", "An administrator must approve this exact classification correction.");
  }
  const { capsuleId, expectedDigest, sensitivity, classificationReviewed, rationale } = params;
  if (typeof capsuleId !== "string" || !capsuleId.startsWith("WC-") || typeof expectedDigest !== "string"
    || !/^[a-f0-9]{64}$/.test(expectedDigest) || typeof sensitivity !== "string" || !isPrincipalSensitivity(sensitivity)
    || classificationReviewed !== true || typeof rationale !== "string" || rationale.trim().length < 20 || rationale.length > 2000) {
    return refusal("invalid_input", "An exact review digest, verified classification and review rationale are required.");
  }
  const result = await prisma.$transaction(async db => {
    if (!await administrator(userId, db)) return refusal("not_authorized", "Platform administration permission is required.");
    const room = await db.workroom.findUnique({ where: { capsuleId }, select });
    if (!room) return refusal("not_found", "The Workroom could not be found.");
    if (digest(room) !== expectedDigest) return refusal("classification_changed", "The room changed; review its classification again.");
    if (!state(room).needsReview) return refusal("review_not_required", "This recovery corrects invalid declarations only.");
    const entries = Array.isArray(room.scopeClaims) ? room.scopeClaims : [room.scopeClaims];
    const index = entries.findIndex(entry => readWorkroomBoundaryClaim(entry) !== null);
    const original = entries[index] as { workroomBoundary: Record<string, unknown> };
    const next = [...entries];
    next[index] = { ...original, workroomBoundary: { ...original.workroomBoundary, sensitivityCeiling: sensitivity } };
    const changed = await db.workroom.updateMany({
      where: workroomBoundaryWriteWhere(room),
      data: { scopeClaims: next as Prisma.InputJsonValue },
    });
    if (changed.count !== 1) return refusal("classification_changed", "The room changed; review its classification again.");
    const payload = await offloadEvidenceOutput({ originalDeclarationJson: JSON.stringify(original), sensitivity,
      expectedDigest, classificationReviewed: true, rationale: rationale.trim(),
      approvedAuthorityEnvelopeId: context?.approvedAuthorityEnvelopeId ?? null });
    const audit = await db.workroomActivity.create({ data: { workCapsuleId: room.id, kind: "evidence-recorded",
      summary: "Administrator corrected an invalid sensitivity declaration after classification review.",
      payload: payload as Prisma.InputJsonValue, recordedById: userId, recordedByAgentId: context?.agentId ?? null } });
    return { success: true, message: "Corrected the reviewed declaration; original history and room access checks remain.",
      data: { capsuleId, classification: sensitivity, auditActivityId: audit.id } };
  });
  if (result.success) revalidatePortalContext();
  return result;
}
