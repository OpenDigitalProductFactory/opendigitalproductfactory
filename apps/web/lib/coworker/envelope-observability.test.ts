// BI-78D3CF1E — counting the consent requests that lapse.
//
// The load-bearing case is the third one: an envelope past its expiry still
// reads `status: "proposed"`, because nothing rewrites it when the window
// closes. A naive `count(status = proposed)` therefore reports blocked coworkers
// that nobody can actually unblock — which is how seven lapsed envelopes stayed
// invisible on a live install.

import { describe, expect, it, vi } from "vitest";

import {
  observeEnvelopes,
  publishEnvelopeObservation,
  type ObservableEnvelope,
} from "./envelope-observability";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const ahead = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const envelope = (overrides: Partial<ObservableEnvelope> = {}): ObservableEnvelope => ({
  status: "proposed",
  manifestActionId: "record_initiative_evidence",
  expiresAt: ahead(10),
  resolvedAt: null,
  ...overrides,
});

describe("observeEnvelopes", () => {
  it("counts a live proposal as awaiting a decision", () => {
    const got = observeEnvelopes([envelope()], NOW);
    expect(got.awaitingDecision).toBe(1);
    expect(got.expiredUnactioned).toBe(0);
  });

  it("counts a resolved envelope under its outcome, not as awaiting", () => {
    const got = observeEnvelopes(
      [
        envelope({ status: "approved", resolvedAt: ago(5) }),
        envelope({ status: "declined", resolvedAt: ago(5) }),
        envelope({ status: "executed", resolvedAt: ago(5) }),
      ],
      NOW,
    );
    expect(got.awaitingDecision).toBe(0);
    expect(got.byOutcome.approved).toBe(1);
    expect(got.byOutcome.declined).toBe(1);
    expect(got.byOutcome.executed).toBe(1);
  });

  // The whole point. The row still says "proposed" after the window closes.
  it("separates a lapsed envelope from one that can still be answered", () => {
    const got = observeEnvelopes(
      [
        envelope({ expiresAt: ago(1) }), // window closed
        envelope({ expiresAt: ahead(1) }), // still open
      ],
      NOW,
    );
    expect(got.expiredUnactioned).toBe(1);
    expect(got.awaitingDecision).toBe(1);
    expect(got.byOutcome.expired).toBe(1);
  });

  it("does not report a lapsed envelope as awaiting a decision nobody can make", () => {
    const got = observeEnvelopes([envelope({ expiresAt: ago(30) })], NOW);
    expect(got.awaitingDecision).toBe(0);
  });

  it("names WHICH actions went unanswered, not just how many", () => {
    const got = observeEnvelopes(
      [
        envelope({ expiresAt: ago(1), manifestActionId: "record_initiative_evidence" }),
        envelope({ expiresAt: ago(2), manifestActionId: "screen_dispatch_action" }),
      ],
      NOW,
    );
    expect(got.expiredActions).toEqual([
      "record_initiative_evidence",
      "screen_dispatch_action",
    ]);
  });

  it("treats an envelope with no expiry as open, never as lapsed", () => {
    const got = observeEnvelopes([envelope({ expiresAt: null })], NOW);
    expect(got.awaitingDecision).toBe(1);
    expect(got.expiredUnactioned).toBe(0);
  });

  it("treats the exact expiry instant as closed", () => {
    const got = observeEnvelopes([envelope({ expiresAt: NOW })], NOW);
    expect(got.expiredUnactioned).toBe(1);
  });

  it("ignores an unrecognised status rather than crashing the projection", () => {
    const got = observeEnvelopes([envelope({ status: "invented" })], NOW);
    expect(got.awaitingDecision).toBe(0);
    expect(got.expiredUnactioned).toBe(0);
  });

  it("returns zeroes for an empty set", () => {
    const got = observeEnvelopes([], NOW);
    expect(got.awaitingDecision).toBe(0);
    expect(got.expiredUnactioned).toBe(0);
    expect(got.expiredActions).toEqual([]);
  });

  // Reproduces the live finding: several envelopes, all still reading
  // "proposed", none of them actionable.
  it("reproduces the seven-lapsed-envelopes case", () => {
    const lapsed = Array.from({ length: 7 }, (_, index) =>
      envelope({ expiresAt: ago(20 + index) }),
    );
    const got = observeEnvelopes(lapsed, NOW);
    expect(got.expiredUnactioned).toBe(7);
    expect(got.awaitingDecision).toBe(0);
    expect(got.byOutcome.expired).toBe(7);
  });
});

describe("publishEnvelopeObservation", () => {
  it("sets both gauges from one observation", () => {
    const sinks = { awaiting: { set: vi.fn() }, expiredUnactioned: { set: vi.fn() } };
    publishEnvelopeObservation(
      observeEnvelopes(
        [envelope(), envelope({ expiresAt: ago(1) }), envelope({ expiresAt: ago(2) })],
        NOW,
      ),
      sinks,
    );
    expect(sinks.awaiting.set).toHaveBeenCalledWith(1);
    expect(sinks.expiredUnactioned.set).toHaveBeenCalledWith(2);
  });

  // Gauges, not counters: these are observed on a render, so a counter would
  // multiply by however often anyone happens to look at the page.
  it("is idempotent — observing twice does not double the reported figure", () => {
    const sinks = { awaiting: { set: vi.fn() }, expiredUnactioned: { set: vi.fn() } };
    const observation = observeEnvelopes([envelope({ expiresAt: ago(1) })], NOW);
    publishEnvelopeObservation(observation, sinks);
    publishEnvelopeObservation(observation, sinks);
    expect(sinks.expiredUnactioned.set).toHaveBeenNthCalledWith(1, 1);
    expect(sinks.expiredUnactioned.set).toHaveBeenNthCalledWith(2, 1);
  });

  it("never lets a registry mishap break the caller", () => {
    const sinks = {
      awaiting: {
        set: () => {
          throw new Error("registry exploded");
        },
      },
      expiredUnactioned: {
        set: () => {
          throw new Error("registry exploded");
        },
      },
    };
    expect(() =>
      publishEnvelopeObservation(observeEnvelopes([envelope()], NOW), sinks),
    ).not.toThrow();
  });
});
