import type { WorkCaseSourceRef } from "./case-types";

export function roomText(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function roomStrings(
  values: readonly string[] | undefined,
): string[] {
  return values?.map((value) => value.trim()).filter(Boolean) ?? [];
}

export function dedupeRoomSourceRefs(
  refs: readonly WorkCaseSourceRef[],
): WorkCaseSourceRef[] {
  const keyed = new Map<string, WorkCaseSourceRef>();
  for (const ref of refs) {
    keyed.set(`${ref.kind}:${ref.sourceType ?? ""}:${ref.id}`, ref);
  }
  return [...keyed.values()];
}
