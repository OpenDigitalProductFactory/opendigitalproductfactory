import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isBoundedTrustedJson } from "../bounded-trusted-json.js";
import { DECISION_SCOPES, type DecisionScope } from "../decision-scopes.js";

export const COMPOSITION_VERSION = "operating-composition/0.1" as const;
/** Existing trusted-reference fields, with the digest mandatory for this contract. */
export type CompositionReference = { id: string; version: string; digest: string };
export type OperatingComposition = { schemaVersion: typeof COMPOSITION_VERSION;
  subjectRef: CompositionReference; principalRef: CompositionReference; jobRef: CompositionReference;
  roleRef: CompositionReference; supervisionRef: CompositionReference; instructions: CompositionReference[];
  skills: CompositionReference[]; models: CompositionReference[]; tools: CompositionReference[];
  doctrine: { scope: DecisionScope; profileRef: CompositionReference }[];
  memoryPolicyRef: CompositionReference; configurationRef: CompositionReference;
  harnessRef: CompositionReference; runtimeRef: CompositionReference };
export type CompositionDiagnostic = { code: string; path: string };
export type BuiltComposition = { ok: true; value: OperatingComposition; compositionRef: CompositionReference; canonicalization: "dpf-canonical-json/v1" } | { ok: false; diagnostics: CompositionDiagnostic[] };
export const COMPOSITION_LIMITS = { references: 64, instructions: 128, text: 512 } as const;
export const sameCompositionReference = (a: CompositionReference, b: CompositionReference): boolean =>
  a.id === b.id && a.version === b.version && a.digest === b.digest;
export const isCompositionRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function isCompositionReference(value: unknown): value is CompositionReference {
  return isCompositionRecord(value) && hasExactKeys(value, ["id", "version", "digest"])
    && [value.id, value.version].every(v => typeof v === "string" && v.trim().length > 0 && v.length <= COMPOSITION_LIMITS.text)
    && typeof value.digest === "string" && /^sha256:[a-f0-9]{64}$/.test(value.digest);
}
const oneRefs = ["subjectRef", "principalRef", "jobRef", "roleRef", "supervisionRef", "memoryPolicyRef", "configurationRef", "harnessRef", "runtimeRef"] as const;
const manyRefs = ["instructions", "skills", "models", "tools"] as const;
const compareRefs = (a: CompositionReference, b: CompositionReference): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Structural composition only. The host resolves effective bytes, revisions and authority. */
export function buildOperatingComposition(value: unknown, digest: (text: string) => string): BuiltComposition {
  const diagnostics: CompositionDiagnostic[] = [];
  const issue = (code: string, path: string) => { if (diagnostics.length < 32) diagnostics.push({ code, path }); };
  if (!isBoundedTrustedJson(value)) return { ok: false, diagnostics: [{ code: "input-limit", path: "" }] };
  if (!isCompositionRecord(value) || !hasExactKeys(value, ["schemaVersion", ...oneRefs, ...manyRefs, "doctrine"]))
    return { ok: false, diagnostics: [{ code: "invalid-structure", path: "" }] };
  if (value.schemaVersion !== COMPOSITION_VERSION) issue("unsupported-version", "schemaVersion");
  for (const key of oneRefs) if (!isCompositionReference(value[key])) issue("invalid-reference", key);
  if (isCompositionReference(value.subjectRef) && `operating-composition:${value.subjectRef.id}`.length > COMPOSITION_LIMITS.text)
    issue("composition-id-limit", "subjectRef.id");
  for (const key of manyRefs) {
    const refs = value[key], max = key === "instructions" ? COMPOSITION_LIMITS.instructions : COMPOSITION_LIMITS.references;
    if (!Array.isArray(refs) || refs.length > max || (["instructions", "models"].includes(key) && refs.length === 0)) { issue("invalid-collection", key); continue; }
    if (!refs.every(isCompositionReference)) issue("invalid-reference", key);
    else if (new Set(refs.map(ref => ref.id)).size !== refs.length) issue("duplicate-reference", key);
  }
  if (!Array.isArray(value.doctrine) || value.doctrine.length === 0 || value.doctrine.length > DECISION_SCOPES.length) issue("invalid-doctrine", "doctrine");
  else {
    const scopes = new Set();
    for (const item of value.doctrine) {
      if (!isCompositionRecord(item) || !hasExactKeys(item, ["scope", "profileRef"]) || !DECISION_SCOPES.some(scope => scope === item.scope)
        || !isCompositionReference(item.profileRef)) issue("invalid-doctrine", "doctrine");
      else if (scopes.has(item.scope)) issue("duplicate-scope", "doctrine");
      else scopes.add(item.scope);
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  const snapshot = JSON.parse(JSON.stringify(value)) as OperatingComposition;
  // Order is meaningful for instructions; the remaining reference sets are keyed by id.
  for (const key of ["skills", "models", "tools"] as const) snapshot[key].sort(compareRefs);
  snapshot.doctrine.sort((a, b) => a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0);
  try {
    const hash = digest(canonicalJson(snapshot));
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid digest port output");
    return { ok: true, value: snapshot, canonicalization: "dpf-canonical-json/v1", compositionRef: {
      id: `operating-composition:${snapshot.subjectRef.id}`, version: COMPOSITION_VERSION, digest: `sha256:${hash}`,
    } };
  } catch { return { ok: false, diagnostics: [{ code: "digest-unavailable", path: "" }] }; }
}
