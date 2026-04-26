export function normalizeLocalityName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function namesAreExactNormalizedMatch(left: string, right: string): boolean {
  return normalizeLocalityName(left) === normalizeLocalityName(right);
}
