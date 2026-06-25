import { describe, expect, it } from "vitest";
import {
  canAuthenticateUnderTrust,
  canSubmitUnderTrust,
  canTransitionTrust,
  hasTokenPrefix,
  isBootstrapConsumed,
  isBootstrapUsable,
  isDualApproved,
  resolveLinkTrust,
  TOKEN_PREFIXES,
  tokenDisplayPrefix,
} from "./trust-link-lifecycle";

const T = (iso: string) => new Date(iso);

describe("trust transitions (WS-0b)", () => {
  it("allows pending->trusted and quarantine/revoke; revoked is terminal", () => {
    expect(canTransitionTrust("pending", "trusted")).toBe(true);
    expect(canTransitionTrust("trusted", "quarantined")).toBe(true);
    expect(canTransitionTrust("quarantined", "trusted")).toBe(true);
    expect(canTransitionTrust("trusted", "pending")).toBe(false);
    expect(canTransitionTrust("revoked", "trusted")).toBe(false);
    expect(canTransitionTrust("pending", "pending")).toBe(true);
  });
});

describe("token prefixes never alias", () => {
  it("federation link/bootstrap prefixes are not prefixes of each other", () => {
    expect(TOKEN_PREFIXES.federationLink.startsWith(TOKEN_PREFIXES.federationBootstrap)).toBe(false);
    expect(TOKEN_PREFIXES.federationBootstrap.startsWith(TOKEN_PREFIXES.federationLink)).toBe(false);
  });

  it("matches and extracts a display prefix", () => {
    expect(hasTokenPrefix("dpflink_abcdef1234567", TOKEN_PREFIXES.federationLink)).toBe(true);
    expect(hasTokenPrefix("dpffboot_abc", TOKEN_PREFIXES.federationLink)).toBe(false);
    expect(tokenDisplayPrefix("dpflink_abcdef1234567", TOKEN_PREFIXES.federationLink)).toBe("abcdef12");
  });
});

describe("single-use bootstrap", () => {
  const base = { consumedAt: null, consumedById: null, revokedAt: null, expiresAt: T("2026-06-24T03:00:00Z") };

  it("fresh, unexpired, unconsumed -> usable", () => {
    expect(isBootstrapUsable(base, T("2026-06-24T02:00:00Z"))).toBe(true);
  });
  it("consumed -> not usable", () => {
    expect(isBootstrapConsumed({ consumedAt: T("2026-06-24T02:00:00Z"), consumedById: "link_1" })).toBe(true);
    expect(isBootstrapUsable({ ...base, consumedAt: T("2026-06-24T02:00:00Z"), consumedById: "link_1" }, T("2026-06-24T02:30:00Z"))).toBe(false);
  });
  it("expired or revoked -> not usable", () => {
    expect(isBootstrapUsable(base, T("2026-06-24T03:30:00Z"))).toBe(false);
    expect(isBootstrapUsable({ ...base, revokedAt: T("2026-06-24T02:00:00Z") }, T("2026-06-24T02:30:00Z"))).toBe(false);
  });
});

describe("submit / authenticate gates", () => {
  it("only trusted may submit", () => {
    expect(canSubmitUnderTrust("trusted")).toBe(true);
    expect(canSubmitUnderTrust("pending")).toBe(false);
    expect(canSubmitUnderTrust("quarantined")).toBe(false);
  });
  it("authenticate requires a hash and not-revoked (pending can still authenticate to heartbeat)", () => {
    expect(canAuthenticateUnderTrust({ tokenHash: "h", trustState: "pending", revokedAt: null })).toBe(true);
    expect(canAuthenticateUnderTrust({ tokenHash: null, trustState: "trusted", revokedAt: null })).toBe(false);
    expect(canAuthenticateUnderTrust({ tokenHash: "h", trustState: "revoked", revokedAt: T("2026-06-24T02:00:00Z") })).toBe(false);
  });
});

describe("dual approval (federation-specific)", () => {
  it("trusted only when BOTH sides approve", () => {
    expect(isDualApproved(T("2026-06-24T01:00:00Z"), T("2026-06-24T01:05:00Z"))).toBe(true);
    expect(isDualApproved(T("2026-06-24T01:00:00Z"), null)).toBe(false);
    expect(isDualApproved(null, null)).toBe(false);
  });

  it("resolveLinkTrust: revoke/quarantine win over approval; both-approved -> trusted", () => {
    const approved = { approvedAtLocal: T("2026-06-24T01:00:00Z"), approvedAtPeer: T("2026-06-24T01:05:00Z") };
    expect(resolveLinkTrust({ ...approved, revokedAt: null, quarantinedAt: null })).toBe("trusted");
    expect(resolveLinkTrust({ ...approved, revokedAt: T("2026-06-24T02:00:00Z"), quarantinedAt: null })).toBe("revoked");
    expect(resolveLinkTrust({ ...approved, revokedAt: null, quarantinedAt: T("2026-06-24T02:00:00Z") })).toBe("quarantined");
    expect(resolveLinkTrust({ approvedAtLocal: T("2026-06-24T01:00:00Z"), approvedAtPeer: null, revokedAt: null, quarantinedAt: null })).toBe("pending");
  });
});
