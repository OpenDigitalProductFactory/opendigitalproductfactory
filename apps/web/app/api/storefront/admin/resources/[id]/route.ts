// @exposure public

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { readActivationProfile } from "@dpf/storefront-templates";

import { auth } from "@/lib/auth";
import {
  ResourceCommandError,
  updateAdminResource,
  type AdminResourceClient,
} from "@/lib/resource-scheduling/admin-resource-repository";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ code: "unauthorized", message: "Unauthorized" }, { status: 401 });
  }
  const config = await prisma.storefrontConfig.findFirst({
    select: { organizationId: true, archetype: { select: { activationProfile: true } } },
  });
  const activation = readActivationProfile(config?.archetype.activationProfile);
  const profiles = activation?.processProfile.resourceKinds.filter(
    (kind) => ["kennel", "foster-home"].includes(kind.kindSlug) && kind.capacityUnit === "animals",
  ) ?? [];
  if (!config || profiles.length === 0) {
    return NextResponse.json({ code: "housing_not_configured", message: "Housing is not configured." }, { status: 404 });
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { id } = await params;
    const resource = await updateAdminResource({
      db: prisma as unknown as AdminResourceClient,
      organizationId: config.organizationId,
      domain: "care",
      profiles,
      resourceId: id,
      command: {
        expectedVersion: Number(body.expectedVersion),
        ...(body.label === undefined ? {} : { label: String(body.label) }),
        ...(body.capacity === undefined ? {} : { capacity: Number(body.capacity) }),
        ...(body.serviceArea === undefined
          ? {}
          : { serviceArea: typeof body.serviceArea === "string" ? body.serviceArea : null }),
        ...(body.blockedReason === undefined
          ? {}
          : { blockedReason: typeof body.blockedReason === "string" ? body.blockedReason : null }),
        ...(body.lifecycle === "active" || body.lifecycle === "retired"
          ? { lifecycle: body.lifecycle }
          : {}),
        idempotencyKey: String(body.idempotencyKey ?? ""),
      },
    });
    return NextResponse.json({ resource });
  } catch (error) {
    if (error instanceof ResourceCommandError) {
      const status = error.code === "resource_conflict" ? 409 : error.code === "resource_not_found" ? 404 : 400;
      return NextResponse.json({ code: error.code, message: error.message }, { status });
    }
    throw error;
  }
}
