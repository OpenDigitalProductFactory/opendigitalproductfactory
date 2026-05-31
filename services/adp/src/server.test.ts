import { describe, expect, it } from "vitest";

import {
  adpMcpRequests,
  adpToolCallDuration,
  adpToolCallErrors,
  handleRequest,
  metricsRegistry,
} from "./server.js";

// Minimal IncomingMessage / ServerResponse stand-ins. The ADP server uses
// just a handful of node:http API surface (method, url, headers, writeHead,
// end, JSON-body events), so it's simpler to fake them than to spin a real
// socket.
type WrittenResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

function makeRequest(method: string, url: string): import("node:http").IncomingMessage {
  // We're casting through unknown because we only exercise the fields the
  // handler reads. The dispatch is purely on (method, url) for /health and
  // /metrics, so no body / event-emitter behavior is needed for those paths.
  return { method, url, headers: {} } as unknown as import("node:http").IncomingMessage;
}

function makeResponse(): {
  res: import("node:http").ServerResponse;
  written: WrittenResponse;
} {
  const written: WrittenResponse = { status: 0, headers: {}, body: "" };
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      written.status = status;
      written.headers = headers;
    },
    end(payload: string | Buffer) {
      written.body = typeof payload === "string" ? payload : payload.toString("utf8");
    },
  } as unknown as import("node:http").ServerResponse;
  return { res, written };
}

describe("ADP server /metrics endpoint", () => {
  it("returns Prometheus text exposition with the service label", async () => {
    const { res, written } = makeResponse();
    await handleRequest(makeRequest("GET", "/metrics"), res);

    expect(written.status).toBe(200);
    expect(written.headers["Content-Type"]).toContain("text/plain");
    // Default labels apply to every metric so a scrape can attribute the
    // sample to the ADP service (not just to the `job` Prometheus assigns).
    expect(written.body).toContain('service="adp"');
    // Default-process metrics from prom-client confirm the registry is wired.
    expect(written.body).toContain("process_cpu_seconds_total");
    // The custom counters appear in the exposition only after they've been
    // observed. The names must be present in HELP lines regardless.
    expect(written.body).toContain("dpf_adp_tool_call_duration_seconds");
    expect(written.body).toContain("dpf_adp_tool_call_errors_total");
    expect(written.body).toContain("dpf_adp_mcp_requests_total");
  });

  it("/health still works alongside /metrics", async () => {
    const { res, written } = makeResponse();
    await handleRequest(makeRequest("GET", "/health"), res);

    expect(written.status).toBe(200);
    const parsed = JSON.parse(written.body);
    expect(parsed).toMatchObject({ ok: true, service: "adp" });
  });

  it("unknown routes still 404", async () => {
    const { res, written } = makeResponse();
    await handleRequest(makeRequest("GET", "/who-knows"), res);

    expect(written.status).toBe(404);
  });
});

describe("ADP server metric registry shape", () => {
  it("exports the registry and the named metrics", async () => {
    // Quick smoke that the exports the rest of the app expects are stable.
    expect(metricsRegistry).toBeDefined();
    expect(adpMcpRequests).toBeDefined();
    expect(adpToolCallDuration).toBeDefined();
    expect(adpToolCallErrors).toBeDefined();

    // Counter increments are observable in the exposition text.
    adpMcpRequests.inc({ method: "tools/call" });
    const text = await metricsRegistry.metrics();
    expect(text).toMatch(/dpf_adp_mcp_requests_total\{[^}]*method="tools\/call"[^}]*\} \d+/);
  });
});
