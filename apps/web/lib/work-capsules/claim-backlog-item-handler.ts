import type { ToolResult } from "@/lib/mcp-tools";
import { deriveDeliverableSensitivity } from "@/lib/explore/build-process-matrix";
import { WORK_INTENTS, type WorkIntent } from "@/lib/work-capsules";
import {
  DELIVERY_SHAPE_PICK_LIST,
  buildDeliveryShapeClaim,
  resolveDeliveryShape,
  type DeliveryShapeResolution,
} from "@/lib/work-management/derive-delivery-shape";
import { ensureCapsuleWorkItemAnchorWithPrisma } from "@/lib/work-capsules/capsule-workitem-anchor.server";

import { providerToExecutorKind } from "./external-session-capture";
import { claimGovernedBacklogWorkspace } from "./governed-work-claim";
import { branchOccupiedResult } from "./mcp-result-errors";
import { defaultPlatformRepositoryFullName } from "./work-capsule-branch-identity";
import { BacklogItemAlreadyClaimedError } from "./backlog-workroom-ownership";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

type ToolContext = { agentId?: string; threadId?: string; taskRunId?: string; routeContext?: string } | undefined;

function stringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Executors with nobody at the keyboard: a refusal to them must raise attention, not wait for an answer. */
const UNATTENDED_EXECUTORS = new Set(["build-studio", "dpf-native", "git-webhook"]);

/**
 * Design §3.3: declared → derived → refused with the pick list. The shape is
 * required before implementation; design, review and plan intents record a
 * derived shape when the rules agree and otherwise proceed unshaped.
 */
async function resolveClaimShape(args: {
  db: CapsuleDb;
  itemId: string;
  declared: string | null;
  workIntent: WorkIntent;
}): Promise<{ resolution: DeliveryShapeResolution | null; refusal: ToolResult | null }> {
  const item = args.db.backlogItem
    ? await args.db.backlogItem.findFirst({
      where: { OR: [{ itemId: args.itemId }, { id: args.itemId }] },
      select: { effortSize: true, workType: true, title: true, body: true },
    }) as { effortSize?: string | null; workType?: string | null; title?: string | null; body?: string | null } | null
    : null;
  const signals = {
    effortSize: item?.effortSize ?? null,
    workType: item?.workType ?? null,
    sensitivity: deriveDeliverableSensitivity({ text: `${item?.title ?? ""}\n${item?.body ?? ""}`, workType: item?.workType ?? null }),
  };
  const resolution = resolveDeliveryShape({ declared: args.declared, signals });
  if (resolution.kind === "invalid") {
    return { resolution, refusal: { success: false, error: "invalid_work_shape", message: resolution.message, data: { pickList: DELIVERY_SHAPE_PICK_LIST } } };
  }
  if (resolution.kind === "ambiguous") {
    if (args.workIntent !== "implementation") return { resolution: null, refusal: null };
    return {
      resolution,
      refusal: {
        success: false,
        error: "work_shape_required",
        message: `${resolution.reason} Re-claim ${args.itemId} with workShape set to one of the five delivery shapes; do not guess.`,
        data: { itemId: args.itemId, signals: resolution.signals, pickList: DELIVERY_SHAPE_PICK_LIST },
      },
    };
  }
  if (resolution.key === "delivery-xlarge" && args.workIntent === "implementation") {
    return {
      resolution,
      refusal: {
        success: false,
        error: "work_shape_xlarge_requires_decomposition",
        message: `${args.itemId} is xlarge: it never enters implementation. Decompose it into shaped children and claim those (design §3.4 rule 7).`,
        data: { itemId: args.itemId, workShape: resolution.ref, pickList: DELIVERY_SHAPE_PICK_LIST },
      },
    };
  }
  return { resolution, refusal: null };
}

async function persistClaimShape(db: CapsuleDb, capsuleId: string, resolution: DeliveryShapeResolution | null): Promise<void> {
  if (!resolution || (resolution.kind !== "declared" && resolution.kind !== "derived")) return;
  if (!db.workroom?.findUnique) return;
  const row = await db.workroom.findUnique({ where: { capsuleId }, select: { scopeClaims: true } }) as { scopeClaims?: unknown } | null;
  const existing = Array.isArray(row?.scopeClaims) ? row!.scopeClaims as unknown[] : [];
  const preserved = existing.filter((entry) => !(entry && typeof entry === "object" && "workShape" in (entry as Record<string, unknown>)));
  await db.workroom.update({ where: { capsuleId }, data: { scopeClaims: [...preserved, buildDeliveryShapeClaim(resolution)] } });
}

