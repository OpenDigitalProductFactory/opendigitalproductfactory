import { describe, expect, it, vi } from "vitest";

import {
  buildDiscoveryEvidencePacket,
  DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS,
  recordDiscoveryTriageDecision,
  resolveDiscoveryTriageOutcome,
  scoreDiscoveryTriageCandidate,
  shouldAutoApplyTriageDecision,
  synthesizeDiscoveryFingerprintRule,
} from "./discovery-triage";

describe("buildDiscoveryEvidencePacket", () => {
  it("builds a replayable evidence packet from an inventory entity", () => {
    const packet = buildDiscoveryEvidencePacket({
      id: "entity-1",
      entityKey: "service:prom:windows-host:windows-host",
      entityType: "service",
      name: "windows-host",
      firstSeenAt: new Date("2026-04-25T00:00:00Z"),
      lastSeenAt: new Date("2026-04-25T01:00:00Z"),
      attributionConfidence: 0.283,
      candidateTaxonomy: [
        { nodeId: "foundational/compute/servers", name: "Servers", score: 0.283 },
      ],
      properties: { job: "windows-host", instance: "windows-host", health: "up" },
    });

    expect(packet.redactionStatus).toBe("unverified");
    expect(packet.candidateTaxonomy[0]?.nodeId).toBe("foundational/compute/servers");
    expect(packet.protocolEvidence.prometheusLabels).toMatchObject({ job: "windows-host" });
  });
});

describe("discovery triage scoring and routing", () => {
  it("routes deterministic high-confidence matches to auto-attributed", () => {
    const packet = buildDiscoveryEvidencePacket({
      id: "entity-2",
      entityKey: "service:docker:runtime",
      entityType: "service",
      name: "docker",
      firstSeenAt: new Date("2026-04-22T00:00:00Z"),
      lastSeenAt: new Date("2026-04-25T00:00:00Z"),
      candidateTaxonomy: [
        { nodeId: "foundational/platform_services/container_platform", name: "Container Platform", score: 0.97 },
      ],
      identityCandidates: [
        { identity: "Docker Engine", score: 0.97, manufacturer: "Docker", model: "Engine" },
      ],
      discoveryRunIds: ["run-1", "run-2", "run-3"],
      properties: {
        processName: "dockerd",
        ports: [2375],
        softwareEvidence: ["docker-engine"],
      },
    });

    const score = scoreDiscoveryTriageCandidate(packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS);

    expect(resolveDiscoveryTriageOutcome(score, packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS)).toBe("auto-attributed");
    expect(shouldAutoApplyTriageDecision(score, packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS)).toBe(true);
  });

  it("routes coworker-level high-confidence matches to auto-attributed and synthesizes a rule", () => {
    const packet = buildDiscoveryEvidencePacket({
      id: "entity-3",
      entityKey: "service:prometheus:node-exporter",
      entityType: "service",
      name: "node-exporter",
      firstSeenAt: new Date("2026-04-24T00:00:00Z"),
      lastSeenAt: new Date("2026-04-25T00:00:00Z"),
      candidateTaxonomy: [
        { nodeId: "foundational/platform_services/observability_platform", name: "Observability Platform", score: 0.91 },
      ],
      identityCandidates: [
        { identity: "Prometheus Node Exporter", score: 0.93, manufacturer: "Prometheus" },
      ],
      discoveryRunIds: ["run-1", "run-2", "run-3"],
      properties: {
        job: "node-exporter",
        instance: "server-1",
        softwareEvidence: ["prometheus-node-exporter"],
      },
    });

    const score = scoreDiscoveryTriageCandidate(packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS);
    const proposedRule = synthesizeDiscoveryFingerprintRule(packet, score, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS);

    expect(resolveDiscoveryTriageOutcome(score, packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS)).toBe("auto-attributed");
    expect(proposedRule).toMatchObject({
      ruleType: "discovery-fingerprint",
      taxonomyNodeId: "foundational/platform_services/observability_platform",
      redactionStatus: "unverified",
    });
  });

  it("routes clear identity without a taxonomy node to taxonomy-gap", () => {
    const packet = buildDiscoveryEvidencePacket({
      id: "entity-4",
      entityKey: "device:custom:edge-probe",
      entityType: "device",
      name: "edge-probe",
      firstSeenAt: new Date("2026-04-23T00:00:00Z"),
      lastSeenAt: new Date("2026-04-25T00:00:00Z"),
      hasSuitableTaxonomy: false,
      identityCandidates: [
        { identity: "Acme Edge Probe", score: 0.88, manufacturer: "Acme", model: "Probe" },
      ],
      discoveryRunIds: ["run-1", "run-2"],
      properties: {
        processName: "edge-probe",
        softwareEvidence: ["acme-edge-probe"],
      },
    });

    const score = scoreDiscoveryTriageCandidate(packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS);

    expect(resolveDiscoveryTriageOutcome(score, packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS)).toBe("taxonomy-gap");
  });

  it("routes close competing candidates to human-review", () => {
    const packet = buildDiscoveryEvidencePacket({
      id: "entity-5",
      entityKey: "service:ambiguous:edge",
      entityType: "service",
      name: "ambiguous-edge",
      firstSeenAt: new Date("2026-04-22T00:00:00Z"),
      lastSeenAt: new Date("2026-04-25T00:00:00Z"),
      candidateTaxonomy: [
        { nodeId: "foundational/network_management/network_connectivity", name: "Network Connectivity", score: 0.91 },
        { nodeId: "foundational/network_management/network_security", name: "Network Security", score: 0.88 },
      ],
      identityCandidates: [
        { identity: "Edge Service", score: 0.82 },
        { identity: "Edge Gateway", score: 0.8 },
      ],
      discoveryRunIds: ["run-1", "run-2", "run-3"],
      properties: {
        processName: "edge-service",
        ports: [443],
        softwareEvidence: ["edge"],
      },
    });

    const score = scoreDiscoveryTriageCandidate(packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS);

    expect(score.taxonomyAmbiguityMargin).toBeLessThan(DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS.ambiguityMargin);
    expect(resolveDiscoveryTriageOutcome(score, packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS)).toBe("human-review");
    expect(shouldAutoApplyTriageDecision(score, packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS)).toBe(false);
  });

  it("routes sparse evidence to needs-more-evidence", () => {
    const packet = buildDiscoveryEvidencePacket({
      id: "entity-6",
      entityKey: "service:unknown",
      entityType: "service",
      name: "unknown",
      firstSeenAt: new Date("2026-04-25T00:00:00Z"),
      lastSeenAt: new Date("2026-04-25T00:15:00Z"),
      properties: {},
      discoveryRunIds: [],
    });

    const score = scoreDiscoveryTriageCandidate(packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS);

    expect(score.identityConfidence).toBeLessThan(DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS.humanReviewFloor);
    expect(resolveDiscoveryTriageOutcome(score, packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS)).toBe("needs-more-evidence");
  });
});

