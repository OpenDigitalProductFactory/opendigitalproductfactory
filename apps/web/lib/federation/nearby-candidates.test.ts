import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetNearbyFederationCandidates,
  isLinkLocalFederationEndpoint,
  listNearbyFederationCandidates,
  recordNearbyFederationCandidates,
  type NearbyFederationCandidateInput,
} from "./nearby-candidates";

const NOW = new Date("2026-07-20T03:00:00.000Z");

function candidate(
  overrides: Partial<NearbyFederationCandidateInput> = {},
): NearbyFederationCandidateInput {
  return {
    discoveryId: "yM4sS9VcH0rW2nQ8",
    endpoint: "https://192.168.1.42",
    protocol: "1",
    capabilityDigest: "8f31c9a2",
    pairPath: "/connect/pair",
    ...overrides,
  };
}

beforeEach(() => _resetNearbyFederationCandidates());

describe("nearby federation candidate cache", () => {
  it("accepts only private origin URLs and rejects hostname-prefix lookalikes", () => {
    expect(isLinkLocalFederationEndpoint("http://dpf-node.local:3000")).toBe(true);
    expect(isLinkLocalFederationEndpoint("https://[fe90::2]:3443")).toBe(true);
    expect(isLinkLocalFederationEndpoint("https://[fd12::2]:3443")).toBe(true);
    expect(isLinkLocalFederationEndpoint("https://fcloud.example")).toBe(false);
    expect(isLinkLocalFederationEndpoint("https://user:pass@10.0.0.2")).toBe(false);
    expect(isLinkLocalFederationEndpoint("https://10.0.0.2/path?q=1")).toBe(false);
  });

  it("deduplicates refreshed observations and bounds their lifetime", () => {
    recordNearbyFederationCandidates({
      edgeNodeId: "edge-1",
      observedAt: NOW,
      candidates: [candidate()],
      now: NOW,
    });
    recordNearbyFederationCandidates({
      edgeNodeId: "edge-1",
      observedAt: new Date(NOW.getTime() + 10_000),
      candidates: [candidate()],
      now: new Date(NOW.getTime() + 10_000),
    });

    expect(listNearbyFederationCandidates(new Date(NOW.getTime() + 20_000))).toHaveLength(1);
    expect(listNearbyFederationCandidates(new Date(NOW.getTime() + 131_000))).toEqual([]);
  });

  it("marks only HTTPS endpoints eligible for automatic pairing", () => {
    recordNearbyFederationCandidates({
      edgeNodeId: "edge-1",
      observedAt: NOW,
      candidates: [
        candidate(),
        candidate({ discoveryId: "p7aQ2vM8zT4nK6cR", endpoint: "http://192.168.1.43:3000" }),
      ],
      now: NOW,
    });

    expect(listNearbyFederationCandidates(NOW).map((row) => row.automaticPairing)).toEqual([
      "tls-validation-required",
      "blocked-insecure-transport",
    ]);
  });

  it("drops the local installation and never exposes the reporting edge identity", () => {
    recordNearbyFederationCandidates({
      edgeNodeId: "edge-secret-row-id",
      observedAt: NOW,
      localAuthorityUrl: "https://192.168.1.42/",
      candidates: [candidate()],
      now: NOW,
    });

    expect(listNearbyFederationCandidates(NOW)).toEqual([]);
  });
});
