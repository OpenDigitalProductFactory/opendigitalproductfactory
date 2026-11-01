/** Remove only a metadata field, never ownership or unrelated extensions.
 * Legacy object-shaped JSON is retained; unrecognised scalars cannot be erased.
 * @param {unknown} value
 * @param {readonly string[]} fields
 * @returns {unknown[]}
 */
export function withoutScopeMetadataFields(value, fields) {
  if (value == null) return [];
  const entries = Array.isArray(value) ? value
    : typeof value === "object" ? [value] : null;
  if (!entries) throw new Error("Unrecognised scope claims cannot be overwritten.");
  return entries.flatMap(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || !fields.some(field => Object.hasOwn(entry, field))) return [entry];
    const rest = Object.fromEntries(Object.entries(entry).filter(([field]) => !fields.includes(field)));
    return Object.keys(rest).some(field => !["recordedAt", "source", "declaredByUserId"].includes(field)) ? [rest] : [];
  });
}
