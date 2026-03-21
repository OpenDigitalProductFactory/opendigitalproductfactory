// GET  /api/v1/customer/contacts — paginated list with full-text search
// POST /api/v1/customer/contacts — create contact with duplicate prevention

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { createContactSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import {
  parsePagination,
  buildPaginatedResponse,
} from "@/lib/api/pagination.js";

function contactInclude() {
  return {
    accountRoles: {
      include: { account: { select: { id: true, accountId: true, name: true } } },
      orderBy: [{ isPrimary: "desc" as const }, { startedAt: "desc" as const }],
    },
  };
}

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const search = url.searchParams.get("search");
    const accountId = url.searchParams.get("accountId");

    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
    }
    if (accountId) {
      where.accountId = accountId;
    }
    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { jobTitle: { contains: search, mode: "insensitive" } },
      ];
    }

    const contacts = await prisma.customerContact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: contactInclude(),
    });

    return apiSuccess(buildPaginatedResponse(contacts, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

/** Find similar contacts for duplicate prevention */
async function findSimilarContacts(
  email: string,
  firstName?: string,
  lastName?: string,
  phone?: string,
) {
  const similar: { id: string; email: string; firstName: string | null; lastName: string | null; confidence: number; matchedOn: string }[] = [];

  // Exact email match — highest confidence
  const emailMatch = await prisma.customerContact.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (emailMatch) {
    similar.push({ ...emailMatch, confidence: 100, matchedOn: "email" });
    return similar; // Exact email = definitive duplicate
  }

  // Name match — fuzzy
  if (firstName && lastName) {
    const nameMatches = await prisma.customerContact.findMany({
      where: {
        firstName: { equals: firstName, mode: "insensitive" },
        lastName: { equals: lastName, mode: "insensitive" },
      },
      select: { id: true, email: true, firstName: true, lastName: true },
      take: 5,
    });
    for (const m of nameMatches) {
      similar.push({ ...m, confidence: 70, matchedOn: "name" });
    }
  }

  // Phone match — digit comparison
  if (phone) {
    const digitsOnly = phone.replace(/\D/g, "");
    if (digitsOnly.length >= 7) {
      const phoneMatches = await prisma.customerContact.findMany({
        where: {
          phone: { not: null },
        },
        select: { id: true, email: true, firstName: true, lastName: true, phone: true },
        take: 100, // scan for digit match
      });
      for (const m of phoneMatches) {
        if (m.phone && m.phone.replace(/\D/g, "").includes(digitsOnly)) {
          similar.push({
            id: m.id,
            email: m.email,
            firstName: m.firstName,
            lastName: m.lastName,
            confidence: 60,
            matchedOn: "phone",
          });
        }
      }
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  return similar.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);

    const body = await request.json();
    const parsed = createContactSchema.safeParse(body);
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

    const { email, firstName, lastName, phone, accountId, ...rest } =
      parsed.data;

    // Duplicate prevention: check for similar contacts
    const similarContacts = await findSimilarContacts(
      email,
      firstName,
      lastName,
      phone,
    );

    // If exact email match, reject creation
    if (similarContacts.some((s) => s.confidence === 100)) {
      return NextResponse.json(
        {
          code: "DUPLICATE_CONTACT",
          message: "A contact with this email already exists",
          similarContacts,
        },
        { status: 409 },
      );
    }

    // Verify account exists
    const account = await prisma.customerAccount.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!account) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Customer account not found" },
        { status: 404 },
      );
    }

    // Create contact + primary role in transaction
    const contact = await prisma.$transaction(async (tx) => {
      const created = await tx.customerContact.create({
        data: {
          email,
          firstName: firstName?.trim() || null,
          lastName: lastName?.trim() || null,
          name:
            firstName || lastName
              ? [firstName, lastName].filter(Boolean).join(" ").trim()
              : null,
          phone: phone?.trim() || null,
          accountId,
          ...rest,
        },
        include: contactInclude(),
      });

      // Create primary role in junction table
      await tx.contactAccountRole.create({
        data: {
          contactId: created.id,
          accountId,
          isPrimary: true,
        },
      });

      // Re-fetch with roles
      return tx.customerContact.findUniqueOrThrow({
        where: { id: created.id },
        include: contactInclude(),
      });
    });

    return apiSuccess({ contact, similarContacts }, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
