// GET /api/v1/ops/backlog — paginated list of backlog items with filters
// POST /api/v1/ops/backlog — create a new backlog item

import * as crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { createBacklogItemSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const statusFilter = url.searchParams.get("status");
    const epicIdFilter = url.searchParams.get("epicId");

    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
    }
    if (statusFilter) {
      where.status = statusFilter;
    }
    if (epicIdFilter) {
      where.epicId = epicIdFilter;
    }

    const items = await prisma.backlogItem.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take: limit + 1,
      select: {
        id: true,
        itemId: true,
        title: true,
        status: true,
        type: true,
        body: true,
        priority: true,
        epicId: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        agentId: true,
        submittedBy: { select: { email: true } },
        epic: {
          select: { id: true, epicId: true, title: true },
        },
        digitalProduct: {
          select: { id: true, productId: true, name: true },
        },
        taxonomyNode: {
          select: { id: true, nodeId: true, name: true },
        },
      },
    });

    return apiSuccess(buildPaginatedResponse(items, limit));
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
    const parsed = createBacklogItemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const { title, body: itemBody, type, epicId, priority } = parsed.data;

    const item = await prisma.backlogItem.create({
      data: {
        itemId: `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        title: title.trim(),
        type,
        status: "open",
        priority: priority ?? null,
        epicId: epicId ?? null,
        submittedById: user.id,
        ...(itemBody !== undefined && { body: itemBody.trim() || null }),
      },
    });

    return apiSuccess(item, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
