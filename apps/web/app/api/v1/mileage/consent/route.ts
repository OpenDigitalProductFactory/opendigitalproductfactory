// GET  /api/v1/mileage/consent — the driver's current capture consent.
// POST /api/v1/mileage/consent — record an explicit grant.
//
// Consent is its own endpoint rather than a field on the driver because the
// app must be able to ask "may I capture?" before it captures anything, and
// because the grant/revoke history is the lawful-basis evidence for every drive.

// @exposure authenticated

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { requireDriverProfileId } from "@/lib/api/mileage";
import { newId } from "@/lib/shared/new-id";
import type { GrantMileageConsentRequest, MileageConsentState } from "@dpf/types";

function toState(row: {
  consentStatus: string;
  policyVersion: string;
  retentionDays: number;
  grantedAt: Date | null;
} | null): MileageConsentState {
  if (!row) {
    return { consentStatus: "pending", policyVersion: null, retentionDays: null, grantedAt: null };
  }
  return {
    consentStatus: row.consentStatus as MileageConsentState["consentStatus"],
    policyVersion: row.policyVersion,
    retentionDays: row.retentionDays,
    grantedAt: row.grantedAt ? row.grantedAt.toISOString() : null,
  };
}

export async function GET(request: Request) {
  try {
    const { user } = await authenticateRequest(request);
    const driverId = await requireDriverProfileId(user.id);
    const row = await prisma.driverLocationConsent.findFirst({
      where: { employeeProfileId: driverId },
      orderBy: { updatedAt: "desc" },
      select: { consentStatus: true, policyVersion: true, retentionDays: true, grantedAt: true },
    });
    return apiSuccess(toState(row));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await authenticateRequest(request);
    const driverId = await requireDriverProfileId(user.id);
    const body = (await request.json()) as GrantMileageConsentRequest;

    if (!body.policyVersion || typeof body.policyVersion !== "string") {
      throw new ApiError("INVALID_POLICY_VERSION", "A disclosure version is required.", 400);
    }

    const org = await prisma.organization.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!org) throw new ApiError("NO_ORGANIZATION", "No organization exists.", 409);

    // Keyed on (driver, policyVersion): a changed disclosure needs a fresh
    // grant rather than silently inheriting the old one.
    const row = await prisma.driverLocationConsent.upsert({
      where: {
        employeeProfileId_policyVersion: {
          employeeProfileId: driverId,
          policyVersion: body.policyVersion,
        },
      },
      create: {
        driverLocationConsentId: `DLC-${newId()}`,
        organizationId: org.id,
        employeeProfileId: driverId,
        consentStatus: "granted",
        grantedAt: new Date(),
        policyVersion: body.policyVersion,
      },
      update: { consentStatus: "granted", grantedAt: new Date(), revokedAt: null },
      select: { consentStatus: true, policyVersion: true, retentionDays: true, grantedAt: true },
    });

    return apiSuccess(toState(row), 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
