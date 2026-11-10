import { describe, expect, it, vi } from "vitest";

import {
  ORPHAN_LOOKBACK_DAYS,
  STALE_DELEGATE_DAYS,
  loadOrphanedApprovalItems,
  projectOrphanedApprovals,
  type OrphanEnvelopeRow,
} from "./orphaned-approval";

const now = new Date("2026-09-26T12:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

function row(overrides: Partial<OrphanEnvelopeRow> = {}): OrphanEnvelopeRow {
  return {
    delegatingUserId: "u-admin",
    manifestActionId: "invite_room_participant",
    status: "expired",
    createdAt: days(1),
    delegate: { email: "admin@dpf.local", isActive: true, lastSeenAt: null },
    ...overrides,
  };
}

// BI-61DE8177, live 2026-09-26: 193 approvals routed to admin@dpf.local expired
// unanswered. Envelopes live 15 minutes, so the warning is about the PERSON the
// approvals go to, not one envelope.
describe("projectOrphanedApprovals", () => {
  it("raises one item per unseen delegate, counting their unanswered approvals", () => {
    const items = projectOrphanedApprovals(
      [row(), row({ status: "proposed", createdAt: days(0) }), row({ manifestActionId: "record_initiative_evidence" })],
      now,
    );
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.id).toBe("orphaned-approval:u-admin");
    expect(item.source).toBe("orphaned-approval");
    expect(item.title).toContain("admin@dpf.local");
    expect(item.context).toContain("3 approval requests");
    expect(item.context).toContain("has not used the portal since tracking began");
    expect(item.context).toContain("invite_room_participant");
    expect(item.deepLink).toBe("/admin/platform-development");
  });

  it("never offers a control that decides someone else's approval", () => {
    const [item] = projectOrphanedApprovals([row()], now);
    expect(item.actions.map((a) => a.kind)).toEqual(["open-in-context"]);
  });

  it("stays quiet for a delegate who used the portal recently", () => {
    const seen = { email: "mark@example.com", isActive: true, lastSeenAt: days(1) };
    expect(projectOrphanedApprovals([row({ delegatingUserId: "u-mark", delegate: seen })], now)).toEqual([]);
  });

  it("flags a delegate not seen for longer than the stale window, naming when", () => {
    const stale = { email: "old@example.com", isActive: true, lastSeenAt: days(STALE_DELEGATE_DAYS + 1) };
    const [item] = projectOrphanedApprovals([row({ delegatingUserId: "u-old", delegate: stale })], now);
    expect(item.context).toContain("has not used the portal since 2026-09-22");
  });

  it("flags a deactivated delegate and a delegate whose account no longer exists", () => {
    const inactive = { email: "gone@example.com", isActive: false, lastSeenAt: days(0) };
    const items = projectOrphanedApprovals(
      [row({ delegatingUserId: "u-gone", delegate: inactive }), row({ delegatingUserId: "u-missing", delegate: null })],
      now,
    );
    expect(items.map((i) => i.id).sort()).toEqual(["orphaned-approval:u-gone", "orphaned-approval:u-missing"]);
  });

  it("ignores approvals that were decided, and ones older than the lookback", () => {
    expect(projectOrphanedApprovals([row({ status: "executed" }), row({ status: "declined" })], now)).toEqual([]);
    expect(projectOrphanedApprovals([row({ createdAt: days(ORPHAN_LOOKBACK_DAYS + 1) })], now)).toEqual([]);
  });

  it("does not flag the delegate's approvals created after they were last seen but still inside the window", () => {
    // Seen an hour ago: whatever expired since is ordinary, not orphaned.
    const recent = { email: "a@example.com", isActive: true, lastSeenAt: new Date(now.getTime() - 3_600_000) };
    expect(projectOrphanedApprovals([row({ delegate: recent, createdAt: new Date(now.getTime() - 60_000) })], now)).toEqual([]);
  });
});

describe("loadOrphanedApprovalItems", () => {
  it("reads only undecided envelopes inside the lookback", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const userFind = vi.fn().mockResolvedValue([]);
    await loadOrphanedApprovalItems({ coworkerActionEnvelope: { findMany }, user: { findMany: userFind } } as never, now);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ["proposed", "expired"] }, createdAt: { gte: days(ORPHAN_LOOKBACK_DAYS) } },
    }));
  });

  it("joins each delegate once and projects", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { delegatingUserId: "u-admin", manifestActionId: "invite_room_participant", status: "expired", createdAt: days(1) },
    ]);
    const userFind = vi.fn().mockResolvedValue([{ id: "u-admin", email: "admin@dpf.local", isActive: true, lastSeenAt: null }]);
    const items = await loadOrphanedApprovalItems({ coworkerActionEnvelope: { findMany }, user: { findMany: userFind } } as never, now);
    expect(userFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["u-admin"] } } }));
    expect(items.map((i) => i.id)).toEqual(["orphaned-approval:u-admin"]);
  });
});
