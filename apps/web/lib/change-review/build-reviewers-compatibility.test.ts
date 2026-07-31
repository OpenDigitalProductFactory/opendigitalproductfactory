import { describe, expect, it } from "vitest";
import {
  buildCodeReviewPrompt,
  parseReviewResponse,
} from "@/lib/build-reviewers";
import {
  buildSemanticChangeReviewPrompt,
  parseSemanticReviewResponse,
} from "./semantic-change-review";

describe("Build Studio shared-contract adapter", () => {
  it("preserves the exact legacy code-review prompt", () => {
    expect(buildCodeReviewPrompt("Add filter", "const x = 1;", "PASS 1 test")).toBe(
      buildSemanticChangeReviewPrompt({
        title: "Add filter",
        artifact: "const x = 1;",
        verificationEvidence: "PASS 1 test",
        promptProfile: "build-studio-v1",
      }),
    );
  });

  it("preserves the shared surface-neutral parser result", () => {
    const raw =
      '{"decision":"fail","issues":[{"severity":"critical","description":"Auth bypass","location":"auth.ts:4"}],"summary":"blocked"}';
    expect(parseReviewResponse(raw)).toEqual(parseSemanticReviewResponse(raw));
  });
});
