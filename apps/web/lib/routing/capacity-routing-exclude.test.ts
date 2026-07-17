import { describe, expect, it } from "vitest";
import {
  applyCapacitySoftExclusion,
  capacityRoutingExclusionReason,
} from "./capacity-routing-exclude";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");

describe("capacityRoutingExclusionReason", () => {
  it("allows available / unknown / missing", () => {
    expect(capacityRoutingExclusionReason(null, NOW)).toBeNull();
    expect(capacityRoutingExclusionReason({ state: "available" }, NOW)).toBeNull();
    expect(capacityRoutingExclusionReason({ state: "unknown" }, NOW)).toBeNull();
  });

  it("blocks reauth and billing while peers can take over", () => {
    expect(capacityRoutingExclusionReason({ state: "reauth_required" }, NOW)).toMatch(
      /reauth_required/,
    );
    expect(capacityRoutingExclusionReason({ state: "billing_action_required" }, NOW)).toMatch(
      /billing/,
    );
  });

  it("blocks rate_limited until retryAt, then clears", () => {
    const future = NOW + 60_000;
    expect(
      capacityRoutingExclusionReason({ state: "rate_limited", retryAtMs: future }, NOW),
    ).toMatch(/rate_limited/);
    expect(
      capacityRoutingExclusionReason({ state: "rate_limited", retryAtMs: NOW - 1 }, NOW),
    ).toBeNull();
  });

  it("fail-closes rate_limited without retryAt (stale but still unhealthy)", () => {
    expect(capacityRoutingExclusionReason({ state: "rate_limited" }, NOW)).toMatch(
      /rate_limited/,
    );
  });
});

describe("applyCapacitySoftExclusion", () => {
  const eps = [
    { providerId: "codex", id: "e1" },
    { providerId: "local", id: "e2" },
  ];

  it("drops unhealthy providers when a healthy peer remains (BI-3607DDDA)", () => {
    const map = new Map([
      ["codex", { state: "reauth_required" }],
      ["local", { state: "available" }],
    ]);
    const r = applyCapacitySoftExclusion({
      endpoints: eps,
      capacityByProvider: map,
      nowMs: NOW,
    });
    expect(r.eligible.map((e) => e.providerId)).toEqual(["local"]);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0]!.endpoint.providerId).toBe("codex");
    expect(r.excluded[0]!.reason).toMatch(/reauth_required/);
  });

  it("keeps the sole unhealthy provider rather than lock out the install", () => {
    const map = new Map([["codex", { state: "rate_limited", retryAtMs: NOW + 99_000 }]]);
    const r = applyCapacitySoftExclusion({
      endpoints: [eps[0]!],
      capacityByProvider: map,
      nowMs: NOW,
    });
    expect(r.eligible).toHaveLength(1);
    expect(r.excluded).toHaveLength(0);
  });

  it("leaves everyone when capacity map is empty", () => {
    const r = applyCapacitySoftExclusion({
      endpoints: eps,
      capacityByProvider: new Map(),
      nowMs: NOW,
    });
    expect(r.eligible).toHaveLength(2);
    expect(r.excluded).toHaveLength(0);
  });
});
