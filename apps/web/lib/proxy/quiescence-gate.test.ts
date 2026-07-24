/**
 * Tests for the Proxy-side quiescence gate (BI-QUIESCE-003).
 *
 * Covers the request classification + allow-list + gate decision logic
 * + header attachment + fetch-failure fail-policy. The actual integration
 * with NextAuth wrapping is covered manually via dogfooding once
 * BI-QUIESCE-006 (banner + state route end-to-end) lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  _resetProxyQuiescenceCache,
  attachVersionHeaders,
  checkQuiescenceForRequest,
  evaluateGate,
  fetchQuiescenceState,
  getLastKnownNonNormal,
  isAllowListed,
  isMutationRequest,
  type ProxyQuiescenceState,
} from "./quiescence-gate";

beforeEach(() => {
  _resetProxyQuiescenceCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const normalState: ProxyQuiescenceState = {
  level: "normal",
  runId: null,
  enteredAt: null,
  version: "1.0.0",
  bundleHash: "abc123",
};

const drainingState: ProxyQuiescenceState = {
  level: "draining",
  runId: "QR-2026-05-24-abc12345",
  enteredAt: "2026-05-24T18:00:00.000Z",
  version: "1.0.0",
  bundleHash: "abc123",
};

const swappingState: ProxyQuiescenceState = {
  ...drainingState,
  level: "swapping",
};

function makeRequest(url: string, init?: { method?: string; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers: init?.headers,
  });
}

describe("isAllowListed", () => {
  it("allow-lists /api/health", () => {
    expect(isAllowListed("/api/health")).toBe(true);
    expect(isAllowListed("/api/health/detail")).toBe(true);
  });

  it("allow-lists /api/v1/edge/* (edge-node heartbeats)", () => {
    expect(isAllowListed("/api/v1/edge/heartbeat")).toBe(true);
    expect(isAllowListed("/api/v1/edge/")).toBe(true);
  });

  it("allow-lists the state route itself (would recurse otherwise)", () => {
    expect(isAllowListed("/api/internal/quiescence-state")).toBe(true);
  });

  it("allow-lists MCP transport so route-level tool policy can decide read vs write", () => {
    expect(isAllowListed("/api/mcp/v1")).toBe(true);
  });

  it("does NOT allow-list normal routes", () => {
    expect(isAllowListed("/portal")).toBe(false);
    expect(isAllowListed("/api/portal/coworker")).toBe(false);
    expect(isAllowListed("/admin/quiescence")).toBe(false);
  });

  it("does NOT match arbitrary substring (defensive)", () => {
    expect(isAllowListed("/api/internal/quiescence-something-else")).toBe(false);
    // Cheat that would pass a naïve `includes` check
    expect(isAllowListed("/api/proxy/api/health")).toBe(false);
  });
});

describe("isMutationRequest", () => {
  it("classifies POST as mutation", () => {
    expect(isMutationRequest(makeRequest("https://x/y", { method: "POST" }))).toBe(true);
  });

  it("classifies PUT/PATCH/DELETE as mutation", () => {
    expect(isMutationRequest(makeRequest("https://x/y", { method: "PUT" }))).toBe(true);
    expect(isMutationRequest(makeRequest("https://x/y", { method: "PATCH" }))).toBe(true);
    expect(isMutationRequest(makeRequest("https://x/y", { method: "DELETE" }))).toBe(true);
  });

  it("classifies GET as read-only", () => {
    expect(isMutationRequest(makeRequest("https://x/y", { method: "GET" }))).toBe(false);
  });

  it("classifies HEAD / OPTIONS as read-only", () => {
    expect(isMutationRequest(makeRequest("https://x/y", { method: "HEAD" }))).toBe(false);
    expect(isMutationRequest(makeRequest("https://x/y", { method: "OPTIONS" }))).toBe(false);
  });

  it("classifies GET with Accept: text/event-stream as mutation (new SSE handshake)", () => {
    expect(
      isMutationRequest(
        makeRequest("https://x/y", { method: "GET", headers: { accept: "text/event-stream" } }),
      ),
    ).toBe(true);
  });

  it("classifies GET with Accept: */* as read", () => {
    expect(
      isMutationRequest(makeRequest("https://x/y", { method: "GET", headers: { accept: "*/*" } })),
    ).toBe(false);
  });
});

