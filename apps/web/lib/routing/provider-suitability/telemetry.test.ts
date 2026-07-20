import { describe, expect, it } from "vitest";

import type { ProviderSuitabilityPolicy } from "./types";
import {
  PROVIDER_SUITABILITY_ROLLOUT_STAGES,
  applySuitabilityTelemetryAdvisory,
  detectProviderSuitabilityDrift,
  resolveProviderSuitabilityRollout,
} from "./telemetry";

const NOW = new Date("2026-07-20T12:00:00.000Z");

describe("provider suitability drift", () => {
  it("finds stale catalog/attestation, expiring evidence, and repeated route failures", () => {
    const signals = detectProviderSuitabilityDrift({
      providerConnectionId: "connection-1",
      providerId: "openrouter",
      providerName: "OpenRouter business",
      catalogReviewedAt: "2025-01-01T00:00:00.000Z",
      attestedAt: "2025-11-01T00:00:00.000Z",
      contractExpiresAt: "2026-07-25T00:00:00.000Z",
      regionalEntitlementExpiresAt: "2026-07-22T00:00:00.000Z",
      evidenceClaims: [{ claimKey: "zero-retention", status: "expired" }],
      repeatedRouteFailures: 4,
      observed: null,
      attested: null,
      now: NOW,
    });

    expect(signals.map((signal) => signal.kind)).toEqual(expect.arrayContaining([
      "catalog-stale",
      "attestation-stale",
      "contract-expiring",
      "regional-entitlement-expiring",
      "evidence-expired",
      "repeated-route-failure",
    ]));
  });

  it.each([
    ["executionChannel", "direct-api", "subscription-cli", "execution-channel-mismatch"],
    ["accountClass", "enterprise", "regular", "account-class-mismatch"],
    ["planLimit", "enterprise", "free", "plan-limit-mismatch"],
    ["endpoint", "https://eu.example/v1", "https://global.example/v1", "endpoint-mismatch"],
    ["credentialKind", "workload-identity", "api-key", "credential-mismatch"],
  ] as const)("detects %s drift against the attested connection", (field, attested, observed, kind) => {
    const signals = detectProviderSuitabilityDrift({
      providerConnectionId: "connection-1",
      providerId: "anthropic",
      providerName: "Anthropic enterprise",
      catalogReviewedAt: NOW.toISOString(),
      attestedAt: NOW.toISOString(),
      contractExpiresAt: null,
      regionalEntitlementExpiresAt: null,
      evidenceClaims: [],
      repeatedRouteFailures: 0,
      attested: { [field]: attested },
      observed: { [field]: observed },
      now: NOW,
    });

    expect(signals).toEqual(expect.arrayContaining([expect.objectContaining({ kind })]));
  });
});

describe("provider suitability rollout", () => {
  it("keeps the governed rollout order stable", () => {
    expect(PROVIDER_SUITABILITY_ROLLOUT_STAGES).toEqual([
      "compiler-shadow",
      "admin-preview",
      "onboarding-recommendation",
      "selected-vertical-bindings",
      "restricted-openrouter",
      "evidence-enforcement",
      "continuous-tuning",
    ]);
  });

  it("enables capabilities cumulatively without letting telemetry become enforcement", () => {
    expect(resolveProviderSuitabilityRollout("restricted-openrouter")).toMatchObject({
      compilerShadow: true,
      adminPreview: true,
      onboardingRecommendation: true,
      selectedVerticalBindings: true,
      restrictedOpenRouter: true,
      evidenceEnforcement: false,
      continuousTuning: false,
    });
  });
});

describe("telemetry is advisory", () => {
  it("cannot widen or override hard policy, contract, residency, or operator denial", () => {
    const policy: ProviderSuitabilityPolicy = {
      policyId: "policy-1",
      organizationId: "org-1",
      source: "admin",
      effect: "deny",
      allowedProviders: [],
      deniedProviders: ["personal-openai"],
      allowedProviderConnectionIds: [],
      deniedProviderConnectionIds: ["connection-personal"],
      residencyPolicy: "local_only",
      openRouterObligations: null,
      explanations: [{ code: "operator-denial", message: "Denied by the owner." }],
      compilerVersion: "1.0.0",
    };

    const adjusted = applySuitabilityTelemetryAdvisory(policy, {
      recommendationDelta: 100,
      reasonCodes: ["recent-success"],
    });

    expect(adjusted.policy).toEqual(policy);
    expect(adjusted.recommendationDelta).toBe(100);
    expect(adjusted.enforcementChanged).toBe(false);
  });
});
