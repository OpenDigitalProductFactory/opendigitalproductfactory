import { describe, it, expect, vi, beforeEach } from "vitest";

// Keep the real payload builders (buildEscalationPayload + redaction) and mock
// only the network-touching escalateToUpstreamIssue.
vi.mock("./issue-bridge", async () => {
  const actual = await vi.importActual<typeof import("./issue-bridge")>("./issue-bridge");
  return {
    ...actual,
    escalateToUpstreamIssue: vi.fn(),
  };
});

import { escalateToUpstreamIssue, type NormalizedSource } from "./issue-bridge";
import {
  buildRedactedFeedbackPayload,
  selectTransport,
  type RelayHttpClient,
  type RedactedIssuePayload,
} from "./feedback-transport";

const PSEUDONYM = "dpf-agent-a1b2c3d4";

function source(overrides: Partial<NormalizedSource> = {}): NormalizedSource {
  return {
    title: "Crash on DESKTOP-ABC123 dashboard",
    body: "stack trace from WIN-FOO99 host",
    severity: "high",
    routeContext: "/build",
    errorStack: null,
    userAgent: null,
    humanId: "PIR-AB12C",
    upstreamIssueNumber: null,
    ...overrides,
  };
}

function payload(overrides: Partial<RedactedIssuePayload> = {}): RedactedIssuePayload {
  return buildRedactedFeedbackPayload({ source: source(), pseudonym: PSEUDONYM, ...overrides });
}

describe("buildRedactedFeedbackPayload", () => {
  it("redacts hostnames in title and body and prefixes the pseudonym", () => {
    const p = buildRedactedFeedbackPayload({ source: source(), pseudonym: PSEUDONYM });
    expect(p.title).toBe(`[${PSEUDONYM}] Crash on [redacted] dashboard`);
    expect(p.body).toContain("[redacted]");
    expect(p.body).not.toContain("DESKTOP-ABC123");
    expect(p.body).not.toContain("WIN-FOO99");
  });

  it("carries the local reference and pseudonym for correlation", () => {
    const p = buildRedactedFeedbackPayload({ source: source(), pseudonym: PSEUDONYM });
    expect(p.localRef).toBe("PIR-AB12C");
    expect(p.pseudonym).toBe(PSEUDONYM);
  });

  it("labels the issue as a platform-issue-report with severity", () => {
    const p = buildRedactedFeedbackPayload({ source: source({ severity: "high" }), pseudonym: PSEUDONYM });
    expect(p.labels).toContain("hive:submitted");
    expect(p.labels).toContain("hive:platform-issue-report");
    expect(p.labels).toContain("severity:high");
  });
});

describe("selectTransport", () => {
  it("prefers the relay when a relay URL is configured", () => {
    const t = selectTransport({ upstreamRelayUrl: "https://relay.dpf/intake", hasToken: true });
    expect(t.kind).toBe("relay");
  });

  it("uses the direct bridge when only a token is available", () => {
    const t = selectTransport({ upstreamRelayUrl: null, hasToken: true });
    expect(t.kind).toBe("direct");
  });

  it("is a no-op when neither relay nor token is available", async () => {
    const t = selectTransport({ upstreamRelayUrl: null, hasToken: false });
    expect(t.kind).toBe("noop");
    const result = await t.file(payload(), { reportRowId: "cuid1" });
    expect(result.status).toBe("skipped");
  });
});