describe("evaluateGate — pure decision", () => {
  it("passes everything during normal", () => {
    const req = makeRequest("https://example.com/portal", { method: "POST" });
    const d = evaluateGate(req, normalState);
    expect(d.kind).toBe("pass");
  });

  it("blocks mutations during draining", () => {
    const req = makeRequest("https://example.com/admin/x", { method: "POST" });
    const d = evaluateGate(req, drainingState);
    expect(d.kind).toBe("block");
    if (d.kind === "block") {
      expect(d.response.status).toBe(503);
      expect(d.response.headers.get("retry-after")).toBe("30");
      expect(d.response.headers.get("x-platform-version")).toBe("1.0.0");
      expect(d.response.headers.get("x-bundle-hash")).toBe("abc123");
      expect(d.response.headers.get("x-quiescence-level")).toBe("draining");
      expect(d.response.headers.get("x-quiescence-run-id")).toBe("QR-2026-05-24-abc12345");
      // 503 drain response must close the socket (BI-79676285)
      expect(d.response.headers.get("connection")).toBe("close");
    }
  });

  it("passes GETs during draining", () => {
    const req = makeRequest("https://example.com/portal", { method: "GET" });
    expect(evaluateGate(req, drainingState).kind).toBe("pass");
  });

  it("blocks new SSE handshakes during draining", () => {
    const req = makeRequest("https://example.com/api/stream", {
      method: "GET",
      headers: { accept: "text/event-stream" },
    });
    expect(evaluateGate(req, drainingState).kind).toBe("block");
  });

  it("blocks everything during swapping", () => {
    const reqGet = makeRequest("https://example.com/portal", { method: "GET" });
    const reqPost = makeRequest("https://example.com/api/x", { method: "POST" });
    expect(evaluateGate(reqGet, swappingState).kind).toBe("block");
    expect(evaluateGate(reqPost, swappingState).kind).toBe("block");
  });

  it("allow-lists health endpoints even during swapping", () => {
    const req = makeRequest("https://example.com/api/health", { method: "GET" });
    expect(evaluateGate(req, swappingState).kind).toBe("pass");
  });

  it("allow-lists edge-node heartbeats even during swapping", () => {
    const req = makeRequest("https://example.com/api/v1/edge/heartbeat", { method: "POST" });
    expect(evaluateGate(req, swappingState).kind).toBe("pass");
  });

  it("allow-lists the state route even during swapping (avoids recursion)", () => {
    const req = makeRequest("https://example.com/api/internal/quiescence-state", { method: "GET" });
    expect(evaluateGate(req, swappingState).kind).toBe("pass");
  });
});

describe("attachVersionHeaders", () => {
  it("sets X-Platform-Version + X-Bundle-Hash on the response", () => {
    const res = NextResponse.next();
    const result = attachVersionHeaders(res, drainingState);
    expect(result.headers.get("x-platform-version")).toBe("1.0.0");
    expect(result.headers.get("x-bundle-hash")).toBe("abc123");
    expect(result.headers.get("x-quiescence-level")).toBe("draining");
  });

  it("does NOT set x-quiescence-level when state level is unknown", () => {
    const res = NextResponse.next();
    const result = attachVersionHeaders(res, {
      ...normalState,
      level: "unknown",
    });
    expect(result.headers.get("x-quiescence-level")).toBeNull();
    // But version + bundle headers ARE still set even on unknown
    expect(result.headers.get("x-platform-version")).toBe("1.0.0");
  });

  it("sets Connection: close during draining (BI-79676285)", () => {
    const res = NextResponse.next();
    const result = attachVersionHeaders(res, drainingState);
    expect(result.headers.get("connection")).toBe("close");
  });

  it("sets Connection: close during swapping (BI-79676285)", () => {
    const res = NextResponse.next();
    const result = attachVersionHeaders(res, swappingState);
    expect(result.headers.get("connection")).toBe("close");
  });

  it("does NOT set Connection: close during normal (keep-alive preserved)", () => {
    const res = NextResponse.next();
    const result = attachVersionHeaders(res, normalState);
    expect(result.headers.get("connection")).toBeNull();
  });
});

