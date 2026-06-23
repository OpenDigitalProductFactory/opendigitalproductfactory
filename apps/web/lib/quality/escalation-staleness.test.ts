import { describe, expect, it } from "vitest";
import {
  selectResolvableEscalations,
  type EscalationStalenessRow,
} from "./escalation-staleness";

function row(over: Partial<EscalationStalenessRow>): EscalationStalenessRow {
  return {
    reportId: "PIR-A",
    createdAt: new Date("2026-06-23T00:00:00Z"),
    buildSupersededByEpicId: null,
    originatingBacklogItemId: "bi-cuid-1",
    backlogItemStatus: "deferred",
    backlogItemTriageOutcome: "build",
    ...over,
  };
}

describe("selectResolvableEscalations", () => {
  it("resolves when the originating backlog item shipped (done)", () => {
    const out = selectResolvableEscalations([row({ backlogItemStatus: "done" })]);
    expect(out).toEqual([{ reportId: "PIR-A", reason: "originating-item-done" }]);
  });

  it("resolves when the originating item is discarded or a duplicate", () => {
    expect(
      selectResolvableEscalations([row({ reportId: "PIR-D", backlogItemTriageOutcome: "discard" })]),
    ).toEqual([{ reportId: "PIR-D", reason: "originating-item-wont-do" }]);
    expect(
      selectResolvableEscalations([row({ reportId: "PIR-U", backlogItemTriageOutcome: "duplicate" })]),
    ).toEqual([{ reportId: "PIR-U", reason: "originating-item-wont-do" }]);
  });

  it("resolves when the build was superseded by an epic (decompose approved)", () => {
    const out = selectResolvableEscalations([
      // Even with a still-pending BI, a superseded build is handled.
      row({ buildSupersededByEpicId: "epic-cuid-1", backlogItemStatus: "in-progress" }),
    ]);
    expect(out).toEqual([{ reportId: "PIR-A", reason: "build-superseded-by-epic" }]);
  });

  it("resolves the older escalation when a newer one exists for the same item", () => {
    const older = row({ reportId: "PIR-OLD", createdAt: new Date("2026-06-23T00:00:00Z") });
    const newer = row({ reportId: "PIR-NEW", createdAt: new Date("2026-06-23T06:00:00Z") });
    const out = selectResolvableEscalations([older, newer]);
    expect(out).toEqual([{ reportId: "PIR-OLD", reason: "superseded-by-newer-escalation" }]);
  });

  it("KEEPS an escalation whose item is still in-progress", () => {
    expect(selectResolvableEscalations([row({ backlogItemStatus: "in-progress" })])).toEqual([]);
  });

  it("KEEPS an escalation whose item is deferred-but-still-wanted (the parked-for-build state)", () => {
    // The genuine "waiting for a human" case: parked deferred with a build outcome.
    expect(
      selectResolvableEscalations([row({ backlogItemStatus: "deferred", backlogItemTriageOutcome: "build" })]),
    ).toEqual([]);
    expect(
      selectResolvableEscalations([row({ backlogItemStatus: "deferred", backlogItemTriageOutcome: "defer" })]),
    ).toEqual([]);
  });

  it("KEEPS an escalation with no originating link that is not superseded", () => {
    expect(
      selectResolvableEscalations([
        row({ originatingBacklogItemId: null, backlogItemStatus: null, backlogItemTriageOutcome: null }),
      ]),
    ).toEqual([]);
  });

  it("processes a mixed batch independently", () => {
    const out = selectResolvableEscalations([
      row({ reportId: "PIR-DONE", originatingBacklogItemId: "i1", backlogItemStatus: "done" }),
      row({ reportId: "PIR-KEEP", originatingBacklogItemId: "i2", backlogItemStatus: "in-progress" }),
      row({ reportId: "PIR-SUP", originatingBacklogItemId: "i3", buildSupersededByEpicId: "e1" }),
    ]);
    expect(out).toEqual([
      { reportId: "PIR-DONE", reason: "originating-item-done" },
      { reportId: "PIR-SUP", reason: "build-superseded-by-epic" },
    ]);
  });
});
