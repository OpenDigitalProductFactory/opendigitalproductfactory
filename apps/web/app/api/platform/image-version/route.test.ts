import { afterEach, describe, expect, it, vi } from "vitest";

const readImageVersion = vi.fn();

vi.mock("@/lib/platform/image-version", () => ({
  readImageVersion: (...args: unknown[]) => readImageVersion(...args),
}));

import { GET } from "./route";

afterEach(() => {
  readImageVersion.mockReset();
});

describe("GET /api/platform/image-version", () => {
  it("returns the stamped version when the file is present", async () => {
    readImageVersion.mockResolvedValueOnce({
      raw: "0ef4ee02f5131e759a9462076d30449995c66655",
      source: "git-sha",
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      present: true,
      version: "0ef4ee02f5131e759a9462076d30449995c66655",
      source: "git-sha",
    });
  });

  it("returns present:false when the image was not stamped", async () => {
    readImageVersion.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      present: false,
      version: null,
      source: null,
    });
  });

  it("disables caching so a stale image cannot serve a cached fresh-looking value", async () => {
    readImageVersion.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toMatch(/no-cache/);
  });
});
