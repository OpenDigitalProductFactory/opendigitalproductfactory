import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: authMock }));

const organizationFindFirst = vi.hoisted(() => vi.fn());
const mediaAttachmentFindFirst = vi.hoisted(() => vi.fn());
vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: organizationFindFirst },
    mediaAttachment: { findFirst: mediaAttachmentFindFirst },
  },
}));

const driverGet = vi.hoisted(() => vi.fn());
const getMediaStorageDriver = vi.hoisted(() => vi.fn(() => ({ get: driverGet })));
vi.mock("@/lib/media", () => ({ getMediaStorageDriver }));

import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost/api/critique-media/asset1");

const READY_CRITIQUE_ASSET = {
  asset: {
    storageKey: "media/sha256/aa/bb/ccc",
    storageDriver: "filesystem",
    mimeType: "image/png",
    status: "ready",
    kind: "image",
  },
};

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "u1" } });
  organizationFindFirst.mockReset().mockResolvedValue({ id: "org1" });
  mediaAttachmentFindFirst.mockReset().mockResolvedValue(READY_CRITIQUE_ASSET);
  driverGet.mockReset().mockResolvedValue(Buffer.from("PNGBYTES"));
  getMediaStorageDriver.mockClear();
});

describe("GET /api/critique-media/:id", () => {
  it("refuses an unauthenticated request", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(req(), ctx("asset1"));
    expect(res.status).toBe(401);
    expect(mediaAttachmentFindFirst).not.toHaveBeenCalled();
  });

  it("streams the bytes for a signed-in reviewer, privately cached", async () => {
    const res = await GET(req(), ctx("asset1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("private");
    expect(await res.text()).toBe("PNGBYTES");
  });

  it("scopes the query to this org, a WikiPage owner, and the critique role", async () => {
    await GET(req(), ctx("asset1"));
    expect(mediaAttachmentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          mediaAssetId: "asset1",
          organizationId: "org1",
          ownerType: "WikiPage",
          role: "critique-screenshot",
        }),
      }),
    );
  });

  it("404s an asset that is not an anchored critique screenshot", async () => {
    // A bare MediaAsset, a storefront image, another org's asset — none has a
    // matching critique attachment, so the query returns null.
    mediaAttachmentFindFirst.mockResolvedValue(null);
    const res = await GET(req(), ctx("asset1"));
    expect(res.status).toBe(404);
    expect(driverGet).not.toHaveBeenCalled();
  });

  it("404s an asset that is still uploading", async () => {
    mediaAttachmentFindFirst.mockResolvedValue({
      asset: { ...READY_CRITIQUE_ASSET.asset, status: "uploading" },
    });
    const res = await GET(req(), ctx("asset1"));
    expect(res.status).toBe(404);
  });

  it("404s when the blob cannot be read from storage", async () => {
    driverGet.mockRejectedValue(new Error("ENOENT"));
    const res = await GET(req(), ctx("asset1"));
    expect(res.status).toBe(404);
  });
});
