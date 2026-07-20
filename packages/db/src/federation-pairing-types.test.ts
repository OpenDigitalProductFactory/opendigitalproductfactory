import { describe, expect, it } from "vitest";

import {
  FEDERATION_PAIRING_DIRECTIONS,
  FEDERATION_PAIRING_STATUSES,
  canTransitionFederationPairing,
  resolveFederationPairingStatus,
} from "./federation-pairing-types";

describe("federation pairing lifecycle", () => {
  it("keeps direction and status registries closed", () => {
    expect(FEDERATION_PAIRING_DIRECTIONS).toEqual(["incoming", "outgoing"]);
    expect(FEDERATION_PAIRING_STATUSES).toEqual([
      "pending",
      "approved",
      "denied",
      "consumed",
      "expired",
    ]);
  });

  it("permits only one-way, auditable lifecycle transitions", () => {
    expect(canTransitionFederationPairing("pending", "approved")).toBe(true);
    expect(canTransitionFederationPairing("pending", "denied")).toBe(true);
    expect(canTransitionFederationPairing("approved", "consumed")).toBe(true);
    expect(canTransitionFederationPairing("approved", "pending")).toBe(false);
    expect(canTransitionFederationPairing("denied", "approved")).toBe(false);
    expect(canTransitionFederationPairing("consumed", "approved")).toBe(false);
  });

  it("treats an elapsed session as expired without trusting a stale stored status", () => {
    const now = new Date("2026-07-20T12:15:00.000Z");
    expect(
      resolveFederationPairingStatus({
        status: "pending",
        expiresAt: new Date("2026-07-20T12:14:59.999Z"),
        now,
      }),
    ).toBe("expired");
    expect(
      resolveFederationPairingStatus({
        status: "approved",
        expiresAt: new Date("2026-07-20T12:15:00.001Z"),
        now,
      }),
    ).toBe("approved");
    expect(
      resolveFederationPairingStatus({
        status: "consumed",
        expiresAt: new Date("2026-07-20T12:14:00.000Z"),
        now,
      }),
    ).toBe("consumed");
  });
});
