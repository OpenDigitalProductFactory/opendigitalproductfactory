import { describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/govern/credential-crypto";
import { decryptPeerToken, enrollWithPeer } from "./outbound";
import { incidentPayloadHash, pushIncidentsToManagingPeer, type OutboundPushDb } from "./push";

function mockFetch(res: { ok?: boolean; status?: number; json?: unknown }) {
  return vi.fn().mockResolvedValue({
    ok: res.ok ?? true,
    status: res.status ?? 200,
    json: async () => res.json ?? {},
  }) as unknown as typeof fetch;
}

describe("decryptPeerToken", () => {
  it("round-trips through encryptSecret and handles null", () => {
    const stored = encryptSecret("dpflink_peertoken");
    expect(decryptPeerToken(stored)).toBe("dpflink_peertoken");
    expect(decryptPeerToken(null)).toBeNull();
    expect(decryptPeerToken(undefined)).toBeNull();
  });
});

describe("incidentPayloadHash", () => {
  it("is deterministic", () => {
    const i = { incidentKey: "k", summary: "s", highestSeverity: "critical", alertCount: 3 };
    expect(incidentPayloadHash(i)).toBe(incidentPayloadHash({ ...i }));
  });
});

describe("pushIncidentsToManagingPeer", () => {
  const incidents = [{ incidentKey: "k1", summary: "s1", highestSeverity: "critical", alertCount: 3 }];

  it("skips when there is no trusted managing link", async () => {
    const db = { federationLink: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as OutboundPushDb;
    expect(await pushIncidentsToManagingPeer(db, incidents)).toEqual({ pushed: 0, skipped: 1, reason: "no-trusted-managing-link" });
  });

  it("skips when the link has no stored peer token", async () => {
    const db = {
      federationLink: { findFirst: vi.fn().mockResolvedValue({ linkId: "l", peerAuthorityUrl: "https://msp", peerTokenEnc: null }) },
    } as unknown as OutboundPushDb;
    expect(await pushIncidentsToManagingPeer(db, incidents)).toEqual({ pushed: 0, skipped: 1, reason: "no-peer-token" });
  });

  it("pushes each incident to the peer with the decrypted token", async () => {
    const f = mockFetch({ ok: true, json: { ok: true } });
    const db = {
      federationLink: {
        findFirst: vi.fn().mockResolvedValue({ linkId: "link_1", peerAuthorityUrl: "https://msp.example", peerTokenEnc: "dpflink_peertoken" }),
      },
    } as unknown as OutboundPushDb;
    const res = await pushIncidentsToManagingPeer(db, incidents, { fetchImpl: f });
    expect(res).toEqual({ pushed: 1, skipped: 0 });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://msp.example/api/v1/federation/incident");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer dpflink_peertoken");
    expect(JSON.parse(init.body as string).data.payloadHash).toBe(incidentPayloadHash(incidents[0]));
  });

  it("no-ops on empty input", async () => {
    const db = { federationLink: { findFirst: vi.fn() } } as unknown as OutboundPushDb;
    expect(await pushIncidentsToManagingPeer(db, [])).toEqual({ pushed: 0, skipped: 0 });
  });

  it("minimizes the payload at egress — non-allow-listed fields never cross the link", async () => {
    const f = mockFetch({ ok: true, json: { ok: true } });
    const db = {
      federationLink: {
        findFirst: vi.fn().mockResolvedValue({ linkId: "link_1", peerAuthorityUrl: "https://msp.example", peerTokenEnc: "dpflink_peertoken" }),
      },
    } as unknown as OutboundPushDb;
    // An incident that (wrongly) carries customer-identifying + forbidden fields.
    const leaky = [{ incidentKey: "k1", summary: "s1", highestSeverity: "critical", alertCount: 3, internalCustomerName: "Acme Health LLP", patientId: "p-9" }];
    const res = await pushIncidentsToManagingPeer(db, leaky as never, { fetchImpl: f });
    expect(res.pushed).toBe(1);
    const [, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    const sent = JSON.parse(init.body as string).data;
    expect(sent.incidentKey).toBe("k1");
    expect(sent.payloadHash).toBeDefined();
    // The minimum-necessary contract dropped both the off-list and forbidden fields.
    expect(sent.internalCustomerName).toBeUndefined();
    expect(sent.patientId).toBeUndefined();
  });
});

describe("enrollWithPeer (error paths, no prisma)", () => {
  const base = {
    peerAuthorityUrl: "https://msp.example",
    bootstrapToken: "dpffboot_x",
    localAuthorityUrl: "https://customer.example",
    displayName: "Customer LLP",
  };

  it("fails when the peer rejects the invitation", async () => {
    const f = mockFetch({ ok: false, status: 401, json: { ok: false, error: "token_not_found", message: "bad" } });
    const res = await enrollWithPeer({ ...base, fetchImpl: f });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("token_not_found");
  });

  it("fails when the peer returns no usable token/role", async () => {
    const f = mockFetch({ ok: true, json: { ok: true } });
    const res = await enrollWithPeer({ ...base, fetchImpl: f });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid_peer_response");
  });

  it("sends its own callbackToken in the enroll body (mutual handshake)", async () => {
    // Peer rejects → returns before prisma, but the body was still sent.
    const f = mockFetch({ ok: false, status: 401, json: { ok: false } });
    await enrollWithPeer({ ...base, fetchImpl: f });
    const [, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    const sent = JSON.parse(init.body as string) as { callbackToken?: string };
    expect(typeof sent.callbackToken).toBe("string");
    expect(sent.callbackToken!.length).toBeGreaterThan(0);
  });
});
