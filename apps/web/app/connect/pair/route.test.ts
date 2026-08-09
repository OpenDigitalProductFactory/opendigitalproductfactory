import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  confirm: vi.fn(),
  poll: vi.fn(),
  reveal: vi.fn(),
  identity: vi.fn(),
  organization: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: { organization: { findFirst: mocks.organization } },
}));
vi.mock("@/lib/federation/demand-identity", () => ({
  resolveFederationSigningIdentity: mocks.identity,
}));
vi.mock("@/lib/federation/nearby-pairing-service", () => ({
  createIncomingNearbyPairing: mocks.create,
  confirmIncomingNearbyPairing: mocks.confirm,
  pollIncomingNearbyPairing: mocks.poll,
  revealIncomingNearbyPairing: mocks.reveal,
}));

import { _resetNearbyPairingRateLimits } from "@/lib/federation/nearby-pairing-rate-limit";

import { POST } from "./route";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://dpf-b.local/connect/pair", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.168.1.40", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /connect/pair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetNearbyPairingRateLimits();
    mocks.identity.mockResolvedValue({ installationId: `inst_${"b".repeat(32)}`, projectionSecret: "c".repeat(64) });
    mocks.organization.mockResolvedValue({ name: "Windows development installation" });
    mocks.create.mockResolvedValue({ ok: true, pairingId: "pair_123" });
    mocks.confirm.mockResolvedValue({ ok: true, status: "pending-confirmation" });
    mocks.poll.mockResolvedValue({ ok: true, status: "pending" });
    mocks.reveal.mockResolvedValue({
      ok: true,
      matchingCode: "123456",
      receiverEphemeralPublicKey: "receiver-public-key",
      receiverNonce: "receiver-nonce",
    });
  });

  it("creates a bounded incoming session without requiring an existing federation credential", async () => {
    const response = await POST(request({
      operation: "request",
      requesterAuthorityUrl: "https://dpf-a.local:3443",
      displayName: "Mac development installation",
      requesterInstallationId: `inst_${"a".repeat(32)}`,
      candidateDiscoveryId: "rotating-b-123456",
      relationshipPreset: "same-organization",
    }));

    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      {
        requesterAuthorityUrl: "https://dpf-a.local:3443",
        displayName: "Mac development installation",
        requesterInstallationId: `inst_${"a".repeat(32)}`,
        candidateDiscoveryId: "rotating-b-123456",
        relationshipPreset: "same-organization",
      },
      expect.objectContaining({
        localDisplayName: "Windows development installation",
        localInstallationId: `inst_${"b".repeat(32)}`,
        localAuthorityUrl: "https://dpf-b.local",
        localSigningIdentity: expect.any(Object),
      }),
    );
  });

  it("accepts a bounded authenticated commit reveal", async () => {
    const response = await POST(request({
      operation: "reveal",
      pairingId: "pair_123",
      pairingSecret: `dpffpair_${"a".repeat(43)}`,
      requesterEphemeralPublicKey: "requester-public-key",
      requesterNonce: "requester-nonce",
    }));
    expect(response.status).toBe(200);
    expect(mocks.reveal).toHaveBeenCalledWith({
      pairingId: "pair_123",
      pairingSecret: `dpffpair_${"a".repeat(43)}`,
      requesterEphemeralPublicKey: "requester-public-key",
      requesterNonce: "requester-nonce",
    });
  });

  it("records the requester's explicit matching-code confirmation", async () => {
    const response = await POST(request({
      operation: "confirm",
      pairingId: "pair_123",
      pairingSecret: `dpffpair_${"a".repeat(43)}`,
    }));
    expect(response.status).toBe(200);
    expect(mocks.confirm).toHaveBeenCalledWith({
      pairingId: "pair_123",
      pairingSecret: `dpffpair_${"a".repeat(43)}`,
    });
  });

  it("polls only with the pairing id and high-entropy bearer secret", async () => {
    const response = await POST(request({
      operation: "poll",
      pairingId: "pair_123",
      pairingSecret: `dpffpair_${"a".repeat(43)}`,
    }));
    expect(response.status).toBe(200);
    expect(mocks.poll).toHaveBeenCalledWith({
      pairingId: "pair_123",
      pairingSecret: `dpffpair_${"a".repeat(43)}`,
    });

    const codeResponse = await POST(request({
      operation: "poll",
      pairingId: "pair_123",
      pairingSecret: "ABCD-EFGH",
    }));
    expect(codeResponse.status).toBe(400);
  });

  it("rejects oversized and repeated unauthenticated requests", async () => {
    const oversized = await POST(request({ operation: "request" }, { "content-length": "9000" }));
    expect(oversized.status).toBe(413);

    let last = await POST(request({ operation: "unknown" }));
    for (let index = 0; index < 10; index += 1) {
      last = await POST(request({ operation: "unknown" }));
    }
    expect(last.status).toBe(429);
  });

  it("allows the three-second approval polling cadence without opening request intake", async () => {
    let response: Response | undefined;
    for (let index = 0; index < 20; index += 1) {
      response = await POST(request({
        operation: "poll",
        pairingId: "pair_123",
        pairingSecret: `dpffpair_${"a".repeat(43)}`,
      }));
    }
    expect(response?.status).toBe(200);
  });
});
