import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    deviceCodeSession: {
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  GITHUB_OAUTH_CLIENT_ID,
  cleanupExpiredDeviceCodeSessions,
  pollAccessToken,
  requestDeviceCode,
} from "./github-oauth";

function okJson<T>(body: T): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function errResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestDeviceCode", () => {
  it("POSTs to https://github.com/login/device/code with the right body and headers", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(
      okJson({
        device_code: "dc_abc",
        user_code: "WDJB-MJHT",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    );

    const result = await requestDeviceCode("public_repo");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/login/device/code",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }),
    );

    // Verify the body params encode client_id and scope.
    const callArg = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = callArg?.body as URLSearchParams;
    expect(body.get("client_id")).toBe(GITHUB_OAUTH_CLIENT_ID);
    expect(body.get("scope")).toBe("public_repo");

    expect(result).toEqual({
      device_code: "dc_abc",
      user_code: "WDJB-MJHT",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
  });

  it("throws when GitHub returns a non-2xx status", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(errResponse(503));
    await expect(requestDeviceCode()).rejects.toThrow(/503/);
  });
});

describe("pollAccessToken", () => {
  it("returns { status: 'pending' } on authorization_pending", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      okJson({ error: "authorization_pending" }),
    );
    const result = await pollAccessToken("dc_abc");
    expect(result).toEqual({ status: "pending" });
  });

  it("returns { status: 'slow_down', interval } on slow_down with carried interval", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      okJson({ error: "slow_down", interval: 15 }),
    );
    const result = await pollAccessToken("dc_abc");
    expect(result).toEqual({ status: "slow_down", interval: 15 });
  });

  it("falls back to interval=10 on slow_down when GitHub omits the field", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ error: "slow_down" }));
    const result = await pollAccessToken("dc_abc");
    expect(result).toEqual({ status: "slow_down", interval: 10 });
  });

  it("returns { status: 'success', token, scope } on access_token success", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      okJson({
        access_token: "gho_xxx",
        scope: "public_repo",
        token_type: "bearer",
      }),
    );

    const result = await pollAccessToken("dc_abc");
    expect(result).toEqual({
      status: "success",
      token: "gho_xxx",
      scope: "public_repo",
    });
  });

  it("returns scope='' when GitHub returns access_token without a scope field", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      okJson({ access_token: "gho_yyy" }),
    );
    const result = await pollAccessToken("dc_abc");
    expect(result).toEqual({ status: "success", token: "gho_yyy", scope: "" });
  });

  it("returns { status: 'expired' } on expired_token", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ error: "expired_token" }));
    const result = await pollAccessToken("dc_abc");
    expect(result).toEqual({ status: "expired" });
  });

  it("returns { status: 'denied' } on access_denied", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okJson({ error: "access_denied" }));
    const result = await pollAccessToken("dc_abc");
    expect(result).toEqual({ status: "denied" });
  });

  it("returns { status: 'error', error } on unrecognized error codes", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      okJson({ error: "rabbit_in_orbit", error_description: "Unexpected" }),
    );
    const result = await pollAccessToken("dc_abc");
    expect(result).toEqual({ status: "error", error: "Unexpected" });
  });

  it("returns { status: 'error', error: '...status...' } on non-2xx HTTP", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(errResponse(500));
    const result = await pollAccessToken("dc_abc");
    expect(result).toEqual({ status: "error", error: "GitHub returned 500" });
  });

  it("POSTs to https://github.com/login/oauth/access_token with the device-code grant", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(okJson({ error: "authorization_pending" }));

    await pollAccessToken("dc_abc");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({ method: "POST" }),
    );
    const body = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)
      ?.body as URLSearchParams;
    expect(body.get("client_id")).toBe(GITHUB_OAUTH_CLIENT_ID);
    expect(body.get("device_code")).toBe("dc_abc");
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
  });
});

describe("cleanupExpiredDeviceCodeSessions", () => {
  it("deletes rows whose expiresAt is in the past and returns the count", async () => {
    const before = Date.now();
    vi.mocked(prisma.deviceCodeSession.deleteMany).mockResolvedValueOnce({ count: 7 });

    const removed = await cleanupExpiredDeviceCodeSessions();

    expect(removed).toBe(7);
    expect(prisma.deviceCodeSession.deleteMany).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.deviceCodeSession.deleteMany).mock.calls[0]?.[0] as
      | { where?: { expiresAt?: { lt?: Date } } }
      | undefined;
    expect(arg?.where?.expiresAt?.lt).toBeInstanceOf(Date);
    expect((arg?.where?.expiresAt?.lt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("returns 0 when nothing matched", async () => {
    vi.mocked(prisma.deviceCodeSession.deleteMany).mockResolvedValueOnce({ count: 0 });
    const removed = await cleanupExpiredDeviceCodeSessions();
    expect(removed).toBe(0);
  });
});
