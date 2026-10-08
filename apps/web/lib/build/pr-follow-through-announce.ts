/**
 * Where a room's PR follow-through decision is heard (BI-88341B5D §3.5).
 *
 * Every effect lands on the room as a WorkroomActivity, so the room's own
 * timeline carries the evidence whichever client opened the PR. A hold that
 * needs a person (a staged repair, an exhausted budget, a failure nobody can
 * classify, infrastructure that will not recover) also goes to the existing
 * escalation inbox — once per head, keyed by the record's attentionKey.
 */
import type { ProactivityActionBoundary, ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import { resolveRoomActionBoundary } from "@/lib/work-management/room-turn-authority";
import { readWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { readWorkroomShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { shapeBiasFor } from "@/lib/work-posture/derive";

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

export type PrFollowThroughAnnounceDeps = {
  recordActivity: (input: { roomId: string; kind: string; summary: string; payload: Record<string, unknown> }) => Promise<void>;
  raiseIssue: (input: {
    title: string;
    description: string;
    dedupeKey: string;
    featureBuildId: string | null;
    selfFixClass: "needs-human";
  }) => Promise<void>;
};

/**
 * The room's posture for its PR, read with the turn authority's precedence
 * (declared, then shape bias, then platform default). An undeclared level reads
 * `balanced`, as the workroom drive reads it.
 */
export function resolvePrFollowThroughPosture(input: {
  scopeClaims: unknown;
  platformDefaultActionBoundary: ProactivityActionBoundary | null;
}): { authority: PrRepairAuthority; actuationAllowed: boolean; level: ProactivityLevel; boundary: ProactivityActionBoundary | null } {
  const declared = readWorkroomPostureClaim(input.scopeClaims);
  const level: ProactivityLevel = declared?.proactivityLevel ?? "balanced";
  const boundary = resolveRoomActionBoundary(
    {
      declaredActionBoundary: declared?.actionBoundary ?? null,
      shapeActionBoundary: shapeBiasFor(readWorkroomShapeClaim(input.scopeClaims))?.actionBoundary ?? null,
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

export async function announcePrFollowThrough(input: {
  room: PrFollowThroughRoom;
  priorAttentionKey: string | null;
  decision: PrFollowThroughDecision;
  deps: PrFollowThroughAnnounceDeps;
}): Promise<"announced" | "quiet"> {
  const { room, decision, deps } = input;
  const pr = `PR #${room.prNumber}`;
  const record = (summary: string, payload: Record<string, unknown>) =>
    deps.recordActivity({
      roomId: room.id,
      kind: PR_FOLLOW_THROUGH_ACTIVITY_KIND,
      summary,
      payload: { prNumber: room.prNumber, prUrl: room.prUrl, failingChecks: decision.followThrough.failing, ...payload },
    });

  if (decision.kind === "none" || decision.kind === "hold") return "quiet";

  if (decision.kind === "rerun-infrastructure") {
    await record(`${pr}: re-ran the failed jobs of an infrastructure failure on ${decision.headSha.slice(0, 12)}.`, {
      decision: decision.kind,
      headSha: decision.headSha,
      workflowRunIds: decision.workflowRunIds,
    });
    return "announced";
  }

  if (decision.kind === "repair" && decision.mode === "dispatch") {
    await record(`${pr}: dispatched repair attempt ${decision.packet.attempt} of ${decision.packet.bound} for ${checksLine(decision)}.`, {
      decision: decision.kind,
      mode: decision.mode,
      headSha: decision.headSha,
      packet: decision.packet,
    });
    return "announced";
  }

  const key = decision.followThrough.attentionKey;
  if (!key || key === input.priorAttentionKey) return "quiet";

  const summary = decision.kind === "repair"
    ? decision.mode === "propose"
      ? `${pr} is red on ${checksLine(decision)}. A repair is staged for a person to run.`
      : `${pr} is red on ${checksLine(decision)}. The room is quiet, so it recorded this and did nothing else.`
    : `${pr} needs a person (${decision.reason}): ${checksLine(decision)}.`;
  await record(summary, {
    decision: decision.kind,
    headSha: decision.headSha,
    ...(decision.kind === "repair" ? { mode: decision.mode, packet: decision.packet } : { target: decision.target, reason: decision.reason }),
  });
  if (decision.kind === "repair" && decision.mode === "record") return "announced";

  await deps.raiseIssue({
    title: `Workroom ${room.capsuleId} needs a decision on ${pr}`,
    description:
      `${summary}\n\nHead: ${decision.headSha}\nPR: ${room.prUrl}\n\n`
      + "The room never merges by hand, force-pushes, dismisses a check or weakens a test. "
      + "The merge queue remains the only path to main.",
    dedupeKey: `${room.capsuleId}:${key}`,
    featureBuildId: room.featureBuildId,
    selfFixClass: "needs-human",
  });
  return "announced";
}
