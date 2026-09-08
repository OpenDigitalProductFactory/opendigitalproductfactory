/**
 * The case for a Workroom that anchors no WorkItem (BI-2C31C399).
 *
 * `a-room-is-reachable-by-construction` part 2 says the read model resolves a
 * room through the foreign key that anchors it, and part 3 says a room that
 * exists is reachable. Both were true only for anchored rooms. Measured on the
 * live install: 464 Workrooms, 290 of them — 62% — carry no `workItemId`. The
 * portfolio activity tree links every room by capsule id, the canonical
 * resolver needs an anchor to redirect to and returns null without one, and the
 * loader then looks for a WorkItem whose sourceType is `work-capsule`, which
 * nothing is. Every one of those rooms served the not-found boundary.
 *
 * A room with no WorkItem is not a broken anchor. It is a room that is its own
 * unit of work, so it is its own case — which keeps one case per unit of work
 * (BI-EBEB77E2) rather than minting a second case for rooms that already have
 * one. Anchored rooms still redirect to the item's case and never reach here.
 *
 * This mirrors `coworker-engagement-case-projection.ts`: the loader already
 * branches to a dedicated projection for a source that is not a WorkItem, and
 * this is the second such source rather than a new mechanism.
 */

import { buildWorkCaseDetail } from "./case-read-model";
import { encodeWorkCaseKey } from "./case-key";
import { buildWorkroomView } from "./room-read-model";
import type { WorkspaceWorkCaseDetailView, WorkspaceWorkCaseListItem } from "./workspace-case-loader";

/** The capsule fields this projection reads. */
export type WorkroomOnlyRecord = {
  capsuleId: string;
  title: string;
  status: string;
  objective?: string | null;
  workItemId?: string | null;
  updatedAt?: Date | string | null;
};

export type WorkroomOnlyPrismaClient = {
  /**
   * `findFirst` is optional on the shared case client, so callers with a
   * narrower fake keep compiling and this projection declines rather than
   * throwing. Same guard `canonical-case-key.ts` applies.
   */
  workroom: { findFirst?(args: unknown): Promise<WorkroomOnlyRecord | null> };
};

const SOURCE_TYPE = "work-capsule";

/**
 * Load the case for a room addressed by its capsule id.
 *
 * Returns null when no such room exists — a missing room is genuinely not
 * found — and null when the room anchors a WorkItem, because that room's case
 * is the item's and the caller redirects there.
 */
export async function loadWorkroomOnlyCaseDetail({
  prismaClient,
  sourceId,
  caseKey,
  now,
}: {
  prismaClient: WorkroomOnlyPrismaClient;
  sourceId: string;
  caseKey: string;
  now: Date;
}): Promise<WorkspaceWorkCaseDetailView | null> {
  if (!prismaClient.workroom?.findFirst) return null;
  const room = await prismaClient.workroom.findFirst({
    where: { capsuleId: sourceId },
    select: {
      capsuleId: true,
      title: true,
      status: true,
      objective: true,
      workItemId: true,
      updatedAt: true,
    },
  });
  if (!room) return null;
  // An anchored room's case is its WorkItem's. Resolving it here as well would
  // give one unit of work two cases.
  if (room.workItemId) return null;

  const source = { sourceType: SOURCE_TYPE, sourceId: room.capsuleId, status: room.status };
  const detail = buildWorkCaseDetail({
    source,
    capsule: { capsuleId: room.capsuleId, status: room.status, title: room.title },
  });

  // The shared summary titles a source-only case "<source label> <id>", which
  // for a room reads "Work capsule WC-ALPHA" — an identifier, not a name. The
  // room already has a human title, so the case carries it. Titled locally
  // rather than in the shared read model, which every other case type shares.
  const titledDetail = {
    ...detail,
    summary: { ...detail.summary, title: room.title },
  };

  const objective = room.objective?.trim() || null;
  const roomView = buildWorkroomView({
    caseKey,
    detail: titledDetail,
    boundary: {
      // The room's own objective is its purpose. Where none was recorded the
      // boundary says so rather than restating the title as if it were intent.
      purpose: objective ?? "No objective was recorded for this Workroom.",
      outcome: objective ?? "No objective was recorded for this Workroom.",
      scopeIncluded: [room.title],
      sourceRefs: detail.summary.sourceRefs,
    },
    participants: [],
    activities: [],
    context: {
      refs: detail.summary.sourceRefs,
      digest: objective,
      sensitivityCeiling: null,
    },
    now,
  });

  // The list-item fields the detail summary does not carry are stated, not
  // guessed: this projection knows the room's status and nothing about urgency,
  // effort or assignment, so it says so rather than implying a value.
  const summary: WorkspaceWorkCaseListItem = {
    ...titledDetail.summary,
    href: `/workspace/cases/${encodeWorkCaseKey({ sourceType: SOURCE_TYPE, sourceId: room.capsuleId })}`,
    urgencyLabel: "Not recorded",
    effortLabel: "Not recorded",
    assignmentLabel: "Not recorded",
    attentionRequired: room.status === "blocked",
    attentionReason: room.status === "blocked" ? "This Workroom is blocked." : null,
    description: objective,
    dueAt: detail.summary.dueAt ?? null,
  };

  return {
    summary,
    evidenceTimeline: detail.timeline,
    sourceRefs: detail.summary.sourceRefs,
    workItemId: null,
    workItemTitle: null,
    room: roomView,
  };
}
