"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import type { WorkforceActionResult } from "./workforce";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AddressInput = {
  employeeProfileId: string;
  label: string;
  addressLine1: string;
  addressLine2?: string | null;
  cityId: string;
  postalCode: string;
  isPrimary: boolean;
};

const VALID_LABELS = ["home", "work", "billing", "shipping", "headquarters", "site"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function denied(message: string): WorkforceActionResult {
  return { ok: false, message };
}

function isValidLabel(label: string): boolean {
  return (VALID_LABELS as readonly string[]).includes(label);
}

// ---------------------------------------------------------------------------
// createEmployeeAddress
// ---------------------------------------------------------------------------

export async function createEmployeeAddress(input: AddressInput): Promise<WorkforceActionResult> {
  if (!isValidLabel(input.label)) {
    return denied(`Invalid label. Must be one of: ${VALID_LABELS.join(", ")}`);
  }
  if (!input.addressLine1.trim()) {
    return denied("Address line 1 is required.");
  }
  if (!input.cityId.trim()) {
    return denied("City is required.");
  }
  if (!input.postalCode.trim()) {
    return denied("Postal code is required.");
  }

  await prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.employeeAddress.updateMany({
        where: { employeeProfileId: input.employeeProfileId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const address = await tx.address.create({
      data: {
        label: input.label,
        addressLine1: input.addressLine1.trim(),
        addressLine2: input.addressLine2?.trim() || null,
        cityId: input.cityId,
        postalCode: input.postalCode.trim(),
      },
    });

    await tx.employeeAddress.create({
      data: {
        employeeProfileId: input.employeeProfileId,
        addressId: address.id,
        isPrimary: input.isPrimary,
      },
    });
  });

  revalidatePath("/employee");
  return { ok: true, message: "Address created." };
}

// ---------------------------------------------------------------------------
// updateAddress
// ---------------------------------------------------------------------------

export async function updateAddress(
  addressId: string,
  data: Partial<Pick<AddressInput, "label" | "addressLine1" | "addressLine2" | "cityId" | "postalCode">>,
): Promise<WorkforceActionResult> {
  if (data.label !== undefined && !isValidLabel(data.label)) {
    return denied(`Invalid label. Must be one of: ${VALID_LABELS.join(", ")}`);
  }

  await prisma.address.update({
    where: { id: addressId },
    data,
  });

  revalidatePath("/employee");
  return { ok: true, message: "Address updated." };
}

// ---------------------------------------------------------------------------
// deleteEmployeeAddress
// ---------------------------------------------------------------------------

export async function deleteEmployeeAddress(employeeAddressId: string): Promise<WorkforceActionResult> {
  const link = await prisma.employeeAddress.findUnique({
    where: { id: employeeAddressId },
    select: { id: true, addressId: true },
  });

  if (!link) {
    return denied("Employee address link not found.");
  }

  await prisma.employeeAddress.delete({ where: { id: employeeAddressId } });
  await prisma.address.update({
    where: { id: link.addressId },
    data: { status: "inactive" },
  });

  revalidatePath("/employee");
  return { ok: true, message: "Address deleted." };
}

// ---------------------------------------------------------------------------
// setPrimaryAddress
// ---------------------------------------------------------------------------

export async function setPrimaryAddress(employeeAddressId: string): Promise<WorkforceActionResult> {
  const link = await prisma.employeeAddress.findUnique({
    where: { id: employeeAddressId },
    select: { id: true, employeeProfileId: true },
  });

  if (!link) {
    return denied("Employee address link not found.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.employeeAddress.updateMany({
      where: { employeeProfileId: link.employeeProfileId, isPrimary: true },
      data: { isPrimary: false },
    });

    await tx.employeeAddress.update({
      where: { id: employeeAddressId },
      data: { isPrimary: true },
    });
  });

  revalidatePath("/employee");
  return { ok: true, message: "Primary address updated." };
}
