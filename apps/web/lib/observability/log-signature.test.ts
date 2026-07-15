import { describe, it, expect } from "vitest";
import {
  isErrorLine,
  toTemplate,
  signatureId,
  dedupeKeyFor,
  severityForCount,
  clusterBySignature,
  type RawLogLine,
} from "./log-signature";

describe("isErrorLine", () => {
  it("matches genuine error lines", () => {
    expect(isErrorLine("[discovery-scheduler] Failed: Error [PrismaClientKnownRequestError]")).toBe(true);
    expect(isErrorLine("panic: runtime error: nil pointer")).toBe(true);
    expect(isErrorLine("Traceback (most recent call last):")).toBe(true);
  });

  it("rejects the ErrorCode substring false-positive caught live", () => {
    // grafana info line — 'error' only appears inside the field name ErrorCode.
    expect(
      isErrorLine(
        'logger=plugins t=2026-06-09T22:59:44Z level=info msg="flag evaluation succeeded" flag="{ErrorCode: ErrorMessage:}"',
      ),
    ).toBe(false);
  });

  it("rejects structured info/debug logs even if they contain the word error", () => {
    expect(isErrorLine('level=info msg="no error occurred"')).toBe(false);
    expect(isErrorLine('{"level":"debug","msg":"error budget ok"}')).toBe(false);
  });

  it("rejects Loki/Alloy self-noise", () => {
    expect(isErrorLine("entry has timestamp too old: 2026-05-26")).toBe(false);
    expect(isErrorLine("final error sending batch, no retries left")).toBe(false);
  });

  it("rejects empty/clean lines", () => {
    expect(isErrorLine("")).toBe(false);
    expect(isErrorLine("request completed in 12ms")).toBe(false);
  });

  it("rejects the responses-adapter self-referential outbound-request noise", () => {
    // The adapter logs its own outbound AI request; when the portal files a PIR
    // through the AI the body echoes a prior report, so "Error" trips ERROR_TOKEN
    // and the scanner would file a fresh PIR for its own request (self-loop).
    expect(
      isErrorLine(
        '[responses-adapter] REQUEST to https://chatgpt.com/backend-api/codex/responses | model=gpt-5.4 | tools=0 [none] | stream=true | input=[{"role":"user","content":"Error Report PIR-Y8EA8: New error signature..."}]',
      ),
    ).toBe(false);
    // Plain outbound request line (no echoed report) is likewise not an error.
    expect(
      isErrorLine("[responses-adapter] REQUEST to https://chatgpt.com/backend-api/codex/responses | model=gpt-5.4 | stream=true"),
    ).toBe(false);
    // Benign OpenAI Responses API SSE start event.
    expect(isErrorLine('data: {"type":"response.created","response":{"id":"resp_123"}}')).toBe(false);
    // A genuine error that merely mentions the adapter must still cluster.
    expect(isErrorLine("[responses-adapter] Error: upstream returned 500 for codex/responses")).toBe(true);
  });

  it("rejects benign Postgres controlled-restart lifecycle noise (BI-PIR self-upgrade churn)", () => {
    // These are normal restart choreography during a self-upgrade recycle, not
    // application defects — they minted ~6 duplicate BI-PIR-* on 2026-07-15.
    expect(
      isErrorLine("2026-07-15 05:24:11.000 UTC [1] FATAL: terminating connection due to administrator command"),
    ).toBe(false);
    expect(isErrorLine("FATAL: the database system is starting up")).toBe(false);
    expect(isErrorLine("FATAL: the database system is shutting down")).toBe(false);
    // postgres-exporter sidecar losing its scrape while the DB bounces.
    expect(
      isErrorLine('level=error msg="Error scraping target" err="dial tcp: connect: connection refused"'),
    ).toBe(false);
  });

  it("STILL clusters a genuine app-side DB outage (lifecycle filter must not hide real failures)", () => {
    // The safety invariant: a real outage surfaces app-side via Prisma, and that
    // path is NOT filtered — so filtering the Postgres-side lifecycle FATALs
    // above never suppresses the actionable signal.
    expect(
      isErrorLine("[db] Error: PrismaClientInitializationError: Can't reach database server at postgres:5432"),
    ).toBe(true);
    expect(isErrorLine("Error: connect ECONNREFUSED 127.0.0.1:5432 (database unreachable)")).toBe(true);
    // A genuine catalog-scout scraping error must NOT be swallowed — the DB
    // filter is scoped to metrics-exporter phrasing ("scraping target/dsn"),
    // not the word "scraping" alone.
    expect(isErrorLine("[external-catalog-scout] Error scraping catalog vendor-x: timeout")).toBe(true);
  });
});

