import type { PriorityClass } from "./reference-model-types.js";

export function normalizePriorityClass(text: string | null | undefined): PriorityClass | null {
  const value = text?.trim().toLowerCase() ?? "";
  if (value.startsWith("must ") || value.startsWith("shall ")) return "required";
  if (value.startsWith("should ")) return "recommended";
  if (value.startsWith("may ")) return "optional";
  return null;
}

export function slugifyReferenceModelName(name: string, version: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const normalizedVersion = version
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${base}_v${normalizedVersion}`;
}
