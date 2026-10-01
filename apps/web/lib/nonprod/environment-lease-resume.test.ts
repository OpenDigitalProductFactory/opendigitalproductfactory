// BI-D35B85BF — the server half of a resumed local-CI claim: a cancelled wait
// stays cancelled, and identity drift retires only the same owner's obsolete
// queued wait (AC-DW-01, AC-DW-02, AC-DW-04).
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { resolveResumeClaim, SUPERSEDED_PHASE } from "./environment-lease-resume";

const NOW = new Date("2026-09-24T00:00:00.000Z");

type Row = {
  id: string; leaseId: string; environmentKey: string; status: string; phase: string | null;
  ownerSessionId: string; claimKey: string;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "row-pinned", leaseId: "NPEL-PINNED", environmentKey: "local-integration-ci", status: "queued",
    phase: "waiting", ownerSessionId: "session-1", claimKey: "gate:old", ...overrides,
  };
}

function tx(pinned: Row | null) {
  return {
    nonProductionEnvironmentLease: {
      findUnique: vi.fn(async () => pinned),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...pinned, ...data })),
    },
  };
}

const base = { environmentKey: "local-integration-ci", ownerSessionId: "session-1", now: NOW };

describe("resolveResumeClaim", () => {
  it("does nothing for a claim that resumes nothing", async () => {
    const db = tx(row());
    await expect(resolveResumeClaim({ ...base, tx: db as never, resumeLeaseId: undefined, claimLease: null }))
      .resolves.toEqual({ kind: "proceed", superseded: null });
    expect(db.nonProductionEnvironmentLease.findUnique).not.toHaveBeenCalled();
  });

  it("AC-DW-01: a cancelled pinned lease is final, and nothing is created or revived", async () => {
    const cancelled = row({ status: "cancelled", phase: "cancelled" });
    const db = tx(cancelled);
    const decision = await resolveResumeClaim({ ...base, tx: db as never, resumeLeaseId: "NPEL-PINNED", claimLease: null });
    expect(decision).toEqual({ kind: "terminal", lease: cancelled });
    expect(db.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("AC-DW-02: identity drift supersedes the same owner's queued wait before its replacement", async () => {
    const db = tx(row());
    const decision = await resolveResumeClaim({
      ...base, tx: db as never, resumeLeaseId: "NPEL-PINNED", claimLease: row({ id: "row-new", leaseId: "NPEL-NEW", claimKey: "gate:new" }) as never,
    });
    expect(decision.kind).toBe("proceed");
    expect(db.nonProductionEnvironmentLease.update).toHaveBeenCalledWith({
      where: { id: "row-pinned" },
      data: { status: "cancelled", phase: SUPERSEDED_PHASE, cancelledAt: NOW, releasedAt: NOW, activeKey: null },
    });
    expect(decision.kind === "proceed" && decision.superseded?.leaseId).toBe("NPEL-PINNED");
  });

  it("supersedes when the new identity has no row yet", async () => {
    const db = tx(row());
    const decision = await resolveResumeClaim({ ...base, tx: db as never, resumeLeaseId: "NPEL-PINNED", claimLease: null });
    expect(decision.kind === "proceed" && decision.superseded?.phase).toBe(SUPERSEDED_PHASE);
  });

  it("never cancels an admitted run", async () => {
    const db = tx(row({ status: "active" }));
    await expect(resolveResumeClaim({ ...base, tx: db as never, resumeLeaseId: "NPEL-PINNED", claimLease: null }))
      .rejects.toThrow("nonprod_resume_lease_active");
    expect(db.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("never touches another owner's lease", async () => {
    const db = tx(row({ ownerSessionId: "someone-else" }));
    await expect(resolveResumeClaim({ ...base, tx: db as never, resumeLeaseId: "NPEL-PINNED", claimLease: null }))
      .rejects.toThrow("nonprod_resume_not_owner");
    expect(db.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("proceeds past an expired pinned lease or one already superseded", async () => {
    for (const pinned of [row({ status: "expired" }), row({ status: "cancelled", phase: SUPERSEDED_PHASE })]) {
      const db = tx(pinned);
      await expect(resolveResumeClaim({ ...base, tx: db as never, resumeLeaseId: "NPEL-PINNED", claimLease: null }))
        .resolves.toEqual({ kind: "proceed", superseded: null });
      expect(db.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
    }
  });

  it("an unchanged identity keeps its own row: ordinary eventual admission", async () => {
    const same = row();
    const db = tx(same);
    await expect(resolveResumeClaim({ ...base, tx: db as never, resumeLeaseId: "NPEL-PINNED", claimLease: same as never }))
      .resolves.toEqual({ kind: "proceed", superseded: null });
    expect(db.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });

  it("ignores a pinned lease from another environment", async () => {
    const db = tx(row({ environmentKey: "active-candidate" }));
    await expect(resolveResumeClaim({ ...base, tx: db as never, resumeLeaseId: "NPEL-PINNED", claimLease: null }))
      .resolves.toEqual({ kind: "proceed", superseded: null });
  });
});
