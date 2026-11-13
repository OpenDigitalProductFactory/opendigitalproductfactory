/**
 * Legacy issued-hash serialization, moved unchanged from routing/metadata-hash.
 * It intentionally retains JSON.stringify/toJSON/integer-key semantics. New
 * composition records use the shared canonical JSON home and another version.
 */
export function serializeLegacyMetadata(rawMetadata: unknown): string | undefined {
  return JSON.stringify(rawMetadata, sortReplacer);
}
function sortReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((sorted, k) => {
        sorted[k] = (value as Record<string, unknown>)[k];
        return sorted;
      }, {});
  }
  return value;
}
export type LegacyModelBinding = {
  default_model_id: string | null; pinned_provider_id: string | null; pinned_model_id: string | null;
  minimum_tier: string | null; budget_class: string | null; execution_type: string | null;
  temperature: number | null; max_tokens: number | null;
};
export function deriveLegacyPromptClassRefs(skills: Array<{ label: string; taskType: string | null }>): string[] {
  return skills.map(skill => `${skill.taskType ?? "conversation"}:${skill.label}`).sort();
}
/** Inputs must already carry canonical host-resolved grants; this creates no grants. */
export function legacyOperatingProfileMaterial(input: { modelBinding: LegacyModelBinding; grantKeys: string[];
  promptClassRefs: string[]; hitlDefault: number; sensitivity: string }) {
  return { hitl_default: input.hitlDefault, model_binding: input.modelBinding,
    prompt_class_refs: [...input.promptClassRefs].sort(), sensitivity: input.sensitivity,
    tool_grants_sorted: [...input.grantKeys].sort() };
}
