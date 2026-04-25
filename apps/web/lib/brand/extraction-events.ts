export type BrandExtractionEvent =
  | { type: "brand:extract.progress"; taskRunId: string; stage: string; message: string; percent: number }
  | { type: "brand:extract.complete"; taskRunId: string; summary: string }
  | { type: "brand:extract.failed"; taskRunId: string; error: string };

export function coerceBrandExtractionEvent(
  event: { type: string; taskRunId?: string } & Record<string, unknown>,
  activeTaskRunId: string | null,
): BrandExtractionEvent | null {
  if (
    event.type !== "brand:extract.progress"
    && event.type !== "brand:extract.complete"
    && event.type !== "brand:extract.failed"
  ) {
    return null;
  }

  if (typeof event.taskRunId !== "string" || event.taskRunId.length === 0) {
    return null;
  }

  if (activeTaskRunId && activeTaskRunId.length > 0 && event.taskRunId !== activeTaskRunId) {
    return null;
  }

  return event as BrandExtractionEvent;
}
