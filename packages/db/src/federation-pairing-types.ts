export const FEDERATION_PAIRING_DIRECTIONS = ["incoming", "outgoing"] as const;
export type FederationPairingDirection = (typeof FEDERATION_PAIRING_DIRECTIONS)[number];

export const FEDERATION_PAIRING_STATUSES = [
  "pending",
  "approved",
  "denied",
  "consumed",
  "expired",
] as const;
export type FederationPairingStatus = (typeof FEDERATION_PAIRING_STATUSES)[number];

const PAIRING_TRANSITIONS: Record<FederationPairingStatus, readonly FederationPairingStatus[]> = {
  pending: ["pending", "approved", "denied", "expired"],
  approved: ["approved", "consumed", "expired"],
  denied: ["denied"],
  consumed: ["consumed"],
  expired: ["expired"],
};

export function isFederationPairingDirection(value: unknown): value is FederationPairingDirection {
  return (FEDERATION_PAIRING_DIRECTIONS as readonly unknown[]).includes(value);
}

export function isFederationPairingStatus(value: unknown): value is FederationPairingStatus {
  return (FEDERATION_PAIRING_STATUSES as readonly unknown[]).includes(value);
}

export function canTransitionFederationPairing(
  from: FederationPairingStatus,
  to: FederationPairingStatus,
): boolean {
  return PAIRING_TRANSITIONS[from].includes(to);
}

export function resolveFederationPairingStatus(input: {
  status: FederationPairingStatus;
  expiresAt: Date;
  now?: Date;
}): FederationPairingStatus {
  if (input.status === "denied" || input.status === "consumed" || input.status === "expired") {
    return input.status;
  }
  return input.expiresAt.getTime() <= (input.now ?? new Date()).getTime()
    ? "expired"
    : input.status;
}
