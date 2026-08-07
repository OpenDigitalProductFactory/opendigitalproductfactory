import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutual-token half of the enroll handshake: when the connecting peer supplies a
// callbackToken, the inviter stores it as ITS outbound token (peerTokenEnc) so it
// can relay approval + push demand back. Absent → one-directional (peerTokenEnc null).

const captured: { data?: Record<string, unknown> } = {};

const mockTx = {
  federationBootstrapToken: { update: vi.fn().mockResolvedValue({}) },
  principal: { create: vi.fn().mockResolvedValue({ id: "principal-row-1" }) },
  principalAlias: { create: vi.fn().mockResolvedValue({}) },
  federationLink: {
    create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
      captured.data = args.data;
      return Promise.resolve({ id: "link-row-1" });
    }),
  },
};

const findUnique = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    federationBootstrapToken: { findUnique: (...a: unknown[]) => findUnique(...a) },
    $transaction: (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
  },
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  encryptSecret: (plain: string) => `enc(${plain})`,
}));

import { generateFederationBootstrapToken, hashToken } from "./tokens";
import { enrollFederationLink } from "./enrollment";

const bootstrap = generateFederationBootstrapToken();

function validTokenRow() {
  return {
    id: "bt-1",
    tokenHash: hashToken(bootstrap.plaintext),
    consumedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    offeredRole: "same-org-peer",
    proposedProjection: null,
    proposedAuthorityBand: null,
  };
}

describe("enrollFederationLink — mutual callback token", () => {
  beforeEach(() => {
    captured.data = undefined;
    findUnique.mockReset().mockResolvedValue(validTokenRow());
    mockTx.federationLink.create.mockClear();
  });

  it("stores the connector's callbackToken as the inviter's outbound token", async () => {
    const res = await enrollFederationLink({
      bootstrapToken: bootstrap.plaintext,
      peerAuthorityUrl: "http://192.168.0.152:3000",
      displayName: "Mac",
      callbackToken: "dpflink_callback_from_connector",
    });
    expect(res.ok).toBe(true);
    // The inviter can now call the connector back.
    expect(captured.data?.peerTokenEnc).toBe("enc(dpflink_callback_from_connector)");
    // And it still issues its own inbound token for the connector to use.
    expect(typeof captured.data?.tokenHash).toBe("string");
  });

  it("leaves peerTokenEnc null when no callbackToken is supplied (older connector)", async () => {
    const res = await enrollFederationLink({
      bootstrapToken: bootstrap.plaintext,
      peerAuthorityUrl: "http://192.168.0.152:3000",
      displayName: "Mac",
    });
    expect(res.ok).toBe(true);
    expect(captured.data?.peerTokenEnc).toBeNull();
  });
});
