import { describe, expect, it, vi } from "vitest";
import { contractProbe, reachabilityProbe } from "./probes";
import type { JourneyProbeContext } from "./types";

function ctx(overrides: Partial<JourneyProbeContext> = {}): JourneyProbeContext {
  return {
    organizationId: "org_1",
    organizationSlug: "acme",
    baseUrl: "https://example.test",
    storefrontId: "sf_1",
    storefrontPublished: true,
    archetypeIds: ["field-service"],
    bookableItemId: "item_1",
    hasInquirySurface: true,
    hasPaymentConfiguration: true,
    fetchImpl: vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch,
    now: () => new Date(0),
    ...overrides,
  };
}

describe("reachabilityProbe", () => {
  it("passes on a sub-400 response", async () => {
    const probe = reachabilityProbe(() => "/s/acme");
    const result = await probe(ctx());
    expect(result.passed).toBe(true);
  });

  it("fails with expected-vs-actual on an error status", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 503, statusText: "Service Unavailable" }),
    ) as unknown as typeof fetch;
    const probe = reachabilityProbe(() => "/s/acme");

    const result = await probe(ctx({ fetchImpl }));

    expect(result.passed).toBe(false);
    expect(result.expected).toContain("below 400");
    expect(result.actual).toContain("503");
  });

  it("reports a plain outage when neither the public address nor loopback answers", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const probe = reachabilityProbe(() => "/s/acme");

    const result = await probe(ctx({ fetchImpl }));

    expect(result.passed).toBe(false);
    expect(result.actual).toBe("ECONNREFUSED");
    expect(result.detail).toContain("could not be reached at all");
  });

  it("distinguishes 'unreachable publicly' from 'down', so the operator hunts the right problem", async () => {
    // Public address refuses; the same page answers on loopback => the app is
    // up and this is a DNS / proxy / certificate problem, not an outage.
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ENOTFOUND book.example.test"))
      .mockResolvedValueOnce(new Response("", { status: 200 })) as unknown as typeof fetch;
    const probe = reachabilityProbe(() => "/s/acme");

    const result = await probe(ctx({ fetchImpl }));

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("works inside the install");
    expect(result.actual).toContain("DNS, proxy, or certificate");
    // The second attempt must target loopback, not the public origin again.
    const secondUrl = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[1][0];
    expect(secondUrl).toContain("127.0.0.1");
  });

  it("reports a missing base URL as a configuration gap, not a journey failure cause", async () => {
    const probe = reachabilityProbe(() => "/s/acme");
    const result = await probe(ctx({ baseUrl: "" }));

    expect(result.passed).toBe(false);
    expect(result.expected).toContain("NEXT_PUBLIC_BASE_URL");
  });

  it("fails when the public path cannot be built", async () => {
    const probe = reachabilityProbe(() => null);
    const result = await probe(ctx({ organizationSlug: null }));

    expect(result.passed).toBe(false);
    expect(result.actual).toContain("no organization slug");
  });
});

describe("contractProbe", () => {
  it("passes with the supplied detail when the predicate holds", async () => {
    const probe = contractProbe(
      () => ({ ok: true, expected: "e", actual: "a" }),
      "all good",
      "all bad",
    );
    const result = await probe(ctx());
    expect(result).toEqual({ passed: true, detail: "all good" });
  });

  it("carries expected-vs-actual when the predicate fails", async () => {
    const probe = contractProbe(
      () => ({ ok: false, expected: "a published storefront", actual: "published=false" }),
      "all good",
      "all bad",
    );
    const result = await probe(ctx());
    expect(result.passed).toBe(false);
    expect(result.expected).toBe("a published storefront");
    expect(result.actual).toBe("published=false");
  });
});
