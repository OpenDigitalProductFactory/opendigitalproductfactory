import { describe, expect, it } from "vitest";
import {
  applyCapacitySoftExclusion,
  capacityRoutingExclusionReason,
  STALE_TEMPORARY_CAPACITY_MS,
} from "./capacity-routing-exclude";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");

describe("capacityRoutingExclusionReason", () => {
  it("isolates account health while retaining shared quota restrictions", () => {
    const endpoints = [{ providerId: "openai", providerConnectionId: "a" }, { providerId: "openai", providerConnectionId: "b" }];
    const result = applyCapacitySoftExclusion({ endpoints, capacityByProvider: new Map([["openai:account:a", { state: "reauth_required" }]]), nowMs: NOW });
    expect(result.eligible).toEqual([endpoints[1]]);
    const quota = applyCapacitySoftExclusion({ endpoints: [...endpoints, { providerId: "local", providerConnectionId: "local" }], capacityByProvider: new Map([["openai", { state: "quota_resets_at", retryAtMs: NOW + 60000 }]]), nowMs: NOW });
    expect(quota.eligible).toEqual([{ providerId: "local", providerConnectionId: "local" }]);
  });
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

  it("fail-closes rate_limited without retryAt when the observation age is unknown", () => {
    expect(capacityRoutingExclusionReason({ state: "rate_limited" }, NOW)).toMatch(
      /rate_limited/,
    );
  });

  it("keeps blocking a retryAt-less rate_limited that was observed recently", () => {
    expect(
      capacityRoutingExclusionReason(
        { state: "rate_limited", retryAtMs: null, observedAtMs: NOW - 60_000 },
        NOW,
      ),
    ).toMatch(/rate_limited/);
  });

  it("stops blocking a retryAt-less rate_limited once the observation is stale", () => {
    const observed = NOW - STALE_TEMPORARY_CAPACITY_MS - 1;
    expect(
      capacityRoutingExclusionReason(
        { state: "rate_limited", retryAtMs: null, observedAtMs: observed },
        NOW,
      ),
    ).toBeNull();
    expect(
      capacityRoutingExclusionReason(
        { state: "cooling_down", retryAtMs: null, observedAtMs: observed },
        NOW,
      ),
    ).toBeNull();
  });

  it("a stale observation does not override an explicit future retryAt", () => {
    expect(
      capacityRoutingExclusionReason(
        {
          state: "rate_limited",
          retryAtMs: NOW + 60_000,
          observedAtMs: NOW - STALE_TEMPORARY_CAPACITY_MS - 1,
        },
        NOW,
      ),
    ).toMatch(/rate_limited/);
  });
});

describe("applyCapacitySoftExclusion", () => {
  const unconfirmedQuota = { state: "rate_limited", retryAtMs: NOW - 1,
    observedAtMs: NOW - 60_000, quotaResetUnconfirmed: true };

  it("keeps an observed quota hold after heuristic probe eligibility, without claiming a reset", () => {
    expect(capacityRoutingExclusionReason(unconfirmedQuota, NOW)).toMatch(/quota.*unconfirmed/i);
  });

  it("does not restore a quota-held sole candidate when there is no eligible alternative", () => {
    const endpoint = { providerId: "anthropic-sub", id: "subscription" };
    const result = applyCapacitySoftExclusion({ endpoints: [endpoint],
      capacityByProvider: new Map([[endpoint.providerId, unconfirmedQuota]]), nowMs: NOW });
    expect(result.eligible).toEqual([]);
    expect(result.excluded).toEqual([{ endpoint, reason: expect.stringMatching(/quota.*unconfirmed/i) }]);
  });

  it("preserves the actual quota exclusion while retaining an otherwise eligible peer", () => {
    const endpoints = [{ providerId: "anthropic-sub", id: "subscription" }, { providerId: "local", id: "local" }];
    const result = applyCapacitySoftExclusion({ endpoints,
      capacityByProvider: new Map([["anthropic-sub", unconfirmedQuota]]), nowMs: NOW });
    expect(result.eligible).toEqual([endpoints[1]]);
    expect(result.excluded).toEqual([{ endpoint: endpoints[0], reason: expect.stringMatching(/quota.*unconfirmed/i) }]);
  });

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
