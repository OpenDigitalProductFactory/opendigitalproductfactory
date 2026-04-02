// apps/web/lib/mcp-catalog-sync.ts
// Core MCP catalog sync logic. No "use server" — importable by actions and tests.

import { prisma } from "@dpf/db";
import { agentEventBus } from "@/lib/agent-event-bus";
import {
  deriveArchetypeIds,
  type GlamaServerEntry,
  type RegistryServerEntry,
} from "@/lib/mcp-catalog-types";

const REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0/servers";
const GLAMA_BASE = "https://glama.ai/api/mcp/v1/servers";
const PAGE_SIZE = 50;
const GLAMA_CONCURRENCY = 10;
const GLAMA_BATCH_DELAY_MS = 100;

async function fetchRegistryPage(
  cursor?: string
): Promise<{ servers: RegistryServerEntry[]; nextCursor: string | null }> {
  const url = new URL(REGISTRY_BASE);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Registry API error: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.servers)) throw new Error("Unexpected registry API response shape");
  return data;
}

async function fetchGlamaEnrichment(
  registryId: string
): Promise<GlamaServerEntry | null> {
  try {
    const res = await fetch(`${GLAMA_BASE}/${encodeURIComponent(registryId)}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function enrichBatch(
  entries: RegistryServerEntry[]
): Promise<Map<string, GlamaServerEntry>> {
  const result = new Map<string, GlamaServerEntry>();
  for (let i = 0; i < entries.length; i += GLAMA_CONCURRENCY) {
    const batch = entries.slice(i, i + GLAMA_CONCURRENCY);
    const enriched = await Promise.all(
      batch.map((e) => fetchGlamaEnrichment(e.id))
    );
    batch.forEach((entry, idx) => {
      const g = enriched[idx];
      if (g) result.set(entry.id, g);
    });
    if (i + GLAMA_CONCURRENCY < entries.length) {
      await new Promise((r) => setTimeout(r, GLAMA_BATCH_DELAY_MS));
    }
  }
  return result;
}

function toSlug(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function runMcpCatalogSync(syncId: string): Promise<void> {
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalNew = 0;

  try {
    const existing = await prisma.mcpIntegration.findMany({
      where: { status: "active" },
      select: { registryId: true },
    });
    const existingIds = new Set(existing.map((e) => e.registryId));

    const syncStartedAt = new Date();

    let cursor: string | undefined;
    do {
      const page = await fetchRegistryPage(cursor);
      const entries = page.servers;
      totalFetched += entries.length;

      const glamaMap = await enrichBatch(entries);

      for (const entry of entries) {
        const glama = glamaMap.get(entry.id);
        const archetypeIds = deriveArchetypeIds(entry.tags ?? []);
        const isNew = !existingIds.has(entry.id);
        if (isNew) totalNew++;

        const slug = toSlug(entry.id);
        const commonFields = {
          slug,
          name: entry.name,
          shortDescription: entry.description?.slice(0, 160) ?? null,
          description: entry.description ?? null,
          vendor: entry.vendor ?? null,
          repositoryUrl: entry.repository?.url ?? null,
          category: entry.category ?? "uncategorized",
          subcategory: entry.subcategory ?? null,
          tags: entry.tags ?? [],
          isVerified: entry.isVerified ?? false,
          archetypeIds,
          status: "active",
          rawMetadata: entry as object,
          lastSyncedAt: new Date(),
          logoUrl: glama?.logoUrl ?? null,
          rating: glama?.stats?.rating ?? null,
          ratingCount: glama?.stats?.ratingCount ?? null,
          installCount: glama?.stats?.installCount ?? null,
          pricingModel: glama?.pricing?.model ?? null,
        };

        await prisma.mcpIntegration.upsert({
          where: { registryId: entry.id },
          create: { registryId: entry.id, ...commonFields },
          update: commonFields,
        });

        totalUpserted++;

        agentEventBus.emit(syncId, {
          type: "sync:progress",
          totalFetched,
          totalUpserted,
          totalNew,
        });
      }

      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const { count: totalRemoved } = await prisma.mcpIntegration.updateMany({
      where: { status: "active", lastSyncedAt: { lt: syncStartedAt } },
      data: { status: "deprecated" },
    });

    await prisma.mcpCatalogSync.update({
      where: { id: syncId },
      data: {
        status: "success",
        completedAt: new Date(),
        totalFetched,
        totalUpserted,
        totalNew,
        totalRemoved,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    try {
      await prisma.mcpCatalogSync.update({
        where: { id: syncId },
        data: { status: "failed", completedAt: new Date(), error },
      });
    } catch {
      // swallow — database may be unavailable
    }
  } finally {
    agentEventBus.emit(syncId, { type: "done" });
  }
}
