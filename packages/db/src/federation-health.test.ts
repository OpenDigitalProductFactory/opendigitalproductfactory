import { describe, expect, it } from "vitest";

import { describePullFailure, resolveFederationHealth, type FederationLinkHealthInput } from "./federation-health";

const now = new Date("2026-09-02T21:00:00.000Z");

function link(overrides: Partial<FederationLinkHealthInput> = {}): FederationLinkHealthInput {
  return {
    linkId: "link_1", peerLabel: "Production", mirroredItems: 1620,
    lastPullAt: new Date("2026-09-02T20:57:00.000Z"), lastOutcome: "synced", lastDetail: null, conflicts: 0,
    ...overrides,
  };
}

describe("resolveFederationHealth", () => {
  it("says In step with counts and recency when the last pull is within the cadence", () => {
    const health = resolveFederationHealth({ links: [link()], now });
    expect(health.state).toBe("in-step");
    expect(health.line).toBe("In step with Production: 1,620 items mirrored here, last copy 3 minutes ago.");
  });

  it("says Behind when the last successful pull is older than two cadences, and mentions conflicts", () => {
    const health = resolveFederationHealth({ links: [link({ lastPullAt: new Date("2026-09-02T20:30:00.000Z"), conflicts: 4 })], now });
    expect(health.state).toBe("behind");
    expect(health.line).toBe("Behind by 30 minutes: the last copy from Production landed 30 minutes ago (4 ids left alone because local work uses them).");
  });

  it("says Broken because … with the platform's next move, never a human instruction", () => {
    const stale = resolveFederationHealth({ links: [link({ lastOutcome: "fetch-failed", lastDetail: "Peer does not serve work sync yet (upgrade the peer)." })], now });
    expect(stale.state).toBe("broken");
    expect(stale.line).toBe("Broken because the other installation is on a version that predates backlog sync; it upgrades on its own in its next quiet period and this retries every five minutes.");
    const never = resolveFederationHealth({ links: [link({ lastPullAt: null, lastOutcome: null })], now });
    expect(never.line).toBe("Broken because nothing has arrived from Production yet; this retries every five minutes.");
    expect(describePullFailure("invalid-page", "items[125].proposedOutcome:invalid")).toContain("cannot read (items[125].proposedOutcome:invalid)");
    expect(describePullFailure("no-token", null)).toContain("re-pairs on the next tick");
  });

  it("rolls several connections up to the worst one, and has a line for no peers", () => {
    const health = resolveFederationHealth({
      links: [link(), link({ linkId: "link_2", peerLabel: "Lab", lastOutcome: "fetch-failed", lastDetail: "Peer responded 500" })],
      now,
    });
    expect(health.state).toBe("broken");
    expect(health.line).toMatch(/^Broken because the other installation could not be reached \(Peer responded 500\); this retries every five minutes\. \(1 other connection in step\)$/);
    expect(health.links.map((l) => l.state)).toEqual(["in-step", "broken"]);
    const both = resolveFederationHealth({ links: [link(), link({ linkId: "link_2", peerLabel: "Lab", mirroredItems: 10 })], now });
    expect(both.line).toBe("In step with 2 installations: 1,630 items mirrored here.");
    expect(resolveFederationHealth({ links: [], now })).toMatchObject({ state: "no-peer", line: "No other installation in the organization is connected." });
  });
});
