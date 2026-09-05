import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockAvailable, mockRelay, mockParse } = vi.hoisted(() => ({
  mockAvailable: vi.fn(),
  mockRelay: vi.fn(),
  mockParse: vi.fn(),
}));

vi.mock("@/lib/federation/membership-relay", () => ({
  membershipRelayAvailable: mockAvailable,
  relayMembershipSign: mockRelay,
  parseMembershipSignRequest: mockParse,
}));

import { POST } from "./route";

const body = { spec: "dpf.membership-sign/1", csrPem: "-----BEGIN CERTIFICATE REQUEST-----\nAA==\n-----END CERTIFICATE REQUEST-----", enrollmentToken: "t", memberAddress: "http://192.168.0.200:3000" };

function request(payload: unknown = body, headers: Record<string, string> = {}): NextRequest {
  return new Request("http://test/api/v1/federation/membership/sign", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAvailable.mockResolvedValue({ available: true, rootPem: "ROOT" });
  mockParse.mockReturnValue(body);
  mockRelay.mockResolvedValue({ accepted: true, certPem: "LEAF", chainPems: ["LEAF", "ROOT"], rootPem: "ROOT" });
});

describe("POST /api/v1/federation/membership/sign", () => {
  it("is not there on an installation that is not the organization authority", async () => {
    mockAvailable.mockResolvedValue({ available: false, reason: "not-the-authority" });
    expect((await POST(request())).status).toBe(404);
    expect(mockRelay).not.toHaveBeenCalled();
  });

  it("relays a well-formed request keyed by the caller's address and returns the CA's chain", async () => {
    const response = await POST(request(body, { "x-forwarded-for": "192.168.0.200, 10.0.0.1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, certPem: "LEAF", chainPems: ["LEAF", "ROOT"], rootPem: "ROOT" });
    expect(mockRelay).toHaveBeenCalledWith({ request: body, callerKey: "192.168.0.200" }, { rootPem: "ROOT" });
  });

  it("maps refusals to statuses: malformed 400, token or CA refusal 403, CA down 503, rate limit 429 with retry-after", async () => {
    mockParse.mockReturnValueOnce(null);
    expect((await POST(request())).status).toBe(400);
    expect((await POST(request("not json"))).status).toBe(400);
    mockRelay.mockResolvedValueOnce({ accepted: false, reason: "token-invalid", detail: "expired" });
    const refused = await POST(request());
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ accepted: false, reason: "token-invalid", detail: "expired" });
    mockRelay.mockResolvedValueOnce({ accepted: false, reason: "ca-unreachable" });
    expect((await POST(request())).status).toBe(503);
    mockRelay.mockResolvedValueOnce({ accepted: false, reason: "rate-limited", retryAfterSeconds: 42 });
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("42");
  });
});
