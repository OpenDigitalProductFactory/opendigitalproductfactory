/**
 * Capability Inventory — Phase 2
 * Unified view of all platform capabilities: internal tools, MCP server tools,
 * and AI provider capabilities. Supports filtering by source, skill, and status.
 */
"use server";

import { prisma } from "@dpf/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CapabilitySourceType = "internal" | "external_mcp" | "provider_native";

export type CapabilityAvailabilityStatus = "active" | "degraded" | "inactive" | "deprecated";

export interface CapabilityInventoryRow {
  capabilityId: string;
  sourceType: CapabilitySourceType;
  integrationId: string | null;
  displayName: string;
  description: string | null;
  enabled: boolean;
  availabilityStatus: CapabilityAvailabilityStatus;
  riskClass: "critical" | "elevated" | "standard" | null;
  auditClass: "ledger" | "journal" | "metrics_only" | null;
  sideEffect: boolean | null;
  requiresExternalAccess: boolean | null;
  buildPhases: string[] | null;
  integrationDependencies: string[];
  /** Raw manifest JSON for inline expand */
  manifest: Record<string, unknown> | null;
}

export interface CapabilityInventoryFilters {
  sourceType?: CapabilitySourceType;
  enabled?: boolean;
  search?: string;
  /** Filter to a specific list of capability IDs */
  capabilityIds?: string[];
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

// 60-second in-process cache using React's cache() for server actions.
// React cache() deduplicates within a single request; the TTL guard below
// keeps the data fresh across sequential requests.

let _inventoryCache: { rows: CapabilityInventoryRow[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function fetchInventoryUncached(): Promise<CapabilityInventoryRow[]> {
  const rows: CapabilityInventoryRow[] = [];

  // ── 1. Internal platform capabilities ────────────────────────────────────
  const platformCaps = await prisma.platformCapability.findMany({
    orderBy: { name: "asc" },
  });

  for (const cap of platformCaps) {
    const m = (cap.manifest ?? {}) as Record<string, unknown>;
    rows.push({
      capabilityId: cap.capabilityId,
      sourceType: "internal",
      integrationId: null,
      displayName: cap.name,
      description: cap.description ?? null,
      enabled: cap.state !== "deprecated" && cap.state !== "inactive",
      availabilityStatus: mapPlatformState(cap.state),
      riskClass: (m.riskClass as CapabilityInventoryRow["riskClass"]) ?? null,
      auditClass: (m.auditClass as CapabilityInventoryRow["auditClass"]) ?? null,
      sideEffect: typeof m.sideEffect === "boolean" ? m.sideEffect : null,
      requiresExternalAccess:
        typeof m.requiresExternalAccess === "boolean" ? m.requiresExternalAccess : null,
      buildPhases: Array.isArray(m.buildPhases) ? (m.buildPhases as string[]) : null,
      integrationDependencies: Array.isArray(m.integrationDependencies)
        ? (m.integrationDependencies as string[])
        : [],
      manifest: m,
    });
  }

  // ── 2. MCP server tools ───────────────────────────────────────────────────
  const mcpTools = await prisma.mcpServerTool.findMany({
    include: {
      server: {
        select: {
          serverId: true,
          name: true,
          status: true,
          integrationId: true,
          healthStatus: true,
        },
      },
    },
    orderBy: { toolName: "asc" },
  });

  for (const tool of mcpTools) {
    const capabilityId = `mcp:${tool.server.serverId}__${tool.toolName}`;
    rows.push({
      capabilityId,
      sourceType: "external_mcp",
      integrationId: tool.server.integrationId ?? null,
      displayName: tool.toolName,
      description: tool.description ?? null,
      enabled: tool.isEnabled && tool.server.status === "active",
      availabilityStatus: mapMcpStatus(tool.server.status, tool.server.healthStatus, tool.isEnabled),
      riskClass: null,
      auditClass: null,
      sideEffect: null,
      requiresExternalAccess: true, // MCP tools always reach outside the platform
      buildPhases: null,
      integrationDependencies: [tool.server.serverId],
      manifest: {
        sourceType: "external_mcp",
        serverId: tool.server.serverId,
        serverName: tool.server.name,
        inputSchema: tool.inputSchema,
      },
    });
  }

  // ── 3. Model provider capabilities ───────────────────────────────────────
  const providers = await prisma.modelProvider.findMany({
    orderBy: { name: "asc" },
    select: {
      providerId: true,
      name: true,
      status: true,
      category: true,
      endpointType: true,
      capabilityTier: true,
    },
  });

  for (const p of providers) {
    const capabilityId = `provider:${p.providerId}`;
    const isExternal = p.category !== "local";
    rows.push({
      capabilityId,
      sourceType: "provider_native",
      integrationId: null,
      displayName: p.name,
      description: `${p.endpointType ?? "llm"} · ${p.capabilityTier ?? "basic"} tier`,
      enabled: p.status === "active",
      availabilityStatus: mapProviderStatus(p.status),
      riskClass: isExternal ? "elevated" : "standard",
      auditClass: isExternal ? "journal" : "metrics_only",
      sideEffect: false,
      requiresExternalAccess: isExternal,
      buildPhases: null,
      integrationDependencies: [],
      manifest: {
        sourceType: "provider_native",
        category: p.category,
        endpointType: p.endpointType,
        capabilityTier: p.capabilityTier,
      },
    });
  }

  return rows;
}

// ─── Status mappers ───────────────────────────────────────────────────────────

function mapPlatformState(state: string): CapabilityAvailabilityStatus {
  switch (state) {
    case "active":
      return "active";
    case "deprecated":
      return "deprecated";
    case "inactive":
      return "inactive";
    default:
      return "inactive";
  }
}

function mapMcpStatus(
  serverStatus: string,
  healthStatus: string,
  isEnabled: boolean
): CapabilityAvailabilityStatus {
  if (!isEnabled) return "inactive";
  if (serverStatus !== "active") return "inactive";
  if (healthStatus === "healthy") return "active";
  if (healthStatus === "degraded") return "degraded";
  return "inactive";
}

function mapProviderStatus(status: string): CapabilityAvailabilityStatus {
  switch (status) {
    case "active":
      return "active";
    case "unconfigured":
    case "inactive":
      return "inactive";
    default:
      return "inactive";
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch all capabilities with optional filters.
 * Sorted: internal platform capabilities first, then alphabetically by display name.
 * Results are cached for 60 seconds.
 */
export async function getCapabilityInventory(
  filters?: CapabilityInventoryFilters
): Promise<CapabilityInventoryRow[]> {
  // TTL-based cache
  const now = Date.now();
  if (!_inventoryCache || now - _inventoryCache.fetchedAt > CACHE_TTL_MS) {
    _inventoryCache = {
      rows: await fetchInventoryUncached(),
      fetchedAt: now,
    };
  }

  // Sort: internal first, then alphabetically
  let rows = [..._inventoryCache.rows].sort((a, b) => {
    if (a.sourceType === "internal" && b.sourceType !== "internal") return -1;
    if (a.sourceType !== "internal" && b.sourceType === "internal") return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  // Apply filters
  if (filters?.sourceType) {
    rows = rows.filter((r) => r.sourceType === filters.sourceType);
  }
  if (filters?.enabled !== undefined) {
    rows = rows.filter((r) => r.enabled === filters.enabled);
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        r.capabilityId.toLowerCase().includes(q)
    );
  }
  if (filters?.capabilityIds && filters.capabilityIds.length > 0) {
    const ids = new Set(filters.capabilityIds);
    rows = rows.filter((r) => ids.has(r.capabilityId));
  }

  return rows;
}

/**
 * Fetch a single capability by its capabilityId.
 */
export async function getCapabilityById(
  capabilityId: string
): Promise<CapabilityInventoryRow | null> {
  const rows = await getCapabilityInventory();
  return rows.find((r) => r.capabilityId === capabilityId) ?? null;
}

// ─── Workstream D: Skill→capability resolution ───────────────────────────────

/**
 * Resolve a skill's allowedTools list to capability inventory IDs.
 * Maps each tool name to `platform:${toolName}` and filters to only
 * entries that exist in the capability inventory.
 *
 * @param skillId - The SkillDefinition slug/id to look up
 */
export async function getCapabilitiesForSkill(
  skillId: string
): Promise<CapabilityInventoryRow[]> {
  const skill = await prisma.skillDefinition.findUnique({
    where: { skillId },
    select: { allowedTools: true },
  });

  if (!skill || !Array.isArray(skill.allowedTools) || skill.allowedTools.length === 0) {
    return [];
  }

  // Map tool names to platform capability IDs
  const capabilityIds = (skill.allowedTools as string[]).map(
    (toolName) => `platform:${toolName}`
  );

  return getCapabilityInventory({ capabilityIds });
}
