// Discovery & inventory tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained estate-discovery pipeline out of the mcp-tools.ts
// executeTool switch: sweeping the estate for entities, running the triage pass
// over needs-review inventory, ingesting the external Hive Scout catalog, and
// the attribution actions that resolve a discovered entity (attribute to a
// taxonomy node, dismiss, resolve a portfolio quality issue, configure a
// gateway scan). Each handler lazy-imports its single backing action module and
// reproduces the former switch case verbatim, so behaviour is identical when
// the tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import { DISCOVERY_TRIAGE_AGENT_ID } from "@dpf/db";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { DiscoveryTriageRunResult } from "@/lib/discovery-triage-runner";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const DISCOVERY_TRIAGE_SAMPLE_LIMIT = 10;

/**
 * Compact the discovery-triage run result for inline tool output (BI-PIR-edaa1d12).
 *
 * run_discovery_triage persists every decision server-side, but the scheduled
 * triage agent has no file-reading tool, so returning the full decisions[] array
 * inline (~50k chars on a full run) overflows the runtime token budget and the
 * daily metrics become unreadable — the summary can confirm executed-vs-skipped
 * but not report a single count. By default we return a metrics-only summary
 * (every count, the single top follow-up, and a capped sample of the entities
 * still needing human review) and only inline the full decisions[] array when
 * the caller explicitly opts in.
 */
export function compactDiscoveryTriageData(
  result: DiscoveryTriageRunResult,
  includeDecisions: boolean,
): Record<string, unknown> {
  const decisions = Array.isArray(result.decisions) ? result.decisions : [];
  const actionable = decisions.filter((d) => d.requiresHumanReview);
  const sample = (actionable.length > 0 ? actionable : decisions)
    .slice(0, DISCOVERY_TRIAGE_SAMPLE_LIMIT)
    .map((d) => ({ inventoryEntityId: d.inventoryEntityId, outcome: d.outcome }));
  const topFollowUp = actionable[0]
    ? {
        inventoryEntityId: actionable[0].inventoryEntityId,
        outcome: actionable[0].outcome,
        pendingHumanReview: result.metrics?.humanReview ?? actionable.length,
      }
    : null;

  const data: Record<string, unknown> = {
    trigger: result.trigger,
    processedAt: result.processedAt,
    runIdempotencyKey: result.runIdempotencyKey,
    skipped: result.skipped ?? false,
    skipReason: result.skipReason ?? null,
    metrics: result.metrics,
    decisionCount: decisions.length,
    topFollowUp,
    decisionSampleIds: sample,
  };
  if (includeDecisions) {
    data.decisions = decisions;
  }
  return data;
}

const definitions: ToolDefinition[] = [
  {
    name: "discovery_sweep",
    description: "Run a fresh discovery pass to refresh attribution, topology, and evidence quality across the estate.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
  },
  {
    name: "run_discovery_triage",
    description: "Run a single discovery triage pass over needs-review and weakly resolved inventory, applying safe high-confidence matches and returning a summary of the run.",
    inputSchema: {
      type: "object",
      properties: {
        trigger: { type: "string", enum: ["cadence", "volume"], default: "cadence" },
        includeDecisions: {
          type: "boolean",
          default: false,
          description:
            "Include the full per-entity decisions[] array inline. Off by default — the response returns a compact metrics summary plus a sample of the entities needing review, because the full array can exceed the runtime token limit.",
        },
      },
      required: [],
    },
    requiredCapability: "manage_provider_connections",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "run_hive_scout_ingest",
    description: "Run one external catalog scouting pass, diff the results against DPF coworker and skill coverage, and create deduplicated backlog suggestions for any uncovered archetype gaps.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "manage_backlog",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "attribute_entity_to_product",
    description: "Link a discovered inventory entity to a portfolio taxonomy node so it counts toward the managed product estate. Use to resolve catalog_match_ambiguous or attribution_gap quality issues.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string", description: "InventoryEntity id (cuid) to attribute" },
        taxonomyNodeId: { type: "string", description: "TaxonomyNode cuid — use this OR taxonomyNodeSlug" },
        taxonomyNodeSlug: { type: "string", description: "Taxonomy nodeId path (e.g. 'foundational/compute/physical_compute')" },
      },
      required: ["entityId"],
    },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
  },
  {
    name: "dismiss_entity",
    description: "Mark a discovered inventory entity as dismissed so it no longer shows in the attribution review queue. Use when the item is noise, out of scope, or superseded.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string", description: "InventoryEntity id (cuid) to dismiss" },
      },
      required: ["entityId"],
    },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
  },
  {
    name: "resolve_portfolio_quality_issue",
    description: "Close a PortfolioQualityIssue by marking it resolved or dismissed. Use after the underlying cause has been fixed (e.g. entity attributed, relationship refreshed) or when the issue does not apply.",
    inputSchema: {
      type: "object",
      properties: {
        issueId: { type: "string", description: "PortfolioQualityIssue cuid" },
        resolution: { type: "string", enum: ["resolved", "dismissed"], description: "'resolved' if the cause was fixed; 'dismissed' if the issue does not apply" },
      },
      required: ["issueId", "resolution"],
    },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
  },
  {
    name: "configure_gateway_scan",
    description: "Create or update a DiscoveryConnection for an ARP/subnet gateway scan so physical LAN segments (e.g. 192.168.x) become visible. Use to resolve gateway_connection_needed issues.",
    inputSchema: {
      type: "object",
      properties: {
        name:             { type: "string", description: "Human label for the connection (e.g. 'Home LAN 192.168.0.0/24')" },
        endpointUrl:      { type: "string", description: "Gateway URL or scan endpoint (e.g. http://192.168.0.1 or arp://192.168.0.0/24)" },
        apiKey:           { type: "string", description: "Optional API key (encrypted at rest)" },
        collectorType:    { type: "string", enum: ["arp_scan", "unifi"], description: "Defaults to 'arp_scan' for generic subnet discovery" },
        gatewayEntityId:  { type: "string", description: "Optional InventoryEntity cuid of the gateway device" },
        configuration:    { type: "object", description: "Collector-specific configuration JSON (e.g. { subnet: '192.168.0.0/24' })" },
      },
      required: ["name", "endpointUrl"],
    },
    requiredCapability: "manage_provider_connections",
    sideEffect: true,
  },
];

