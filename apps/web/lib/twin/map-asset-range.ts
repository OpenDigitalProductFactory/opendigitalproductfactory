export type MapAssetRangeResult =
  | { status: "full"; start: 0; end: number; length: number }
  | { status: "partial"; start: number; end: number; length: number }
  | { status: "unsatisfiable"; reason: string };

const BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

export function resolveMapAssetRange(
  rangeHeader: string | null,
  byteLength: number,
): MapAssetRangeResult {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new RangeError("Map asset length must be a positive safe integer.");
  }
  if (rangeHeader === null) {
    return { status: "full", start: 0, end: byteLength - 1, length: byteLength };
  }
  if (rangeHeader.includes(",")) {
    return { status: "unsatisfiable", reason: "Multiple byte ranges are not supported." };
  }
  const match = BYTE_RANGE.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) {
    return { status: "unsatisfiable", reason: "Byte range syntax is invalid." };
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { status: "unsatisfiable", reason: "Byte range suffix is invalid." };
    }
    const length = Math.min(suffixLength, byteLength);
    return { status: "partial", start: byteLength - length, end: byteLength - 1, length };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : byteLength - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= byteLength ||
    requestedEnd < start
  ) {
    return { status: "unsatisfiable", reason: "Byte range is outside the asset." };
  }
  const end = Math.min(requestedEnd, byteLength - 1);
  return { status: "partial", start, end, length: end - start + 1 };
}
