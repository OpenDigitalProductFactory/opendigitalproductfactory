import { describe, it, expect } from "vitest";
import {
  disabledConnectedProviderToAttentionItem,
  expiredCredentialToAttentionItem,
  selectDisabledConnectedProviders,
  selectExpiredCredentialProviders,
  suitabilityDriftToAttentionItem,
  PROVIDER_RECONNECT_ROUTE,
} from "./provider-credential";
import type { ProviderSuitabilityDriftSignal } from "@/lib/routing/provider-suitability/telemetry";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const PAST = "2026-07-14T00:00:00.000Z";
const FUTURE = "2026-08-01T00:00:00.000Z";

type Row = Parameters<typeof selectExpiredCredentialProviders>[0][number];

function row(overrides: Partial<Row["provider"]> = {}, credential: Row["credential"] = null): Row {
  return {
    provider: {
      providerId: "anthropic-sub",
      name: "Claude / Anthropic (OAuth Subscription)",
      status: "active",
      authMethod: "oauth",
      endpointType: "responses",
      ...overrides,
    },
    credential,
  };
}

describe("selectExpiredCredentialProviders", () => {
  it("includes an enabled provider whose token expiry is in the past", () => {
    const out = selectExpiredCredentialProviders([row({}, { tokenExpiresAt: PAST })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ providerId: "anthropic-sub", expiredAtIso: new Date(PAST).toISOString() });
  });

  it("includes a credential explicitly marked status=expired even with no timestamp", () => {
    const out = selectExpiredCredentialProviders([row({}, { status: "expired" })], NOW);
    expect(out).toHaveLength(1);
    // No token timestamp to age against → falls back to now.
    expect(out[0]?.expiredAtIso).toBe(NOW.toISOString());
  });

  it("excludes a provider whose token is still valid (future expiry)", () => {
    expect(selectExpiredCredentialProviders([row({}, { tokenExpiresAt: FUTURE })], NOW)).toHaveLength(0);
  });

  it("excludes a never-configured provider (no credential row) — opt-in, not an alert", () => {
    expect(selectExpiredCredentialProviders([row({}, null)], NOW)).toHaveLength(0);
  });

  it("excludes a local provider that needs no credential (authMethod none)", () => {
    expect(
      selectExpiredCredentialProviders([row({ authMethod: "none" }, { tokenExpiresAt: PAST })], NOW),
    ).toHaveLength(0);
  });

  // This lane stays scoped to still-routable providers on purpose. A disabled
  // provider is a real alert, but it is the DISABLED lane's job (BI-DB6A75D4) —
  // the cause differs (routing turned it off) and so does the copy.
  it("excludes a disabled/inactive provider even if its credential expired", () => {
    expect(
      selectExpiredCredentialProviders([row({ status: "disabled" }, { tokenExpiresAt: PAST })], NOW),
    ).toHaveLength(0);
  });

  it("excludes a non-routing MCP service endpoint", () => {
    expect(
      selectExpiredCredentialProviders([row({ endpointType: "service" }, { tokenExpiresAt: PAST })], NOW),
    ).toHaveLength(0);
  });

  it("includes a degraded (still-routable) provider with an expired credential", () => {
    expect(
      selectExpiredCredentialProviders([row({ status: "degraded" }, { tokenExpiresAt: PAST })], NOW),
    ).toHaveLength(1);
  });
});

// BI-DB6A75D4 — routing disables a non-local provider once its credentials
// genuinely fail (routing/fallback.ts), which is exactly when the operator needs
// telling. Regression guard for the four-day silent `anthropic-sub` outage.
describe("selectDisabledConnectedProviders", () => {
  it("includes a provider routing disabled while a credential is still on file", () => {
    const out = selectDisabledConnectedProviders(
      [row({ status: "disabled" }, { tokenExpiresAt: PAST })],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      providerId: "anthropic-sub",
      detectedAtIso: new Date(PAST).toISOString(),
    });
  });

  it("includes a disabled provider whose credential has no expiry timestamp, aged at now", () => {
    const out = selectDisabledConnectedProviders([row({ status: "disabled" }, { status: "active" })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.detectedAtIso).toBe(NOW.toISOString());
  });

  it("ages a disabled provider at now when the stored expiry is still in the future", () => {
    const out = selectDisabledConnectedProviders(
      [row({ status: "disabled" }, { tokenExpiresAt: FUTURE })],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.detectedAtIso).toBe(NOW.toISOString());
  });

  it("excludes a never-configured provider (no credential row) — opt-in, not an alert", () => {
    expect(selectDisabledConnectedProviders([row({ status: "disabled" }, null)], NOW)).toHaveLength(0);
  });

  it("excludes an inactive provider — operator chose to turn it off, not a failure", () => {
    expect(
      selectDisabledConnectedProviders([row({ status: "inactive" }, { tokenExpiresAt: PAST })], NOW),
    ).toHaveLength(0);
  });

  it("excludes a still-routable provider — that is the expired-credential lane's job", () => {
    expect(
      selectDisabledConnectedProviders([row({ status: "active" }, { tokenExpiresAt: PAST })], NOW),
    ).toHaveLength(0);
    expect(
      selectDisabledConnectedProviders([row({ status: "degraded" }, { tokenExpiresAt: PAST })], NOW),
    ).toHaveLength(0);
  });

  it("excludes a local provider that needs no credential (authMethod none)", () => {
    expect(
      selectDisabledConnectedProviders(
        [row({ status: "disabled", authMethod: "none" }, { tokenExpiresAt: PAST })],
        NOW,
      ),
    ).toHaveLength(0);
  });

  it("excludes a non-routing MCP service endpoint", () => {
    expect(
      selectDisabledConnectedProviders(
        [row({ status: "disabled", endpointType: "service" }, { tokenExpiresAt: PAST })],
        NOW,
      ),
    ).toHaveLength(0);
  });
});

