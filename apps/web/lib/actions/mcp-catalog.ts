"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { runMcpCatalogSync } from "@/lib/mcp-catalog-sync";
import { computeNextRunAt, type ScheduleValue } from "@/lib/ai-provider-types";

// ─── Auth helpers ──────────────────────────────────────────────────────────────

async function requireManageIntegrations(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

// ─── Sync trigger ──────────────────────────────────────────────────────────────

export async function triggerMcpCatalogSync(): Promise<{ ok: boolean; message: string; syncId?: string }> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    return { ok: false, message: "Unauthorized" };
  }

  const running = await prisma.mcpCatalogSync.findFirst({ where: { status: "running" } });
  if (running) return { ok: false, message: "A sync is already in progress." };

  const sync = await prisma.mcpCatalogSync.create({
    data: { triggeredBy: "manual", triggeredByUserId: user.id },
  });

  // Update ScheduledJob lastRunAt (best-effort — job may not exist yet)
  void prisma.scheduledJob.update({
    where: { jobId: "mcp-catalog-sync" },
    data: { lastRunAt: new Date(), lastStatus: "running" },
  }).catch(() => {});

  // Fire-and-forget: client subscribes to SSE on sync.id for real-time progress
  void runMcpCatalogSync(sync.id).then(async () => {
    const job = await prisma.scheduledJob.findUnique({ where: { jobId: "mcp-catalog-sync" } });
    await prisma.scheduledJob.update({
      where: { jobId: "mcp-catalog-sync" },
      data: {
        lastStatus: "completed",
        lastRunAt: new Date(),
        nextRunAt: job ? computeNextRunAt(job.schedule, new Date()) : null,
      },
    }).catch(() => {});
  }).catch(() => {});

  return { ok: true, message: "Sync started.", syncId: sync.id };
}

// ─── Query ─────────────────────────────────────────────────────────────────────

export async function queryMcpIntegrations(params: {
  query: string;
  category?: string;
  archetypeId?: string;
  pricingModel?: string;
  limit?: number;
}) {
  const { query, category, archetypeId, pricingModel, limit = 20 } = params;

  return prisma.mcpIntegration.findMany({
    where: {
      status: "active",
      ...(category ? { category } : {}),
      ...(pricingModel ? { pricingModel } : {}),
      ...(archetypeId ? { archetypeIds: { has: archetypeId } } : {}),
    ...(query.trim() ? {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { shortDescription: { contains: query, mode: "insensitive" } },
        { tags: { has: query.toLowerCase() } },
      ],
    } : {}),
    },
    select: {
      id: true, name: true, vendor: true, slug: true,
      shortDescription: true, category: true, pricingModel: true,
      rating: true, ratingCount: true, installCount: true, isVerified: true,
      documentationUrl: true, logoUrl: true, archetypeIds: true,
    },
    orderBy: [{ isVerified: "desc" }, { installCount: "desc" }],
    take: limit,
  });
}

// ─── Schedule management ───────────────────────────────────────────────────────

export async function updateMcpCatalogSchedule(schedule: ScheduleValue): Promise<void> {
  await requireManageIntegrations();
  const nextRunAt = schedule === "disabled" ? null : computeNextRunAt(schedule, new Date());
  await prisma.scheduledJob.upsert({
    where: { jobId: "mcp-catalog-sync" },
    create: {
      jobId: "mcp-catalog-sync",
      name: "MCP Integrations Catalog Sync",
      schedule,
      nextRunAt,
    },
    update: { schedule, nextRunAt },
  });
}

// ─── Scheduled execution (called from page server component) ──────────────────

export async function runMcpCatalogSyncIfDue(): Promise<void> {
  const job = await prisma.scheduledJob.findUnique({ where: { jobId: "mcp-catalog-sync" } });
  if (!job || job.schedule === "disabled" || !job.nextRunAt || job.nextRunAt > new Date()) return;
  const running = await prisma.mcpCatalogSync.findFirst({ where: { status: "running" } });
  if (running) return;
  const sync = await prisma.mcpCatalogSync.create({ data: { triggeredBy: "schedule" } });
  await prisma.scheduledJob.update({
    where: { jobId: "mcp-catalog-sync" },
    data: { lastRunAt: new Date(), lastStatus: "running" },
  });
  void runMcpCatalogSync(sync.id).then(async () => {
    await prisma.scheduledJob.update({
      where: { jobId: "mcp-catalog-sync" },
      data: { lastStatus: "completed", nextRunAt: computeNextRunAt(job.schedule, new Date()) },
    }).catch(() => {});
  }).catch(() => {});
}
