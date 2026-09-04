import { describe, it, expect } from "vitest";
import {
  describeCapacityWindow,
  describeToolRouteFailureOutcome,
  describeToolRouteFailure,
  localCapacityHeldHandoff,
  noEligibleModelHandoff,
  providersBusyHandoff,
  sensitivityClearanceHandoff,
  unexplainedDeadEndHandoff,
} from "./inference-dead-ends";

// BI-33F1EA72. Measured on the live install: 196 of 1,138 assistant messages
// were dead ends, and 84% of those were provider availability — the paths the
// hand-off rung originally did NOT cover.
describe("dead-end replies hand off instead of asking the user to poll", () => {
  const all = [
    ["no eligible model", noEligibleModelHandoff()],
    ["providers busy", providersBusyHandoff()],
    ["local capacity held", localCapacityHeldHandoff()],
    ["sensitivity clearance", sensitivityClearanceHandoff("confidential")],
    ["unexplained dead end", unexplainedDeadEndHandoff()],
  ] as const;

  it.each(all)("%s ends on the resumption, not on the limitation", (_name, message) => {
    const lastLine = message.trimEnd().split("\n").pop() ?? "";
    expect(lastLine).toMatch(/pick this|straight back up/i);
  });

  it.each(all)("%s gives at least one numbered step", (_name, message) => {
    expect(message).toMatch(/^1\. /m);
  });

  it("stops telling the user to poll on an unexplained dead end", () => {
    // The prior copy was "Please try again in about 30 seconds." — a poll
    // instruction with no step and no resumption. 114 of 196 dead ends.
    const message = unexplainedDeadEndHandoff();
    expect(message).not.toMatch(/try again in about 30 seconds/i);
    expect(message).toMatch(/Providers & Routing/);
  });

  // BI-A89E4827. The catch-all is by construction the branch that matched
  // nothing, so it must not name a cause. The old copy asserted "an expired
  // sign-in or exhausted quota is the usual cause" and sent an owner whose
  // providers were all healthy to a settings page that could not help.
  it("does not assert a cause it has not established", () => {
    const message = unexplainedDeadEndHandoff();
    expect(message).toMatch(/can't tell from here/i);
    expect(message).not.toMatch(/is the usual cause/i);
    expect(message).not.toMatch(/exhausted quota/i);
  });

  // BI-A89E4827. A host-capacity deferral is not a configuration problem, so
  // the reply must not send the owner to a settings surface that cannot clear
  // it — reconnecting a provider provably does nothing here.
  it("treats a local capacity deferral as a wait, naming no settings surface", () => {
    const message = localCapacityHeldHandoff();
    expect(message).toMatch(/Nothing is misconfigured/);
    expect(message).toMatch(/background job/i);
    expect(message).not.toMatch(/Providers & Routing/);
    expect(message).not.toMatch(/reconnect/i);
  });

  it("says so when host capacity could not be confirmed either way", () => {
    expect(localCapacityHeldHandoff(true)).toMatch(/couldn't confirm/i);
  });

  it("keeps the genuinely transient case short rather than inventing config steps", () => {
    // Nothing is misconfigured when every endpoint is rate-limited, so a
    // three-step "go check your settings" would be a fabricated instruction.
    const message = providersBusyHandoff();
    expect(message).toMatch(/Nothing is misconfigured/);
    expect(message).not.toMatch(/^2\. /m);
  });

  it("names the routing causes rather than blaming a disconnected provider", () => {
    const message = noEligibleModelHandoff();
    expect(message).toMatch(/residency|data-policy/);
    expect(message).toMatch(/context size/);
  });
});
describe("describeToolRouteFailure classifies the deferral that stranded the owner", () => {
  // The exact error text and class name observed on the live install:
  //   [agentic-loop] routeAndCall threw:
  //   Local provider dispatch deferred: local-ci-active-capacity-reservation
  const deferralMessage = "Local provider dispatch deferred: local-ci-active-capacity-reservation";

  it("recognises the typed error even when the message is opaque", () => {
    const typed = Object.assign(new Error("something else entirely"), {
      name: "LocalProviderCapacityDeferredError",
    });
    expect(describeToolRouteFailure("something else entirely", 0, typed))
      .toBe(localCapacityHeldHandoff());
  });

  it("recognises the deferral when only its message survived a queue boundary", () => {
    expect(describeToolRouteFailure(deferralMessage, 0)).toBe(localCapacityHeldHandoff());
  });

  it("distinguishes unproven capacity from held capacity", () => {
    expect(
      describeToolRouteFailure(
        "Local provider dispatch deferred: local-ci-capacity-reservation-unavailable",
        0,
      ),
    ).toBe(localCapacityHeldHandoff(true));
  });

  it("no longer sends a deferred turn to Providers & Routing", () => {
    expect(describeToolRouteFailure(deferralMessage, 0)).not.toMatch(/Providers & Routing/);
  });

  it("leaves the established branches alone", () => {
    expect(describeToolRouteFailure("REQUEST_TOO_LARGE: 200000", 0))
      .toMatch(/too long for this AI provider/);
    expect(describeToolRouteFailure("No credential for codex", 0))
      .toMatch(/No AI provider credentials are configured/);
    expect(describeToolRouteFailure("58 tools exceeds threshold for small local models", 58))
      .toMatch(/58 of them/);
    expect(describeToolRouteFailure("No eligible endpoints: toolUse required", 0))
      .toMatch(/supports tools is active right now/);
    expect(describeToolRouteFailure("No eligible endpoints for task type 'conversation'", 0))
      .toBe(noEligibleModelHandoff());
    expect(describeToolRouteFailure("All endpoints failed for conversation", 0))
      .toBe(providersBusyHandoff());
  });

  // BI-431524DF. A confidential coworker's empty route is a data-governance block,
  // not an outage — it must NOT tell the operator to re-check connected providers.
  it("names the clearance lever when the block is sensitivity, not availability", () => {
    const routerReason =
      "No eligible endpoints for task type 'conversation' with sensitivity 'confidential'. " +
      "3 endpoint(s) excluded. No connected provider is cleared for 'confidential' data.";
    const message = describeToolRouteFailure(routerReason, 0);

    expect(message).toBe(sensitivityClearanceHandoff("confidential"));
    // The wrong advice the generic branch would give, explicitly absent.
    expect(message).not.toMatch(/provider status/i);
    // The real levers, present.
    expect(message).toMatch(/no-training/i);
    expect(message).toMatch(/local model/i);
    // Never implies attesting a personal subscription.
    expect(message).toMatch(/business or enterprise account/i);
  });

  it("classifies the sensitivity-clearance dead end as policy-or-capability", () => {
    const outcome = describeToolRouteFailureOutcome(
      "No eligible endpoints for task type 'conversation' with sensitivity 'restricted'. " +
        "2 endpoint(s) excluded. No connected provider is cleared for 'restricted' data.",
      0,
    );
    expect(outcome.kind).toBe("policy-or-capability");
    expect(outcome.message).toBe(sensitivityClearanceHandoff("restricted"));
  });

  // Regression: an empty route with NO clearance clause stays the generic copy —
  // the clearance branch must not swallow ordinary "no eligible endpoints" cases.
  it("leaves a non-clearance empty route on the generic hand-off", () => {
    expect(describeToolRouteFailure("No eligible endpoints for task type 'conversation'", 0))
      .toBe(noEligibleModelHandoff());
  });

  it("falls through to the unexplained hand-off, not to a fabricated cause", () => {
    expect(describeToolRouteFailure("ECONNRESET talking to the model host", 0))
      .toBe(unexplainedDeadEndHandoff());
  });

  it("does not call a missing model busy", () => {
    const outcome = describeToolRouteFailureOutcome(
      'All endpoints failed for conversation. Attempts: [{"endpointId":"docker-model-runner","error":"Model not found"}]',
      0,
    );

    expect(outcome.kind).toBe("model-missing");
    expect(outcome.message).not.toMatch(/busy|rate-limit/i);
    expect(outcome.message).toMatch(/model.*unavailable|available model/i);
  });

  it("keeps the bounded reconciliation signal classified as model-missing", () => {
    const outcome = describeToolRouteFailureOutcome(
      "Provider model inventory changed for docker-model-runner. Attempts: []",
      0,
    );

    expect(outcome.kind).toBe("model-missing");
    expect(outcome.message).not.toMatch(/busy|rate-limit/i);
  });
});

// BI-94D44FDB. The owner-facing half: a deferral is a bounded wait, so say how
// long rather than leaving them to guess or poll.
describe("the capacity reply names the window when it knows one", () => {
  const now = new Date("2026-08-23T20:14:00.000Z");

  it("turns a lease expiry into a plain relative window", () => {
    expect(describeCapacityWindow(new Date("2026-08-23T20:17:00.000Z"), now))
      .toBe("about 3 minutes");
    expect(describeCapacityWindow(new Date("2026-08-23T20:14:40.000Z"), now))
      .toBe("about a minute");
  });

  it("says nothing rather than something wrong", () => {
    // Already past, implausibly far out, absent, or unparseable — in every case
    // a made-up number would be worse than the generic wait.
    expect(describeCapacityWindow(new Date("2026-08-23T20:13:00.000Z"), now)).toBeNull();
    expect(describeCapacityWindow(new Date("2026-08-23T22:00:00.000Z"), now)).toBeNull();
    expect(describeCapacityWindow(null, now)).toBeNull();
    expect(describeCapacityWindow(new Date("nonsense"), now)).toBeNull();
  });

  it("puts the window in the step, not in a separate sentence to skim past", () => {
    const message = localCapacityHeldHandoff(false, new Date("2026-08-23T20:17:00.000Z"), now);
    expect(message).toMatch(/^1\. Send the message again in about 3 minutes at the earliest/m);
    expect(message).toMatch(/Nothing is misconfigured/);
  });

  // BI-EBE25715: with no window we do not know how long the host stays
  // reserved, and a queue behind the current claim can make it indefinite.
  // Saying "a couple of minutes" was a promise the platform cannot keep.
  it("admits it cannot tell how long when no window is known", () => {
    const message = localCapacityHeldHandoff(false, null, now);
    expect(message).toMatch(/I can't tell from here how long that will be/);
    expect(message).not.toMatch(/couple of minutes/);
  });

  it("frames a known window as the EARLIEST it could free, not a promise", () => {
    const message = localCapacityHeldHandoff(false, new Date("2026-08-23T20:17:00.000Z"), now);
    expect(message).toMatch(/at the earliest/);
    expect(message).toMatch(/nothing else is waiting for this machine/);
  });

  it("reads the window off the thrown error the routing layer produced", () => {
    const thrown = Object.assign(
      new Error("Local provider dispatch deferred: local-ci-active-capacity-reservation"),
      {
        name: "LocalProviderCapacityDeferredError",
        expectedFreeAt: new Date(Date.now() + 3 * 60_000),
      },
    );

    expect(describeToolRouteFailure(thrown.message, 0, thrown)).toMatch(/about 3 minutes/);
  });

  it("survives the window arriving as a serialized string across a queue boundary", () => {
    const thrown = {
      name: "LocalProviderCapacityDeferredError",
      message: "Local provider dispatch deferred: local-ci-active-capacity-reservation",
      expectedFreeAt: new Date(Date.now() + 2 * 60_000).toISOString(),
    };

    expect(describeToolRouteFailure(thrown.message, 0, thrown)).toMatch(/about 2 minutes/);
  });
});
