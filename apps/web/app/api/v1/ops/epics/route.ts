// GET /api/v1/ops/epics — paginated list of epics with portfolios and items
// POST /api/v1/ops/epics — create a new epic

import * as crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { createEpicSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const scopeKindFilter = url.searchParams.get("scopeKind");
    const archetypeCategoryFilter = url.searchParams.get("archetypeCategory");
    const archetypeIdFilter = url.searchParams.get("archetypeId");
    const lifecycleTagFilter = url.searchParams.get("lifecycleTag");

    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
    }
    if (scopeKindFilter) {
      where.scopeKind = scopeKindFilter;
    }
    if (archetypeCategoryFilter) {
      where.archetypeCategories = { has: archetypeCategoryFilter };
    }
    if (archetypeIdFilter) {
      where.archetypeIds = { has: archetypeIdFilter };
    }
    if (lifecycleTagFilter) {
      where.lifecycleTags = { has: lifecycleTagFilter };
    }

    const epics = await prisma.epic.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: limit + 1,
      select: {
        id: true,
        epicId: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        agentId: true,
        scopeKind: true,
        archetypeCategories: true,
        archetypeIds: true,
        scopeRationale: true,
        lifecycleTags: true,
        submittedBy: { select: { email: true } },
        portfolios: {
          select: {
            epicId: true,
            portfolioId: true,
            portfolio: { select: { id: true, slug: true, name: true } },
          },
        },
        items: {
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            itemId: true,
            title: true,
            status: true,
            type: true,
            priority: true,
            epicId: true,
            scopeKind: true,
            archetypeCategories: true,
            archetypeIds: true,
            scopeRationale: true,
            lifecycleTags: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return apiSuccess(buildPaginatedResponse(epics, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await authenticateRequest(request);

    const body = await request.json();
    const parsed = createEpicSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const {
      title,
      description,
      portfolioIds,
      scopeKind,
      archetypeCategories,
      archetypeIds,
      scopeRationale,
      lifecycleTags,
    } = parsed.data;

    // Check for similar existing epics before creating
    let similarEpics: Array<{ epicId: string; title: string; status: string; score: number }> = [];
    try {
      const { searchPlatformKnowledge } = await import("@/lib/semantic-memory");
      const searchText = `${title} ${description ?? ""}`.trim();
      const search = await searchPlatformKnowledge({ query: searchText, entityType: "epic", limit: 5 });
      // BI-339C441F: an unavailable search is not "no similar epics". The
      // overlap list stays empty either way, but the outage gets said out loud
      // instead of passing for a clean check.
      if (search.status === "unavailable") {
        console.warn(
          `[ops/epics] overlap check skipped — semantic search unavailable (${search.reason}).`,
        );
      }
      const hits = search.results;
      if (hits.length > 0) {
        const epicRows = await prisma.epic.findMany({
          where: { epicId: { in: hits.map((h) => h.entityId) } },
          select: { epicId: true, title: true, status: true },
        });
        const rowMap = new Map(epicRows.map((r) => [r.epicId, r]));
        similarEpics = hits
          .filter((h) => rowMap.has(h.entityId))
          .map((h) => {
            const row = rowMap.get(h.entityId)!;
            return { epicId: row.epicId, title: row.title, status: row.status, score: h.score };
          });
      }
    } catch {
      // Semantic search unavailable — proceed without overlap check
    }

    const epic = await prisma.$transaction(async (tx) => {
      const created = await tx.epic.create({
        data: {
          epicId: `EP-${crypto.randomUUID()}`,
          title: title.trim(),
          status: "open",
          submittedById: user.id,
          ...(description !== undefined && { description: description.trim() || null }),
          scopeKind: scopeKind ?? null,
          archetypeCategories: archetypeCategories ?? [],
          archetypeIds: archetypeIds ?? [],
          scopeRationale: scopeRationale?.trim() || null,
          lifecycleTags: lifecycleTags ?? [],
        },
      });

      if (portfolioIds.length > 0) {
        await tx.epicPortfolio.createMany({
          data: portfolioIds.map((portfolioId) => ({
            epicId: created.id,
            portfolioId,
          })),
        });
      }

      // Index in platform knowledge for semantic search
      import("@/lib/semantic-memory").then(({ storePlatformKnowledge }) =>
        storePlatformKnowledge({
          entityId: created.epicId,
          entityType: "epic",
          title,
          content: description ?? "",
        })
      ).catch(() => {});

      return created;
    });

    return apiSuccess({ ...epic, similarEpics }, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
