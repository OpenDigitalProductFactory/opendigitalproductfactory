import { describe, expect, it } from "vitest";

import { createNvdRateLimiter, fetchNvdCveAdvisories } from "./nvd-client";

const NVD_RESPONSE = {
  vulnerabilities: [
    {
      cve: {
        id: "CVE-2026-4242",
        metrics: {
          cvssMetricV31: [{ cvssData: { baseSeverity: "CRITICAL" } }],
        },
      },
    },
    {
      cve: {
        id: "CVE-2026-9999",
        metrics: {
          cvssMetricV2: [{ baseSeverity: "LOW" }],
        },
      },
    },
  ],
};

describe("fetchNvdCveAdvisories", () => {
  it("queries the NVD CVE API by cpeName and maps CVSS severity to patch advisories", async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => NVD_RESPONSE } as Response;
    }) as unknown as typeof fetch;

    const advisories = await fetchNvdCveAdvisories("cpe:2.3:o:canonical:ubuntu_linux:22.04:*:*:*:*:*:*:*", {
      fetcher,
      kevCves: new Set(["CVE-2026-4242"]),
      rateLimiter: { wait: async () => undefined },
    });

    expect(urls[0]).toContain("/rest/json/cves/2.0?");
    expect(urls[0]).toContain("cpeName=cpe%3A2.3%3Ao%3Acanonical%3Aubuntu_linux%3A22.04");
    expect(urls[0]).toContain("isVulnerable");
    expect(advisories).toEqual([
      {
        id: "CVE-2026-4242",
        severity: "critical",
        fixedVersion: null,
        cisaKev: true,
        source: "nvd",
        findingKind: "patch-gap",
      },
      {
        id: "CVE-2026-9999",
        severity: "low",
        fixedVersion: null,
        cisaKev: false,
        source: "nvd",
        findingKind: "patch-gap",
      },
    ]);
  });

  it("backs off on NVD 429 responses before retrying once", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 429, headers: { get: () => "2" } } as unknown as Response;
      }
      return { ok: true, json: async () => ({ vulnerabilities: [] }) } as Response;
    }) as unknown as typeof fetch;

    await fetchNvdCveAdvisories("cpe:2.3:o:canonical:ubuntu_linux:22.04:*:*:*:*:*:*:*", {
      fetcher,
      kevCves: new Set(),
      rateLimiter: { wait: async () => undefined },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  it("fetches all NVD pages for broad CPE matches", async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      const startIndex = new URL(url).searchParams.get("startIndex");
      if (startIndex === "0") {
        return {
          ok: true,
          json: async () => ({
            resultsPerPage: 1,
            startIndex: 0,
            totalResults: 2,
            vulnerabilities: [{ cve: { id: "CVE-2026-0001" } }],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          resultsPerPage: 1,
          startIndex: 1,
          totalResults: 2,
          vulnerabilities: [{ cve: { id: "CVE-2026-0002" } }],
        }),
      } as Response;
    }) as unknown as typeof fetch;

    const advisories = await fetchNvdCveAdvisories("cpe:2.3:a:vendor:product:*:*:*:*:*:*:*:*", {
      fetcher,
      kevCves: new Set(),
      rateLimiter: { wait: async () => undefined },
    });

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("startIndex=0");
    expect(urls[1]).toContain("startIndex=1");
    expect(advisories.map((advisory) => advisory.id)).toEqual(["CVE-2026-0001", "CVE-2026-0002"]);
  });
});

describe("createNvdRateLimiter", () => {
  it("uses the anonymous 5 per 30s limit unless an API key is configured", async () => {
    const sleeps: number[] = [];
    const limiter = createNvdRateLimiter({
      hasApiKey: false,
      now: (() => {
        let t = 0;
        return () => t++;
      })(),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await limiter.wait();
    await limiter.wait();
    await limiter.wait();
    await limiter.wait();
    await limiter.wait();
    await limiter.wait();

    expect(sleeps).toEqual([29995]);
  });

  it("uses the keyed 50 per 30s limit when an API key is configured", async () => {
    const sleeps: number[] = [];
    const limiter = createNvdRateLimiter({
      hasApiKey: true,
      now: (() => {
        let t = 0;
        return () => t++;
      })(),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    for (let i = 0; i < 51; i += 1) await limiter.wait();

    expect(sleeps).toEqual([29950]);
  });

  it("records the post-sleep request time before admitting the next window", async () => {
    const sleeps: number[] = [];
    let currentTime = 0;
    const limiter = createNvdRateLimiter({
      hasApiKey: false,
      now: () => currentTime,
      sleep: async (ms) => {
        sleeps.push(ms);
        currentTime += ms;
      },
    });

    for (let i = 0; i < 5; i += 1) await limiter.wait();
    currentTime = 1000;
    await limiter.wait();
    currentTime = 31000;
    for (let i = 0; i < 5; i += 1) await limiter.wait();

    expect(sleeps).toEqual([29000, 29000]);
  });
});
