import { describe, expect, it } from "vitest";

import { buildWorkroomOutcomePacket, WorkroomOutcomePacketError } from "./outcome-packet";

const receipt = { kind: "receipt" as const, id: "R-1", sourceType: "tool-execution" };
const evidence = { kind: "runtime-verification" as const, id: "RV-1", status: "passed" };

describe("Work Room Outcome Packets", () => {
  it("uses source policy for required categories while allowing optional categories to stay empty", () => {
    const packet = buildWorkroomOutcomePacket({
      sourceKey: "scheduled",
      outcomeState: "achieved",
      summary: "Weekly cash position reviewed and exceptions assigned.",
      facts: [
        { category: "receipts", sourceRef: receipt, provenance: "canonical" },
        { category: "evidence", sourceRef: evidence, provenance: "canonical" },
      ],
      accountablePrincipalRef: "prn-finance-owner",
      verifiedByRef: "prn-controller",
      completedAt: "2026-08-01T10:00:00.000Z",
    });

    expect(packet.receiptRefs).toEqual([receipt]);
    expect(packet.evidenceRefs).toEqual([evidence]);
    expect(packet.decisionRefs).toEqual([]);
    expect(packet.artifactRefs).toEqual([]);
    expect(Object.isFrozen(packet)).toBe(true);
  });

  it("rejects a standing packet that omits a source-required category", () => {
    expect(() => buildWorkroomOutcomePacket({
      sourceKey: "scheduled",
      outcomeState: "partially-achieved",
      summary: "Review completed without verification.",
      facts: [{ category: "receipts", sourceRef: receipt, provenance: "canonical" }],
      accountablePrincipalRef: "prn-finance-owner",
      completedAt: "2026-08-01T10:00:00.000Z",
    })).toThrowError(expect.objectContaining<Partial<WorkroomOutcomePacketError>>({ reason: "missing_required_category" }));
  });

  it.each(["decisions", "artifacts", "evidence"] as const)(
    "does not let raw chat satisfy the %s field",
    (category) => {
      expect(() => buildWorkroomOutcomePacket({
        sourceKey: "scheduled",
        outcomeState: "achieved",
        summary: "A chat message claimed the cycle was done.",
        facts: [
          { category, sourceRef: { kind: "work-item", id: "WIM-1", status: "comment" }, provenance: "raw-chat" },
          { category: "receipts", sourceRef: receipt, provenance: "canonical" },
          { category: "evidence", sourceRef: evidence, provenance: "canonical" },
        ],
        accountablePrincipalRef: "prn-finance-owner",
        completedAt: "2026-08-01T10:00:00.000Z",
      })).toThrowError(expect.objectContaining<Partial<WorkroomOutcomePacketError>>({ reason: "raw_chat_not_durable" }));
    },
  );

  it("requires every unresolved item to carry an explicit disposition", () => {
    expect(() => buildWorkroomOutcomePacket({
      sourceKey: "scheduled",
      outcomeState: "partially-achieved",
      summary: "One exception remains.",
      facts: [
        { category: "receipts", sourceRef: receipt, provenance: "canonical" },
        { category: "evidence", sourceRef: evidence, provenance: "canonical" },
      ],
      unresolvedWork: [{ summary: "Investigate variance", ownerRef: null, disposition: "later" as never }],
      accountablePrincipalRef: "prn-finance-owner",
      completedAt: "2026-08-01T10:00:00.000Z",
    })).toThrowError(expect.objectContaining<Partial<WorkroomOutcomePacketError>>({ reason: "invalid_unresolved_disposition" }));
  });
});