async function discoverySweepHandler(): Promise<ToolResult> {
  const { triggerBootstrapDiscovery } = await import("@/lib/actions/discovery");
  const result = await triggerBootstrapDiscovery();
  if (!result.ok) {
    return {
      success: false,
      message: result.error,
      error: result.error,
    };
  }
  return {
    success: true,
    message: `Discovery sweep completed: ${result.summary.createdEntities + result.summary.updatedEntities} entities refreshed and ${result.summary.createdRelationships + result.summary.updatedRelationships} relationships refreshed.`,
    data: result.summary as Record<string, unknown>,
  };
}

async function runDiscoveryTriageHandler(
  params: Record<string, unknown>,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { runDiscoveryTriageDaily } = await import("@/lib/discovery-triage-runner");
  const trigger = params["trigger"] === "volume" ? "volume" : "cadence";
  const includeDecisions = params["includeDecisions"] === true;
  const result = await runDiscoveryTriageDaily(undefined, {
    trigger,
    actorType: "agent",
    actorId: context?.agentId ?? DISCOVERY_TRIAGE_AGENT_ID,
    enableAutonomousReview: true,
  });
  const escalation = result.metrics?.escalationQueueDepth ?? 0;
  return {
    success: true,
    message: result.skipped
      ? result.skipReason ?? "Discovery triage skipped."
      : `Discovery triage processed ${result.metrics.processed} entities with ${result.metrics.autoAttributed} auto-attributed` +
        (escalation > 0 ? `; ${escalation} awaiting human review.` : "."),
    data: compactDiscoveryTriageData(result, includeDecisions),
  };
}

async function runHiveScoutIngestHandler(
  context?: { agentId?: string; taskRunId?: string },
): Promise<ToolResult> {
  const { runHiveScoutIngest } = await import("@/lib/actions/hive-scout/ingest-500-agents");
  const result = await runHiveScoutIngest({
    actorAgentId: context?.agentId,
    taskRunId: context?.taskRunId,
    enableAutonomousReview: true,
  });
  return {
    success: true,
    message: `Hive Scout parsed ${result.catalogEntries} entries, detected ${result.gaps} gaps, reviewed ${result.reviewed ?? 0} ambiguous candidate${result.reviewed === 1 ? "" : "s"}, created ${result.created} backlog suggestion${result.created === 1 ? "" : "s"}, skipped ${result.duplicates} deterministic duplicate${result.duplicates === 1 ? "" : "s"} and ${result.skippedByReview ?? 0} review rejection${result.skippedByReview === 1 ? "" : "s"}, deferred ${result.deferred}, reused ${result.reviewCacheHits ?? 0} cached review${result.reviewCacheHits === 1 ? "" : "s"}, dropped ${result.reviewSchemaDropCount ?? 0} invalid review entr${result.reviewSchemaDropCount === 1 ? "y" : "ies"}${result.reviewSkipReason ? `, and skipped autonomous review because ${result.reviewSkipReason}` : ""}${result.reviewFailureReason ? `, with reviewer failure reason ${result.reviewFailureReason}` : ""}.`,
    data: result as unknown as Record<string, unknown>,
  };
}

