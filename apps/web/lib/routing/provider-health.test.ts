import { describe, it, expect } from "vitest";
import {
  deriveProviderHealth,
  remediationForFailureClass,
  providerDetailHref,
  type RecentOutcome,
} from "./provider-health";

const NOW = 1_700_000_000_000;

function outcome(overrides: Partial<RecentOutcome> & { ageMs: number }): RecentOutcome {
  return {
    providerErrorCode: overrides.providerErrorCode ?? null,
    fallbackOccurred: overrides.fallbackOccurred ?? false,
    latencyMs: overrides.latencyMs ?? 1000,
    createdAt: new Date(NOW - overrides.ageMs),
  };
}

function base(overrides: Partial<Parameters<typeof deriveProviderHealth>[0]> = {}) {
  return deriveProviderHealth({
    providerId: "codex",
    lifecycleStatus: "active",
    recentOutcomes: [],
    now: NOW,
    ...overrides,
  });
}

describe("providerDetailHref", () => {
  it("builds an encoded provider-detail path", () => {
    expect(providerDetailHref("codex")).toBe("/platform/ai/providers/codex");
    expect(providerDetailHref("a b")).toBe("/platform/ai/providers/a%20b");
  });
});

describe("remediationForFailureClass", () => {
  it("maps auth → reauth with a provider deep link", () => {
    expect(remediationForFailureClass("auth", "codex")).toEqual({
      remediationKind: "reauth",
      adminActionHref: "/platform/ai/providers/codex",
    });
  });
  it("maps billing → provider_settings", () => {
    expect(remediationForFailureClass("billing", "codex").remediationKind).toBe("provider_settings");
  });
  it("maps rate_limit/overloaded/transient → wait (no deep link)", () => {
    expect(remediationForFailureClass("rate_limit", "codex")).toEqual({ remediationKind: "wait" });
    expect(remediationForFailureClass("overloaded", "codex").remediationKind).toBe("wait");
    expect(remediationForFailureClass("transient", "codex").remediationKind).toBe("wait");
  });
  it("maps request_too_large → choose_smaller_request", () => {
    expect(remediationForFailureClass("request_too_large", "codex").remediationKind).toBe("choose_smaller_request");
  });
  it("maps unknown/null → none", () => {
    expect(remediationForFailureClass(null, "codex").remediationKind).toBe("none");
    expect(remediationForFailureClass("weird", "codex").remediationKind).toBe("none");
  });
});

