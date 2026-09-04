import { describe, expect, it, vi } from "vitest";

import {
  confirmPairingFromOrganizationTrust,
  type PairingSessionRow,
  type TrustConfirmationStore,
} from "./confirm-pairing-from-organization-trust";

type ConfirmationWrite = Parameters<TrustConfirmationStore["recordLocalConfirmation"]>[0];

const NOW = new Date("2026-08-27T00:00:00.000Z");
const AUTO_ENROLL = { mode: "auto-enroll" as const, explanation: "same organization root" };
const EVIDENCE = {
  presentedRootFingerprint: "a".repeat(64),
  certificateVerified: true,
  peerOrganizationRef: "ORG-1779558156034",
};

function session(overrides: Partial<PairingSessionRow> = {}): PairingSessionRow {
  return {
    id: "row-1",
    pairingId: "pair-1",
    direction: "outgoing",
    status: "pending",
    expiresAt: new Date("2026-08-27T00:10:00.000Z"),
    sasState: { protocolVersion: 1, localDeviceId: "dev-local" },
    ...overrides,
  };
}

function store(row: PairingSessionRow | null = session()) {
  const recordLocalConfirmation = vi.fn(async (_input: ConfirmationWrite) => {});
  const impl: TrustConfirmationStore = {
    findSession: async () => row,
    recordLocalConfirmation,
  };
  return { store: impl, recordLocalConfirmation };
}

function run(overrides: {
  decision?: { mode: "auto-enroll" | "operator-confirmation" | "blocked"; explanation: string; reason?: never };
  row?: PairingSessionRow | null;
  peerOk?: boolean;
} = {}) {
  const { store: impl, recordLocalConfirmation } = store(
    overrides.row === undefined ? session() : overrides.row,
  );
  const confirmWithPeer = vi.fn(async () => ({ ok: overrides.peerOk ?? true }));
  return {
    recordLocalConfirmation,
    confirmWithPeer,
    result: confirmPairingFromOrganizationTrust({
      pairingId: "pair-1",
      decision: (overrides.decision ?? AUTO_ENROLL) as never,
      evidence: EVIDENCE,
      store: impl,
      confirmWithPeer,
      now: NOW,
    }),
  };
}

describe("confirmPairingFromOrganizationTrust — the case that skips the code", () => {
  it("confirms a validated same-organization peer", async () => {
    const { result, recordLocalConfirmation } = run();
    expect(await result).toEqual({ confirmed: true, provenance: "organization-trust" });
    expect(recordLocalConfirmation).toHaveBeenCalledOnce();
  });

  it("records that a machine confirmed it, on what basis, with no person", async () => {
    const { result, recordLocalConfirmation } = run();
    await result;
    const written = recordLocalConfirmation.mock.calls[0]?.[0] as ConfirmationWrite;
    expect(written.sasState).toMatchObject({
      // Prior SAS state is preserved, not clobbered.
      protocolVersion: 1,
      localDeviceId: "dev-local",
      confirmationProvenance: "organization-trust",
      confirmationEvidence: {
        certificateVerified: true,
        presentedRootFingerprint: "a".repeat(64),
        peerOrganizationRef: "ORG-1779558156034",
      },
    });
    // No principal is written anywhere: none exists, and inventing one would
    // make the audit trail assert something untrue.
    expect(JSON.stringify(written)).not.toContain("PrincipalId");
  });
});

describe("it refuses anything short of auto-enroll", () => {
  it("refuses an operator-confirmation verdict", async () => {
    const { result, confirmWithPeer, recordLocalConfirmation } = run({
      decision: { mode: "operator-confirmation", explanation: "chain not validated" },
    });
    expect(await result).toEqual({ confirmed: false, refusal: "not-auto-enroll" });
    // It must not even talk to the peer, let alone record a confirmation.
    expect(confirmWithPeer).not.toHaveBeenCalled();
    expect(recordLocalConfirmation).not.toHaveBeenCalled();
  });

  it("refuses a blocked verdict", async () => {
    const { result } = run({ decision: { mode: "blocked", explanation: "plain HTTP" } });
    expect(await result).toMatchObject({ confirmed: false, refusal: "not-auto-enroll" });
  });
});

describe("every session precondition still holds", () => {
  it("refuses when the session is missing", async () => {
    expect(await run({ row: null }).result).toMatchObject({ refusal: "session-not-found" });
  });

  it("refuses an incoming session", async () => {
    const { result } = run({ row: session({ direction: "incoming" }) });
    expect(await result).toMatchObject({ refusal: "session-not-found" });
  });

  it("refuses a session that is not pending", async () => {
    const { result } = run({ row: session({ status: "approved" }) });
    expect(await result).toMatchObject({ refusal: "session-not-pending" });
  });

  it("refuses an expired session", async () => {
    const { result } = run({
      row: session({ expiresAt: new Date("2026-08-26T23:59:00.000Z") }),
    });
    expect(await result).toMatchObject({ refusal: "session-expired" });
  });

  it("leaves the session for a human when the peer refuses", async () => {
    const { result, recordLocalConfirmation } = run({ peerOk: false });
    expect(await result).toMatchObject({ refusal: "peer-confirmation-failed" });
    expect(recordLocalConfirmation).not.toHaveBeenCalled();
  });

  it("tolerates a session whose sasState is not an object", async () => {
    const { result, recordLocalConfirmation } = run({ row: session({ sasState: null }) });
    expect(await result).toMatchObject({ confirmed: true });
    expect((recordLocalConfirmation.mock.calls[0]?.[0] as ConfirmationWrite).sasState).toMatchObject({
      confirmationProvenance: "organization-trust",
    });
  });
});
