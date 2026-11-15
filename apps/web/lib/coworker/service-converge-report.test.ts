import { describe, expect, it } from "vitest";
import { parseServiceConvergeReport } from "./service-converge-report";

const executedAt = new Date("2026-11-15T01:00:00Z");
const report = () => ({ mode: "shadow", targetSha: "a".repeat(40), at: "2026-11-15T00:00:00.000Z", outcome: "current",
  wouldRecreate: [], unchanged: ["postgres"], skippedStopped: ["dev-postgres"], dataOwnerChanged: [],
  unclassified: ["helper"], failed: [], bindDrift: [{ service: "portal-tls", port: "443", running: "127.0.0.1", rendered: "0.0.0.0" }] });

describe("saved shadow report projection", () => {
  it("preserves shadow classifications separately even when producer outcome says current", () => {
    const result = parseServiceConvergeReport(JSON.stringify(report()), executedAt);
    expect(result).toEqual({ mode: "shadow", targetSha: "a".repeat(40), observedAtIso: "2026-11-15T00:00:00.000Z", outcome: "current",
      classifications: { wouldRecreate: [], unchanged: ["postgres"], skippedStopped: ["dev-postgres"], dataOwnerChanged: [],
        unclassified: ["helper"], failed: [], bindDrift: ["portal-tls"] } });
    expect(JSON.stringify(result)).not.toMatch(/127\.0\.0\.1|0\.0\.0\.0|running|rendered|healthy|restored/);
  });
  it("validates but suppresses original change hashes and deduplicates valid bind ports", () => {
    const value = { ...report(), wouldRecreate: [{ service: "portal", from: "b".repeat(64), to: "c".repeat(64) }] };
    value.bindDrift.push({ ...value.bindDrift[0], port: "80" });
    const result = parseServiceConvergeReport(JSON.stringify(value), executedAt);
    expect(result?.classifications.wouldRecreate).toEqual(["portal"]);
    expect(result?.classifications.bindDrift).toEqual(["portal-tls"]);
    expect(JSON.stringify(result)).not.toContain("b".repeat(64));
  });
  it.each(["unknown-key", "mode", "target", "future", "time", "outcome", "missing-group", "invalid-service", "conflicting", "hash", "port", "address", "overflow"])("refuses %s instead of exposing raw output", change => {
    const value: any = report();
    if (change === "unknown-key") value.secret = "SECRET";
    if (change === "mode") value.mode = "active";
    if (change === "target") value.targetSha = "not-a-target";
    if (change === "future") value.at = "2099-01-01T00:00:00Z";
    if (change === "time") value.at = "yesterday";
    if (change === "outcome") value.outcome = "restored";
    if (change === "missing-group") delete value.failed;
    if (change === "invalid-service") value.failed = ["SECRET\nAuthorization: bearer"];
    if (change === "conflicting") value.failed = ["postgres"];
    if (change === "hash") value.dataOwnerChanged = [{ service: "redis", from: "bad", to: "c".repeat(64) }];
    if (change === "port") value.bindDrift[0].port = "99999";
    if (change === "address") value.bindDrift[0].running = "PRIVATE-SECRET";
    if (change === "overflow") value.failed = Array.from({ length: 129 }, (_, i) => `service-${i}`);
    expect(parseServiceConvergeReport(JSON.stringify(value), executedAt)).toBeNull();
  });
  it.each(["SECRET", "{", " ".repeat(15000), "{\"mode\":\"shadow\"}"])("refuses malformed, unproven or capped output", output => {
    expect(parseServiceConvergeReport(output, executedAt)).toBeNull();
  });
});
