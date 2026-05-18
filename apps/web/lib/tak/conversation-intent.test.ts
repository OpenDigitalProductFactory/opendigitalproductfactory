import { describe, expect, it } from "vitest";
import { isPageExplanationOnlyRequest } from "./conversation-intent";

describe("isPageExplanationOnlyRequest", () => {
  it("treats natural workspace UI explanation asks as conversation-only", () => {
    expect(
      isPageExplanationOnlyRequest(
        "I'm finding this user interface a little bit confusing. Can you explain it for me?",
      ),
    ).toBe(true);

    expect(
      isPageExplanationOnlyRequest("You haven't explained it to me, can you do that?"),
    ).toBe(true);

    expect(
      isPageExplanationOnlyRequest(
        "I'm not asking about a backlog item, I'm looking for you to explain it is all.",
      ),
    ).toBe(true);
  });

  it("does not strip tools for explicit backlog, issue, or status requests", () => {
    expect(isPageExplanationOnlyRequest("Create a backlog item for this confusing UI")).toBe(false);
    expect(isPageExplanationOnlyRequest("File an issue because this page is confusing")).toBe(false);
    expect(isPageExplanationOnlyRequest("What are the top open backlog priorities?")).toBe(false);
  });
});
