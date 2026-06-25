import { describe, expect, it, vi } from "vitest";
import { postToPeer, sendIncidentToPeer } from "./client";

function mockFetch(res: { ok?: boolean; status?: number; json?: unknown } = {}) {
  return vi.fn().mockResolvedValue({
    ok: res.ok ?? true,
    status: res.status ?? 200,
    json: async () => res.json ?? { ok: true },
  }) as unknown as typeof fetch;
}

describe("postToPeer", () => {
  it("POSTs to peerUrl+path with Bearer auth and a JSON body; strips trailing slash", async () => {
    const f = mockFetch({ status: 200, json: { ok: true, action: "created" } });
    const result = await postToPeer({
      peerAuthorityUrl: "https://peer.example/",
      linkToken: "dpflink_secret",
      path: "/api/v1/federation/incident",
      cloudEvent: { specversion: "1.0", data: { x: 1 } },
      fetchImpl: f,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://peer.example/api/v1/federation/incident");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer dpflink_secret");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).data).toEqual({ x: 1 });
  });

  it("refuses an SSRF target (link-local / cloud-metadata host) by default and never dials", async () => {
    const f = mockFetch();
    const result = await postToPeer({
      peerAuthorityUrl: "https://169.254.169.254",
      linkToken: "dpflink_secret",
      path: "/api/v1/federation/incident",
      cloudEvent: {},
      fetchImpl: f,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses a non-https peer scheme by default and never dials", async () => {
    const f = mockFetch();
    const result = await postToPeer({
      peerAuthorityUrl: "http://peer.example",
      linkToken: "dpflink_secret",
      path: "/api/v1/federation/incident",
      cloudEvent: {},
      fetchImpl: f,
    });
    expect(result.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns a soft failure on a network error (no throw)", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const result = await postToPeer({
      peerAuthorityUrl: "https://peer.example",
      linkToken: "dpflink_secret",
      path: "/api/v1/federation/incident",
      cloudEvent: {},
      fetchImpl: f,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain("ECONNREFUSED");
  });
});

describe("sendIncidentToPeer", () => {
  it("wraps the incident in a CloudEvent and posts to the incident route", async () => {
    const f = mockFetch();
    await sendIncidentToPeer(
      { peerAuthorityUrl: "https://peer.example", linkToken: "dpflink_x", linkId: "link_1", fetchImpl: f },
      { incidentKey: "k", summary: "s", payloadHash: "h" },
    );
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://peer.example/api/v1/federation/incident");
    const sent = JSON.parse(init.body as string);
    expect(sent.specversion).toBe("1.0");
    expect(sent.type).toBe("dpf.federation.incident");
    expect(sent.dpflinkid).toBe("link_1");
    expect(sent.data.incidentKey).toBe("k");
  });
});
