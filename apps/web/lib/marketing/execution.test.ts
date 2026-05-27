import { describe, it, expect } from "vitest";
import {
  OUTBOUND_DRAFT_STATUS,
  OUTBOUND_APPROVAL_DECISION,
  OUTBOUND_DOMAIN,
  OUTBOUND_SOURCE_TYPE,
  OUTBOUND_BODY_FORMAT,
  isAllowedDraftTransition,
  assertDraftTransition,
  draftStatusForDecision,
} from "./execution";

describe("OUTBOUND_DRAFT_STATUS catalog", () => {
  it("contains the six expected states", () => {
    expect([...OUTBOUND_DRAFT_STATUS].sort()).toEqual(
      ["approved", "draft", "needs-changes", "pending-review", "rejected", "stale"],
    );
  });
});

describe("OUTBOUND_APPROVAL_DECISION catalog", () => {
  it("matches draft status transitions", () => {
    expect([...OUTBOUND_APPROVAL_DECISION].sort()).toEqual(
      ["approved", "needs-changes", "rejected"],
    );
  });
});

describe("OUTBOUND_DOMAIN catalog", () => {
  it("starts with marketing as the first adopter", () => {
    expect(OUTBOUND_DOMAIN).toContain("marketing");
  });
});

describe("OUTBOUND_SOURCE_TYPE catalog", () => {
  it("includes marketing-asset-task for Phase 1 + future inbound source", () => {
    expect([...OUTBOUND_SOURCE_TYPE].sort()).toEqual(
      ["inbound-channel-message", "manual", "marketing-asset-task", "marketing-campaign-brief"],
    );
  });
});

describe("OUTBOUND_BODY_FORMAT catalog", () => {
  it("supports markdown / html / plain", () => {
    expect([...OUTBOUND_BODY_FORMAT].sort()).toEqual(["html", "markdown", "plain"]);
  });
});

describe("draft state machine", () => {
  it("allows pending-review → approved", () => {
    expect(isAllowedDraftTransition("pending-review", "approved")).toBe(true);
  });

  it("allows pending-review → rejected", () => {
    expect(isAllowedDraftTransition("pending-review", "rejected")).toBe(true);
  });

  it("allows pending-review → needs-changes", () => {
    expect(isAllowedDraftTransition("pending-review", "needs-changes")).toBe(true);
  });

  it("allows needs-changes → pending-review (drafter produces a new revision)", () => {
    expect(isAllowedDraftTransition("needs-changes", "pending-review")).toBe(true);
  });

  it("rejects approved → approved (idempotency boundary)", () => {
    expect(isAllowedDraftTransition("approved", "approved")).toBe(false);
  });

  it("rejects rejected → approved (no resurrection without a new draft)", () => {
    expect(isAllowedDraftTransition("rejected", "approved")).toBe(false);
  });

  it("rejects approved → rejected (terminal)", () => {
    expect(isAllowedDraftTransition("approved", "rejected")).toBe(false);
  });

  it("assertDraftTransition throws with a clear message on illegal transition", () => {
    expect(() => assertDraftTransition("approved", "approved")).toThrow(/Illegal/);
  });

  it("assertDraftTransition does not throw on legal transition", () => {
    expect(() => assertDraftTransition("pending-review", "approved")).not.toThrow();
  });
});

describe("draftStatusForDecision", () => {
  it("maps approved decision to approved status", () => {
    expect(draftStatusForDecision("approved")).toBe("approved");
  });

  it("maps rejected decision to rejected status", () => {
    expect(draftStatusForDecision("rejected")).toBe("rejected");
  });

  it("maps needs-changes decision to needs-changes status", () => {
    expect(draftStatusForDecision("needs-changes")).toBe("needs-changes");
  });
});
