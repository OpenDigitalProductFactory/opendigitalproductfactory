import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { hashPassword } from "@/lib/password";
import { nanoid } from "nanoid";
import {
  customerAccountNormalizedColumns,
  customerContactNormalizedColumns,
} from "@/lib/mdm/dedup-gate";
import { registerCustomerAccountSource } from "@/lib/mdm/crosswalk";

export async function POST(req: NextRequest) {
  const body = await req.json() as { name?: string; email?: string; password?: string; orgSlug?: string };
  const { name, email, password } = body;

  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  // Check if email already exists in CustomerContact
  const existing = await prisma.customerContact.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  // Create CustomerAccount and CustomerContact in a transaction
  const createdAccountId = await prisma.$transaction(async (tx) => {
    const account = await tx.customerAccount.create({
      data: {
        accountId: `CA-${nanoid(10)}`,
        name: name ?? email,
        ...customerAccountNormalizedColumns({ name: name ?? email }),
        status: "prospect",
      },
    });

    await tx.customerContact.create({
      data: {
        email,
        name: name ?? null,
        ...customerContactNormalizedColumns({ name: name ?? null }),
        passwordHash,
        accountId: account.id,
        isActive: true,
      },
    });
    return account.id;
  });

  await registerCustomerAccountSource({
    accountId: createdAccountId,
    sourceSystem: "storefront-signup",
    sourceEntityId: email,
  });

  return NextResponse.json({ success: true });
}
