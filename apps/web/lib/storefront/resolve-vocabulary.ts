export function resolveVocabularyKey(input: {
  archetypeCategory?: string | null;
  industry?: string | null;
}): string | null {
  return input.archetypeCategory || input.industry || null;
}
