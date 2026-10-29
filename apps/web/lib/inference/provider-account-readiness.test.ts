import { describe, expect, it } from "vitest";
import { projectAccountReadiness } from "./provider-account-readiness";
import copy from "../../../../packages/i18n/src/messages/en-US/providerAccounts.json";

const now = Date.parse("2026-10-15T12:00:00Z");
const base = { status: "active", requiresCredential: true, hasCredential: true,
  credentialNeedsRenewal: false, healthAvailable: true, now, copy };
describe("account readiness distinguishes configuration from current proof", () => {
  it("does not call a configured account working without successful inference", () => {
    expect(projectAccountReadiness(base).state).toBe("enabled");
    expect(projectAccountReadiness({ ...base, healthAvailable: false }).state).toBe("unverified");
    expect(projectAccountReadiness({ ...base, capacity: { state: "available", lastSuccessAtMs: now - 1000 } }).state).toBe("working");
    expect(projectAccountReadiness({ ...base, capacity: { state: "available", lastSuccessAtMs: now - 3_600_000 } }).state).toBe("enabled");
  });
  it("keeps temporary waits yellow and actionable hard failures red", () => {
    expect(projectAccountReadiness({ ...base, capacity: { state: "quota_resets_at", retryAtMs: now + 6 * 86_400_000 } }).state).toBe("waiting");
    expect(projectAccountReadiness({ ...base, status: "paused" }).state).toBe("paused");
    expect(projectAccountReadiness({ ...base, status: "paused", capacity: { state: "billing_action_required", safeSummary: "Add credits" } })).toMatchObject({ state: "blocked", summary: "Add credits" });
    expect(projectAccountReadiness({ ...base, credentialNeedsRenewal: true }).state).toBe("blocked");
  });
  it("does not inherit another account's success or overlook a shared limit", () => {
    expect(projectAccountReadiness({ ...base, sharedCapacity: { state: "available", lastSuccessAtMs: now - 1000 } }).state).toBe("enabled");
    expect(projectAccountReadiness({ ...base, capacity: { state: "available", lastSuccessAtMs: now - 1000 }, sharedCapacity: { state: "rate_limited", retryAtMs: now + 1000 } }).state).toBe("waiting");
  });
  it("keeps global cloud restrictions and verified empty model access visible", () => {
    expect(projectAccountReadiness({ ...base, sharedRestrictions: [{ key: "local-only", summary: "Cloud traffic is blocked.", until: null }] })).toMatchObject({ state: "paused", summary: "Cloud traffic is blocked." });
    expect(projectAccountReadiness({ ...base, verifiedModelCount: 0 }).state).toBe("blocked");
    expect(projectAccountReadiness({ ...base, capacity: { state: "available", lastSuccessAtMs: now + 1000 } }).state).toBe("enabled");
  });
});
