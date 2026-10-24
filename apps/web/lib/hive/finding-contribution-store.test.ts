import { describe, expect, it, vi } from "vitest";

import { contributeFindingToHive, type FindingContributionDb } from "./finding-contribution-store";
import type { EscalationOutcome } from "./finding-contribution";

const ROW = {
  proposalId: "IP-A1B2C",
  title: "The async worker throws before claiming",
  description: "Full finding body.",
  contributionStatus: "local",
  backlogItemId: "cm-backlog-row-id",
};

function makeDb(row: Record<string, unknown> | null = ROW) {
  const create = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
  const updateMany = vi.fn(async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
    count: 1,
  }));
  const db = {
    improvementProposal: { findUnique: vi.fn(async () => row), updateMany },
    hiveContributionLedger: { create },
  } as unknown as FindingContributionDb;
  return { db, create, updateMany };
}

function run(
  db: FindingContributionDb,
  outcome: EscalationOutcome,
  escalateSpy = vi.fn(async (_i: { kind: "backlog"; id: string }) => outcome),
) {
  return {
    escalateSpy,
    result: contributeFindingToHive({
      db,
      proposalId: "IP-A1B2C",
      escalate: escalateSpy,
      pseudonym: async () => "amber-heron-4417",
    }),
  };
}

describe("contributeFindingToHive", () => {
  it("escalates the finding's backlog item, with no build and no diff", async () => {
    // The whole point: contribute_to_hive needs an active FeatureBuild and its
    // diffPatch, so an external session holding a knowledge finding cannot use
    // it. This path needs neither.
    const { db } = makeDb();
    const { escalateSpy, result } = run(db, {
      status: "filed",
      issueNumber: 42,
      url: "https://example.invalid/42",
    });

    await expect(result).resolves.toMatchObject({ contributed: true, issueNumber: 42 });
    expect(escalateSpy).toHaveBeenCalledWith({ kind: "backlog", id: "cm-backlog-row-id" });
  });

  it("writes the ledger row contribute_to_hive never writes, under a pseudonym", async () => {
    const { db, create } = makeDb();
    await run(db, { status: "filed", issueNumber: 42, url: "https://example.invalid/42" }).result;

    const data = create.mock.calls[0]![0].data;
    expect(data.contributionType).toBe("improvement");
    expect(data.contributor).toBe("amber-heron-4417");
    expect(data.ruleKey).toBe("IP-A1B2C");
    expect(data.status).toBe("submitted");
    expect(data.redactionStatus).toBe("redacted");
    expect(String(data.payloadHash)).toMatch(/^[0-9a-f]{64}$/);
    // No person, no host, no local path on the row.
    expect(JSON.stringify(data)).not.toContain("markdbodman");
  });

  it("flips contributionStatus so the local-only sweep stops reporting it", async () => {
    const { db, updateMany } = makeDb();
    await run(db, { status: "filed", issueNumber: 1, url: null }).result;

    const args = updateMany.mock.calls[0]![0];
    expect(args.data).toEqual({ contributionStatus: "contributed" });
    // Guarded on the prior value so two concurrent sends cannot double-flip.
    expect(args.where).toMatchObject({ contributionStatus: { not: "contributed" } });
  });

  it("does NOT mark it contributed when the escalation only skipped", async () => {
    // The dangerous inversion: marking it contributed on a skip would stop the
    // sweep reporting a finding that never left the install — invisible locally
    // AND absent upstream.
    const { db, create, updateMany } = makeDb();
    const { result } = run(db, { status: "skipped", reason: "install is private" });

    await expect(result).resolves.toMatchObject({ contributed: false });
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does NOT mark it contributed when the escalation failed", async () => {
    const { db, create, updateMany } = makeDb();
    const { result } = run(db, { status: "failed", error: "upstream unreachable" });

    await expect(result).resolves.toMatchObject({ contributed: false });
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("never escalates a proposal already contributed", async () => {
    const { db } = makeDb({ ...ROW, contributionStatus: "contributed" });
    const { escalateSpy, result } = run(db, { status: "filed", issueNumber: 1, url: null });

    await expect(result).resolves.toMatchObject({ reason: "already-contributed" });
    expect(escalateSpy).not.toHaveBeenCalled();
  });

  it("never escalates a proposal with no backlog item", async () => {
    const { db } = makeDb({ ...ROW, backlogItemId: null });
    const { escalateSpy, result } = run(db, { status: "filed", issueNumber: 1, url: null });

    await expect(result).resolves.toMatchObject({ reason: "no-backlog-item" });
    expect(escalateSpy).not.toHaveBeenCalled();
  });

  it("refuses an unknown proposal without touching anything", async () => {
    const { db, create, updateMany } = makeDb(null);
    const { escalateSpy, result } = run(db, { status: "filed", issueNumber: 1, url: null });

    await expect(result).resolves.toMatchObject({ reason: "not-found" });
    expect(escalateSpy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("escalates before it records, so a failure cannot leave a false 'contributed'", async () => {
    const order: string[] = [];
    const { db } = makeDb();
    db.hiveContributionLedger.create = vi.fn(async () => {
      order.push("ledger");
      return {};
    });
    db.improvementProposal.updateMany = vi.fn(async () => {
      order.push("flip");
      return { count: 1 };
    });

    await contributeFindingToHive({
      db,
      proposalId: "IP-A1B2C",
      escalate: async () => {
        order.push("escalate");
        return { status: "filed", issueNumber: 1, url: null };
      },
      pseudonym: async () => "amber-heron-4417",
    });

    expect(order).toEqual(["escalate", "ledger", "flip"]);
  });
});
