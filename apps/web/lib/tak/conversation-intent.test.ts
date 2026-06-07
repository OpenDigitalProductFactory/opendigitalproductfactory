import { describe, expect, it } from "vitest";
import {
  isConversationalExpansionRequest,
  isPageExplanationOnlyRequest,
  isPlatformMechanismQuestion,
  isRedundantReaskQuestion,
  isTrivialSocialMessage,
} from "./conversation-intent";

describe("isRedundantReaskQuestion", () => {
  it("flags a short re-ask of a question the model already asked", () => {
    const prior = ["Which scope did you want — the whole portfolio or just Foundational?"];
    expect(
      isRedundantReaskQuestion(
        "Just to confirm, which scope did you want — the whole portfolio or just Foundational?",
        prior,
      ),
    ).toBe(true);
  });

  it("does NOT flag a substantive answer that merely ends with an engagement question", () => {
    // The exact false-positive from the /portfolio trace, 2026-06-04: a good
    // 1500-char answer that shares generic vocabulary with the greeting and
    // ends with one engagement question must NOT trigger a re-dispatch.
    const prior = [
      "Hi! I'm your Portfolio Analyst on the /portfolio view. I see your portfolio has 58 products spread across 4 portfolios. What would you like to focus on?",
    ];
    const substantiveAnswer =
      "You're looking at your portfolio dashboard — a bird's-eye view of every product initiative your company is running, organized into four strategic buckets. " +
      "Foundational holds 57 of your 58 products, which is an extreme concentration worth watching. The other three portfolios are nearly empty. " +
      "Budget sources aren't connected for any portfolio, so health scores are partial. What would you like to focus on first?";
    expect(substantiveAnswer.length).toBeGreaterThan(350);
    expect(isRedundantReaskQuestion(substantiveAnswer, prior)).toBe(false);
  });

  it("does not flag when there is no prior question to repeat", () => {
    expect(
      isRedundantReaskQuestion("Which portfolio did you mean?", [
        "Your portfolio has 58 products across 4 buckets.",
      ]),
    ).toBe(false);
  });

  it("ignores responses with no question mark", () => {
    expect(
      isRedundantReaskQuestion("Here are your three risks.", ["What did you mean?"]),
    ).toBe(false);
  });
});

describe("isTrivialSocialMessage", () => {
  it("matches greetings, thanks, acknowledgements, and farewells", () => {
    for (const msg of [
      "hello",
      "Hi!",
      "hey there",
      "good morning",
      "good evening",
      "thanks",
      "thank you",
      "thank you so much",
      "thx",
      "ty",
      "ok cool thanks",
      "got it",
      "that sounds great",
      "perfect",
      "awesome, thanks!",
      "appreciate it",
      "bye",
      "see you later",
      "cheers",
    ]) {
      expect(isTrivialSocialMessage(msg), msg).toBe(true);
    }
  });

  it("does NOT strip tools for real requests, even terse ones", () => {
    for (const msg of [
      "what are my top 3 portfolio risks right now?",
      "yes, do the truck list first",
      "ok now create a backlog item",
      "hi, can you summarize the open epics?",
      "thanks — now deploy it",
      "good work on the deploy", // contains a real noun
      "show me the backlog",
      "what's broken?",
      "yes",
      "no",
      "deploy",
    ]) {
      expect(isTrivialSocialMessage(msg), msg).toBe(false);
    }
  });

  it("ignores empty and whitespace-only input", () => {
    expect(isTrivialSocialMessage("")).toBe(false);
    expect(isTrivialSocialMessage("   ")).toBe(false);
  });
});

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
