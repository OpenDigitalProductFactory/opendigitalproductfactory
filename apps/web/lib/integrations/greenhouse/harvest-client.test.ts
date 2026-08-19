import { describe, expect, it, vi } from "vitest";
import {
  HARVEST_BASE_URL,
  harvestAuthHeader,
  harvestGetPaged,
  HarvestApiError,
  parseHarvestNextLink,
  verifyHarvestCredential,
} from "./harvest-client";

function jsonPage(body: unknown, link: string | null = null) {
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k.toLowerCase() === "link" ? link : null) },
    json: async () => body,
  } as unknown as Response;
}

describe("harvestAuthHeader", () => {
  it("encodes the token as Basic base64(token:)", () => {
    expect(harvestAuthHeader("abc123")).toBe(
      `Basic ${Buffer.from("abc123:", "utf8").toString("base64")}`,
    );
  });
});

describe("verifyHarvestCredential", () => {
  it("returns ok:true on a 2xx and sends the Basic auth header to the jobs endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await verifyHarvestCredential("good-key", fetchImpl);

    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${HARVEST_BASE_URL}/jobs?per_page=1`);
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: harvestAuthHeader("good-key"),
    });
  });

  it("returns ok:false with the status on a 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);

    const result = await verifyHarvestCredential("bad-key", fetchImpl);

    expect(result).toEqual({ ok: false, status: 401 });
  });
});

describe("parseHarvestNextLink", () => {
  it("extracts the rel=next URL", () => {
    const header =
      '<https://harvest.greenhouse.io/v1/jobs?page=2>; rel="next", <https://harvest.greenhouse.io/v1/jobs?page=9>; rel="last"';
    expect(parseHarvestNextLink(header)).toBe("https://harvest.greenhouse.io/v1/jobs?page=2");
  });

  it("returns null when there is no next link", () => {
    expect(parseHarvestNextLink(null)).toBeNull();
    expect(parseHarvestNextLink('<...>; rel="prev"')).toBeNull();
  });
});

describe("harvestGetPaged", () => {
  it("follows rel=next across pages and concatenates results", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonPage([{ id: 1 }], `<${HARVEST_BASE_URL}/jobs?page=2>; rel="next"`))
      .mockResolvedValueOnce(jsonPage([{ id: 2 }], null));

    const rows = await harvestGetPaged<{ id: number }>("/jobs", { apiToken: "k", fetchImpl });

    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${HARVEST_BASE_URL}/jobs?per_page=100`);
  });

  it("retries on 429 honoring Retry-After, then succeeds", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (k: string) => (k.toLowerCase() === "retry-after" ? "0" : null) },
      } as unknown as Response)
      .mockResolvedValueOnce(jsonPage([{ id: 1 }], null));

    const rows = await harvestGetPaged<{ id: number }>("/jobs", {
      apiToken: "k",
      fetchImpl,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(rows).toEqual([{ id: 1 }]);
    expect(sleeps).toEqual([0]);
  });

  it("throws HarvestApiError on a non-429 error status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
    } as unknown as Response);

    await expect(harvestGetPaged("/jobs", { apiToken: "k", fetchImpl })).rejects.toBeInstanceOf(
      HarvestApiError,
    );
  });
});