describe("RelayTransport", () => {
  it("POSTs the redacted payload with the install-id header and returns filed", async () => {
    const client = vi.fn<RelayHttpClient>(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ issueNumber: 42, url: "https://github.com/o/r/issues/42" }),
    }));
    const t = selectTransport(
      { upstreamRelayUrl: "https://relay.dpf/intake", hasToken: false },
      { relayClient: client },
    );

    const result = await t.file(payload(), { reportRowId: "cuid1" });

    expect(result).toEqual({
      status: "filed",
      issueNumber: 42,
      url: "https://github.com/o/r/issues/42",
    });
    expect(client).toHaveBeenCalledOnce();
    const [url, init] = client.mock.calls[0]!;
    expect(url).toBe("https://relay.dpf/intake");
    expect(init.headers["X-DPF-Install-Id"]).toBe(PSEUDONYM);
    const sent = JSON.parse(init.body) as { body: string; title: string };
    expect(sent.body).not.toContain("DESKTOP-ABC123");
    expect(sent.title).toContain(PSEUDONYM);
  });

  it("returns filed with null issueNumber when the relay omits it", async () => {
    const client = vi.fn<RelayHttpClient>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://github.com/o/r/issues/9" }),
    }));
    const t = selectTransport(
      { upstreamRelayUrl: "https://relay.dpf/intake", hasToken: false },
      { relayClient: client },
    );
    const result = await t.file(payload(), { reportRowId: "cuid1" });
    expect(result).toEqual({ status: "filed", issueNumber: null, url: "https://github.com/o/r/issues/9" });
  });

  it("fails when the relay response omits a url", async () => {
    const client = vi.fn<RelayHttpClient>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ issueNumber: 1 }),
    }));
    const t = selectTransport(
      { upstreamRelayUrl: "https://relay.dpf/intake", hasToken: false },
      { relayClient: client },
    );
    const result = await t.file(payload(), { reportRowId: "cuid1" });
    expect(result.status).toBe("failed");
  });

  it("surfaces a non-ok relay status as failed", async () => {
    const client = vi.fn<RelayHttpClient>(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: "rate limited" }),
    }));
    const t = selectTransport(
      { upstreamRelayUrl: "https://relay.dpf/intake", hasToken: false },
      { relayClient: client },
    );
    const result = await t.file(payload(), { reportRowId: "cuid1" });
    expect(result).toEqual({ status: "failed", error: "Relay error: rate limited" });
  });

  it("surfaces a network error as failed", async () => {
    const client = vi.fn<RelayHttpClient>(async () => {
      throw new Error("ECONNREFUSED");
    });
    const t = selectTransport(
      { upstreamRelayUrl: "https://relay.dpf/intake", hasToken: false },
      { relayClient: client },
    );
    const result = await t.file(payload(), { reportRowId: "cuid1" });
    expect(result).toEqual({ status: "failed", error: "Relay network error: ECONNREFUSED" });
  });
});

describe("DirectBridgeTransport", () => {
  const mockEscalate = vi.mocked(escalateToUpstreamIssue);

  beforeEach(() => {
    mockEscalate.mockReset();
  });

  it("maps a created bridge result to filed", async () => {
    mockEscalate.mockResolvedValue({ status: "created", issueNumber: 7, url: "https://github.com/o/r/issues/7" });
    const t = selectTransport({ upstreamRelayUrl: null, hasToken: true });
    const result = await t.file(payload(), { reportRowId: "cuid-7" });
    expect(result).toEqual({ status: "filed", issueNumber: 7, url: "https://github.com/o/r/issues/7" });
    expect(mockEscalate).toHaveBeenCalledWith({ kind: "issue-report", id: "cuid-7" });
  });

  it("maps a skipped bridge result to skipped", async () => {
    mockEscalate.mockResolvedValue({ status: "skipped", reason: "contribution mode is fork_only — no upstream escalation" });
    const t = selectTransport({ upstreamRelayUrl: null, hasToken: true });
    const result = await t.file(payload(), { reportRowId: "cuid-7" });
    expect(result).toEqual({ status: "skipped", reason: "contribution mode is fork_only — no upstream escalation" });
  });

  it("maps a failed bridge result to failed", async () => {
    mockEscalate.mockResolvedValue({ status: "failed", error: "GitHub API error: bad credentials" });
    const t = selectTransport({ upstreamRelayUrl: null, hasToken: true });
    const result = await t.file(payload(), { reportRowId: "cuid-7" });
    expect(result).toEqual({ status: "failed", error: "GitHub API error: bad credentials" });
  });
});
