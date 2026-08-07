import { describe, expect, it, vi } from "vitest";
import { isPrivateOrLoopbackFederationHost, postToPeer, sendDemandDigestToPeer, sendDemandToPeer, sendIncidentToPeer } from "./client";

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

describe("sendDemandToPeer", () => {
  it("uses the demand inbox route and preserves the DPF demand activity", async () => {
    const f = mockFetch({ status: 202, json: { ok: true, originVersion: 7 } });

    const result = await sendDemandToPeer(
      { peerAuthorityUrl: "https://peer.example", linkToken: "dpflink_x", linkId: "link_1", fetchImpl: f },
      "dpf.demand.updated",
      { envelopeId: "dem_1", originVersion: 7 },
      { eventId: "evt_stable", now: new Date("2026-07-20T06:00:00.000Z") },
    );

    expect(result).toMatchObject({ ok: true, status: 202 });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://peer.example/api/v1/federation/demand");
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      id: "evt_stable",
      type: "dpf.demand.updated",
      time: "2026-07-20T06:00:00.000Z",
      dpflinkid: "link_1",
      data: { envelopeId: "dem_1", originVersion: 7 },
    });
  });
});

describe("sendDemandDigestToPeer", () => {
  it("uses the authenticated reconciliation endpoint", async () => {
    const f = mockFetch({ status: 200, json: { ok: true, needs: [] } });
    await sendDemandDigestToPeer(
      { peerAuthorityUrl: "https://peer.example", linkToken: "dpflink_x", linkId: "link_1", fetchImpl: f },
      { specVersion: "dpf.demand-digest/1", records: [] },
      { eventId: "evt_digest", now: new Date("2026-07-20T06:00:00.000Z") },
    );
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://peer.example/api/v1/federation/demand/reconcile");
    expect(JSON.parse(init.body as string)).toMatchObject({ id: "evt_digest", type: "dpf.demand.reconcile" });
  });
});

describe("isPrivateOrLoopbackFederationHost", () => {
  it.each([
    "http://192.168.0.152:3000",
    "http://10.1.2.3:3000",
    "http://172.16.0.9:3000",
    "http://172.31.255.1",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://[::1]:3000",
    "https://box.local:3000",
  ])("is true for private/loopback/link-local host %s", (u) => {
    expect(isPrivateOrLoopbackFederationHost(u)).toBe(true);
  });

  it.each([
    "https://peer.example.com",
    "http://203.0.113.10:3000",
    "http://172.15.0.1", // just below the 172.16-31 private block
    "http://172.32.0.1", // just above
    "https://federation.acme.io",
    "not a url",
  ])("is false for public/DNS/out-of-range host %s", (u) => {
    expect(isPrivateOrLoopbackFederationHost(u)).toBe(false);
  });
});

describe("safePeerRequestUrl scoped same-org LAN allowance (via postToPeer)", () => {
  const base = {
    linkToken: "dpflink_secret",
    path: "/api/v1/federation/enroll",
    cloudEvent: {},
  };

  it("same-org LAN: dials a private http peer WITHOUT the global flag", async () => {
    const f = mockFetch({ ok: true, status: 200 });
    const result = await postToPeer({
      ...base,
      peerAuthorityUrl: "http://192.168.0.200:3000",
      sameOrgLan: true,
      fetchImpl: f,
    });
    expect(result.ok).toBe(true);
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it("NOT same-org: a private http peer is still SSRF-blocked and never dialed", async () => {
    const f = mockFetch();
    const result = await postToPeer({
      ...base,
      peerAuthorityUrl: "http://192.168.0.200:3000",
      sameOrgLan: false,
      fetchImpl: f,
    });
    expect(result.ok).toBe(false);
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
  });

  it("same-org but PUBLIC http peer: still requires HTTPS (public http never auto-allowed)", async () => {
    const f = mockFetch();
    const result = await postToPeer({
      ...base,
      peerAuthorityUrl: "http://peer.example.com",
      sameOrgLan: true,
      fetchImpl: f,
    });
    expect(result.ok).toBe(false);
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
  });

  it("same-org + private HTTPS peer: dialed", async () => {
    const f = mockFetch({ ok: true, status: 200 });
    const result = await postToPeer({
      ...base,
      peerAuthorityUrl: "https://192.168.0.200:3000",
      sameOrgLan: true,
      fetchImpl: f,
    });
    expect(result.ok).toBe(true);
  });
});
