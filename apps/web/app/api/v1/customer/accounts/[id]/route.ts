// GET  /api/v1/customer/accounts/:id — customer detail
// PATCH /api/v1/customer/accounts/:id — update customer

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { updateCustomerSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;

    const account = await prisma.customerAccount.findUnique({
      where: { id },
      include: {
        contacts: true,
        contactRoles: {
          include: { contact: true },
          orderBy: [{ isPrimary: "desc" }, { startedAt: "desc" }],
        },
        parentAccount: { select: { id: true, accountId: true, name: true } },
        childAccounts: { select: { id: true, accountId: true, name: true, status: true } },
      },
    });

    if (!account) {
      throw apiError("NOT_FOUND", "Customer account not found", 404);
    }

    return apiSuccess(account);
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
    await authenticateRequest(request);
    const { id } = await params;

    const body = await request.json();
    const parsed = updateCustomerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: "Invalid input",
          details: parsed.error.flatten(),
        },
        { status: 422 },
      );
    }

    const existing = await prisma.customerAccount.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw apiError("NOT_FOUND", "Customer account not found", 404);
    }

    const { name, ...rest } = parsed.data;

    const updated = await prisma.customerAccount.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...rest,
      },
      include: { contacts: true },
    });

    return apiSuccess(updated);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
