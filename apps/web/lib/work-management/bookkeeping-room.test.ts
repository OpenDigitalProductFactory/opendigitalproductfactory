// S-ROOM (BI-F8B6CF81) — the Bookkeeping Work Room composes three existing substrates:
// the canonical lifecycle grammar (a `bookkeeping-room` grammar), the Work Room source
// registry (a `bookkeeping-period` room kind), and the Outcome Packet builder (reused).
// These tests exercise the machinery with fixtures — the live reconciled period is
// owner-gated on a real statement export (no fictitious data on the live instance).
import { describe, expect, it } from "vitest";

import { canAdvance, getStage, validateGrammar } from "@/lib/lifecycle-grammar";
import { BOOKKEEPING_ROOM_GRAMMAR, resolveBookkeepingRoomPoint } from "@/lib/lifecycle-grammars";
import {
  buildWorkroomOutcomePacket,
  WorkroomOutcomePacketError,
} from "@/lib/work-management/outcome-packet";
import { getWorkCaseSourceEntry } from "@/lib/work-management/source-registry";
import {
  resolveWorkroomStructure,
  workroomStructureSubjectFor,
} from "@/lib/work-management/room-structure";
import type { WorkCaseSourceRef } from "@/lib/work-management/case-types";

describe("bookkeeping-room lifecycle grammar", () => {
  it("is a valid grammar (validateGrammar does not throw)", () => {
    expect(() => validateGrammar(BOOKKEEPING_ROOM_GRAMMAR)).not.toThrow();
  });

  it("declares the six books-loop stages in order, ending terminal", () => {
    expect(BOOKKEEPING_ROOM_GRAMMAR.stages.map((s) => s.key)).toEqual([
      "open",
      "gather",
      "import-categorize",
      "reconcile",
      "owner-review",
      "closed",
    ]);
    const closed = getStage(BOOKKEEPING_ROOM_GRAMMAR, "closed");
    expect(closed?.isTerminal).toBe(true);
    expect(closed?.advancesTo).toEqual([]);
  });

  it("each non-terminal stage advances only to the next stage", () => {
    const linear: Record<string, string[]> = {
      open: ["gather"],
      gather: ["import-categorize"],
      "import-categorize": ["reconcile"],
      reconcile: ["owner-review"],
      "owner-review": ["closed"],
    };
    for (const [from, to] of Object.entries(linear)) {
      expect(getStage(BOOKKEEPING_ROOM_GRAMMAR, from)?.advancesTo).toEqual(to);
    }
  });

  it("names the real exception condition of each working stage as a blocked state", () => {
    const blockedByStage = Object.fromEntries(
      BOOKKEEPING_ROOM_GRAMMAR.stages.map((stage) => [
        stage.key,
        stage.states.filter((state) => state.band === "blocked").map((state) => state.key),
      ]),
    );
    expect(blockedByStage.gather).toContain("awaiting-documents");
    expect(blockedByStage["import-categorize"]).toContain("exceptions-open");
    expect(blockedByStage.reconcile).toContain("unreconciled");
    expect(blockedByStage["owner-review"]).toContain("changes-requested");
  });

  it("owner-review is the ready band — books done, waiting only on the human", () => {
    const entry = getStage(BOOKKEEPING_ROOM_GRAMMAR, "owner-review")?.states.find((s) => s.isEntry);
    expect(entry?.band).toBe("ready");
  });

  it("advancing from the entry state of a non-terminal stage is allowed", () => {
    const check = canAdvance(BOOKKEEPING_ROOM_GRAMMAR, { stage: "reconcile", state: "reconciling" }, "owner-review");
    expect(check.allowed).toBe(true);
  });

  it("resolveBookkeepingRoomPoint maps every stored status onto a real (stage,state)", () => {
    const statuses = [
      "open",
      "gathering",
      "awaiting-documents",
      "categorizing",
      "exceptions-open",
      "reconciling",
      "unreconciled",
      "in-review",
      "changes-requested",
      "closed",
      "cancelled",
    ];
    for (const status of statuses) {
      const point = resolveBookkeepingRoomPoint(status);
      const stage = getStage(BOOKKEEPING_ROOM_GRAMMAR, point.stage);
      expect(stage, `stage for ${status}`).toBeTruthy();
      expect(stage?.states.some((s) => s.key === point.state), `state for ${status}`).toBe(true);
    }
  });

  it("falls back to the open entry for an unknown stored status", () => {
    expect(resolveBookkeepingRoomPoint("nonsense")).toEqual({ stage: "open", state: "open" });
  });
});

