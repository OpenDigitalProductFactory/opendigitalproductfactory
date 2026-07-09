// Tests for the consolidation parity steward (BI-ED9AC5A6): bets with
// outstanding backlog work are open conformance issues; fully-delivered bets
// auto-resolve through the shared reconciler.

import { describe, expect, it, vi } from "vitest";

import { CONSOLIDATION_BETS } from "@/lib/optimization/consolidation-bets";
import { runConsolidationParitySteward } from "./consolidation-parity-steward";

type IssueRow = {
  id: string;
  issueType: string;
  message: string;
  severity: string;
  detailsJson: Record<string, unknown>;
  status: string;
};

function makeDb(input: {
  statuses: Record<string, string>;
  existingIssues?: IssueRow[];
}) {
  const issues: IssueRow[] = [...(input.existingIssues ?? [])];
  return {
    issues,
    backlogItem: {
      findMany: vi.fn().mockImplementation(async (args: { where: { itemId: { in: string[] } } }) =>
        args.where.itemId.in
          .filter((itemId) => itemId in input.statuses)
          .map((itemId) => ({ itemId, status: input.statuses[itemId] })),
      ),
    },
    eaConformanceIssue: {
      findMany: vi.fn().mockImplementation(async () => issues.filter((row) => row.status === "open")),
      create: vi.fn().mockImplementation(async (args: { data: IssueRow }) => {
        const row = { ...args.data, id: `issue-${issues.length + 1}`, status: "open" };
        issues.push(row as IssueRow);
        return { id: row.id };
      }),
      update: vi.fn().mockImplementation(async (args: { where: { id: string }; data: Partial<IssueRow> }) => {
        const row = issues.find((candidate) => candidate.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      }),
    },
  };
}

function allDoneStatuses(): Record<string, string> {
  return Object.fromEntries(
    CONSOLIDATION_BETS.flatMap((bet) => bet.backlogItemIds.map((itemId) => [itemId, "done"])),
  );
}

describe("runConsolidationParitySteward", () => {
  it("opens one issue per bet with outstanding work, keyed consolidation-parity:<betKey>", async () => {
    const statuses = allDoneStatuses();
    // Make BET-11's single item open again.
    statuses["BI-B72328D5"] = "open";
    const db = makeDb({ statuses });

    const result = await runConsolidationParitySteward({ db: db as never });

    expect(result.outstandingBets).toEqual(["BET-11"]);
    expect(result.created).toBe(1);
    const issue = db.issues[0]!;
    expect(issue.detailsJson.issueKey).toBe("consolidation-parity:BET-11");
    expect(issue.issueType).toBe("consolidation-outstanding");
    expect(issue.message).toMatch(/BET-11/);
  });

  it("auto-resolves the issue when every delivery item reaches a terminal state", async () => {
    const db = makeDb({
      statuses: allDoneStatuses(),
      existingIssues: [
        {
          id: "issue-old",
          issueType: "consolidation-outstanding",
          severity: "warn",
          message: "Consolidation BET-11 …",
          detailsJson: { issueKey: "consolidation-parity:BET-11" },
          status: "open",
        },
      ],
    });

    const result = await runConsolidationParitySteward({ db: db as never });

    expect(result.outstandingBets).toEqual([]);
    expect(result.completedBets).toContain("BET-11");
    expect(result.resolved).toBe(1);
    expect(db.issues.find((row) => row.id === "issue-old")?.status).toBe("resolved");
  });

  it("treats a registry item id missing from the live backlog as outstanding drift", async () => {
    const statuses = allDoneStatuses();
    delete statuses["BI-A1E864A5"]; // BET-5's item vanishes from the backlog
    const db = makeDb({ statuses });

    const result = await runConsolidationParitySteward({ db: db as never });

    expect(result.outstandingBets).toEqual(["BET-5"]);
    const issue = db.issues[0]!;
    expect(issue.detailsJson.openItemIds).toEqual(["BI-A1E864A5"]);
  });

  it("severity follows leverage (H → warn, M → info)", async () => {
    const statuses = allDoneStatuses();
    statuses["BI-B72328D5"] = "open"; // BET-11, leverage H
    statuses["BI-C0CEB377"] = "open"; // BET-14, leverage M
    const db = makeDb({ statuses });

    await runConsolidationParitySteward({ db: db as never });

    const byKey = new Map(db.issues.map((row) => [row.detailsJson.issueKey, row.severity]));
    expect(byKey.get("consolidation-parity:BET-11")).toBe("warn");
    expect(byKey.get("consolidation-parity:BET-14")).toBe("info");
  });
});
