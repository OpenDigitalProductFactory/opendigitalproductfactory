// @exposure authenticated
// POST /api/v1/customer-sites/:siteId/location/device-confirmation
// A staff member checked in at a job confirms the site's location from where
// they are (BI-C318C227 §2.2). Only on their tap, one fix; the point is stored
// as the site's location and nowhere else.

import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@dpf/db";
import type { SiteLocationConfirmationInput } from "@dpf/types";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { apiError, toRouteErrorResponse } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { decideSiteLocationConfirmation } from "@/lib/api/site-location-confirmation";
import { resolveWorkItemSites } from "@/lib/api/work-item-site-resolution";
import { replaceableByDeviceWhere } from "@/lib/geocoding/provenance";

function readBody(raw: unknown): SiteLocationConfirmationInput {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (
    typeof body.workItemId !== "string" || !body.workItemId ||
    typeof body.latitude !== "number" || typeof body.longitude !== "number" ||
    typeof body.accuracyMeters !== "number"
  ) {
    throw apiError("VALIDATION_ERROR", "Body must be { workItemId, latitude, longitude, accuracyMeters, confirmFar? }", 422);
  }
  return {
    workItemId: body.workItemId,
    latitude: body.latitude,
    longitude: body.longitude,
    accuracyMeters: body.accuracyMeters,
    confirmFar: body.confirmFar === true,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);
    const { siteId } = await params;
    const input = readBody(await request.json().catch(() => null));

    const job = await prisma.workItem.findUnique({
      where: { itemId: input.workItemId },
      select: { assignedToUserId: true, status: true, sourceType: true, sourceId: true },
    });
    if (!job) throw apiError("NOT_FOUND", "Work item not found", 404);
    const assignedToCaller = job.assignedToUserId === user.id;
    const jobSites = assignedToCaller ? await resolveWorkItemSites({ sourceType: job.sourceType, sourceId: job.sourceId }) : [];

    const site = await prisma.customerSite.findFirst({
      where: { id: siteId, mergedIntoId: null },
      select: {
        name: true,
        accountId: true,
        primaryAddressId: true,
        primaryAddress: { select: { latitude: true, longitude: true, validationSource: true } },
      },
    });
    const address = site?.primaryAddress ?? null;

    const decision = decideSiteLocationConfirmation({
      job: { assignedToCaller, status: job.status },
      siteOnJob: Boolean(site) && jobSites.some((s) => s.id === siteId),
      address: {
        exists: Boolean(address),
        latitude: address?.latitude == null ? null : Number(address.latitude),
        longitude: address?.longitude == null ? null : Number(address.longitude),
        validationSource: address?.validationSource ?? null,
      },
      fix: { latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters },
      confirmFar: input.confirmFar === true,
    });
    if (decision.status === "refused") {
      const status = decision.reason === "not-assigned" || decision.reason === "site-not-on-job" ? 403 : 409;
      return NextResponse.json({ code: "SITE_LOCATION_REFUSED", ...decision }, { status });
    }

    // Conditional on the stored point still being replaceable, so a pin or
    // another confirmation made meanwhile wins.
    const written = await prisma.address.updateMany({
      where: { id: site!.primaryAddressId!, ...replaceableByDeviceWhere() },
      data: {
        latitude: decision.latitude,
        longitude: decision.longitude,
        validatedAt: new Date(),
        validationSource: "device-confirmed",
      },
    });
    if (written.count === 0) {
      return NextResponse.json({ code: "SITE_LOCATION_REFUSED", status: "refused", reason: "already-confirmed" }, { status: 409 });
    }
    await prisma.activity.create({
      data: {
        activityId: `ACT-${crypto.randomUUID()}`,
        type: "system",
        subject: `Location of customer site "${site!.name}" confirmed on site`,
        body: `Confirmed from the phone at check-in on job ${input.workItemId}.`,
        accountId: site!.accountId,
        contactId: null,
        opportunityId: null,
        createdById: user.id,
      },
    });
    return apiSuccess(decision);
  } catch (e) {
    return toRouteErrorResponse(e);
  }
}
