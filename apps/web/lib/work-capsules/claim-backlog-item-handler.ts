import { adoptionScopePatch, scopeWriteWhere } from "./scope-input";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { assessDeliverySensitivity } from "@/lib/backlog/initiative-readiness/delivery-sensitivity";
import { WORK_INTENTS, type WorkIntent } from "@/lib/work-capsules";
import {
  DELIVERY_SHAPE_PICK_LIST,
  buildDeliveryShapeClaim,
  resolveDeliveryShape,
  type DeliveryShapeResolution,
} from "@/lib/work-management/derive-delivery-shape";
import { kickRoomSetup, oweRoomSetup } from "@/lib/workroom-runtime/room-setup-effects.server";

import { providerToExecutorKind } from "./external-session-capture";
import { claimGovernedBacklogWorkspace } from "./governed-work-claim";
import { branchOccupiedResult } from "./mcp-result-errors";
import { defaultPlatformRepositoryFullName } from "./work-capsule-branch-identity";
import { lazyResolverDeps, resolveSourceCommitShas, sourceCommitRefusal, type SourceCommitResolverDeps } from "./source-commit-resolution";
import { BacklogItemAlreadyClaimedError } from "./backlog-workroom-ownership";
import { evaluateTwinClaimGate, type TwinGateOutcome } from "./twin-claim-gate";
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
    sensitivity: assessDeliverySensitivity({ title: item?.title, body: item?.body, workType: item?.workType }).level,
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

/** Orchestrating harnesses DPF recognises (BI-53BED66C). Descriptive only: never an authority identity. */
export const EXECUTOR_HARNESSES = ["t3-code"] as const;
export type ExecutorHarness = (typeof EXECUTOR_HARNESSES)[number];

/** A provider string that names only a harness, with no model client in it. */
export function isHarnessOnlyProvider(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  return /^t3(?:[-_ ]?code)?$/.test(normalized);
}

/** Record which harness runs the room's executor, keyed to the session it ran. */
export async function persistExecutorHarness(db: CapsuleDb, capsuleId: string, harness: ExecutorHarness, sessionRef: string): Promise<void> {
  const row = await db.workroom.findUnique({ where: { capsuleId }, select: { workspaceState: true } }) as { workspaceState?: unknown } | null;
  if (!row) return;
  const state = row.workspaceState && typeof row.workspaceState === "object" && !Array.isArray(row.workspaceState)
    ? row.workspaceState as Record<string, unknown> : {};
  await db.workroom.update({ where: { capsuleId },
    data: { workspaceState: { ...state, executorHarness: { harness, executorRef: sessionRef, recordedAt: new Date().toISOString() } } } });
}

export async function persistClaimShape(db: CapsuleDb, capsuleId: string, resolution: DeliveryShapeResolution | null): Promise<void> {
  if (!resolution || (resolution.kind !== "declared" && resolution.kind !== "derived")) return;
  if (!db.workroom?.findUnique) return;
  const row = await db.workroom.findUnique({ where: { capsuleId }, select: { scopeClaims: true, updatedAt: true } });
  if (!row) throw new Error(`Work Capsule ${capsuleId} not found while binding its execution shape`);
  const patch = adoptionScopePatch(row, { workShape: resolution.ref }, new Date());
  if (!Array.isArray(patch.scopeClaims)) return;
  const scopeClaims = patch.scopeClaims.map((entry: unknown) => entry && typeof entry === "object" && "workShape" in entry
    ? { ...entry, ...buildDeliveryShapeClaim(resolution) } : entry);
  await db.workroom.update({ where: scopeWriteWhere({ ...row, capsuleId }), data: { scopeClaims } });
}

async function recordTwinOverride(
  db: {
    workroom: { findUnique(args: unknown): Promise<{ id: string } | null> };
    workroomActivity: { create(args: unknown): Promise<unknown> };
  },
  capsuleId: string,
  gate: Extract<TwinGateOutcome, { kind: "overridden" }>,
  actor: WorkCapsuleActor,
): Promise<void> {
  const room = await db.workroom.findUnique({ where: { capsuleId }, select: { id: true } });
  if (!room) return;
  await db.workroomActivity.create({
    data: {
      workCapsuleId: room.id,
      kind: "federated-twin-override",
      summary: `Deliberately claimed despite the paired installation's work on ${gate.blockers.map((b) => b.itemId).join(", ")}: ${gate.reason}`,
      payload: { reason: gate.reason, twins: gate.blockers },
      recordedById: actor.userId,
      recordedByAgentId: actor.agentId,
    },
  });
}

