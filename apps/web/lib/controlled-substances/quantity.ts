/**
 * Exact controlled-substance quantities (EP-CSC-CUSTODY).
 *
 * Ledger quantities are Decimal(18,4) in the database. Arithmetic here is done
 * on bigint ten-thousandths so a balance never drifts by a floating-point
 * fraction of a millilitre.
 */

export const QUANTITY_SCALE = 4;
const FACTOR = 10n ** BigInt(QUANTITY_SCALE);

/** A quantity in ten-thousandths of the product's base unit. */
export type Quantity = bigint;

export class QuantityFormatError extends Error {
  constructor(value: unknown) {
    super(`Not a valid quantity: ${String(value)}`);
    this.name = "QuantityFormatError";
  }
}

/** Parse a decimal string, number or Prisma Decimal (anything with toString). */
export function parseQuantity(value: string | number | { toString(): string }): Quantity {
  const text = typeof value === "string" ? value.trim() : value.toString();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new QuantityFormatError(value);
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > QUANTITY_SCALE && /[1-9]/.test(fraction.slice(QUANTITY_SCALE))) {
    throw new QuantityFormatError(value);
  }
  const scaled = BigInt(whole) * FACTOR + BigInt(fraction.slice(0, QUANTITY_SCALE).padEnd(QUANTITY_SCALE, "0"));
  return sign ? -scaled : scaled;
}

/** Canonical fixed-scale string, e.g. "-2.5000". Used in hashes and writes. */
export function formatQuantity(quantity: Quantity): string {
  const negative = quantity < 0n;
  const magnitude = negative ? -quantity : quantity;
  const whole = magnitude / FACTOR;
  const fraction = (magnitude % FACTOR).toString().padStart(QUANTITY_SCALE, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
