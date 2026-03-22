// packages/db/src/sanitized-clone.ts
// Sanitized clone pipeline -- copies production data to dev with PII obfuscation.
// Classification driven by table-classification.ts.

import { getTableSensitivity } from "./table-classification";

// -- Obfuscation Helpers --

export function obfuscateName(_original: string | null, index: number): string {
  return `Dev User ${String(index).padStart(3, "0")}`;
}

export function obfuscateEmail(_original: string | null, index: number): string {
  return `dev${String(index).padStart(3, "0")}@dpf.test`;
}

export function obfuscatePhone(_original: string | null, index: number): string {
  return `555-${String(index).padStart(4, "0")}`;
}

/** PII field names that should be obfuscated in confidential tables */
const PII_FIELDS: Record<string, (val: string | null, idx: number) => string> = {
  name: obfuscateName,
  displayName: obfuscateName,
  firstName: obfuscateName,
  lastName: obfuscateName,
  email: obfuscateEmail,
  phone: obfuscatePhone,
  contactEmail: obfuscateEmail,
  contactPhone: obfuscatePhone,
};

export { PII_FIELDS };

export function obfuscateField(
  value: string | null | undefined,
  fieldName: string,
  index: number,
): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const fn = PII_FIELDS[fieldName];
  return fn ? fn(value, index) : value;
}

// -- Table Classification Helpers --

export function shouldCopyTable(tableName: string): boolean {
  const s = getTableSensitivity(tableName);
  return s === "public" || s === "internal";
}

export function shouldObfuscateTable(tableName: string): boolean {
  return getTableSensitivity(tableName) === "confidential";
}

export function shouldSkipTable(tableName: string): boolean {
  return getTableSensitivity(tableName) === "restricted";
}
