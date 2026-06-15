// Resolve whether a NEW invoice should default to "require signature before
// payment", based on the org's portal archetype.
//
// For regulated professional-services archetypes, an engagement letter or
// service agreement customarily needs a client signature before work begins, so
// signature capture defaults ON. Everything else defaults OFF — the operator can
// still enable it per invoice. Per the Phase-1 acceptance criteria, the default
// is ON only for legal and accounting practices.
//
// Dependency-free on purpose (no prisma/@dpf/db) so it unit-tests in isolation
// and never pulls a server-only module into a client bundle. The server resolves
// the org's archetype slug and calls this.

// StorefrontArchetype.archetypeId slugs (see packages/storefront-templates).
const SIGNATURE_DEFAULT_ON_ARCHETYPES: ReadonlySet<string> = new Set([
  "legal-services",
  "accounting",
]);

/**
 * Pure resolver. Returns true when invoices for this archetype should default to
 * requiring a signature before payment.
 */
export function defaultSignatureRequiredForArchetype(
  archetypeId: string | null | undefined,
): boolean {
  return archetypeId != null && SIGNATURE_DEFAULT_ON_ARCHETYPES.has(archetypeId);
}
