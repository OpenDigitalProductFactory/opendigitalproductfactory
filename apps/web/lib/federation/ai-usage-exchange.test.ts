import { describe, expect, it } from "vitest";

import {
  AI_USAGE_SPEC_VERSION,
  buildFederatedAiUsage,
  classifyAiUsageFetchFailure,
  mergePeerAiUsageRecord,
  peerUsageFromRecord,
  validateFederatedAiUsageV1,
  type FederatedAiUsageV1,
} from "./ai-usage-exchange";

const now = new Date("2026-11-13T12:00:00Z");
const usage = (rows: FederatedAiUsageV1["rows"], origin = "inst_dev"): FederatedAiUsageV1 =>
  ({ specVersion: AI_USAGE_SPEC_VERSION, originInstallationId: origin, generatedAt: now.toISOString(), lookbackDays: 30, rows });

describe("serving this install's AI usage to a same-organization peer", () => {
  it("joins hourly usage and limit hits per provider into rows", () => {
    const body = buildFederatedAiUsage({
      originInstallationId: "inst_prod",
      now,
      usage: [
        { providerId: "chatgpt", hour: 10, inputTokens: 100, outputTokens: 20 },
        { providerId: "anthropic-sub", hour: 10, inputTokens: 1, outputTokens: 900 },
      ],
      hits: [{ providerId: "chatgpt", hour: 10, hits: 2 }, { providerId: "chatgpt", hour: 11, hits: 1 }],
    });
    expect(body).toMatchObject({ specVersion: AI_USAGE_SPEC_VERSION, originInstallationId: "inst_prod", lookbackDays: 30 });
    expect(body.rows).toEqual([["anthropic-sub", 10, 1, 900, 0], ["chatgpt", 10, 100, 20, 2], ["chatgpt", 11, 0, 0, 1]]);
    expect(validateFederatedAiUsageV1(body)).toEqual([]);
  });

  it("refuses a body that is not the v1 contract", () => {
    expect(validateFederatedAiUsageV1(null)).toEqual(["body is not an object"]);
    expect(validateFederatedAiUsageV1({ ...usage([]), specVersion: "x" })).toContain(`specVersion is not ${AI_USAGE_SPEC_VERSION}`);
    expect(validateFederatedAiUsageV1(usage([["chatgpt", 1, -5, 0, 0]]))).toEqual(["row 0 is malformed"]);
  });

  it("reads a missing route as a peer not yet updated, and 401/403 as refused", () => {
    expect(classifyAiUsageFetchFailure(404)).toBe("peer-outdated");
    expect(classifyAiUsageFetchFailure(403)).toBe("refused");
    expect(classifyAiUsageFetchFailure(0)).toBe("unreachable");
  });
});

describe("what the Finance page knows about the paired install", () => {
  it("reports a link never pulled as missing, never as zero usage", () => {
    expect(peerUsageFromRecord(null, ["link_1"], now)).toEqual({
      peers: [{ linkId: "link_1", install: "link_1", state: "missing", reason: "never-pulled", lastSuccessAt: null }],
      buckets: [],
    });
  });

  it("attributes pulled usage to the install it ran on", () => {
    const record = mergePeerAiUsageRecord(null, [{ linkId: "link_1", outcome: "pulled", usage: usage([["gemini", 5, 10, 20, 1]]) }], now);
    expect(peerUsageFromRecord(record, ["link_1"], now)).toEqual({
      peers: [{ linkId: "link_1", install: "inst_dev", state: "current", reason: null, lastSuccessAt: now.toISOString() }],
      buckets: [{ install: "inst_dev", providerId: "gemini", hour: 5, inputTokens: 10, outputTokens: 20, limitHits: 1 }],
    });
  });

  it("keeps the last usage after a failed pull and calls it stale", () => {
    const first = mergePeerAiUsageRecord(null, [{ linkId: "link_1", outcome: "pulled", usage: usage([["gemini", 5, 10, 20, 0]]) }], now);
    const later = new Date(now.getTime() + 10 * 60_000);
    const second = mergePeerAiUsageRecord(first, [{ linkId: "link_1", outcome: "unreachable", detail: "fetch failed" }], later);
    const view = peerUsageFromRecord(second, ["link_1"], later);
    expect(view.peers[0]).toEqual({ linkId: "link_1", install: "inst_dev", state: "stale", reason: "unreachable", lastSuccessAt: now.toISOString() });
    expect(view.buckets).toHaveLength(1);
  });

  it("calls usage stale after an hour without a new pull", () => {
    const record = mergePeerAiUsageRecord(null, [{ linkId: "link_1", outcome: "pulled", usage: usage([]) }], now);
    expect(peerUsageFromRecord(record, ["link_1"], new Date(now.getTime() + 2 * 3_600_000)).peers[0]?.state).toBe("stale");
  });

  it("reports a peer that has not been updated to share usage as missing", () => {
    const record = mergePeerAiUsageRecord(null, [{ linkId: "link_1", outcome: "peer-outdated", detail: "Peer responded 404" }], now);
    expect(peerUsageFromRecord(record, ["link_1"], now).peers[0]).toMatchObject({ state: "missing", reason: "peer-outdated" });
  });

  it("drops a link that is no longer trusted", () => {
    const record = mergePeerAiUsageRecord(null, [{ linkId: "link_old", outcome: "pulled", usage: usage([["gemini", 5, 10, 20, 0]]) }], now);
    expect(peerUsageFromRecord(record, [], now)).toEqual({ peers: [], buckets: [] });
  });
});
