// @exposure public

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { readActivationProfile } from "@dpf/storefront-templates";

import { auth } from "@/lib/auth";
import {
  ResourceCommandError,
  createAdminResource,
  listAdminResources,
  type AdminResourceClient,
  type ManagedResourceProfile,
} from "@/lib/resource-scheduling/admin-resource-repository";

const HOUSING_KINDS = new Set(["kennel", "foster-home"]);

async function housingContext(): Promise<{
  organizationId: string;
  storefrontId: string;
  profiles: ManagedResourceProfile[];
} | null> {
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      organizationId: true,
      archetype: { select: { activationProfile: true } },
    },
  });
  const profile = readActivationProfile(config?.archetype.activationProfile);
  if (!config || !profile?.processProfile.housesSubjects) return null;
  const profiles = profile.processProfile.resourceKinds.filter(
    (kind) => HOUSING_KINDS.has(kind.kindSlug) && kind.capacityUnit === "animals",
  );
  return profiles.length > 0
    ? { organizationId: config.organizationId, storefrontId: config.id, profiles }
    : null;
}

function failure(error: unknown) {
  if (error instanceof ResourceCommandError) {
    const status = error.code === "resource_conflict" ? 409 : error.code === "resource_not_found" ? 404 : 400;
    return NextResponse.json({ code: error.code, message: error.message }, { status });
  }
  throw error;
}

async function requireAdmin() {
  const session = await auth();
  return session?.user && (session.user as { type?: string }).type === "admin";
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ code: "unauthorized", message: "Unauthorized" }, { status: 401 });
  }
  const context = await housingContext();
  if (!context) {
    return NextResponse.json({ code: "housing_not_configured", message: "Housing is not configured." }, { status: 404 });
  }
  const resources = await listAdminResources({
    db: prisma as unknown as AdminResourceClient,
    organizationId: context.organizationId,
    domain: "care",
    profiles: context.profiles,
  });
  return NextResponse.json({ resources, resourceKinds: context.profiles });
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ code: "unauthorized", message: "Unauthorized" }, { status: 401 });
  }
  const context = await housingContext();
  if (!context) {
    return NextResponse.json({ code: "housing_not_configured", message: "Housing is not configured." }, { status: 404 });
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const resource = await createAdminResource({
      db: prisma as unknown as AdminResourceClient,
      organizationId: context.organizationId,
      storefrontId: context.storefrontId,
      domain: "care",
      profiles: context.profiles,
      command: {
        label: String(body.label ?? ""),
        kindSlug: String(body.kindSlug ?? ""),
        serviceArea: typeof body.serviceArea === "string" ? body.serviceArea : null,
        capacity: Number(body.capacity),
        idempotencyKey: String(body.idempotencyKey ?? ""),
      },
    });
    return NextResponse.json({ resource }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