/** Ask the item's home for the claim; the answer arrives with delivery. */
async function requestHomeClaim(capsuleId: string): Promise<string> {
  const { requestWorkClaimAtHome } = await import("@/lib/federation/work-claim-exchange.server");
  const queued = await requestWorkClaimAtHome(capsuleId, "claim");
  return queued.queued
    ? "UNCONFIRMED: this item lives on the paired installation, which decides its claim. The request is queued and is sent as soon as that installation can be reached; until it answers, this Workroom is unconfirmed. If it refuses, stop before opening a pull request."
    : `UNCONFIRMED: the claim could not be requested from the item's home (${queued.reason}).`;
}

export async function claimBacklogItemForWork(args: {
  params: Record<string, unknown>;
  userId: string;
  context: ToolContext;
  db: CapsuleDb;
  resolveActor: (userId: string, context: ToolContext) => Promise<WorkCapsuleActor>;
  /** Test seam; production asks the repository provider and the recorded Workrooms. */
  resolveCommitDeps?: (repositoryFullName: string) => Promise<SourceCommitResolverDeps>;
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
  // BI-DF34D948: a short SHA is expanded against the repository, not refused.
  const shas = await resolveSourceCommitShas(params, lazyResolverDeps(args.resolveCommitDeps, repositoryFullName));
  if (!shas.ok) return sourceCommitRefusal(shas, { tool: "claim_backlog_item_for_work", args: params });
  const { baseSha, headSha } = shas.data;
  // BI-53BED66C: a harness (T3 Code) is not the authenticated client. Name the
  // model client as provider and the harness separately; never let "t3" fall
  // through to `human`, which hides who did the work.
  const harness = stringParam(params, "harness");
  if (harness && !EXECUTOR_HARNESSES.includes(harness as ExecutorHarness)) {
    return { success: false, error: "invalid_harness", message: `harness must be one of: ${EXECUTOR_HARNESSES.join(", ")}.` };
  }
  if (isHarnessOnlyProvider(provider)) {
    return { success: false, error: "provider_harness_only",
      message: `"${provider}" names the harness, not the model client. Pass provider "codex" or "claude" (whichever T3 is driving) and harness "t3-code", with sessionRef set to the client thread id (CODEX_THREAD_ID or CLAUDE_CODE_SESSION_ID).` };
  }
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
  // Admission by points in flight (BI-3430B3A4): an implementation claim is a
  // start. An unattended executor is refused past the allowance; a person
  // proceeds with the warning recorded. An item already in flight is admitted.
  let admissionWarning: string | null = null;
  if (((requestedIntent as WorkIntent | null) ?? "implementation") === "implementation") {
    const unattended = UNATTENDED_EXECUTORS.has(executorKind) || Boolean(args.context?.taskRunId);
    const { prisma } = await import("@dpf/db");
    const { evaluateItemAdmission, recordAdmissionOutcome, blocksStart } = await import("@/lib/build/investment-admission");
    const admission = await evaluateItemAdmission(prisma as never, { itemId, startKind: unattended ? "autonomous" : "human" });
    await recordAdmissionOutcome(prisma as never, admission, { source: "claim_backlog_item_for_work", userId: args.userId, agentId: args.context?.agentId ?? null });
    if (blocksStart(admission)) {
      return { success: false, error: "wip_allowance_reached", message: admission.reason, data: { admission, attentionRequired: true, executorKind } };
    }
    if (admission.verdict !== "admit") admissionWarning = admission.reason;
  }
  // The paired installation may already be working this defect (BI-91FC6B9A).
  const { prisma: twinDb } = await import("@dpf/db");
  const twinGate = await evaluateTwinClaimGate(twinDb as never, {
    itemId,
    headBranch: branchName,
    force: params["force"] === true,
    overrideReason: stringParam(params, "overrideReason"),
  });
  if (twinGate.kind === "refused") return twinGate.result;
  // The item lives on the paired installation (BI-30EDDB7F): the local
  // Workroom is created unconfirmed and the claim is asked for at its home.
  const claimAtHome = twinGate.kind === "home-claim" || (twinGate.kind === "overridden" && twinGate.homeClaim);
  try {
    const governed = await claimGovernedBacklogWorkspace({
      db: args.db,
      input: {
        backlogItemId: itemId,
        repositoryFullName,
        headBranch: branchName,
        worktreePath,
        baseBranch: stringParam(params, "baseBranch") ?? "main",
        baseSha,
        headSha,
        executorKind,
        executorRef: sessionRef,
        force: params["force"] === true,
        overrideReason: stringParam(params, "overrideReason"),
        workShape: shape.resolution && (shape.resolution.kind === "declared" || shape.resolution.kind === "derived") ? shape.resolution.ref : null,
        claimAtHome,
      },
      actor: await args.resolveActor(args.userId, args.context),
      workIntent: requestedIntent as WorkIntent | null,
      // BI-C64EDA33 PR 3 (AC-5): the room's shape and harness, and the anchor it is owed, commit with the claim.
      dependencies: {
        afterClaimInTx: async (tx, claim) => {
          await persistClaimShape(tx, claim.capsuleId, shape.resolution);
          if (harness) await persistExecutorHarness(tx, claim.capsuleId, harness as ExecutorHarness, sessionRef);
          const room = await tx.workroom.findUnique({ where: { capsuleId: claim.capsuleId }, select: { id: true } }) as { id: string } | null;
          if (room && "$queryRaw" in tx) {
            await oweRoomSetup(tx as never, { roomRowId: room.id, capsuleId: claim.capsuleId, backlogItemId: claim.backlogItemId,
              title: `Work on ${claim.backlogItemId}`, source: "claim" });
          }
        },
      },
    });
    if (!governed.ok) {
      return {
        success: false,
        error: governed.data.code,
        message: governed.error,
        data: {
          workIntent: governed.data.workIntent,
          readiness: governed.data.readiness,
          governingPrinciples: governed.data.governingPrinciples,
          recovery: governed.data.recovery,
        },
      };
    }
    const result = governed.data.claim;
    if (twinGate.kind === "overridden") await recordTwinOverride(twinDb as never, result.capsuleId, twinGate, await args.resolveActor(args.userId, args.context));
    const homeClaim = claimAtHome ? await requestHomeClaim(result.capsuleId) : null;
    // The anchor the claim owes its room runs now on the effect worker, and is retried there if it fails.
    kickRoomSetup();
    const base = `Bound ${result.backlogItemId} to ${result.headBranch} (${result.capsuleId}).`;
    const investment = await (await import("../portfolio/investment-balance-server")).projectItemInvestment(
      (await import("@dpf/db")).prisma, { itemId: result.backlogItemId, roomId: result.capsuleId },
    );
    const conflicts = result.conflict
      ? [
          ...(result.conflict.backlogClaim ? [`${result.backlogItemId} already has an ACTIVE claim by another session; this call did NOT steal it`] : []),
          ...result.conflict.otherLocations.map((location) => `also in flight on ${location.headBranch ?? "?"} (${location.capsuleId})`),
        ]
      : [];
    return {
      success: true,
      entityId: result.capsuleId,
      message: (conflicts.length
        ? `${base} ADVISORY: ${conflicts.join("; ")}. Coordinate before pushing.`
        : `${base} Claim-at-start recorded for this session.`) + (admissionWarning ? ` Warning: ${admissionWarning}` : "")
        + (homeClaim ? ` ${homeClaim}` : ""),
      data: {
        ...result,
        admissionWarning,
        ...(claimAtHome ? { homeClaim: { state: "requested", message: homeClaim } } : {}),
        investment,
        workShape: shape.resolution && (shape.resolution.kind === "declared" || shape.resolution.kind === "derived")
          ? { ref: shape.resolution.ref, source: shape.resolution.kind, ...(shape.resolution.kind === "derived" ? { reasonCode: shape.resolution.reasonCode, signals: shape.resolution.signals } : {}) }
          : null,
        workIntent: governed.data.workIntent,
        readiness: governed.data.readiness,
        readback: governed.data.readback,
        ...(harness ? { executorHarness: harness } : {}),
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