describe("bookkeeping-period room kind (source registry)", () => {
  it("is registered as a standing room with governed receipts", () => {
    const entry = getWorkCaseSourceEntry("bookkeeping-period");
    expect(entry).toBeTruthy();
    expect(entry?.roomProjection.mode).toBe("standing");
    expect(entry?.receiptPolicy.defaultReceiptKind).toBe("governed-action");
    expect(entry?.defaultDecisionScope).toBe("wwwd");
  });

  it("requires reconciliation evidence, governed receipts, and owner decisions in its Outcome Packet", () => {
    const entry = getWorkCaseSourceEntry("bookkeeping-period");
    expect(entry?.roomProjection.outcomePacket.requiredCategories).toEqual([
      "evidence",
      "receipts",
      "decisions",
    ]);
  });
});

describe("bookkeeping-period room structure binding", () => {
  it("binds a bookkeeping-period source to the bookkeeping-room grammar with no customer value stream", () => {
    const subject = workroomStructureSubjectFor({
      sourceType: "bookkeeping-period",
      bookkeepingPeriodStatus: "reconciling",
    });
    expect(subject).toEqual({ kind: "bookkeeping-period", status: "reconciling" });

    const structure = resolveWorkroomStructure(subject);
    expect(structure?.valueStream).toBeNull();
    expect(structure?.lifecycle?.grammarKey).toBe("bookkeeping-room");
    expect(structure?.lifecycle?.stage).toBe("reconcile");
    expect(structure?.lifecycle?.nextGates.map((g) => g.toStage)).toEqual(["owner-review"]);
  });

  it("returns no subject when the period status is absent", () => {
    expect(workroomStructureSubjectFor({ sourceType: "bookkeeping-period" })).toBeNull();
  });
});

describe("bookkeeping-period Outcome Packet", () => {
  const ref = (kind: WorkCaseSourceRef["kind"], id: string): WorkCaseSourceRef => ({ kind, id });

  it("builds a reconciled-period packet when evidence, receipts, and decisions are all present", () => {
    const packet = buildWorkroomOutcomePacket({
      sourceKey: "bookkeeping-period",
      outcomeState: "achieved",
      summary: "March books reconciled: statement imported, 42 transactions matched, balance ties out.",
      accountablePrincipalRef: "user:operator-owner",
      completedAt: "2026-04-01T00:00:00.000Z",
      facts: [
        { category: "evidence", sourceRef: ref("runtime-verification", "reconciliation-summary-mar"), provenance: "canonical" },
        { category: "receipts", sourceRef: ref("receipt", "governed-import-mar"), provenance: "canonical" },
        { category: "decisions", sourceRef: ref("decision-interaction", "owner-signoff-mar"), provenance: "canonical" },
      ],
    });
    expect(packet.outcomeState).toBe("achieved");
    expect(packet.evidenceRefs).toHaveLength(1);
    expect(packet.receiptRefs).toHaveLength(1);
    expect(packet.decisionRefs).toHaveLength(1);
  });

  it("refuses a packet that is missing the required reconciliation evidence", () => {
    expect(() =>
      buildWorkroomOutcomePacket({
        sourceKey: "bookkeeping-period",
        outcomeState: "partially-achieved",
        summary: "March books partially closed.",
        accountablePrincipalRef: "user:operator-owner",
        completedAt: "2026-04-01T00:00:00.000Z",
        facts: [
          { category: "receipts", sourceRef: ref("receipt", "governed-import-mar"), provenance: "canonical" },
          { category: "decisions", sourceRef: ref("decision-interaction", "owner-signoff-mar"), provenance: "canonical" },
        ],
      }),
    ).toThrow(WorkroomOutcomePacketError);
  });

  it("carries open exceptions forward as unresolved work rather than fabricating a close", () => {
    const packet = buildWorkroomOutcomePacket({
      sourceKey: "bookkeeping-period",
      outcomeState: "partially-achieved",
      summary: "March mostly reconciled; two transactions await owner categorization.",
      accountablePrincipalRef: "user:operator-owner",
      completedAt: "2026-04-01T00:00:00.000Z",
      facts: [
        { category: "evidence", sourceRef: ref("runtime-verification", "reconciliation-summary-mar"), provenance: "canonical" },
        { category: "receipts", sourceRef: ref("receipt", "governed-import-mar"), provenance: "canonical" },
        { category: "decisions", sourceRef: ref("decision-interaction", "owner-signoff-mar"), provenance: "canonical" },
      ],
      unresolvedWork: [
        { summary: "Two unmatched transactions need an owner category", ownerRef: "user:operator-owner", disposition: "carry-over" },
      ],
    });
    expect(packet.unresolvedWork).toHaveLength(1);
    expect(packet.unresolvedWork[0]?.disposition).toBe("carry-over");
  });
});
