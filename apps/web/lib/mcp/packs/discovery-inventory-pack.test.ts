import { beforeEach, describe, expect, it, vi } from "vitest";

const discovery = vi.hoisted(() => ({
  triggerBootstrapDiscovery: vi.fn(),
  configureDiscoveryConnection: vi.fn(),
  testDiscoveryConnection: vi.fn(),
}));
vi.mock("@/lib/actions/discovery", () => discovery);

const triageRunner = vi.hoisted(() => ({ runDiscoveryTriageDaily: vi.fn() }));
vi.mock("@/lib/discovery-triage-runner", () => triageRunner);

const hiveScout = vi.hoisted(() => ({ runHiveScoutIngest: vi.fn() }));
vi.mock("@/lib/actions/hive-scout/ingest-500-agents", () => hiveScout);

const inventory = vi.hoisted(() => ({
  reassignTaxonomy: vi.fn(),
  dismissEntity: vi.fn(),
  resolvePortfolioQualityIssue: vi.fn(),
}));
vi.mock("@/lib/actions/inventory", () => inventory);

const db = vi.hoisted(() => ({
  DISCOVERY_TRIAGE_AGENT_ID: "agent-discovery-triage",
  prisma: { taxonomyNode: { findFirst: vi.fn() } },
  enrichDigitalProduct: vi.fn(),
  requestReEnrichment: vi.fn(),
}));
vi.mock("@dpf/db", () => db);

import { discoveryInventoryPack, compactDiscoveryTriageData } from "./discovery-inventory-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "discovery_sweep",
  "run_discovery_triage",
  "run_hive_scout_ingest",
  "attribute_entity_to_product",
  "dismiss_entity",
  "resolve_portfolio_quality_issue",
  "enrich_digital_product",
  "request_re_enrichment",
  "configure_gateway_scan",
  "configure_and_test_discovery_connection",
  "list_discovery_connections",
];

