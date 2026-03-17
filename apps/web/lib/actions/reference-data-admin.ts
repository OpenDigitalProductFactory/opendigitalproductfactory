"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { WorkforceActionResult } from "./workforce";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkLocationAddressInput = {
  label: string;
  addressLine1: string;
  addressLine2?: string | null;
  cityId: string;
  postalCode: string;
};

const VALID_LABELS = ["home", "work", "billing", "shipping", "headquarters", "site"];

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function requireAdminCapability(): Promise<WorkforceActionResult | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { ok: false, message: "Unauthorized" };
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_admin")) {
    return { ok: false, message: "Unauthorized" };
  }
  return null;
}

function revalidateAdminPaths(): void {
  revalidatePath("/admin/reference-data");
  revalidatePath("/employee");
}

// ─── Toggle Country Status ───────────────────────────────────────────────────

export async function toggleCountryStatus(id: string): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const country = await prisma.country.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!country) return { ok: false, message: "Country not found." };

  const newStatus = country.status === "active" ? "inactive" : "active";
  await prisma.country.update({ where: { id }, data: { status: newStatus } });

  revalidateAdminPaths();
  return { ok: true, message: `Country "${country.name}" is now ${newStatus}.` };
}

// ─── Update Region ───────────────────────────────────────────────────────────

export async function updateRegion(
  id: string,
  data: { name?: string; code?: string },
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const updateData: Record<string, string> = {};

  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) return { ok: false, message: "Region name cannot be empty." };
    updateData.name = trimmed;
  }

  if (data.code !== undefined) {
    updateData.code = data.code.trim();
  }

  const region = await prisma.region.findUnique({ where: { id }, select: { id: true } });
  if (!region) return { ok: false, message: "Region not found." };

  await prisma.region.update({ where: { id }, data: updateData });

  revalidateAdminPaths();
  return { ok: true, message: "Region updated." };
}

// ─── Toggle Region Status ────────────────────────────────────────────────────

export async function toggleRegionStatus(id: string): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const region = await prisma.region.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!region) return { ok: false, message: "Region not found." };

  const newStatus = region.status === "active" ? "inactive" : "active";
  await prisma.region.update({ where: { id }, data: { status: newStatus } });

  revalidateAdminPaths();
  return { ok: true, message: `Region "${region.name}" is now ${newStatus}.` };
}

// ─── Update City ─────────────────────────────────────────────────────────────

export async function updateCity(
  id: string,
  data: { name?: string },
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) return { ok: false, message: "City name cannot be empty." };

    const city = await prisma.city.findUnique({ where: { id }, select: { id: true } });
    if (!city) return { ok: false, message: "City not found." };

    await prisma.city.update({ where: { id }, data: { name: trimmed } });
  }

  revalidateAdminPaths();
  return { ok: true, message: "City updated." };
}

// ─── Toggle City Status ──────────────────────────────────────────────────────

export async function toggleCityStatus(id: string): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const city = await prisma.city.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!city) return { ok: false, message: "City not found." };

  const newStatus = city.status === "active" ? "inactive" : "active";
  await prisma.city.update({ where: { id }, data: { status: newStatus } });

  revalidateAdminPaths();
  return { ok: true, message: `City "${city.name}" is now ${newStatus}.` };
}

// ─── Link Work Location Address ──────────────────────────────────────────────

export async function linkWorkLocationAddress(
  locationId: string,
  addressData: WorkLocationAddressInput,
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  // Validate required fields
  const label = addressData.label.trim();
  const addressLine1 = addressData.addressLine1.trim();
  const cityId = addressData.cityId.trim();
  const postalCode = addressData.postalCode.trim();

  if (!label) return { ok: false, message: "Label is required." };
  if (!VALID_LABELS.includes(label)) {
    return { ok: false, message: `Invalid label. Must be one of: ${VALID_LABELS.join(", ")}.` };
  }
  if (!addressLine1) return { ok: false, message: "Address line 1 is required." };
  if (!cityId) return { ok: false, message: "City is required." };
  if (!postalCode) return { ok: false, message: "Postal code is required." };

  const location = await prisma.workLocation.findUnique({ where: { id: locationId }, select: { id: true } });
  if (!location) return { ok: false, message: "Work location not found." };

  await prisma.$transaction(async (tx) => {
    const address = await tx.address.create({
      data: {
        label,
        addressLine1,
        addressLine2: addressData.addressLine2?.trim() || null,
        cityId,
        postalCode,
        status: "active",
      },
    });

    await tx.workLocation.update({
      where: { id: locationId },
      data: { addressId: address.id },
    });
  });

  revalidateAdminPaths();
  return { ok: true, message: "Address linked to work location." };
}

// ─── Unlink Work Location Address ────────────────────────────────────────────

export async function unlinkWorkLocationAddress(
  locationId: string,
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const location = await prisma.workLocation.findUnique({
    where: { id: locationId },
    select: { id: true, addressId: true },
  });
  if (!location) return { ok: false, message: "Work location not found." };
  if (!location.addressId) return { ok: false, message: "Work location has no linked address." };

  const addressId = location.addressId;

  await prisma.$transaction(async (tx) => {
    await tx.workLocation.update({
      where: { id: locationId },
      data: { addressId: null },
    });

    await tx.address.update({
      where: { id: addressId },
      data: { status: "inactive" },
    });
  });

  revalidateAdminPaths();
  return { ok: true, message: "Address unlinked and soft-deleted." };
}
