// BI-0012E6CA AC-EXPIRY-VISIBLE — an approval nobody answered stays visible to
// the person it was for, as "expired unanswered", with a way to ask again.
//
// The loader used to read `status: "proposed"` and unexpired rows only, so the
// moment a window closed the request disappeared from the delegating user's
// inbox. The only trace was a collapsed "recent outcomes" history row
// (ApprovalOutcomeHistory) and, for an ABSENT delegate only, the superuser
// orphaned-approval roll-up. Nothing offered to re-raise it.
import { describe, expect, it, vi } from "vitest";

import {
  coworkerEnvelopeToAttentionItem,
  loadCoworkerEnvelopeItems,
  type CoworkerEnvelopeRow,
} from "./coworker-envelope";
import { classifyOwnerAttentionLane } from "../owner-routing";
import { buildOwnerAttentionProjection, pinOwnerAttentionEntry } from "../owner-projection";
import { translateAttentionToOwnerDecision } from "../owner-decision";

const NOW = Date.parse("2026-10-01T09:00:00.000Z");
const OWNER = "user-operator";

function expiredRow(over: Partial<CoworkerEnvelopeRow> = {}): CoworkerEnvelopeRow {
  return {
    id: "cmupffie10cdu01t491xmoiby",
    coworkerAgentId: "AGT-EXT-CODEX",
    delegatingUserId: OWNER,
    manifestActionId: "merge_backlog_items",
    rationale: "Merge the duplicate into the canonical item.",
    status: "expired",
    taskRunId: null,
    // Raised at 04:00 while the operator slept; lapsed at 04:15.
    // clock-bomb-guard: allow every projection here takes the pinned NOW explicitly and never reads the wall clock
    expiresAt: new Date("2026-10-01T04:15:00.000Z"),
    createdAt: new Date("2026-10-01T04:00:00.000Z"),
    taskRun: null,
    ...over,
  };
}

/** A stub that honours the status predicate the loader actually sends. */
function stubDb(rows: CoworkerEnvelopeRow[]) {
  const matchesStatus = (status: unknown, value: string): boolean => {
    if (typeof status === "string") return status === value;
    if (status && typeof status === "object" && Array.isArray((status as { in?: unknown }).in)) {
      return ((status as { in: string[] }).in).includes(value);
    }
    return status === undefined;
  };
  const findMany = vi.fn(async (args: { where: { delegatingUserId: string; status?: unknown } }) =>
    rows.filter((row) =>
      row.delegatingUserId === args.where.delegatingUserId
      && matchesStatus(args.where.status, row.status)),
  );
  return {
    db: {
      coworkerActionEnvelope: { findMany, count: vi.fn(async () => 0) },
      toolExecution: { findMany: vi.fn(async () => []) },
    } as never,
    findMany,
  };
}

describe("AC-EXPIRY-VISIBLE: an expired, unanswered approval is re-surfaceable", () => {
  it("is still shown to its delegating user after the window closed", { timeout: 120_000 }, async () => {
    const { db } = stubDb([expiredRow()]);
    const items = await loadCoworkerEnvelopeItems(db, OWNER, NOW);
    expect(items.map((item) => item.envelope?.envelopeId)).toContain("cmupffie10cdu01t491xmoiby");
  });

  it("says it expired unanswered and offers to ask again instead of Authorize/Decline", () => {
    const item = coworkerEnvelopeToAttentionItem(expiredRow(), NOW);
    // A lapsed request can never be authorized from a stale card.
    expect(item.envelope?.actionable).toBe(false);
    expect(item.actions.map((action) => action.kind)).not.toContain("approve");
    // The person sees what happened, in words, and can re-raise it.
    expect(`${item.title} ${item.context}`).toMatch(/expired unanswered/i);
    expect(item.actions.some((action) => /ask again/i.test(action.label))).toBe(true);
  });
});

describe("expired-unanswered requests stay honest and quiet (BI-0012E6CA)", () => {
  it("does not offer an approved request that lapsed before it ran as 'unanswered'", async () => {
    const approved = expiredRow({
      argsJson: { approvalBinding: {}, humanApproval: { userId: OWNER, approvedAt: "2026-10-01T04:05:00.000Z" } },
    });
    const { db } = stubDb([approved]);
    expect(await loadCoworkerEnvelopeItems(db, OWNER, NOW)).toEqual([]);
  });

  it("drops a request once it has been asked again for the same exact call", async () => {
    const lapsed = expiredRow({ approvalBindingFingerprint: "binding-1" });
    const asked = expiredRow({
      id: "env-asked-again",
      status: "proposed",
      approvalBindingFingerprint: "binding-1",
      createdAt: new Date("2026-10-01T08:30:00.000Z"),
      // clock-bomb-guard: allow compared against the pinned NOW passed to the loader, not the wall clock
      expiresAt: new Date("2026-10-08T08:30:00.000Z"),
    });
    const { db } = stubDb([lapsed, asked]);
    const items = await loadCoworkerEnvelopeItems(db, OWNER, NOW);
    expect(items.map((item) => item.envelope?.envelopeId)).toEqual(["env-asked-again"]);
    expect(items[0]?.envelope?.expiredUnanswered).toBe(false);
  }, 120_000);

  it("waits in the low-urgency review instead of today's count, with no deadline badge", () => {
    const item = coworkerEnvelopeToAttentionItem(expiredRow(), NOW);
    expect(classifyOwnerAttentionLane(item)).toMatchObject({ lane: "weekly-digest", hardFloor: false });
    expect(item.triage.timeToAct).toBe("none");
    expect(item.triage.deadlineIso).toBeUndefined();
    expect(item.envelope?.reraiseHref).toBe("/api/agent/envelope/cmupffie10cdu01t491xmoiby/reraise");
  });

  it("is pinned into the visible lane when a deep link asks for it", () => {
    const item = coworkerEnvelopeToAttentionItem(expiredRow(), NOW);
    const projection = buildOwnerAttentionProjection([item], { nowMs: NOW });
    expect(projection.needsYouNow).toHaveLength(0);
    const pinned = pinOwnerAttentionEntry(projection, item.id);
    expect(pinned.needsYouNow.map((entry) => entry.item.id)).toEqual([item.id]);
    expect(pinned.weeklyDigest).toHaveLength(0);
    expect(pinned.count).toBe(1);
    expect(pinOwnerAttentionEntry(projection, "coworker-envelope:unknown")).toBe(projection);
  });

  it("reads a durable request's deadline in days", () => {
    const live = expiredRow({
      status: "proposed",
      createdAt: new Date(NOW),
      expiresAt: new Date(NOW + 7 * 86_400_000),
    });
    const item = coworkerEnvelopeToAttentionItem(live, NOW);
    expect(classifyOwnerAttentionLane(item).lane).toBe("needs-you-now");
    const card = translateAttentionToOwnerDecision(item, NOW);
    expect(card.tags.find((tag) => tag.kind === "deadline")?.label).toBe("Due in 7 days");
  });
});
