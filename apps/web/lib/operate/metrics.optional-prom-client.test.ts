// BI-PIR-53d2c42d — lib/operate/metrics must not require prom-client at import.
//
// The portal image installs only the `@dpf/db...` runtime dependency set
// (Dockerfile "Runtime dependency set", BI-C7C6D827), so prom-client is NOT
// resolvable from /app/apps/web-src. Scripts the image runs from web-src
// (reembed-wiki-store.ts at every boot, approval-convergence-probe.ts) reach
// this module transitively — via nonprod/environment-lease and mcp-tools — and
// died with "Cannot find module 'prom-client'". Only the Next server worked,
// because its standalone bundle traces prom-client.
//
// This test makes prom-client unresolvable by every route a module can load
// it (the ESM/vitest import pipeline AND the CommonJS resolver that tsx and a
// guarded `require` use), then asserts the metrics module still imports and its
// metric objects degrade to safe no-ops.

import Module from "node:module";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("prom-client", () => {
  throw new Error("Cannot find module 'prom-client'");
});

type Resolver = (request: string, ...rest: unknown[]) => string;
const moduleInternals = Module as unknown as { _resolveFilename: Resolver };
const realResolve = moduleInternals._resolveFilename;
moduleInternals._resolveFilename = function patched(this: unknown, request: string, ...rest: unknown[]) {
  if (request === "prom-client" || request.startsWith("prom-client/")) {
    const err = new Error(`Cannot find module '${request}'`) as Error & { code?: string };
    err.code = "MODULE_NOT_FOUND";
    throw err;
  }
  return realResolve.call(this, request, ...rest);
} as Resolver;

afterAll(() => {
  moduleInternals._resolveFilename = realResolve;
});

describe("lib/operate/metrics without prom-client (web-src script context)", () => {
  it("imports without resolving prom-client", async () => {
    await expect(import("./metrics")).resolves.toBeDefined();
    const m = await import("./metrics");
    expect(m.metricsBackendAvailable).toBe(false);
    expect(m.loadPromClient()).toBeNull();
  });

  it("degrades every metric kind to a safe no-op", async () => {
    const m = await import("./metrics");

    expect(() => m.httpRequestsTotal.inc({ method: "GET", route: "/x", status_code: "200" })).not.toThrow();
    expect(() => m.gateRunDispositionsTotal.inc({ gate_kind: "k", disposition: "d", result_class: "r" })).not.toThrow();
    expect(() => m.kernelGateDecisionsTotal.labels("allow", "p", "s").inc()).not.toThrow();
    expect(() => m.queueDepth.set({ queue_key: "q" }, 3)).not.toThrow();
    expect(() => m.sandboxBuildsActive.inc()).not.toThrow();
    expect(() => m.sandboxBuildsActive.dec()).not.toThrow();
    expect(() => m.queueWaitSeconds.observe({ queue_key: "q" }, 1.5)).not.toThrow();

    const end = m.aiInferenceDuration.startTimer({ provider: "p", model: "m", agent: "a" });
    expect(typeof end).toBe("function");
    expect(() => end()).not.toThrow();
  });

  it("exposes an empty registry rather than throwing", async () => {
    const m = await import("./metrics");
    await expect(m.metricsRegistry.metrics()).resolves.toBe("");
    expect(typeof m.metricsRegistry.contentType).toBe("string");
    expect(() => m.metricsRegistry.resetMetrics()).not.toThrow();
  });
});
