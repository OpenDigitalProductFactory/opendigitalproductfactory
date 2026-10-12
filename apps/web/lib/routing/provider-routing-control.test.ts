import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectProviderRoutingControl } from "./provider-routing-control";
import type { ProviderWithCredential } from "@/lib/ai-provider-types";
const now = Date.parse("2026-10-12T12:00:00Z");
function input() {
  return { pw: { provider: { providerId: "chatgpt", status: "active", endpointType: "responses", category: "direct", authMethod: "oauth2_authorization_code", defaultConnectionStatus: "active", operatorPause: null }, credential: { hasUsableMaterial: true, tokenExpiresAt: null } } as unknown as ProviderWithCredential, modelCount: 8, now, localOnly: false };
}
describe("provider routing controls", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => { vi.useRealTimers(); });
  it("shows simultaneous operator, quota and policy restrictions", () => {
    const data = input();
    data.pw.provider.defaultConnectionStatus = "paused";
    data.pw.provider.operatorPause = { pausedAt: "2026-10-12T11:00:00Z", resumeAt: "2026-10-12T14:00:00Z" };
    const result = projectProviderRoutingControl({ ...data, localOnly: true, capacity: { state: "quota_resets_at", retryAtMs: now + 3_600_000, safeSummary: "Usage limit reached." } });
    expect(result.eligibility.eligible).toBe(false);
    expect(result.eligibility.label).toBe("Paused");
    expect(result.restrictions.map(r => r.key)).toEqual(["operator", "local-only", "capacity"]);
    expect(result.restrictions[0].until).toBe("2026-10-12T14:00:00Z");
  });
  it("removing an operator pause leaves a current capacity restriction visible", () => {
    const result = projectProviderRoutingControl({ ...input(), capacity: { state: "rate_limited", retryAtMs: now + 60_000, safeSummary: "Wait for the usage reset." } });
    expect(result.eligibility.eligible).toBe(false);
    expect(result.restrictions.map(r => r.key)).toEqual(["capacity"]);
  });
  it("keeps a host reservation visible after an operator pause ends", () => {
    const result = projectProviderRoutingControl({ ...input(), hostRestriction: "Host reserved for verification." });
    expect(result.eligibility.eligible).toBe(false);
    expect(result.restrictions).toEqual([{ key: "host-capacity", summary: "Host reserved for verification.", until: null }]);
  });
  it("uses the canonical temporary-capacity expiry rules", () => {
    const result = projectProviderRoutingControl({ ...input(), capacity: { state: "rate_limited", retryAtMs: now - 1, safeSummary: "Old limit." } });
    expect(result.eligibility.eligible).toBe(true);
    expect(result.restrictions).toEqual([]);
  });
  it("retains a disabled connection even with a healthy provider lifecycle", () => {
    const data = input(); data.pw.provider.defaultConnectionStatus = "disabled";
    const result = projectProviderRoutingControl(data);
    expect(result.eligibility.eligible).toBe(false);
    expect(result.restrictions[0].key).toBe("connection");
  });
  it("shows the legacy quota recovery schedule rather than mislabeling it as a manual disable", () => {
    const data = input(); data.pw.provider.status = "inactive";
    const result = projectProviderRoutingControl({ ...data, quotaRecovery: { nextRunAt: "2026-10-12T13:00:00Z" } });
    expect(result.restrictions.some(r => r.key === "quota-recovery" && r.until === "2026-10-12T13:00:00Z")).toBe(true);
  });
});
