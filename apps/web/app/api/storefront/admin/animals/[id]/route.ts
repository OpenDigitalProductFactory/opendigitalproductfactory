// Storefront admin: adoptable-animal item.
//   PUT    /api/storefront/admin/animals/:id  -> update
//   DELETE /api/storefront/admin/animals/:id  -> delete (also detaches photos)

import { NextResponse, type NextRequest } from "next/server";
import { prisma, type Prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { deleteMediaForOwner } from "@/lib/media";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function isAdmin(session: { user?: unknown } | null): boolean {
  return Boolean(session?.user && (session.user as { type?: string }).type === "admin");
}

type UpdateAnimalBody = {
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

export async function PUT(req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!isAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const existing = await prisma.adoptableAnimal.findUnique({
    where: { id },
    select: { id: true, status: true, publishedAt: true, adoptedAt: true },
  });
  if (!existing) return NextResponse.json({ error: "Animal not found" }, { status: 404 });

  const body = (await req.json()) as UpdateAnimalBody;
  const data: Record<string, unknown> = {};
  if (body.name != null) data.name = body.name.trim();
  if (body.species !== undefined) data.species = body.species;
  if (body.breed !== undefined) data.breed = body.breed;
  if (body.age !== undefined) data.age = body.age;
  if (body.sex !== undefined) data.sex = body.sex;
  if (body.size !== undefined) data.size = body.size;
  if (body.description !== undefined) data.description = body.description;
  if (body.attributes !== undefined) {
    data.attributes = body.attributes ? (body.attributes as Prisma.InputJsonValue) : undefined;
  }

  if (body.status != null && body.status !== existing.status) {
    data.status = body.status;
    // First time it becomes available, stamp publishedAt; when adopted, stamp adoptedAt.
    if (body.status === "available" && !existing.publishedAt) data.publishedAt = new Date();
    if (body.status === "adopted" && !existing.adoptedAt) data.adoptedAt = new Date();
  }

  const animal = await prisma.adoptableAnimal.update({ where: { id }, data });
  return NextResponse.json(animal);
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!isAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const existing = await prisma.adoptableAnimal.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Animal not found" }, { status: 404 });

  // Detach photos (polymorphic join has no owner FK), then delete the row.
  await deleteMediaForOwner("AdoptableAnimal", id);
  await prisma.adoptableAnimal.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
