import { describe, expect, it } from "vitest";
import {
  extractClaimedCreatedBacklogIds,
  extractToolCreatedBacklogIds,
  sanitizeBacklogCreateClaims,
} from "./backlog-create-claim-guard";

describe("extractClaimedCreatedBacklogIds", () => {
  it("finds Created: BI- style claims", () => {
    expect(
      extractClaimedCreatedBacklogIds(
        "Created: BI-0D1C52AE in EP-BUILD-STUDIO with your title.",
      ),
    ).toEqual(["BI-0D1C52AE"]);
  });

  it("finds multiple create claims in one reply", () => {
    const text = [
      "Created: BI-AAAA1111 for the first item.",
      "Created: BI-BBBB2222 for the second item.",
      "Created: BI-CCCC3333 for the third.",
    ].join("\n");
    expect(extractClaimedCreatedBacklogIds(text).sort()).toEqual([
      "BI-AAAA1111",
      "BI-BBBB2222",
      "BI-CCCC3333",
    ]);
  });

  it("does not treat a mere BI mention as a create claim", () => {
    expect(
      extractClaimedCreatedBacklogIds(
        "See BI-0D1C52AE for the external-PR ship path; no new item needed.",
      ),
    ).toEqual([]);
  });
});

describe("extractToolCreatedBacklogIds", () => {
  it("reads entityId from successful create_backlog_item", () => {
    expect(
      extractToolCreatedBacklogIds([
        {
          name: "create_backlog_item",
          result: { success: true, entityId: "BI-NEW12345", message: "Created backlog item BI-NEW12345" },
        },
      ]),
    ).toEqual(["BI-NEW12345"]);
  });

  it("ignores failed creates and other tools", () => {
    expect(
      extractToolCreatedBacklogIds([
        { name: "create_backlog_item", result: { success: false, error: "validation" } },
        { name: "query_backlog", result: { success: true, entityId: "BI-OLD" } },
      ]),
    ).toEqual([]);
  });
});

describe("sanitizeBacklogCreateClaims (BI-1BB7408D)", () => {
  it("leaves content alone when tool evidence matches the claim", () => {
    const content = "Created: BI-NEW12345 in EP-FOO with your acceptance criteria.";
    const { content: next, strippedClaimIds, verifiedIds } = sanitizeBacklogCreateClaims(content, [
      {
        name: "create_backlog_item",
        result: { success: true, entityId: "BI-NEW12345", message: "Created backlog item BI-NEW12345" },
      },
    ]);
    expect(next).toBe(content);
    expect(strippedClaimIds).toEqual([]);
    expect(verifiedIds).toEqual(["BI-NEW12345"]);
  });

  it("rewrites recycled pre-existing BI create claims with no tool evidence", () => {
    // The live incident: three identical bubbles claiming BI-0D1C52AE was
    // "created" when the row was 18h old and create_backlog_item never ran.
    const content =
      'Created: BI-0D1C52AE in EP-BUILD-STUDIO with your title, source, and full acceptance criteria…';
    const { content: next, strippedClaimIds, verifiedIds } = sanitizeBacklogCreateClaims(content, []);
    expect(strippedClaimIds).toEqual(["BI-0D1C52AE"]);
    expect(verifiedIds).toEqual([]);
    expect(next).not.toMatch(/Created:\s*BI-0D1C52AE/i);
    expect(next).toContain("not created this turn");
    expect(next).toContain("no backlog item was created in this turn");
  });

  it("keeps verified creates and flags only the unproven ones", () => {
    const content = [
      "Created: BI-REAL0001 for the promoter fix.",
      "Created: BI-FAKE0002 for the second item.",
    ].join("\n");
    const { content: next, strippedClaimIds, verifiedIds } = sanitizeBacklogCreateClaims(content, [
      {
        name: "create_backlog_item",
        result: { success: true, entityId: "BI-REAL0001" },
      },
    ]);
    expect(verifiedIds).toEqual(["BI-REAL0001"]);
    expect(strippedClaimIds).toEqual(["BI-FAKE0002"]);
    expect(next).toMatch(/Created:\s*BI-REAL0001/i);
    expect(next).toContain("BI-FAKE0002");
    expect(next).toContain("not created this turn");
  });

  it("is a no-op when there is no create claim", () => {
    const content = "Here is the backlog status. Open items remain under EP-BUILD-STUDIO.";
    const result = sanitizeBacklogCreateClaims(content, []);
    expect(result.content).toBe(content);
    expect(result.strippedClaimIds).toEqual([]);
  });
});
