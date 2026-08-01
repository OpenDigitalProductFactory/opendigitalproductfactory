import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/actions/external-evidence", () => ({ recordExternalEvidence: vi.fn() }));
vi.mock("@/lib/change-review/routed-semantic-review", () => ({ dispatchRoutedSemanticReview: vi.fn() }));
vi.mock("@/lib/work-capsules/work-capsule-store", () => ({ recordWorkCapsuleEvidence: vi.fn() }));

import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { changeReviewPack } from "./change-review-pack";

describe("change-review MCP pack", () => {
  it("exposes one native pre-publication review operation", () => {
    expect(changeReviewPack.definitions.map((definition) => definition.name)).toEqual([
      "review_semantic_change",
    ]);
    expect(Object.keys(changeReviewPack.handlers)).toEqual(["review_semantic_change"]);
  });

  it("requires evidence-writing authority", () => {
    expect(changeReviewPack.grants.review_semantic_change).toEqual(["backlog_write"]);
    expect(isToolAllowedByGrants("review_semantic_change", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("review_semantic_change", ["view_platform"])).toBe(false);
  });

  it("requires an immutable tree identity and exact artifact", () => {
    const definition = changeReviewPack.definitions[0]!;
    expect(definition.inputSchema.required).toEqual(expect.arrayContaining([
      "capsuleId",
      "baseTreeHash",
      "headTreeHash",
      "diffDigest",
      "artifact",
      "verificationEvidence",
    ]));
  });
});
