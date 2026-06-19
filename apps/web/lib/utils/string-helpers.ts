// apps/web/lib/utils/string-helpers.ts
//
// String utilities for displaying long values (file paths, SHA hashes, IDs)
// readably in the UI by eliding the middle. Pure and stateless — safe to reuse
// across API routes, server code, and components.

const ELLIPSIS = "…";

/**
 * Truncate a string to `maxLength`, keeping the beginning and end visible and
 * replacing the middle with a single ellipsis character ('…'). Returns the
 * input unchanged when it already fits within `maxLength`.
 *
 * @param str - the string to truncate
 * @param maxLength - maximum length of the result (must be >= 1)
 * @returns the middle-elided string, or `str` when it already fits
 * @throws {Error} when `maxLength` is less than 1
 *
 * @example
 * truncateMiddle("abcdefghij", 7); // "abc…hij"
 * truncateMiddle("abc", 10);        // "abc"
 * truncateMiddle("abc", 1);         // "…"
 */
export function truncateMiddle(str: string, maxLength: number): string {
  if (maxLength <= 0) {
    throw new Error("maxLength must be greater than 0");
  }
  if (str.length <= maxLength) {
    return str;
  }
  // No room for any surrounding characters — collapse to the ellipsis itself.
  if (maxLength <= ELLIPSIS.length) {
    return ELLIPSIS;
  }

  // Reserve one slot for the ellipsis and split the rest between head and tail,
  // giving the extra character (odd budgets) to the tail.
  const available = maxLength - ELLIPSIS.length;
  const headLength = Math.floor(available / 2);
  const tailLength = available - headLength;

  return `${str.slice(0, headLength)}${ELLIPSIS}${str.slice(str.length - tailLength)}`;
}
