// GET /api/v1/ops/epics — paginated list of epics with portfolios and items
// POST /api/v1/ops/epics — create a new epic

import * as crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { createEpicSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination.js";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);

    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
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

    const { title, description, portfolioIds } = parsed.data;

    const epic = await prisma.$transaction(async (tx) => {
      const created = await tx.epic.create({
        data: {
          epicId: `EP-${crypto.randomUUID()}`,
          title: title.trim(),
          status: "open",
          submittedById: user.id,
          ...(description !== undefined && { description: description.trim() || null }),
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

      return created;
    });

    return apiSuccess(epic, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
