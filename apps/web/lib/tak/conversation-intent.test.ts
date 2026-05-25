import { describe, expect, it } from "vitest";
import {
  isConversationalExpansionRequest,
  isPageExplanationOnlyRequest,
  isPlatformMechanismQuestion,
} from "./conversation-intent";

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

describe("isPlatformMechanismQuestion", () => {
  it("matches mechanism questions about deploy / promote / rebase", () => {
    // The motivating case: Build Studio FB-71FB3A53 thread, 2026-05-22.
    expect(
      isPlatformMechanismQuestion(
        "if I deploy this PR to promote it to production, will it also re-base with the main project too?",
      ),
    ).toBe(true);
    expect(isPlatformMechanismQuestion("Will deploying this also run tests?")).toBe(true);
    expect(isPlatformMechanismQuestion("Does promoting trigger a release bundle?")).toBe(true);
    expect(isPlatformMechanismQuestion("What happens when I ship a build?")).toBe(true);
    expect(isPlatformMechanismQuestion("How does the sandbox get torn down?")).toBe(true);
    expect(isPlatformMechanismQuestion("Is rebase part of the deploy step?")).toBe(true);
  });

  it("does not match requests to the agent in question form", () => {
    // Second-person "will/can/could you ..." is a request, not a mechanism Q.
    expect(isPlatformMechanismQuestion("Will you promote BI-71FB3A53?")).toBe(false);
    expect(isPlatformMechanismQuestion("Can you deploy this PR?")).toBe(false);
    expect(isPlatformMechanismQuestion("Could you start the sandbox?")).toBe(false);
  });

  it("does not match imperative actions even with a trailing question mark", () => {
    expect(isPlatformMechanismQuestion("Promote this build to production?")).toBe(false);
    expect(isPlatformMechanismQuestion("Deploy the PR?")).toBe(false);
    expect(isPlatformMechanismQuestion("Run the release gate?")).toBe(false);
  });

  it("requires a trailing question mark", () => {
    expect(
      isPlatformMechanismQuestion("if I deploy this PR to promote it, it will also re-base"),
    ).toBe(false);
  });

  it("requires a platform action verb", () => {
    // Question opener present but no platform verb — not a mechanism question.
    expect(isPlatformMechanismQuestion("What happens next?")).toBe(false);
    expect(isPlatformMechanismQuestion("If I do this, will it work?")).toBe(false);
  });

  it("handles empty / whitespace-only input", () => {
    expect(isPlatformMechanismQuestion("")).toBe(false);
    expect(isPlatformMechanismQuestion("   ")).toBe(false);
    expect(isPlatformMechanismQuestion("?")).toBe(false);
  });
});

describe("isConversationalExpansionRequest", () => {
  it("treats terse follow-up expansion requests as read-only conversation", () => {
    expect(isConversationalExpansionRequest("elaborate")).toBe(true);
    expect(isConversationalExpansionRequest("tell me more")).toBe(true);
    expect(isConversationalExpansionRequest("more detail please")).toBe(true);
    expect(isConversationalExpansionRequest("expand on that")).toBe(true);
  });

  it("does not treat action confirmations as expansion requests", () => {
    expect(isConversationalExpansionRequest("yes, log it")).toBe(false);
    expect(isConversationalExpansionRequest("do it")).toBe(false);
    expect(isConversationalExpansionRequest("create the backlog item")).toBe(false);
    expect(isConversationalExpansionRequest("continue")).toBe(false);
  });
});
