// Estate posture / identity tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained "estate posture & identity" domain out of the
// mcp-tools.ts executeTool switch: summarizing an estate item's support
// lifecycle / evidence-freshness / open posture issues, explaining what an item
// most likely is and how confident its identity evidence is, judging how
// trustworthy an observed version is, and explaining an item's upstream/downstream
// blast radius. Every handler is read-only and lazy-delegates to the shared
// estate-tooling service (resolving the target entity through routeContext, then
// reading the pre-computed labels), so behaviour is identical when the tool is
// invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const entityProps = {
  entityId: { type: "string", description: "Specific estate item id (optional)" },
  entityKey: { type: "string", description: "Specific estate item key (optional)" },
  entityName: { type: "string", description: "Specific estate item name (optional)" },
} as const;

const definitions: ToolDefinition[] = [
  {
    name: "summarize_estate_posture",
    description: "Summarize support lifecycle, evidence freshness, version confidence, and open posture issues for an estate item or the current product estate view.",
    inputSchema: {
      type: "object",
      properties: { ...entityProps },
      required: [],
    },
    requiredCapability: "view_inventory",
    sideEffect: false,
  },
  {
    name: "review_estate_identity",
    description: "Explain what an estate item most likely is, who made it, how confident the identity evidence is, and what still needs review. Call once per estate entity under review. Low confidence is a finding to present, not a reason to re-call with the same entity. On errors, fix identifiers or capability grants once; do not thrash.",
    inputSchema: {
      type: "object",
      properties: { ...entityProps },
      required: [],
    },
    requiredCapability: "view_inventory",
    sideEffect: false,
  },
  {
    name: "validate_version_confidence",
    description: "Explain how trustworthy the observed version is for a specific estate item, including whether it is normalized or only inferred from raw evidence.",
    inputSchema: {
      type: "object",
      properties: { ...entityProps },
      required: [],
    },
    requiredCapability: "view_inventory",
    sideEffect: false,
  },
  {
    name: "explain_blast_radius",
    description: "Explain the upstream dependencies and downstream impact for a specific estate item using the shared dependency model.",
    inputSchema: {
      type: "object",
      properties: { ...entityProps },
      required: [],
    },
    requiredCapability: "view_inventory",
    sideEffect: false,
  },
];

function entityQuery(params: Record<string, unknown>) {
  return {
    entityId: typeof params["entityId"] === "string" ? params["entityId"] : undefined,
    entityKey: typeof params["entityKey"] === "string" ? params["entityKey"] : undefined,
    entityName: typeof params["entityName"] === "string" ? params["entityName"] : undefined,
  };
}

async function summarizeEstatePostureHandler(params: Record<string, unknown>, routeContext?: string): Promise<ToolResult> {
  const { resolveEstateEntity, summarizeDiscoveryOperations, summarizeProductEstate } = await import("@/lib/estate/estate-tooling");
  const resolved = await resolveEstateEntity(entityQuery(params), routeContext);

  if (resolved.kind === "resolved") {
    return {
      success: true,
      entityId: resolved.item.id,
      message: `${resolved.item.name}: ${resolved.item.supportSummaryLabel}; ${resolved.item.advisorySummaryLabel}; ${resolved.item.freshnessLabel}.`,
      data: {
        item: resolved.item,
        postureBadges: resolved.item.postureBadges,
        blastRadiusLabel: resolved.item.blastRadiusLabel,
        supportSummaryLabel: resolved.item.supportSummaryLabel,
        advisorySummaryLabel: resolved.item.advisorySummaryLabel,
        identityConfidenceLabel: resolved.item.identityConfidenceLabel,
      },
    };
  }

  if (resolved.kind === "ambiguous") {
    return {
      success: false,
      message: `Multiple estate items matched that request. Please be more specific.`,
      error: resolved.matches.map((match) => `${match.name} (${match.entityKey})`).join(", "),
      data: { matches: resolved.matches },
    };
  }

  const productSummary = await summarizeProductEstate(routeContext);
  if (productSummary) {
    return {
      success: true,
      entityId: productSummary.productId,
      message: `${productSummary.productName}: ${productSummary.itemCount} estate items, ${productSummary.openIssueCount} open issues, ${productSummary.unknownSupportCount} with unverified lifecycle, ${productSummary.lowIdentityConfidenceCount} with identity review still needed.`,
      data: productSummary as Record<string, unknown>,
    };
  }

  const discoverySummary = await summarizeDiscoveryOperations();
  return {
    success: true,
    message: `Discovery operations: ${discoverySummary.needsReviewCount} items need review.`,
    data: discoverySummary as Record<string, unknown>,
  };
}

