export function hasExactCoworkerArchetypeDeclaration(
  declarations: unknown,
  archetype: string,
): boolean {
  return Array.isArray(declarations) && declarations.some((declaration) => declaration === archetype);
}
