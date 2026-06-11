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
