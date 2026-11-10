export type WorkCaseKeyRef = { sourceType: string; sourceId: string };

export function encodeWorkCaseKey(ref: WorkCaseKeyRef): string {
  return encodeURIComponent(`${ref.sourceType}:${ref.sourceId}`);
}

export function decodeWorkCaseKey(caseKey: string): WorkCaseKeyRef | null {
  const decoded = decodeURIComponent(caseKey);
  const separator = decoded.indexOf(":");
  if (separator <= 0 || separator === decoded.length - 1) return null;
  return {
    sourceType: decoded.slice(0, separator),
    sourceId: decoded.slice(separator + 1),
  };
}
