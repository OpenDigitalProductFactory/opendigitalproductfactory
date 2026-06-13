// Storefront admin: adoptable-animal collection.
//   GET  /api/storefront/admin/animals  -> list (admin view, all statuses)
//   POST /api/storefront/admin/animals  -> create
// Backs the `animals-available` section for pet-rescue / animal-shelter, which
// previously had no model. Photos attach via /api/media (ownerType=AdoptableAnimal).

import * as crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma, type Prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { listOwnerMedia } from "@/lib/media";

export const runtime = "nodejs";

function isAdmin(session: { user?: unknown } | null): boolean {
  return Boolean(session?.user && (session.user as { type?: string }).type === "admin");
}

type CreateAnimalBody = {
  name?: string;
  species?: string | null;
  breed?: string | null;
  age?: string | null;
  sex?: string | null;
  size?: string | null;
  description?: string | null;
  status?: string;
  attributes?: Record<string, unknown> | null;
};

export async function GET() {
  const session = await auth();
  if (!isAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) return NextResponse.json({ error: "No storefront configured" }, { status: 404 });

  const animals = await prisma.adoptableAnimal.findMany({
    where: { storefrontId: config.id },
    orderBy: [{ status: "asc" }, { sortOrder: "asc" }],
  });

  // Attach gallery so the admin manager can show thumbnails.
  const withMedia = await Promise.all(
    animals.map(async (a) => ({
      ...a,
      media: await listOwnerMedia("AdoptableAnimal", a.id),
    })),
  );

  return NextResponse.json({ animals: withMedia });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await prisma.storefrontConfig.findFirst({
    select: { id: true, organizationId: true },
  });
  if (!config) return NextResponse.json({ error: "No storefront configured" }, { status: 404 });

  const body = (await req.json()) as CreateAnimalBody;
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const last = await prisma.adoptableAnimal.findFirst({
    where: { storefrontId: config.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = (last?.sortOrder ?? -1) + 1;
  const animalRef = `ANML-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const status = body.status ?? "available";

  const animal = await prisma.adoptableAnimal.create({
    data: {
      animalRef,
      storefrontId: config.id,
      organizationId: config.organizationId,
      name: body.name.trim(),
      species: body.species ?? null,
      breed: body.breed ?? null,
      age: body.age ?? null,
      sex: body.sex ?? null,
      size: body.size ?? null,
      description: body.description ?? null,
      status,
      attributes: body.attributes ? (body.attributes as Prisma.InputJsonValue) : undefined,
      publishedAt: status === "available" ? new Date() : null,
      sortOrder,
    },
  });

  return NextResponse.json({ ...animal, media: [] }, { status: 201 });
}