const EXPECTED_GRANTS: Record<string, string[]> = {
  discovery_sweep: ["telemetry_read"],
  run_discovery_triage: ["registry_write"],
  run_hive_scout_ingest: ["backlog_write"],
  attribute_entity_to_product: ["registry_write"],
  dismiss_entity: ["registry_write"],
  resolve_portfolio_quality_issue: ["registry_write"],
  enrich_digital_product: ["enrichment_write"],
  request_re_enrichment: ["enrichment_write"],
  configure_gateway_scan: ["agent_control_read"],
  configure_and_test_discovery_connection: ["agent_control_read"],
  list_discovery_connections: ["agent_control_read"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("discovery-inventory pack — registration", () => {
  it("exposes the discovery/inventory tools including the human-equivalent configure-and-test outcome", () => {
    expect(discoveryInventoryPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(discoveryInventoryPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/path leakage)", () => {
    for (const d of discoveryInventoryPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("preserves requiredCapability and sideEffect metadata verbatim", () => {
    const byName = Object.fromEntries(discoveryInventoryPack.definitions.map((d) => [d.name, d]));
    for (const t of EXPECTED_TOOLS) {
      expect(byName[t].requiredCapability, t).toBe(
        t === "run_hive_scout_ingest" ? "manage_backlog" : "manage_provider_connections",
      );
      expect(byName[t].sideEffect, t).toBe(t !== "list_discovery_connections");
    }
    expect(byName.run_discovery_triage.executionMode).toBe("immediate");
    expect(byName.run_hive_scout_ingest.executionMode).toBe("immediate");
  });

  it("grants mirror agent-grants for every tool", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(discoveryInventoryPack.grants[t]).toEqual(EXPECTED_GRANTS[t]);
      expect(isToolAllowedByGrants(t, EXPECTED_GRANTS[t])).toBe(true);
    }
  });
});

describe("discovery-inventory pack — handler behavior (delegation preserved)", () => {
  it("discovery_sweep summarizes refreshed entities and relationships", async () => {
    discovery.triggerBootstrapDiscovery.mockResolvedValue({
      ok: true,
      summary: { createdEntities: 2, updatedEntities: 3, createdRelationships: 1, updatedRelationships: 4 },
    });
    const res = await discoveryInventoryPack.handlers.discovery_sweep({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("5 entities refreshed");
    expect(res.message).toContain("5 relationships refreshed");
  });

  it("discovery_sweep surfaces a failed sweep as an error", async () => {
    discovery.triggerBootstrapDiscovery.mockResolvedValue({ ok: false, error: "no collectors" });
    const res = await discoveryInventoryPack.handlers.discovery_sweep({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("no collectors");
  });

  it("run_discovery_triage forwards trigger + actor and reports processed counts", async () => {
    triageRunner.runDiscoveryTriageDaily.mockResolvedValue({
      skipped: false,
      metrics: { processed: 7, autoAttributed: 3 },
    });
    const res = await discoveryInventoryPack.handlers.run_discovery_triage(
      { trigger: "volume" },
      "u1",
      { agentId: "agent-x" },
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("processed 7 entities with 3 auto-attributed");
    expect(triageRunner.runDiscoveryTriageDaily).toHaveBeenCalledWith(undefined, {
      trigger: "volume",
      actorType: "agent",
      actorId: "agent-x",
      enableAutonomousReview: true,
    });
  });

  it("run_discovery_triage falls back to the default triage agent id and cadence trigger", async () => {
    triageRunner.runDiscoveryTriageDaily.mockResolvedValue({ skipped: true, skipReason: "too soon" });
    const res = await discoveryInventoryPack.handlers.run_discovery_triage({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("too soon");
    const arg = triageRunner.runDiscoveryTriageDaily.mock.calls[0][1];
    expect(arg.trigger).toBe("cadence");
    expect(arg.actorId).toBe("agent-discovery-triage");
  });

  it("run_discovery_triage returns a compact summary inline and omits the full decisions[] by default", async () => {
    const decisions = Array.from({ length: 30 }, (_, i) => ({
      inventoryEntityId: `entity-${i}`,
      outcome: i % 2 === 0 ? "human-review" : "auto-attributed",
      requiresHumanReview: i % 2 === 0,
    }));
    triageRunner.runDiscoveryTriageDaily.mockResolvedValue({
      trigger: "cadence",
      processedAt: "2026-07-16T00:00:00.000Z",
      runIdempotencyKey: "run-1",
      skipped: false,
      metrics: { processed: 30, autoAttributed: 15, humanReview: 15, escalationQueueDepth: 15 },
      decisions,
    });
    const res = await discoveryInventoryPack.handlers.run_discovery_triage({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("processed 30 entities with 15 auto-attributed");
    expect(res.message).toContain("15 awaiting human review");
    const data = res.data as Record<string, unknown>;
    // The heavy array is NOT inlined by default…
    expect(data.decisions).toBeUndefined();
    // …but the metrics, the count, the top follow-up, and a capped sample are.
    expect(data.metrics).toEqual({ processed: 30, autoAttributed: 15, humanReview: 15, escalationQueueDepth: 15 });
    expect(data.decisionCount).toBe(30);
    expect((data.decisionSampleIds as unknown[]).length).toBe(10);
    expect(data.topFollowUp).toEqual({
      inventoryEntityId: "entity-0",
      outcome: "human-review",
      pendingHumanReview: 15,
    });
  });

  it("run_discovery_triage inlines the full decisions[] only when includeDecisions is opted in", async () => {
    const decisions = [
      { inventoryEntityId: "e0", outcome: "auto-attributed", requiresHumanReview: false },
      { inventoryEntityId: "e1", outcome: "taxonomy-gap", requiresHumanReview: true },
    ];
    triageRunner.runDiscoveryTriageDaily.mockResolvedValue({
      trigger: "volume",
      processedAt: "2026-07-16T00:00:00.000Z",
      skipped: false,
      metrics: { processed: 2, autoAttributed: 1, humanReview: 1, escalationQueueDepth: 1 },
      decisions,
    });
    const res = await discoveryInventoryPack.handlers.run_discovery_triage({ includeDecisions: true }, "u1");
    const data = res.data as Record<string, unknown>;
    expect(data.decisions).toEqual(decisions);
    expect(data.decisionCount).toBe(2);
  });

  it("run_hive_scout_ingest forwards actor + taskRun context and summarizes the run", async () => {
    hiveScout.runHiveScoutIngest.mockResolvedValue({
      catalogEntries: 10, gaps: 2, reviewed: 1, created: 1, duplicates: 0, deferred: 0,
    });
    const res = await discoveryInventoryPack.handlers.run_hive_scout_ingest(
      {},
      "u1",
      { agentId: "agent-y", taskRunId: "TR-1" },
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("Hive Scout parsed 10 entries");
    expect(hiveScout.runHiveScoutIngest).toHaveBeenCalledWith({
      actorAgentId: "agent-y",
      taskRunId: "TR-1",
      enableAutonomousReview: true,
    });
  });

  it("attribute_entity_to_product resolves a taxonomy slug then reassigns", async () => {
    db.prisma.taxonomyNode.findFirst.mockResolvedValue({ id: "node-cuid" });
    inventory.reassignTaxonomy.mockResolvedValue({ ok: true });
    const res = await discoveryInventoryPack.handlers.attribute_entity_to_product(
      { entityId: "e1", taxonomyNodeSlug: "foundational/compute" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(db.prisma.taxonomyNode.findFirst).toHaveBeenCalled();
    expect(inventory.reassignTaxonomy).toHaveBeenCalledWith("e1", "node-cuid");
  });

  it("attribute_entity_to_product rejects when neither id nor slug resolves", async () => {
    const res = await discoveryInventoryPack.handlers.attribute_entity_to_product({ entityId: "e1" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_taxonomy_target");
    expect(inventory.reassignTaxonomy).not.toHaveBeenCalled();
  });

  it("attribute_entity_to_product surfaces an unknown slug", async () => {
    db.prisma.taxonomyNode.findFirst.mockResolvedValue(null);
    const res = await discoveryInventoryPack.handlers.attribute_entity_to_product(
      { entityId: "e1", taxonomyNodeSlug: "nope" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("taxonomy_node_not_found");
  });

  it("dismiss_entity delegates and requires an entityId", async () => {
    const missing = await discoveryInventoryPack.handlers.dismiss_entity({}, "u1");
    expect(missing.success).toBe(false);
    expect(missing.error).toBe("missing_entity_id");

    inventory.dismissEntity.mockResolvedValue({ ok: true });
    const res = await discoveryInventoryPack.handlers.dismiss_entity({ entityId: "e2" }, "u1");
    expect(res.success).toBe(true);
    expect(inventory.dismissEntity).toHaveBeenCalledWith("e2");
  });

  it("resolve_portfolio_quality_issue validates the resolution enum", async () => {
    const bad = await discoveryInventoryPack.handlers.resolve_portfolio_quality_issue(
      { issueId: "i1", resolution: "maybe" },
      "u1",
    );
    expect(bad.success).toBe(false);
    expect(bad.error).toBe("invalid_resolution");

    inventory.resolvePortfolioQualityIssue.mockResolvedValue({ ok: true });
    const res = await discoveryInventoryPack.handlers.resolve_portfolio_quality_issue(
      { issueId: "i1", resolution: "resolved" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(inventory.resolvePortfolioQualityIssue).toHaveBeenCalledWith("i1", "resolved");
  });

  it("configure_gateway_scan defaults collectorType and reports activation state", async () => {
    inventory.reassignTaxonomy.mockClear();
    discovery.configureDiscoveryConnection.mockResolvedValue({ ok: true, connectionId: "conn-1" });
    const res = await discoveryInventoryPack.handlers.configure_gateway_scan(
      { name: "Home LAN", endpointUrl: "arp://192.168.0.0/24" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("arp_scan");
    expect(res.message).toContain("Status: unconfigured");
    const arg = discovery.configureDiscoveryConnection.mock.calls[0][0];
    expect(arg.collectorType).toBe("arp_scan");
    expect(arg.apiKey).toBeUndefined();
  });

  it("configure_gateway_scan requires name and endpointUrl", async () => {
    const noName = await discoveryInventoryPack.handlers.configure_gateway_scan({ endpointUrl: "x" }, "u1");
    expect(noName.error).toBe("missing_name");
    const noUrl = await discoveryInventoryPack.handlers.configure_gateway_scan({ name: "x" }, "u1");
    expect(noUrl.error).toBe("missing_endpoint_url");
  });

  it("configure_and_test_discovery_connection supports SNMP and returns the tested outcome without echoing the secret", async () => {
    discovery.configureDiscoveryConnection.mockResolvedValue({ ok: true, connectionId: "conn-snmp" });
    discovery.testDiscoveryConnection.mockResolvedValue({
      ok: true,
      status: "ok",
      deviceCount: 3,
      message: "Discovered 3 items",
    });

    const result = await discoveryInventoryPack.handlers.configure_and_test_discovery_connection({
      name: "Core switch",
      collectorType: "snmp",
      endpointUrl: "192.168.1.1",
      apiKey: "private-community",
      configuration: { community: "private-community" },
    }, "u1");

    expect(result.success).toBe(true);
    expect(result.message).toContain("SNMP discovery connection saved and tested");
    expect(result.data).toMatchObject({ connectionId: "conn-snmp", status: "ok", deviceCount: 3 });
    expect(JSON.stringify(result)).not.toContain("private-community");
    expect(discovery.configureDiscoveryConnection).toHaveBeenCalledWith(expect.objectContaining({
      collectorType: "snmp",
      endpointUrl: "192.168.1.1",
      apiKey: "private-community",
    }));
    expect(discovery.testDiscoveryConnection).toHaveBeenCalledWith("conn-snmp");
  });

  it("declares SNMP in both discovery connection schemas", () => {
    for (const toolName of ["configure_gateway_scan", "configure_and_test_discovery_connection"]) {
      const definition = discoveryInventoryPack.definitions.find((item) => item.name === toolName);
      const schema = definition?.inputSchema as {
        properties?: { collectorType?: { enum?: string[] } };
      };
      const collector = schema.properties?.collectorType;
      expect(collector?.enum).toContain("snmp");
    }
  });

  it("enrich_digital_product requires a digitalProductId", async () => {
    const res = await discoveryInventoryPack.handlers.enrich_digital_product({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_digital_product_id");
  });

  it("enrich_digital_product reports the enrichment summary", async () => {
    db.enrichDigitalProduct.mockResolvedValue({
      digitalProductId: "dp-1",
      enrichmentStatus: "enriched",
      identitiesEnriched: 2,
      identitiesFailed: 0,
      lifecycleMilestonesWritten: 5,
    });
    const res = await discoveryInventoryPack.handlers.enrich_digital_product({ digitalProductId: "dp-1" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("Enriched 2 identities");
    expect(res.message).toContain("status enriched");
  });

  it("enrich_digital_product surfaces a missing product", async () => {
    db.enrichDigitalProduct.mockResolvedValue({
      digitalProductId: "missing",
      enrichmentStatus: "failed",
      identitiesEnriched: 0,
      identitiesFailed: 0,
      lifecycleMilestonesWritten: 0,
    });
    const res = await discoveryInventoryPack.handlers.enrich_digital_product({ digitalProductId: "missing" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("digital_product_not_found");
  });

  it("request_re_enrichment requires a target", async () => {
    const res = await discoveryInventoryPack.handlers.request_re_enrichment({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_target");
  });

  it("request_re_enrichment flags a product for re-enrichment", async () => {
    db.requestReEnrichment.mockResolvedValue({ flaggedProduct: true, flaggedEntity: false });
    const res = await discoveryInventoryPack.handlers.request_re_enrichment({ digitalProductId: "dp-1" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("product dp-1");
  });

  it("request_re_enrichment reports when nothing was flagged", async () => {
    db.requestReEnrichment.mockResolvedValue({ flaggedProduct: false, flaggedEntity: false });
    const res = await discoveryInventoryPack.handlers.request_re_enrichment({ inventoryEntityId: "gone" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("target_not_found");
  });
});

describe("compactDiscoveryTriageData", () => {
  it("handles a skipped run with no decisions — zero count, null follow-up, empty sample", () => {
    const data = compactDiscoveryTriageData(
      {
        trigger: "cadence",
        processedAt: "2026-07-16T00:00:00.000Z",
        skipped: true,
        skipReason: "too soon",
        metrics: { processed: 0, autoAttributed: 0, humanReview: 0 },
        decisions: [],
      } as never,
      false,
    );
    expect(data.skipped).toBe(true);
    expect(data.skipReason).toBe("too soon");
    expect(data.decisionCount).toBe(0);
    expect(data.topFollowUp).toBeNull();
    expect(data.decisionSampleIds).toEqual([]);
    expect(data.decisions).toBeUndefined();
  });

  it("samples the first decisions when none require human review (no actionable follow-up)", () => {
    const decisions = [
      { inventoryEntityId: "e0", outcome: "auto-attributed", requiresHumanReview: false },
      { inventoryEntityId: "e1", outcome: "dismissed", requiresHumanReview: false },
    ];
    const data = compactDiscoveryTriageData(
      { trigger: "volume", processedAt: "t", metrics: { humanReview: 0 }, decisions } as never,
      false,
    );
    expect(data.topFollowUp).toBeNull();
    expect((data.decisionSampleIds as unknown[]).length).toBe(2);
  });
});
