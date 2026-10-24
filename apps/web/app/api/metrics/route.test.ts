import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/metrics", () => ({
  metricsRegistry: { metrics: vi.fn(async () => "dpf_up 1\n"), contentType: "text/plain; version=0.0.4" },
}));
vi.mock("@/lib/voice-synthesis/service-status", () => ({ refreshVoiceTtsMetrics: vi.fn(async () => {}) }));
vi.mock("@/lib/operate/dependency-health", () => ({ refreshDependencyMetrics: vi.fn(async () => {}) }));

import { GET } from "./route";

const original = process.env.PUBLIC_URL;
afterEach(() => {
  if (original === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = original;
});

function scrape(host: string, forwardedHost?: string): Request {
  const headers: Record<string, string> = { host };
  if (forwardedHost) headers["x-forwarded-host"] = forwardedHost;
  return new Request(`http://${host}/api/metrics`, { headers });
}

describe("GET /api/metrics", () => {
  it("serves the internal Prometheus scrape", async () => {
    process.env.PUBLIC_URL = "https://dpf.example.com";
    const res = await GET(scrape("portal:3000"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("dpf_up 1");
  });

  it("returns 404 to a request that arrived through the public hostname", async () => {
    process.env.PUBLIC_URL = "https://dpf.example.com";
    expect((await GET(scrape("dpf.example.com"))).status).toBe(404);
    expect((await GET(scrape("portal:3000", "dpf.example.com"))).status).toBe(404);
  });

  it("is unchanged on an install with no public URL", async () => {
    delete process.env.PUBLIC_URL;
    expect((await GET(scrape("192.168.1.20:3000"))).status).toBe(200);
  });
});
