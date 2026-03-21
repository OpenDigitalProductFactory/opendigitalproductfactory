// GET   /api/v1/customer/contacts/:id — contact detail with account roles
// PATCH /api/v1/customer/contacts/:id — update contact

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { updateContactSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

function contactInclude() {
  return {
    accountRoles: {
      include: {
        account: { select: { id: true, accountId: true, name: true, status: true } },
      },
      orderBy: [{ isPrimary: "desc" as const }, { startedAt: "desc" as const }],
    },
    account: { select: { id: true, accountId: true, name: true, status: true } },
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;

    const contact = await prisma.customerContact.findUnique({
      where: { id },
      include: contactInclude(),
    });

    if (!contact) {
      throw apiError("NOT_FOUND", "Contact not found", 404);
    }

    return apiSuccess(contact);
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
    const parsed = updateContactSchema.safeParse(body);
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

    const existing = await prisma.customerContact.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw apiError("NOT_FOUND", "Contact not found", 404);
    }

    const { firstName, lastName, ...rest } = parsed.data;

    // Keep legacy `name` field in sync
    const nameUpdate: Record<string, unknown> = {};
    if (firstName !== undefined || lastName !== undefined) {
      const contact = await prisma.customerContact.findUniqueOrThrow({
        where: { id },
        select: { firstName: true, lastName: true },
      });
      const fn = firstName !== undefined ? firstName : contact.firstName;
      const ln = lastName !== undefined ? lastName : contact.lastName;
      nameUpdate.name =
        fn || ln ? [fn, ln].filter(Boolean).join(" ").trim() : null;
    }

    const updated = await prisma.customerContact.update({
      where: { id },
      data: {
        ...(firstName !== undefined && { firstName: firstName.trim() || null }),
        ...(lastName !== undefined && { lastName: lastName.trim() || null }),
        ...nameUpdate,
        ...rest,
      },
      include: contactInclude(),
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
