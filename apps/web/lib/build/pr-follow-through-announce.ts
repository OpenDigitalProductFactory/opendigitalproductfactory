/**
 * Where a room's PR follow-through decision is heard (BI-88341B5D §3.5).
 *
 * Every effect lands on the room as a WorkroomActivity, so the room's own
 * timeline carries the evidence whichever client opened the PR. A hold that
 * needs a person (a staged repair, an exhausted budget, a failure nobody can
 * classify, infrastructure that will not recover) has a separate persisted
 * routing receipt. The decision's attentionKey alone is not delivery. A staged
 * repair is a propose boundary and reaches a person; the rest pass the
 * escalation gate (BI-5E067004).
 */
import type { ProactivityActionBoundary, ProactivityLevel } from "@dpf/validators/workroom-policy/proactivity-types";
import { resolveRoomActionBoundary } from "@/lib/work-management/room-turn-authority";
import { readWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { readWorkroomShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { shapeBiasFor } from "@dpf/validators/workroom-policy/derive";
import { isGateGovernedExecutor } from "@/lib/work-posture/gate-governed";
import { isRecord } from "@/lib/shared/coerce";
import type { OwnerAttentionFiled, OwnerAttentionRoute } from "@/lib/govern/authority/route-to-human";

import {
  resolvePrRepairAuthority,
  type PrFollowThroughDecision,
  type PrRepairAuthority,
} from "./pr-follow-through";

export const PR_FOLLOW_THROUGH_ACTIVITY_KIND = "workroom-pr-follow-through";

export type PrFollowThroughRoom = {
  id: string;
  capsuleId: string;
  featureBuildId: string | null;
  prNumber: number;
  prUrl: string;
};

type FollowThroughActivity = { roomId: string; kind: string; summary: string; payload: Record<string, unknown> };
type FollowThroughIssue = {
    title: string;
    description: string;
    dedupeKey: string;
    featureBuildId: string | null;
    /** What blocks the PR, for the escalation gate's blocker class. */
    blockingFacts: string[];
    /** A repair staged for a person to run: the room proposes, a person acts. */
    proposeBoundary: boolean;
};

type HandoffDisposition =
  | { kind: "pending" | "route-error" | "no-recipient" }
  | { kind: "routed"; route: OwnerAttentionRoute; reportId: string; ownerUserId: string | null };

type FollowThroughHandoff = {
  attentionKey: string;
  headSha: string;
  authorityKey: string;
  issue: FollowThroughIssue;
  disposition: HandoffDisposition;
};

export const PR_FOLLOW_THROUGH_HANDOFF_KEY = "prFollowThroughHandoff";

export function readPrFollowThroughHandoff(workspace: unknown): FollowThroughHandoff | null {
  if (!isRecord(workspace)) return null;
  const value = workspace[PR_FOLLOW_THROUGH_HANDOFF_KEY];
  if (!isRecord(value) || typeof value.headSha !== "string" || typeof value.authorityKey !== "string"
    || typeof value.attentionKey !== "string" || !isRecord(value.issue) || !isRecord(value.disposition)) return null;
  const { issue, disposition } = value;
  if (typeof issue.title !== "string" || typeof issue.description !== "string" || typeof issue.dedupeKey !== "string"
    || (issue.featureBuildId !== null && typeof issue.featureBuildId !== "string")
    || !Array.isArray(issue.blockingFacts) || !issue.blockingFacts.every((fact) => typeof fact === "string")
    || typeof issue.proposeBoundary !== "boolean") return null;
  if (disposition.kind === "routed") {
    if (!["human", "agent", "independent-review"].some((route) => route === disposition.route)
      || typeof disposition.reportId !== "string"
      || (disposition.ownerUserId !== null && typeof disposition.ownerUserId !== "string")) return null;
  } else if (!["pending", "route-error", "no-recipient"].some((kind) => kind === disposition.kind)) return null;
  return value as FollowThroughHandoff;
}

export function followThroughRouteDisposition(
  filed: (OwnerAttentionFiled & { decision: { route: OwnerAttentionRoute } }) | null,
): HandoffDisposition {
  if (!filed || filed.error || !filed.reportId) return { kind: "route-error" };
  if (filed.decision.route === "human" && !filed.ownerUserId) return { kind: "no-recipient" };
  return { kind: "routed", route: filed.decision.route, reportId: filed.reportId, ownerUserId: filed.ownerUserId };
}

/**
 * The room's posture for its PR, read with the turn authority's precedence
 * (declared, then shape bias, then platform default). An undeclared level reads
 * `balanced`, as the workroom drive reads it.
 */
export function resolvePrFollowThroughPosture(input: {
  scopeClaims: unknown;
  /** Workroom.executorKind; a gate-governed room's shape yields to the default (BI-D0DFE502). */
  executorKind?: string | null;
  platformDefaultActionBoundary: ProactivityActionBoundary | null;
}): { authority: PrRepairAuthority; actuationAllowed: boolean; level: ProactivityLevel; boundary: ProactivityActionBoundary | null } {
  const declared = readWorkroomPostureClaim(input.scopeClaims);
  const level: ProactivityLevel = declared?.proactivityLevel ?? "balanced";
  const boundary = resolveRoomActionBoundary(
    {
      declaredActionBoundary: declared?.actionBoundary ?? null,
      shapeActionBoundary: shapeBiasFor(readWorkroomShapeClaim(input.scopeClaims))?.actionBoundary ?? null,
      gateGoverned: isGateGovernedExecutor(input.executorKind),
    },
    input.platformDefaultActionBoundary,
  );
  return {
    authority: resolvePrRepairAuthority({ level, boundary }),
    // Arming auto-merge, updating a stale branch and re-running infrastructure
    // are the existing low-risk actions (§7 slice 3). Only a quiet room or an
    // advise-only boundary withholds them.
    actuationAllowed: level !== "quiet" && boundary !== "advise",
    level,
    boundary,
  };
}

function checksLine(decision: PrFollowThroughDecision): string {
  const failing = decision.followThrough.failing;
  return failing.length
    ? failing.map((check) => `${check.name} (${check.conclusion}, ${check.class})`).join(", ")
    : "none named";
}

export function planPrFollowThroughAnnouncement(input: {
  room: PrFollowThroughRoom;
  priorAttentionKey: string | null;
  decision: PrFollowThroughDecision;
}): { activity: FollowThroughActivity; issue: FollowThroughIssue | null } | null {
  const { room, decision } = input;
  const pr = `PR #${room.prNumber}`;
  const activity = (summary: string, payload: Record<string, unknown>): FollowThroughActivity =>
    ({
      roomId: room.id,
      kind: PR_FOLLOW_THROUGH_ACTIVITY_KIND,
      summary,
      payload: { prNumber: room.prNumber, prUrl: room.prUrl, failingChecks: decision.followThrough.failing, ...payload },
    });

  if (decision.kind === "none" || decision.kind === "hold") return null;

  if (decision.kind === "rerun-infrastructure") {
    return { activity: activity(`${pr}: re-ran the failed jobs of an infrastructure failure on ${decision.headSha.slice(0, 12)}.`, {
      decision: decision.kind,
      headSha: decision.headSha,
      workflowRunIds: decision.workflowRunIds,
    }), issue: null };
  }

  if (decision.kind === "repair" && decision.mode === "dispatch") {
    return { activity: activity(`${pr}: dispatched repair attempt ${decision.packet.attempt} of ${decision.packet.bound} for ${checksLine(decision)}.`, {
      decision: decision.kind,
      mode: decision.mode,
      headSha: decision.headSha,
      packet: decision.packet,
    }), issue: null };
  }

  const key = decision.followThrough.attentionKey;
  if (!key || key === input.priorAttentionKey) return null;

  const identityAction = decision.kind === "attention"
    ? decision.reason === "repair-identity-unavailable"
      ? "Workroom coordinator: confirm an eligible repair identity. Build Studio will recheck eligibility on the next delivery tick."
      : decision.reason === "repair-identity-refused"
        ? "Workroom coordinator: resolve the authorization refusal. Build Studio will keep watching this head, without retrying the refused action."
        : null
    : null;
  const summary = decision.kind === "repair"
    ? decision.mode === "propose"
      ? `${pr} is red on ${checksLine(decision)}. A repair is staged for a person to run.`
      : `${pr} is red on ${checksLine(decision)}. The room is quiet, so it recorded this and did nothing else.`
    : `${pr} needs a person (${decision.reason}): ${checksLine(decision)}.`;
  const entry = activity(summary, {
    decision: decision.kind,
    headSha: decision.headSha,
    ...(identityAction ? { nextAction: identityAction } : {}),
    ...(decision.kind === "repair" ? { mode: decision.mode, packet: decision.packet } : { target: decision.target, reason: decision.reason }),
  });
  if (decision.kind === "repair" && decision.mode === "record") return { activity: entry, issue: null };
  return { activity: entry, issue: {
    title: `Workroom ${room.capsuleId} needs a decision on ${pr}`,
    description:
      `${summary}\n\nHead: ${decision.headSha}\nPR: ${room.prUrl}\n\n`
      + (identityAction ? `${identityAction}\n\n` : "")
      + "The room never merges by hand, force-pushes, dismisses a check or weakens a test. "
      + "The merge queue remains the only path to main.",
    dedupeKey: `${room.capsuleId}:${key}`,
    featureBuildId: room.featureBuildId,
    blockingFacts: [decision.kind === "repair" ? `repair staged: ${checksLine(decision)}` : `${decision.reason}: ${checksLine(decision)}`],
    proposeBoundary: decision.kind === "repair" && decision.mode === "propose",
  } };
}
