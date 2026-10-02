import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ verify: vi.fn(), auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/jwt", () => ({ verifyAccessToken: m.verify }));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));

import { hasMapAssetAccess } from "./map-asset-access.server";

const request = (headers: Record<string, string> = {}) => new Request("https://dpf.local/api/map-assets/us-tx", { headers });

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue(null);
});

describe("hasMapAssetAccess (AC-PMR-AUTH-1)", () => {
  it("admits the phone's valid bearer token without a session", async () => {
    m.verify.mockResolvedValue({ sub: "user-1" });
    expect(await hasMapAssetAccess(request({ authorization: "Bearer good" }))).toBe(true);
    expect(m.verify).toHaveBeenCalledWith("good");
    expect(m.auth).not.toHaveBeenCalled();
  });

  it("refuses an invalid or expired bearer token", async () => {
    m.verify.mockRejectedValue(new Error("expired"));
    expect(await hasMapAssetAccess(request({ authorization: "Bearer bad" }))).toBe(false);
  });

  it("admits a signed-in web session", async () => {
    m.auth.mockResolvedValue({ user: { id: "user-1" } });
    expect(await hasMapAssetAccess(request())).toBe(true);
  });

  it("refuses a caller with neither", async () => {
    expect(await hasMapAssetAccess(request())).toBe(false);
  });
});