async function reviewEstateIdentityHandler(params: Record<string, unknown>, routeContext?: string): Promise<ToolResult> {
  const { resolveEstateEntity } = await import("@/lib/estate/estate-tooling");
  const resolved = await resolveEstateEntity(entityQuery(params), routeContext);

  if (resolved.kind === "ambiguous") {
    return {
      success: false,
      message: "Multiple estate items matched that request. Please be more specific.",
      error: resolved.matches.map((match) => `${match.name} (${match.entityKey})`).join(", "),
      data: { matches: resolved.matches },
    };
  }

  if (resolved.kind === "missing") {
    return {
      success: false,
      message: resolved.reason,
      error: resolved.reason,
    };
  }

  return {
    success: true,
    entityId: resolved.item.id,
    message: `${resolved.item.name}: ${resolved.item.identityConfidenceLabel}; ${resolved.item.manufacturerLabel}; ${resolved.item.versionSourceLabel}.`,
    data: {
      item: resolved.item,
      identityLabel: resolved.item.identityLabel,
      identityConfidenceLabel: resolved.item.identityConfidenceLabel,
      manufacturerLabel: resolved.item.manufacturerLabel,
      versionLabel: resolved.item.versionLabel,
      versionSourceLabel: resolved.item.versionSourceLabel,
      supportSummaryLabel: resolved.item.supportSummaryLabel,
      advisorySummaryLabel: resolved.item.advisorySummaryLabel,
    },
  };
}

async function validateVersionConfidenceHandler(params: Record<string, unknown>, routeContext?: string): Promise<ToolResult> {
  const { resolveEstateEntity } = await import("@/lib/estate/estate-tooling");
  const resolved = await resolveEstateEntity(entityQuery(params), routeContext);

  if (resolved.kind === "ambiguous") {
    return {
      success: false,
      message: "Multiple estate items matched that request. Please be more specific.",
      error: resolved.matches.map((match) => `${match.name} (${match.entityKey})`).join(", "),
      data: { matches: resolved.matches },
    };
  }

  if (resolved.kind === "missing") {
    return {
      success: false,
      message: resolved.reason,
      error: resolved.reason,
    };
  }

  return {
    success: true,
    entityId: resolved.item.id,
    message: `${resolved.item.name}: ${resolved.item.versionConfidenceLabel}. ${resolved.item.versionSourceLabel}. Current version shown as ${resolved.item.versionLabel}.`,
    data: {
      item: resolved.item,
      versionLabel: resolved.item.versionLabel,
      versionSourceLabel: resolved.item.versionSourceLabel,
      versionConfidenceLabel: resolved.item.versionConfidenceLabel,
    },
  };
}

async function explainBlastRadiusHandler(params: Record<string, unknown>, routeContext?: string): Promise<ToolResult> {
  const { loadEstateBlastRadius, resolveEstateEntity } = await import("@/lib/estate/estate-tooling");
  const resolved = await resolveEstateEntity(entityQuery(params), routeContext);

  if (resolved.kind === "ambiguous") {
    return {
      success: false,
      message: "Multiple estate items matched that request. Please be more specific.",
      error: resolved.matches.map((match) => `${match.name} (${match.entityKey})`).join(", "),
      data: { matches: resolved.matches },
    };
  }

  if (resolved.kind === "missing") {
    return {
      success: false,
      message: resolved.reason,
      error: resolved.reason,
    };
  }

  const blastRadius = await loadEstateBlastRadius(resolved.item.id);
  if (!blastRadius) {
    return {
      success: false,
      message: "The estate item could not be loaded for blast-radius analysis.",
      error: "Estate item not found",
    };
  }

  return {
    success: true,
    entityId: resolved.item.id,
    message: `${resolved.item.name}: ${blastRadius.downstream.length} downstream dependenc${blastRadius.downstream.length === 1 ? "y" : "ies"} and ${blastRadius.upstream.length} upstream dependenc${blastRadius.upstream.length === 1 ? "y" : "ies"}.`,
    data: {
      item: resolved.item,
      upstream: blastRadius.upstream,
      downstream: blastRadius.downstream,
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  summarize_estate_posture: (params, _userId, context) => summarizeEstatePostureHandler(params, context?.routeContext),
  review_estate_identity: (params, _userId, context) => reviewEstateIdentityHandler(params, context?.routeContext),
  validate_version_confidence: (params, _userId, context) => validateVersionConfidenceHandler(params, context?.routeContext),
  explain_blast_radius: (params, _userId, context) => explainBlastRadiusHandler(params, context?.routeContext),
};

export const estatePosturePack: ToolPack = {
  packId: "estate-posture",
  definitions,
  handlers,
  grants: {
    summarize_estate_posture: ["registry_read"],
    review_estate_identity: ["registry_read"],
    validate_version_confidence: ["registry_read"],
    explain_blast_radius: ["registry_read"],
  },
};