export async function claimBacklogItemForWork(args: {
  params: Record<string, unknown>;
  userId: string;
  context: ToolContext;
  db: CapsuleDb;
  resolveActor: (userId: string, context: ToolContext) => Promise<WorkCapsuleActor>;
}): Promise<ToolResult> {
  const { params } = args;
  const itemId = stringParam(params, "itemId");
  const worktreePath = stringParam(params, "worktreePath");
  const branchName = stringParam(params, "branchName");
  const provider = stringParam(params, "provider");
  const sessionRef = stringParam(params, "sessionRef");
  const requestedIntent = stringParam(params, "workIntent");
  if (!itemId || !worktreePath || !branchName || !provider || !sessionRef) {
    return { success: false, error: "invalid_input", message: "itemId, worktreePath, branchName, provider, and sessionRef are required." };
  }
  if (requestedIntent && !WORK_INTENTS.includes(requestedIntent as WorkIntent)) {
    return { success: false, error: "invalid_work_intent", message: `workIntent must be one of: ${WORK_INTENTS.join(", ")}.` };
  }
  const repositoryFullName = stringParam(params, "repositoryFullName")
    ?? defaultPlatformRepositoryFullName();
  const executorKind = providerToExecutorKind(provider);
  const shape = await resolveClaimShape({
    db: args.db,
    itemId,
    declared: stringParam(params, "workShape"),
    workIntent: (requestedIntent as WorkIntent | null) ?? "implementation",
  });
  if (shape.refusal) {
    // An unattended caller cannot answer a pick list: say so on the refusal so
    // the dispatcher raises attention to the item's owner instead of retrying.
    const unattended = UNATTENDED_EXECUTORS.has(executorKind) || Boolean(args.context?.taskRunId);
    return unattended
      ? { ...shape.refusal, data: { ...(shape.refusal.data as Record<string, unknown>), attentionRequired: true, executorKind } }
      : shape.refusal;
  }
  try {
    const governed = await claimGovernedBacklogWorkspace({
      db: args.db,
      input: {
        backlogItemId: itemId,
        repositoryFullName,
        headBranch: branchName,
        worktreePath,
        baseBranch: stringParam(params, "baseBranch") ?? "main",
        executorKind,
        executorRef: sessionRef,
        force: params["force"] === true,
        overrideReason: stringParam(params, "overrideReason"),
        workShape: shape.resolution && (shape.resolution.kind === "declared" || shape.resolution.kind === "derived") ? shape.resolution.ref : null,
      },
      actor: await args.resolveActor(args.userId, args.context),
      workIntent: requestedIntent as WorkIntent | null,
    });
    if (!governed.ok) {
      return {
        success: false,
        error: governed.data.code,
        message: governed.error,
        data: {
          workIntent: governed.data.workIntent,
          readiness: governed.data.readiness,
          recovery: governed.data.recovery,
        },
      };
    }
    const result = governed.data.claim;
    await persistClaimShape(args.db, result.capsuleId, shape.resolution);
    await ensureCapsuleWorkItemAnchorWithPrisma({
      capsuleId: result.capsuleId,
      backlogItemId: result.backlogItemId,
      title: `Work on ${result.backlogItemId}`,
    }).catch((error) => {
      console.warn(`[work-convergence] WorkItem anchor skipped for ${result.capsuleId}: ${error instanceof Error ? error.message : "unknown"}`);
    });
    const base = `Bound ${result.backlogItemId} to ${result.headBranch} (${result.capsuleId}).`;
    const conflicts = result.conflict
      ? [
          ...(result.conflict.backlogClaim ? [`${result.backlogItemId} already has an ACTIVE claim by another session; this call did NOT steal it`] : []),
          ...result.conflict.otherLocations.map((location) => `also in flight on ${location.headBranch ?? "?"} (${location.capsuleId})`),
        ]
      : [];
    return {
      success: true,
      entityId: result.capsuleId,
      message: conflicts.length
        ? `${base} ADVISORY: ${conflicts.join("; ")}. Coordinate before pushing.`
        : `${base} Claim-at-start recorded for this session.`,
      data: {
        ...result,
        workShape: shape.resolution && (shape.resolution.kind === "declared" || shape.resolution.kind === "derived")
          ? { ref: shape.resolution.ref, source: shape.resolution.kind, ...(shape.resolution.kind === "derived" ? { reasonCode: shape.resolution.reasonCode, signals: shape.resolution.signals } : {}) }
          : null,
        workIntent: governed.data.workIntent,
        readiness: governed.data.readiness,
        readback: governed.data.readback,
      },
    };
  } catch (error) {
    if (error instanceof BacklogItemAlreadyClaimedError) {
      return {
        success: false,
        error: error.code,
        message: `${error.message} Reuse that Workroom, wait until it is no longer live, or deliberately co-claim with force=true and overrideReason.`,
        data: { backlogItemId: error.backlogItemId, liveWorkrooms: error.liveWorkrooms },
      };
    }
    const occupied = branchOccupiedResult(error);
    if (occupied) return occupied;
    const detail = error instanceof Error ? error.message : "Unknown failure";
    if (/not found/i.test(detail)) return { success: false, error: "not_found", message: detail };
    throw error;
  }
}
