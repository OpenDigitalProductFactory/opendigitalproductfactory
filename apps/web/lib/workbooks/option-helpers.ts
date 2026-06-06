// Universal Grid & Workbooks — select-option helpers (EP-GRID-WORKBOOKS)
// Shared by platform adapters to turn string-enum values into grid SelectOptions.

import type { SelectOption } from "./types";

export function humanizeKey(key: string): string {
  return key
    .split(/[-_]/)
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function toOptions(values: readonly string[]): SelectOption[] {
  return values.map((v) => ({ key: v, label: humanizeKey(v) }));
}