async function attributeEntityToProductHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const entityId = String(params["entityId"] ?? "").trim();
  if (!entityId) return { success: false, message: "entityId is required", error: "missing_entity_id" };

  let taxonomyNodeId = typeof params["taxonomyNodeId"] === "string" ? params["taxonomyNodeId"].trim() : "";
  const slug = typeof params["taxonomyNodeSlug"] === "string" ? params["taxonomyNodeSlug"].trim() : "";
  if (!taxonomyNodeId && slug) {
    const { prisma } = await import("@dpf/db");
    const node = await prisma.taxonomyNode.findFirst({
      where: { nodeId: slug },
      select: { id: true },
    });
    if (!node) {
      return { success: false, message: `Taxonomy node '${slug}' not found`, error: "taxonomy_node_not_found" };
    }
    taxonomyNodeId = node.id;
  }
  if (!taxonomyNodeId) {
    return { success: false, message: "Provide taxonomyNodeId or taxonomyNodeSlug", error: "missing_taxonomy_target" };
  }

  const { reassignTaxonomy } = await import("@/lib/actions/inventory");
  const result = await reassignTaxonomy(entityId, taxonomyNodeId);
  if (!result.ok) {
    return { success: false, message: result.error ?? "Attribution failed", error: result.error ?? "attribution_failed" };
  }
  return {
    success: true,
    entityId,
    message: `Entity attributed to taxonomy node ${slug || taxonomyNodeId}.`,
    data: { entityId, taxonomyNodeId },
  };
}

async function dismissEntityHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const entityId = String(params["entityId"] ?? "").trim();
  if (!entityId) return { success: false, message: "entityId is required", error: "missing_entity_id" };

  const { dismissEntity } = await import("@/lib/actions/inventory");
  const result = await dismissEntity(entityId);
  if (!result.ok) {
    return { success: false, message: result.error ?? "Dismiss failed", error: result.error ?? "dismiss_failed" };
  }
  return {
    success: true,
    entityId,
    message: `Entity ${entityId} dismissed.`,
    data: { entityId },
  };
}

async function resolvePortfolioQualityIssueHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const issueId = String(params["issueId"] ?? "").trim();
  const resolution = String(params["resolution"] ?? "").trim();
  if (!issueId) return { success: false, message: "issueId is required", error: "missing_issue_id" };
  if (resolution !== "resolved" && resolution !== "dismissed") {
    return { success: false, message: "resolution must be 'resolved' or 'dismissed'", error: "invalid_resolution" };
  }

  const { resolvePortfolioQualityIssue } = await import("@/lib/actions/inventory");
  const result = await resolvePortfolioQualityIssue(issueId, resolution);
  if (!result.ok) {
    return { success: false, message: result.error ?? "Resolve failed", error: result.error ?? "resolve_failed" };
  }
  return {
    success: true,
    entityId: issueId,
    message: `Quality issue ${issueId} marked ${resolution}.`,
    data: { issueId, resolution },
  };
}

async function configureGatewayScanHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const name = String(params["name"] ?? "").trim();
  const endpointUrl = String(params["endpointUrl"] ?? "").trim();
  if (!name) return { success: false, message: "name is required", error: "missing_name" };
  if (!endpointUrl) return { success: false, message: "endpointUrl is required", error: "missing_endpoint_url" };

  const collectorType = typeof params["collectorType"] === "string" && params["collectorType"].trim()
    ? params["collectorType"].trim()
    : "arp_scan";
  const apiKey = typeof params["apiKey"] === "string" && params["apiKey"].trim()
    ? params["apiKey"].trim()
    : undefined;
  const gatewayEntityId = typeof params["gatewayEntityId"] === "string" && params["gatewayEntityId"].trim()
    ? params["gatewayEntityId"].trim()
    : undefined;
  const configuration = typeof params["configuration"] === "object" && params["configuration"] !== null
    ? (params["configuration"] as Record<string, unknown>)
    : undefined;

  const { configureDiscoveryConnection } = await import("@/lib/actions/discovery");
  const result = await configureDiscoveryConnection({
    name,
    endpointUrl,
    collectorType,
    apiKey,
    gatewayEntityId,
    configuration,
  });
  if (!result.ok) {
    return { success: false, message: result.error ?? "Configure failed", error: result.error ?? "configure_failed" };
  }
  return {
    success: true,
    entityId: result.connectionId,
    message: `Gateway scan '${name}' configured (${collectorType}). ${apiKey ? "Status: active." : "Status: unconfigured — supply an API key to activate."}`,
    data: { connectionId: result.connectionId, collectorType },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  discovery_sweep: () => discoverySweepHandler(),
  run_discovery_triage: (params, _userId, context) => runDiscoveryTriageHandler(params, context),
  run_hive_scout_ingest: (_params, _userId, context) => runHiveScoutIngestHandler(context),
  attribute_entity_to_product: (params) => attributeEntityToProductHandler(params),
  dismiss_entity: (params) => dismissEntityHandler(params),
  resolve_portfolio_quality_issue: (params) => resolvePortfolioQualityIssueHandler(params),
  configure_gateway_scan: (params) => configureGatewayScanHandler(params),
};

export const discoveryInventoryPack: ToolPack = {
  packId: "discovery-inventory",
  definitions,
  handlers,
  grants: {
    discovery_sweep: ["telemetry_read"],
    run_discovery_triage: ["registry_write"],
    run_hive_scout_ingest: ["backlog_write"],
    attribute_entity_to_product: ["registry_write"],
    dismiss_entity: ["registry_write"],
    resolve_portfolio_quality_issue: ["registry_write"],
    configure_gateway_scan: ["agent_control_read"],
  },
};
