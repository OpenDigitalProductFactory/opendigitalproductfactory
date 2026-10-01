// Governed rebind of a room's work-shape pin to a newer version — the pure
// planner (BI-CB5C0DCE, phase 3). The server shell in
// workroom-shape-rebind.server.ts loads the room and writes; every decision
// about WHETHER a rebind may happen is made here, so the page, the MCP tool
// and the write cannot disagree.
// Spec: docs/superpowers/specs/2026-10-01-workroom-shape-rebind-design.md §4.3

import { err, ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";
import { diffWorkShapeBinding, type BindingChangeKind, type WorkShapeBindingDiff } from "./work-shape-binding-diff";
import { isCompletingWorkroomDriveReceipt } from "./workroom-drive-receipts";
import { getWorkShape, getWorkShapeVersion, readWorkShapeDefinitionContract } from "./work-shapes";
import { readWorkShapeClaim } from "./workroom-shape-claim";

export const REBIND_REFUSAL_CODES = [
  "room_not_found",
  "not_authorized",
  "no_pinned_shape",
  "key_change",
  "target_not_current",
  "not_an_upgrade",
  "stage_in_flight",
  "rationale_required",
  "rebind_conflict",
] as const;
export type RebindRefusalCode = (typeof REBIND_REFUSAL_CODES)[number];

export type RebindRefusal = ActionFailure & { code: RebindRefusalCode };
export type RebindPlanData = { diff: WorkShapeBindingDiff; fromRef: string; toRef: string };
export type RebindPlan = ActionSuccess<RebindPlanData>;

export function rebindRefusal(code: RebindRefusalCode, error: string): RebindRefusal {
  return { ...err(error), code };
}

function semverBelow(a: string, b: string): boolean {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

type DriveSnapshot = { action?: unknown; stageKey?: unknown; receipts?: unknown };

/** A stage the drive dispatched and has not yet seen a completing receipt for. */
export function stageInFlight(workspaceState: unknown): string | null {
  const drive = (workspaceState && typeof workspaceState === "object"
    ? (workspaceState as Record<string, unknown>).workroomDrive
    : null) as DriveSnapshot | null;
  if (!drive || drive.action !== "dispatch_agent" || typeof drive.stageKey !== "string") return null;
  const receipts = Array.isArray(drive.receipts) ? drive.receipts : [];
  const done = receipts.some((receipt) => receipt && typeof receipt === "object"
    && typeof (receipt as Record<string, unknown>).stageKey === "string"
    && typeof (receipt as Record<string, unknown>).kind === "string"
    && isCompletingWorkroomDriveReceipt(receipt as { stageKey: string; kind: string }, drive.stageKey as string));
  return done ? null : drive.stageKey;
}

/**
 * Decide whether a room may move to `toVersion`, in spec order: authority,
 * target, in-flight guard, diff, decision. Writes nothing.
 */
export function planWorkroomShapeRebind(input: {
  scopeClaims: unknown;
  workspaceState: unknown;
  /** Optional: when given it must be the room's own shape key. */
  toKey?: string | null;
  toVersion: string;
  authorized: boolean;
  authorityRefusal: string;
  rationale: string | null;
  /** A preview shows the diff before anyone decides, so it needs no rationale yet. */
  preview?: boolean;
}): RebindPlan | RebindRefusal {
  if (!input.authorized) return rebindRefusal("not_authorized", input.authorityRefusal);
  const pinned = readWorkShapeClaim(input.scopeClaims);
  if (!pinned) return rebindRefusal("no_pinned_shape", "This room does not pin a work shape.");
  if (input.toKey && input.toKey !== pinned.key) {
    return rebindRefusal("key_change", `This room runs ${pinned.key}. A rebind moves it to a newer version of that shape, never to a different one.`);
  }
  const current = getWorkShape(pinned.key);
  if (!current) return rebindRefusal("target_not_current", `The shape ${pinned.key} is no longer in the registry.`);
  if (input.toVersion !== current.version) {
    return rebindRefusal("target_not_current", `A room can only move to the current version of ${pinned.key}, which is ${current.version}.`);
  }
  if (!semverBelow(pinned.version, current.version)) {
    return rebindRefusal("not_an_upgrade", `This room is already on ${pinned.key}@${pinned.version}.`);
  }
  const inFlight = stageInFlight(input.workspaceState);
  if (inFlight) {
    return rebindRefusal("stage_in_flight", `Stage ${inFlight} is running. Rebind once it has finished.`);
  }
  // A pin the registry no longer holds diffs as if every stage were new.
  const from = getWorkShapeVersion(pinned.key, pinned.version);
  const diff = diffWorkShapeBinding(
    from ? readWorkShapeDefinitionContract(from) : { ...readWorkShapeDefinitionContract(current), version: pinned.version, stages: [], grants: [] },
    readWorkShapeDefinitionContract(current),
  );
  if (!input.preview && diff.classification === "widening" && !input.rationale?.trim()) {
    return rebindRefusal("rationale_required", "This version widens what the room can reach. Say why you are approving it.");
  }
  return ok({ diff, fromRef: `${pinned.key}@${pinned.version}`, toRef: `${current.key}@${current.version}` });
}

/** The decision evidence. No stageKey: a rebind must never complete a stage. */
export function buildRebindEvidence(input: {
  plan: RebindPlanData;
  rationale: string | null;
  decidedBy: "accountable-owner" | "platform-manager";
  deciderName: string;
}) {
  const { plan } = input;
  return {
    kind: "decision-record" as const,
    summary: `${input.deciderName} moved this room from ${plan.fromRef} to ${plan.toRef} (${plan.diff.classification}).${input.rationale ? ` ${input.rationale}` : ""}`,
    result: {
      decision: "workshape-rebind",
      from: plan.fromRef,
      to: plan.toRef,
      classification: plan.diff.classification,
      changes: plan.diff.changes,
      ...(input.rationale ? { rationale: input.rationale } : {}),
      decidedBy: input.decidedBy,
    },
  };
}

/** What the room page shows (workroom-shape-rebind.server.ts builds it). */
export type WorkroomShapeRebindView = {
  caseKey: string;
  roomRowId: string;
  fromRef: string;
  toRef: string;
  toVersion: string;
  classification: "widening" | "narrowing" | "unchanged";
  changes: Array<{ kind: BindingChangeKind; stageKey: string | null; detail: string }>;
  canRebind: boolean;
  /** Why the caller cannot rebind now (not the owner, or a stage is running). */
  refusal: string | null;
};