describe("recordDiscoveryTriageDecision", () => {
  it("persists the decision payload with scores, evidence, and rule candidate", async () => {
    const create = vi.fn().mockResolvedValue({ id: "decision-row" });
    const packet = buildDiscoveryEvidencePacket({
      id: "entity-7",
      entityKey: "service:test:decision",
      entityType: "service",
      name: "decision-test",
      firstSeenAt: new Date("2026-04-22T00:00:00Z"),
      lastSeenAt: new Date("2026-04-25T00:00:00Z"),
      candidateTaxonomy: [
        { nodeId: "foundational/compute/servers", name: "Servers", score: 0.95 },
      ],
      identityCandidates: [
        { identity: "Windows Host", score: 0.95, manufacturer: "Microsoft" },
      ],
      discoveryRunIds: ["run-1", "run-2", "run-3"],
      properties: {
        job: "windows-host",
        instance: "windows-host",
        softwareEvidence: ["windows_exporter"],
      },
    });
    const score = scoreDiscoveryTriageCandidate(packet, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS);
    const proposedRule = synthesizeDiscoveryFingerprintRule(packet, score, DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS);

    await recordDiscoveryTriageDecision(
      {
        discoveryTriageDecision: { create },
      },
      {
        decisionId: "triage-1",
        inventoryEntityId: "entity-7",
        qualityIssueId: "issue-1",
        actorType: "agent",
      actorId: "inventory-specialist",
        outcome: "auto-attributed",
        score,
        evidencePacket: packet,
        proposedRule,
        selectedTaxonomyNodeId: "foundational/compute/servers",
        selectedIdentity: { label: "Windows Host" },
        requiresHumanReview: false,
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        decisionId: "triage-1",
        actorType: "agent",
        outcome: "auto-attributed",
        identityConfidence: score.identityConfidence,
        taxonomyConfidence: score.taxonomyConfidence,
        evidenceCompleteness: score.evidenceCompleteness,
        reproducibilityScore: score.reproducibilityScore,
        evidencePacket: packet,
        proposedRule,
        requiresHumanReview: false,
      }),
    });
  });
});