describe("deriveProviderHealth", () => {
  it("unconfigured lifecycle → unconfigured + provider_settings", () => {
    const h = base({ lifecycleStatus: "unconfigured" });
    expect(h.status).toBe("unconfigured");
    expect(h.remediationKind).toBe("provider_settings");
    expect(h.adminActionHref).toBe("/platform/ai/providers/codex");
  });

  it("inactive lifecycle → unconfigured", () => {
    expect(base({ lifecycleStatus: "inactive" }).status).toBe("unconfigured");
  });

  // ── Runtime circuit takes precedence (most current signal) ──
  it("runtime cooldown auth → needs_reauth with cooldownUntil + reauth", () => {
    const h = base({
      lifecycleStatus: "active",
      runtimeCooldown: { unavailable: true, reason: "auth", until: NOW + 600_000 },
    });
    expect(h.status).toBe("needs_reauth");
    expect(h.remediationKind).toBe("reauth");
    expect(h.cooldownUntil).toBe(NOW + 600_000);
    expect(h.lastFailureClass).toBe("auth");
  });

  it("runtime cooldown rate_limit → rate_limited + wait", () => {
    const h = base({
      runtimeCooldown: { unavailable: true, reason: "rate_limit", until: NOW + 30_000 },
    });
    expect(h.status).toBe("rate_limited");
    expect(h.remediationKind).toBe("wait");
    expect(h.cooldownUntil).toBe(NOW + 30_000);
  });

  it("runtime cooldown overloaded/transient/provider_error → cooling_down", () => {
    for (const reason of ["overloaded", "transient", "provider_error"]) {
      const h = base({ runtimeCooldown: { unavailable: true, reason } });
      expect(h.status).toBe("cooling_down");
      expect(h.remediationKind).toBe("wait");
    }
  });

  it("runtime cooldown billing → billing", () => {
    const h = base({ runtimeCooldown: { unavailable: true, reason: "billing" } });
    expect(h.status).toBe("billing");
  });

  // ── Disabled lifecycle (fallback.ts disables on auth/billing) ──
  it("disabled + recent billing error → billing", () => {
    const h = base({
      lifecycleStatus: "disabled",
      recentOutcomes: [outcome({ ageMs: 5_000, providerErrorCode: "billing" })],
    });
    expect(h.status).toBe("billing");
    expect(h.remediationKind).toBe("provider_settings");
  });

  it("disabled + recent auth error → needs_reauth", () => {
    const h = base({
      lifecycleStatus: "disabled",
      recentOutcomes: [outcome({ ageMs: 5_000, providerErrorCode: "auth" })],
    });
    expect(h.status).toBe("needs_reauth");
    expect(h.remediationKind).toBe("reauth");
  });

  it("disabled with no recent signal → defaults to needs_reauth", () => {
    const h = base({ lifecycleStatus: "disabled" });
    expect(h.status).toBe("needs_reauth");
  });

  it("needs_reauth wording differs for api_key vs oauth providers", () => {
    const oauth = base({
      lifecycleStatus: "disabled",
      authMethod: "oauth2_authorization_code",
    });
    expect(oauth.safeSummary).toMatch(/re-authentication|reconnect/i);

    const apiKey = base({ lifecycleStatus: "disabled", authMethod: "api_key" });
    expect(apiKey.safeSummary).toMatch(/key/i);
  });

  // ── Recent telemetry (no cooldown, active lifecycle) ──
  it("error-dominated recent outcomes (rate_limit) → rate_limited", () => {
    const h = base({
      recentOutcomes: [
        outcome({ ageMs: 1_000, providerErrorCode: "rate_limit", latencyMs: 0 }),
        outcome({ ageMs: 2_000, providerErrorCode: "rate_limit", latencyMs: 0 }),
      ],
    });
    expect(h.status).toBe("rate_limited");
  });

  it("recent successes → healthy", () => {
    const h = base({
      recentOutcomes: [outcome({ ageMs: 1_000, latencyMs: 1200 })],
    });
    expect(h.status).toBe("healthy");
    expect(h.remediationKind).toBe("none");
  });

  it("a recent success outweighs an older error (mixed) → healthy", () => {
    const h = base({
      recentOutcomes: [
        outcome({ ageMs: 60_000, providerErrorCode: "rate_limit", latencyMs: 0 }),
        outcome({ ageMs: 1_000, latencyMs: 900 }),
      ],
    });
    expect(h.status).toBe("healthy");
  });

  it("no recent outcomes → unknown", () => {
    expect(base().status).toBe("unknown");
  });

  it("errors OUTSIDE the recent window are ignored → unknown", () => {
    const h = base({
      recentOutcomes: [outcome({ ageMs: 20 * 60_000, providerErrorCode: "rate_limit", latencyMs: 0 })],
      recentWindowMs: 10 * 60_000,
    });
    expect(h.status).toBe("unknown");
  });

  it("never exposes internal identifiers in safeSummary (rule #5)", () => {
    const samples = [
      base({ lifecycleStatus: "unconfigured" }),
      base({ runtimeCooldown: { unavailable: true, reason: "auth" } }),
      base({ runtimeCooldown: { unavailable: true, reason: "rate_limit" } }),
      base({ lifecycleStatus: "disabled" }),
    ];
    for (const h of samples) {
      expect(h.safeSummary).not.toMatch(/codex|gpt-|claude-|modelId|providerId|ModelProvider/);
    }
  });
});