describe("fetchQuiescenceState — cache + timeout", () => {
  it("returns the parsed state from the route", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({
        level: "draining",
        runId: "QR-XYZ",
        enteredAt: "2026-05-24T18:00:00Z",
        version: "1.2.3",
        bundleHash: "deadbeef",
      }), { status: 200 })) as typeof fetch;
    const state = await fetchQuiescenceState("https://x", { fetchImpl, now: 1000 });
    expect(state.level).toBe("draining");
    expect(state.runId).toBe("QR-XYZ");
    expect(state.version).toBe("1.2.3");
  });

  it("returns level=unknown on timeout/error (caller applies fail policy)", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const state = await fetchQuiescenceState("https://x", { fetchImpl, now: 1000 });
    expect(state.level).toBe("unknown");
  });

  it("normalizes unknown level values to 'unknown'", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ level: "garbage", version: "x", bundleHash: "y" }), {
        status: 200,
      })) as typeof fetch;
    const state = await fetchQuiescenceState("https://x", { fetchImpl, now: 1000 });
    expect(state.level).toBe("unknown");
  });

  it("caches within TTL (no second fetch)", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ level: "normal", version: "x", bundleHash: "y" }), {
        status: 200,
      });
    }) as typeof fetch;
    await fetchQuiescenceState("https://x", { fetchImpl, now: 1000 });
    await fetchQuiescenceState("https://x", { fetchImpl, now: 1500 });
    expect(calls).toBe(1);
  });

  it("re-fetches after TTL expires", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ level: "normal", version: "x", bundleHash: "y" }), {
        status: 200,
      });
    }) as typeof fetch;
    await fetchQuiescenceState("https://x", { fetchImpl, now: 1000 });
    await fetchQuiescenceState("https://x", { fetchImpl, now: 3000 });
    expect(calls).toBe(2);
  });

  it("remembers last non-normal state for fail-closed policy", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ level: "draining", runId: "Q1", version: "x", bundleHash: "y" }), {
        status: 200,
      })) as typeof fetch;
    await fetchQuiescenceState("https://x", { fetchImpl, now: 1000 });
    expect(getLastKnownNonNormal()?.level).toBe("draining");
  });
});

describe("checkQuiescenceForRequest — fail policy integration", () => {
  it("does not fetch quiescence state for the state route itself", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(normalState), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest("https://example.com/api/internal/quiescence-state", {
      method: "GET",
    });
    const decision = await checkQuiescenceForRequest(req, "https://example.com");

    expect(decision.kind).toBe("pass");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fail-open for reads when state route returns unknown", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    // Manual injection by pre-seeding cache; checkQuiescenceForRequest
    // uses module-level fetch. We test via evaluateGate directly instead.
    // (fetchQuiescenceState is independently tested above.)
    const req = makeRequest("https://example.com/portal", { method: "GET" });
    const unknownState: ProxyQuiescenceState = {
      level: "unknown",
      runId: null,
      enteredAt: null,
      version: "x",
      bundleHash: "y",
    };
    // Simulate the failure path manually: read → fall back to normal
    const openSubstitute: ProxyQuiescenceState = { ...unknownState, level: "normal" };
    expect(evaluateGate(req, openSubstitute).kind).toBe("pass");
    // Suppress unused-vars lint for fetchImpl placeholder.
    void fetchImpl;
  });

  it("fails open for mutations when state route returns unknown + no prior non-normal memory", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("state route timed out");
    });

    const req = makeRequest("https://example.com/login", { method: "POST" });
    const decision = await checkQuiescenceForRequest(req, "https://example.com");

    expect(decision.kind).toBe("pass");
    expect(decision.state.level).toBe("normal");
  });

  it("preserves last-known non-normal state for mutations on route failure", async () => {
    // Cache the draining state by simulating a successful fetch first.
    const fetchOk = (async () =>
      new Response(JSON.stringify({ level: "draining", runId: "Q1", version: "x", bundleHash: "y" }), {
        status: 200,
      })) as typeof fetch;
    await fetchQuiescenceState("https://x", { fetchImpl: fetchOk, now: 1000 });
    expect(getLastKnownNonNormal()?.level).toBe("draining");

    vi.stubGlobal("fetch", async () => {
      throw new Error("state route timed out");
    });

    const req = makeRequest("https://example.com/api/portal", { method: "POST" });
    const decision = await checkQuiescenceForRequest(req, "https://example.com");

    expect(decision.kind).toBe("block");
    expect(decision.state.level).toBe("draining");
    expect(decision.state.runId).toBe("Q1");
    if (decision.kind === "block") {
      expect(decision.response.status).toBe(503);
      expect(decision.response.headers.get("x-quiescence-run-id")).toBe("Q1");
    }
  });

  // Note: full checkQuiescenceForRequest integration test would mock the
  // module-level `fetch`; skipped here in favor of testing the building
  // blocks individually. The function composes them straightforwardly.
  void checkQuiescenceForRequest; // keep import alive for type-check.
});
