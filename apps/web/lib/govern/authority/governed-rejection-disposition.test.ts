import { describe, expect, it } from "vitest";
import { GOVERNED_REJECTION_DISPOSITION, isGovernedToolRefusal, rejectionMessage } from "./governed-rejection-disposition";

describe("isGovernedToolRefusal", () => {
  it.each(Object.entries(GOVERNED_REJECTION_DISPOSITION))(
    "preserves the canonical disposition for %s without new error-code policy",
    (error, disposition) => {
      expect(isGovernedToolRefusal({ success: false, error })).toBe(disposition === "refused");
    },
  );

  it.each(["awaiting-person", "awaiting-input", "inconclusive"] as const)(
    "honors an explicit %s result over a legacy error field",
    (disposition) => {
      expect(isGovernedToolRefusal({ success: false, error: "authority_denied", disposition })).toBe(false);
    },
  );

  it("does not classify successful work or an unknown execution error as refusal", () => {
    expect(isGovernedToolRefusal({ success: true, error: "authority_denied" })).toBe(false);
    expect(isGovernedToolRefusal({ success: false, error: "database temporarily unavailable" })).toBe(false);
    expect(isGovernedToolRefusal({ success: false, error: "toString" })).toBe(false);
  });

  it("recognizes an explicit refusal without an error code", () => {
    expect(isGovernedToolRefusal({ success: false, disposition: "refused" })).toBe(true);
  });

  it("words a deterministic authority failure as a refusal, not an unavailable check (BI-5FDE148A)", () => {
    for (const code of [
      "authority_subject_not_found",
      "authority_binding_mismatch",
      "authority_scope_missing",
    ] as const) {
      expect(GOVERNED_REJECTION_DISPOSITION[code]).toBe("refused");
      const caller = rejectionMessage("get_backlog_item", "The governed backlog item does not exist.", GOVERNED_REJECTION_DISPOSITION[code]);
      expect(caller).toContain("The governed backlog item does not exist.");
      expect(caller).not.toMatch(/unavailable|retried unchanged/);
    }
    const retry = rejectionMessage(
      "get_backlog_item",
      "connect ETIMEDOUT",
      GOVERNED_REJECTION_DISPOSITION.authority_evidence_unavailable,
    );
    expect(retry).toMatch(/retried unchanged/);
    expect(retry).toMatch(/unavailable/);
  });
});
