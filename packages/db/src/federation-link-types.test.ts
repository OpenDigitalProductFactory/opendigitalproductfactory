import { describe, expect, it } from "vitest";
import {
  canExchangeOverLink,
  FEDERATION_BOOTSTRAP_TOKEN_PREFIX,
  FEDERATION_LINK_TOKEN_PREFIX,
  FEDERATION_PEER_PRINCIPAL_KIND,
  FEDERATION_ROLES,
  inverseRole,
  isFederationRole,
  linkStateFromRow,
} from "./federation-link-types";

const T = (iso: string) => new Date(iso);

describe("federation roles (B1)", () => {
  it("inverts the role for the peer", () => {
    expect(inverseRole("manages")).toBe("managed-by");
    expect(inverseRole("managed-by")).toBe("manages");
  });
  it("validates role strings", () => {
    expect(isFederationRole("manages")).toBe(true);
    expect(isFederationRole("admin")).toBe(false);
    expect(FEDERATION_ROLES).toEqual(["manages", "managed-by"]);
  });
});

describe("convergence + token constants", () => {
  it("peers are a Principal kind, not a parallel table", () => {
    expect(FEDERATION_PEER_PRINCIPAL_KIND).toBe("federated-peer");
  });
  it("link and bootstrap token prefixes do not alias", () => {
    expect(FEDERATION_LINK_TOKEN_PREFIX.startsWith(FEDERATION_BOOTSTRAP_TOKEN_PREFIX)).toBe(false);
    expect(FEDERATION_BOOTSTRAP_TOKEN_PREFIX.startsWith(FEDERATION_LINK_TOKEN_PREFIX)).toBe(false);
  });
});

describe("linkStateFromRow / canExchangeOverLink", () => {
  const approved = { approvedAtLocal: T("2026-06-24T01:00:00Z"), approvedAtPeer: T("2026-06-24T01:05:00Z") };

  it("is trusted only when both sides approve and not revoked/quarantined", () => {
    expect(linkStateFromRow({ ...approved, revokedAt: null, quarantinedAt: null })).toBe("trusted");
    expect(canExchangeOverLink({ ...approved, revokedAt: null, quarantinedAt: null })).toBe(true);
  });

  it("blocks exchange when pending, quarantined, or revoked", () => {
    expect(canExchangeOverLink({ approvedAtLocal: approved.approvedAtLocal, approvedAtPeer: null, revokedAt: null, quarantinedAt: null })).toBe(false);
    expect(canExchangeOverLink({ ...approved, revokedAt: null, quarantinedAt: T("2026-06-24T02:00:00Z") })).toBe(false);
    expect(canExchangeOverLink({ ...approved, revokedAt: T("2026-06-24T02:00:00Z"), quarantinedAt: null })).toBe(false);
  });
});
