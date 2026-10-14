// BI-7BCC87BB (plan B8, AC-OVERRIDE; WWMD DI-18258852EB33 chose the
// exact-link card over widening the admin's queue): an admin who opens another
// person's waiting request by its exact link gets that one card, marked as
// someone else's; the delegate's own Needs-you stays delegate-isolated. The
// superuser's orphaned-approval item links to the absent delegate's newest
// waiting request, where the card holds the only control.
import { describe, expect, it, vi } from "vitest";

import { loadOnBehalfEnvelopeItem } from "./coworker-envelope";
import { projectOrphanedApprovals, type OrphanEnvelopeRow } from "./orphaned-approval";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function envelope(over: Record<string, unknown> = {}) {
  return {
    id: "env-1", coworkerAgentId: "AGT-OPS", delegatingUserId: "owner-1", manifestActionId: "run_discovery_triage",
    rationale: "This coworker is set to propose, not act.", status: "proposed", taskRunId: null,
    expiresAt: new Date(NOW + 3_600_000), createdAt: new Date(NOW - 60_000), argsJson: {}, taskRun: null,
    ...over,
  };
}

function db(row: unknown, owner: unknown = { email: "owner@x.test" }) {
  return {
    coworkerActionEnvelope: { findFirst: vi.fn(async () => row) },
    toolExecution: { findMany: vi.fn(async () => []) },
    user: { findUnique: vi.fn(async () => owner) },
  };
}

describe("loadOnBehalfEnvelopeItem", () => {
  it("loads another person's waiting request by id and marks it as theirs", async () => {
    const store = db(envelope());
    const [item] = await loadOnBehalfEnvelopeItem(store as never, "env-1", "admin-1", NOW);
    expect(store.coworkerActionEnvelope.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "env-1", status: "proposed", NOT: { delegatingUserId: "admin-1" } }),
    }));
    expect(item?.id).toBe("coworker-envelope:env-1");
    expect(item?.envelope?.onBehalf).toEqual({ ownerLabel: "owner@x.test" });
    expect(item?.envelope?.actionable).toBe(true);
  });

  it("returns nothing when there is no such waiting request for someone else", async () => {
    expect(await loadOnBehalfEnvelopeItem(db(null) as never, "env-1", "admin-1", NOW)).toEqual([]);
  });

  it("falls back to the owner's id when the account no longer exists", async () => {
    const [item] = await loadOnBehalfEnvelopeItem(db(envelope(), null) as never, "env-1", "admin-1", NOW);
    expect(item?.envelope?.onBehalf).toEqual({ ownerLabel: "owner-1" });
  });
});

describe("orphaned approvals link to the waiting request", () => {
  const now = new Date(NOW);
  function row(over: Partial<OrphanEnvelopeRow> = {}): OrphanEnvelopeRow {
    return {
      delegatingUserId: "u-gone", manifestActionId: "run_discovery_triage", status: "expired",
      createdAt: new Date(NOW - 86_400_000),
      delegate: { email: "gone@x.test", isActive: false, lastSeenAt: null },
      ...over,
    };
  }

  it("adds a link to the newest request still waiting, where an admin can decide it on their behalf", () => {
    const [item] = projectOrphanedApprovals([
      row({ id: "env-old", status: "proposed", createdAt: new Date(NOW - 7_200_000), expiresAt: new Date(NOW + 60_000) }),
      row({ id: "env-new", status: "proposed", createdAt: new Date(NOW - 60_000), expiresAt: new Date(NOW + 60_000) }),
      row({ id: "env-lapsed", status: "proposed", createdAt: new Date(NOW - 30_000), expiresAt: new Date(NOW - 1) }),
    ], now);
    expect(item?.actions).toEqual([
      { kind: "open-in-context", label: "Review AI connections", href: "/admin/platform-development" },
      { kind: "open-in-context", label: "Decide on their behalf", href: expect.stringContaining("approval=env-new") },
    ]);
  });

  it("adds no link when nothing is still waiting", () => {
    const [item] = projectOrphanedApprovals([row({ id: "env-x" })], now);
    expect(item?.actions.map((action) => action.label)).toEqual(["Review AI connections"]);
  });
});