describe("toTemplate", () => {
  it("masks timestamps, numbers, hex and paths so variants collapse", () => {
    const a = toTemplate("2026-06-09T23:28:04.039Z worker 4821 failed at /app/src/x.js:61:8024");
    const b = toTemplate("2026-06-09T11:02:55.001Z worker 9 failed at /app/src/x.js:12:3");
    expect(a).toBe(b);
    expect(a).toContain("<ts>");
    expect(a).toContain("<n>");
    expect(a).toContain("<path>");
  });

  it("masks uuids", () => {
    expect(toTemplate("session 4f9c1a2b-1111-2222-3333-444455556666 dropped")).toContain("<uuid>");
  });

  it("masks URLs so requests to different endpoints collapse (BI-51F6A428)", () => {
    const a = toTemplate("Error: POST https://api.openai.com/v1/responses failed");
    const b = toTemplate("Error: POST https://api.anthropic.com/v1/messages failed");
    expect(a).toBe(b);
    expect(a).toContain("<url>");
    expect(a).not.toContain("openai.com");
  });

  it("masks AI model names so per-model variants collapse (BI-51F6A428)", () => {
    const a = toTemplate("inference failed for model gpt-5.4 rate limited");
    const b = toTemplate("inference failed for model claude-opus-4-8 rate limited");
    const c = toTemplate("inference failed for model qwen3-coder rate limited");
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toContain("<model>");
    // version suffixes must not survive as their own <n> fragments
    expect(a).not.toMatch(/gpt|<n>/);
  });

  it("does NOT mask a bare English word that merely starts like a hyphenated model family", () => {
    // 'claude'/'grok'/'gpt' only fold when followed by a version, so prose stays intact.
    expect(toTemplate("the claude assistant returned an error")).toContain("claude");
    expect(toTemplate("the claude assistant returned an error")).not.toContain("<model>");
  });

  it("masks embedded platform entity ids so per-id variants collapse (BI-51F6A428)", () => {
    const a = toTemplate("failed to project PIR-Y8EA8 into the backlog");
    const b = toTemplate("failed to project PIR-A1B2C into the backlog");
    expect(a).toBe(b);
    expect(a).toContain("<id>");
    // BI-PIR-* compound ids fold to a single <id>, not <id>-<id>.
    expect(toTemplate("BI-PIR-3c6ed25d unique violation")).toBe("<id> unique violation");
  });
});

describe("signatureId / dedupeKeyFor", () => {
  it("is stable for the same (service, template) and differs across services", () => {
    const t = toTemplate("Error connecting to db at 12:00");
    expect(signatureId("portal", t)).toBe(signatureId("portal", t));
    expect(signatureId("portal", t)).not.toBe(signatureId("inngest", t));
    expect(signatureId("portal", t)).toMatch(/^[0-9a-f]{10}$/);
  });

  it("formats a namespaced dedupe key", () => {
    expect(dedupeKeyFor("portal", "abc1234567")).toBe("log-sig:portal:abc1234567");
  });
});

describe("severityForCount", () => {
  it("scales severity with occurrence count (loud == higher)", () => {
    expect(severityForCount(1)).toBe("low");
    expect(severityForCount(10)).toBe("medium");
    expect(severityForCount(60)).toBe("high");
    expect(severityForCount(500)).toBe("critical");
  });
});

describe("clusterBySignature", () => {
  it("collapses hundreds of near-identical error lines into one signature", () => {
    const lines: RawLogLine[] = [];
    for (let i = 0; i < 250; i++) {
      lines.push({
        service: "portal",
        line: `2026-06-09T23:0${i % 9}:00Z [scheduler] Failed to update job drain ${i}: Error [PrismaClientKnownRequestError]`,
        tsMs: 1_000 + i,
      });
    }
    const buckets = clusterBySignature(lines);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].count).toBe(250);
    expect(buckets[0].service).toBe("portal");
    expect(buckets[0].firstTs).toBe(1_000);
    expect(buckets[0].lastTs).toBe(1_249);
  });

  it("separates distinct problems and distinct services, sorts by count desc", () => {
    const lines: RawLogLine[] = [
      { service: "portal", line: "Error: db timeout 5ms", tsMs: 1 },
      { service: "portal", line: "Error: db timeout 9ms", tsMs: 2 },
      { service: "portal", line: "Error: db timeout 3ms", tsMs: 3 },
      { service: "inngest", line: "panic: worker crashed code 7", tsMs: 4 },
      { service: "grafana", line: 'level=info msg="started ok"', tsMs: 5 }, // filtered out
    ];
    const buckets = clusterBySignature(lines);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].count).toBe(3); // portal db timeout, sorted first
    expect(buckets[0].service).toBe("portal");
    expect(buckets[1].service).toBe("inngest");
    expect(buckets.some((b) => b.service === "grafana")).toBe(false);
  });
});