describe("disabledConnectedProviderToAttentionItem", () => {
  it("projects a one-tap reconnect item naming the automatic shut-off, not an expiry", () => {
    const item = disabledConnectedProviderToAttentionItem({
      providerId: "anthropic-sub",
      name: "Claude / Anthropic (OAuth Subscription)",
      detectedAtIso: new Date(PAST).toISOString(),
    });
    expect(item.id).toBe("provider-credential:anthropic-sub");
    expect(item.source).toBe("provider-credential");
    expect(item.title).toBe("Reconnect Claude / Anthropic (OAuth Subscription)");
    expect(item.context).toContain("turned off automatically");
    expect(item.context).toContain("waiting won't clear it");
    expect(item.triage.residueReason).toBe("needs-credential");
    expect(item.triage.decideEffort).toBe("one-tap");
    expect(item.deepLink).toBe(PROVIDER_RECONNECT_ROUTE);
    expect(item.actions[0]).toMatchObject({ kind: "open-in-context", href: PROVIDER_RECONNECT_ROUTE });
    expect(item.audience.operator).toBe(true);
    expect(item.createdAtIso).toBe(new Date(PAST).toISOString());
  });

  it("shares the expired lane's item id so one provider can never yield two rows", () => {
    const disabled = disabledConnectedProviderToAttentionItem({
      providerId: "anthropic-sub",
      name: "Claude",
      detectedAtIso: NOW.toISOString(),
    });
    const expired = expiredCredentialToAttentionItem({
      providerId: "anthropic-sub",
      name: "Claude",
      expiredAtIso: NOW.toISOString(),
    });
    expect(disabled.id).toBe(expired.id);
  });
});

describe("expiredCredentialToAttentionItem", () => {
  it("projects a one-tap reconnect item pointing at Providers & Routing", () => {
    const item = expiredCredentialToAttentionItem({
      providerId: "anthropic-sub",
      name: "Claude / Anthropic (OAuth Subscription)",
      expiredAtIso: new Date(PAST).toISOString(),
    });
    expect(item.id).toBe("provider-credential:anthropic-sub");
    expect(item.source).toBe("provider-credential");
    expect(item.title).toContain("Reconnect Claude");
    expect(item.triage.residueReason).toBe("needs-credential");
    expect(item.triage.decideEffort).toBe("one-tap");
    expect(item.deepLink).toBe(PROVIDER_RECONNECT_ROUTE);
    expect(item.actions[0]).toMatchObject({ kind: "open-in-context", href: PROVIDER_RECONNECT_ROUTE });
    expect(item.audience.operator).toBe(true);
    expect(item.createdAtIso).toBe(new Date(PAST).toISOString());
  });
});

describe("suitabilityDriftToAttentionItem", () => {
  it("sends stale or mismatched provider evidence to the existing operator attention source", () => {
    const signal: ProviderSuitabilityDriftSignal = {
      providerConnectionId: "connection-1",
      providerId: "openrouter",
      providerName: "OpenRouter business",
      kind: "account-class-mismatch",
      severity: "block-restricted",
      detectedAt: NOW.toISOString(),
      summary: "Observed account class no longer matches the attested posture.",
      nextAction: "Review the connected account.",
    };

    const item = suitabilityDriftToAttentionItem(signal);

    expect(item.id).toBe("provider-suitability:connection-1:account-class-mismatch");
    expect(item.source).toBe("provider-credential");
    expect(item.title).toBe("Review OpenRouter business trust evidence");
    expect(item.context).toContain("Restricted routing stays blocked");
    expect(item.deepLink).toBe("/platform/ai/providers/openrouter");
    expect(item.triage.decideEffort).toBe("review");
  });
});
