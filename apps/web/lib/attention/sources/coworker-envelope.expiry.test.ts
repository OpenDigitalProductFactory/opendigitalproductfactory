// BI-0012E6CA AC-EXPIRY-VISIBLE — an approval nobody answered stays visible to
// the person it was for, as "expired unanswered", with a way to ask again.
//
// Today the loader reads `status: "proposed"` and unexpired rows only, so the
// moment a window closes the request disappears from the delegating user's
// inbox. The only trace is a collapsed "recent outcomes" history row
// (ApprovalOutcomeHistory) and, for an ABSENT delegate only, the superuser
// orphaned-approval roll-up. Nothing offers to re-raise it.
import { describe, expect, it, vi } from "vitest";

import {
  coworkerEnvelopeToAttentionItem,
  loadCoworkerEnvelopeItems,
  type CoworkerEnvelopeRow,
} from "./coworker-envelope";

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
  it("is still shown to its delegating user after the window closed", async () => {
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
