import { describe, expect, it } from "vitest";
import { isProviderAccountVisible, providerAccountConfigurationInput, providerAccountHref, selectProviderAccount, type ProviderAccountIdentity } from "./provider-account-view";

function account(overrides: Partial<ProviderAccountIdentity> = {}): ProviderAccountIdentity {
  return { providerId: "codex", connectionId: "provider-default-codex", isDefault: true,
    status: "unconfigured", credential: null, modelsVerifiedAt: null, lastReviewedAt: null, ...overrides };
}

describe("provider account overview and selection", () => {
  it("keeps untouched optional local engines in the catalog while retaining configured local engines", () => {
    const ollama = account({ providerId: "ollama", connectionId: "provider-default-ollama" });
    expect(isProviderAccountVisible(ollama, { firstRun: false })).toBe(false);
    expect(isProviderAccountVisible(ollama, { firstRun: true })).toBe(true);
    for (const status of ["active", "paused", "disabled", "degraded"]) {
      expect(isProviderAccountVisible({ ...ollama, status }, { firstRun: false })).toBe(true);
    }
  });
  it("hides untouched default catalog entries after setup without reopening onboarding", () => {
    expect(isProviderAccountVisible(account(), { firstRun: false })).toBe(false);
    expect(isProviderAccountVisible(account({ status: "disabled" }), { firstRun: false })).toBe(false);
    expect(isProviderAccountVisible(account(), { firstRun: true })).toBe(true);
  });

  it("retains Local, configured disabled accounts, and explicit unfinished accounts", () => {
    expect(isProviderAccountVisible(account({ providerId: "local", connectionId: "provider-default-local", status: "paused" }), { firstRun: false })).toBe(true);
    expect(isProviderAccountVisible(account({ status: "disabled", credential: { hasUsableMaterial: true } }), { firstRun: false })).toBe(true);
    expect(isProviderAccountVisible(account({ connectionId: "provider-account-work", isDefault: false }), { firstRun: false })).toBe(true);
    expect(isProviderAccountVisible(account({ status: "disconnected", lastReviewedAt: "2026-10-01T00:00:00Z" }), { firstRun: false })).toBe(true);
  });

  it("preserves legacy shared-key defaults without borrowing credentials for extra accounts", () => {
    expect(isProviderAccountVisible(account({ providerId: "zai-coding" }), { firstRun: false, legacyCredentialPresent: true })).toBe(true);
  });

  it("selects exactly the requested account rather than the provider default", () => {
    const initial = account();
    const extra = account({ connectionId: "provider-account-work", isDefault: false });
    expect(selectProviderAccount([initial, extra], "codex", extra.connectionId)).toBe(extra);
    expect(selectProviderAccount([extra, initial], "codex")).toBe(initial);
  });

  it("refuses wrong-provider, missing and blank explicit account selections", () => {
    const initial = account();
    const foreign = account({ providerId: "anthropic", connectionId: "provider-account-other", isDefault: false });
    expect(selectProviderAccount([initial, foreign], "codex", foreign.connectionId)).toBeNull();
    expect(selectProviderAccount([initial], "codex", "missing-account")).toBeNull();
    expect(selectProviderAccount([initial], "codex", "")).toBeNull();
  });

  it("keeps old default links and encodes the selected additional account", () => {
    expect(providerAccountHref(account())).toBe("/platform/ai/providers/codex");
    expect(providerAccountHref(account({ connectionId: "work&account", isDefault: false }))).toBe("/platform/ai/providers/codex?account=work%26account");
  });

  it("does not replace credentials or invalidate account evidence when only renaming", () => {
    const initial = { clientId: "public-client", tokenEndpoint: "https://provider.example/token", scope: "models" };
    expect(providerAccountConfigurationInput("provider-account-work", {
      ...initial, label: "Renamed work account", secretRef: "", clientSecret: "",
    }, initial)).toEqual({ connectionId: "provider-account-work", label: "Renamed work account" });
  });
});
