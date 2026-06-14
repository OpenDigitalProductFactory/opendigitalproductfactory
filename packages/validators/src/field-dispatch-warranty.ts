import { z } from "zod";

// Field Dispatch — warranty-aware service (domain nuance).
//
// Installed equipment carries warranty terms that differ BY COMPONENT and BY
// COVERAGE TYPE. The canonical field-service example: an AC compressor commonly
// has a 10-year PARTS warranty but no LABOR coverage — so a compressor failure in
// year 7 means the part is free to the customer (the contractor may reclaim its
// cost from the manufacturer separately) while the labor is billed. The
// dispatcher and the field technician need this at quote/invoice time, and the
// field invoice must classify each line as covered vs. billable.
//
// Pure: coverage is a function of install date, failure date, and per-component
// terms. See docs/superpowers/specs/2026-06-14-field-dispatch-mobile-contract-
// and-warranty-design.html (R-warranty) and the Field Dispatch capability design.

/** Warranty terms for one component of an installed unit. Parts and labor are
 *  covered for different durations. */
export const warrantyComponentSchema = z.object({
  /** e.g. "compressor", "coil", "heat-exchanger", "control-board", "part", "labor". */
  component: z.string().min(1),
  partsWarrantyMonths: z.number().int().nonnegative(),
  laborWarrantyMonths: z.number().int().nonnegative(),
  source: z.enum(["manufacturer", "contractor", "extended"]),
});
export type WarrantyComponent = z.infer<typeof warrantyComponentSchema>;

/** The warranty profile of an installed unit (a CustomerConfigurationItem sidecar). */
export const equipmentWarrantySchema = z.object({
  installDateIso: z.string().min(1),
  components: z.array(warrantyComponentSchema),
});
export type EquipmentWarranty = z.infer<typeof equipmentWarrantySchema>;

export interface WarrantyAssessment {
  component: string;
  ageMonths: number;
  partsCovered: boolean;
  laborCovered: boolean;
  note: string;
}

function parseDateMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`warranty: unparseable date "${iso}"`);
  return ms;
}

/** Whole calendar months elapsed between two ISO dates (UTC), floored at 0. */
export function warrantyAgeMonths(installDateIso: string, atDateIso: string): number {
  const from = new Date(parseDateMs(installDateIso));
  const to = new Date(parseDateMs(atDateIso));
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Assess parts/labor coverage for a component failing on `atDateIso`. A component
 * with no terms on file defaults to NOT covered — conservative: bill the customer
 * and flag for review rather than silently waive a charge.
 */
export function assessWarranty(equipment: EquipmentWarranty, component: string, atDateIso: string): WarrantyAssessment {
  const ageMonths = warrantyAgeMonths(equipment.installDateIso, atDateIso);
  const terms = equipment.components.find((c) => c.component === component);
  if (!terms) {
    return { component, ageMonths, partsCovered: false, laborCovered: false, note: "no warranty terms on file for this component" };
  }
  const partsCovered = ageMonths <= terms.partsWarrantyMonths;
  const laborCovered = ageMonths <= terms.laborWarrantyMonths;
  const note =
    partsCovered && laborCovered
      ? "parts and labor covered"
      : partsCovered
        ? "part covered; labor billable"
        : "out of warranty — billable";
  return { component, ageMonths, partsCovered, laborCovered, note };
}

/** A line on a field-service invoice, before warranty classification. */
export interface ServiceLine {
  kind: "part" | "labor";
  /** The component this line relates to, for warranty lookup. Omit for general labor/parts. */
  component?: string;
  description: string;
  amount: number;
}

export interface ClassifiedServiceLine extends ServiceLine {
  covered: boolean;
  /** Amount billed to the customer after warranty (0 when covered). */
  billedAmount: number;
  reason: string;
}

/**
 * Classify field-invoice lines against the equipment warranty. A part covered by
 * the parts warranty bills $0 to the customer; labor bills unless labor is
 * covered. Lines with no `component` are always billable. The classified lines
 * feed the DPF invoice (F12) — covered parts become $0 customer lines (with the
 * manufacturer-claim handled separately).
 */
export function classifyServiceLines(
  equipment: EquipmentWarranty,
  lines: ServiceLine[],
  atDateIso: string,
): ClassifiedServiceLine[] {
  return lines.map((line) => {
    if (!line.component) {
      return { ...line, covered: false, billedAmount: line.amount, reason: "no component — billable" };
    }
    const assessment = assessWarranty(equipment, line.component, atDateIso);
    const covered = line.kind === "part" ? assessment.partsCovered : assessment.laborCovered;
    return {
      ...line,
      covered,
      billedAmount: covered ? 0 : line.amount,
      reason: covered ? `${line.kind} under warranty (${assessment.note})` : `${line.kind} billable (${assessment.note})`,
    };
  });
}

/** Total the customer is actually billed after warranty classification. */
export function billableTotal(lines: ClassifiedServiceLine[]): number {
  return lines.reduce((sum, line) => sum + line.billedAmount, 0);
}

/** Defensively parse a stored equipment-warranty record (never throws). */
export function parseEquipmentWarranty(raw: unknown): EquipmentWarranty | null {
  const result = equipmentWarrantySchema.safeParse(raw);
  return result.success ? result.data : null;
}
