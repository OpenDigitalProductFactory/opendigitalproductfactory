// Recruiting → hiring → paying: the compensation seam.
//
// An accepted Offer carries pay terms in an untyped `Offer.compensation` JSON
// blob. When a candidate is hired, those terms must land on the EmployeeProfile
// comp columns that payroll reads (lib/hr/labor-service.ts#compensationFromEmployee),
// so a new hire is immediately PAYABLE with no re-keying. Today the hire-landing
// paths (Greenhouse land-hire, and the future native offer-accept) write identity
// only, so a hire lands with no comp and getEmployeePayrollEarnings returns
// `no-compensation`. This module is that missing connective tissue.
//
// Single source of truth: the offer's typed comp IS the payroll `Compensation`
// discriminated union (lib/hr/labor.ts) — recruiting does not fork the contract.
// Both hire paths (Greenhouse and native P4) use this one mapper, so the spine
// stays seamless regardless of where the hire originates.

import { z } from "zod";
import type { Compensation } from "@/lib/hr/labor";

/**
 * The EmployeeProfile compensation columns, exactly as
 * lib/hr/labor-service.ts#compensationFromEmployee reads them back. A hire that
 * writes these is payable by getEmployeePayrollEarnings.
 */
export interface EmployeeCompensationColumns {
  payType: "hourly" | "salary";
  hourlyRate?: number;
  annualSalary?: number;
  standardAnnualHours?: number;
}

const HourlyOfferCompSchema = z.object({
  payType: z.literal("hourly"),
  hourlyRate: z.number().finite().nonnegative(),
});

const SalaryOfferCompSchema = z.object({
  payType: z.literal("salary"),
  annualSalary: z.number().finite().nonnegative(),
  standardAnnualHours: z.number().finite().positive().optional(),
});

// Structurally the payroll Compensation union; validated at the Offer boundary.
const OfferCompensationSchema = z.discriminatedUnion("payType", [
  HourlyOfferCompSchema,
  SalaryOfferCompSchema,
]);

/**
 * Validate the untyped `Offer.compensation` JSON into a payroll `Compensation`.
 * Returns null when absent, incomplete, or malformed — a hire with no usable
 * comp still lands (unpaid) rather than throwing; comp can be entered later via
 * setEmployeeCompensation. Extra keys (currency, notes) are ignored, not fatal.
 */
export function parseOfferCompensation(json: unknown): Compensation | null {
  if (json == null || typeof json !== "object") return null;
  const parsed = OfferCompensationSchema.safeParse(json);
  return parsed.success ? (parsed.data as Compensation) : null;
}

/**
 * Map a payroll `Compensation` to the EmployeeProfile comp columns a hire writes.
 * Round-trips with compensationFromEmployee: the columns produced here, read back
 * by payroll, reconstruct the same Compensation — the seam invariant that makes a
 * fresh hire payable.
 */
export function offerCompensationToEmployeeColumns(
  comp: Compensation,
): EmployeeCompensationColumns {
  if (comp.payType === "hourly") {
    return { payType: "hourly", hourlyRate: comp.hourlyRate };
  }
  return {
    payType: "salary",
    annualSalary: comp.annualSalary,
    ...(comp.standardAnnualHours != null
      ? { standardAnnualHours: comp.standardAnnualHours }
      : {}),
  };
}

/**
 * Convenience: untyped Offer.compensation JSON → EmployeeProfile comp columns,
 * or null when the offer carries no usable comp. This is what a hire-landing
 * path spreads into its EmployeeProfile create.
 */
export function offerCompensationColumns(
  json: unknown,
): EmployeeCompensationColumns | null {
  const comp = parseOfferCompensation(json);
  return comp ? offerCompensationToEmployeeColumns(comp) : null;
}
