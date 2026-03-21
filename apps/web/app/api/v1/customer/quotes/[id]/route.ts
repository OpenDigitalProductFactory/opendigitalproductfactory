// GET   /api/v1/customer/quotes/:id — quote detail with line items + version history
// PATCH /api/v1/customer/quotes/:id — revise, send, accept, reject

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { reviseQuote, sendQuote, acceptQuote, rejectQuote } from "@/lib/actions/crm.js";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        lineItems: { orderBy: { sortOrder: "asc" }, include: { product: { select: { id: true, productId: true, name: true } } } },
        opportunity: { select: { id: true, opportunityId: true, title: true, stage: true } },
        account: { select: { id: true, accountId: true, name: true } },
        createdBy: { select: { id: true, email: true } },
        previous: { select: { id: true, quoteNumber: true, version: true, status: true } },
        revisions: { select: { id: true, quoteNumber: true, version: true, status: true }, orderBy: { version: "desc" } },
        salesOrder: { select: { id: true, orderRef: true, status: true } },
      },
    });

    if (!quote) throw apiError("NOT_FOUND", "Quote not found", 404);
    return apiSuccess(quote);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);
    const { id } = await params;
    const body = await request.json();

    switch (body.action) {
      case "revise": {
        const revised = await reviseQuote(id, user.id);
        return apiSuccess(revised);
      }
      case "send": {
        const sent = await sendQuote(id, user.id);
        return apiSuccess(sent);
      }
      case "accept": {
        const result = await acceptQuote(id, user.id);
        return apiSuccess(result);
      }
      case "reject": {
        const rejected = await rejectQuote(id, { reason: body.reason, userId: user.id });
        return apiSuccess(rejected);
      }
      default:
        return NextResponse.json(
          { code: "VALIDATION_ERROR", message: "Unknown action. Use: revise, send, accept, reject" },
          { status: 422 },
        );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("not found")) {
      return NextResponse.json({ code: "NOT_FOUND", message: e.message }, { status: 404 });
    }
    if (e instanceof Error && e.message.includes("already")) {
      return NextResponse.json({ code: "CONFLICT", message: e.message }, { status: 409 });
    }
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
