// Platform form-kit — dirty-state kernel (EP-UX-SYSTEM, BI-C167C45E).
// Spec: docs/superpowers/specs/2026-07-28-platform-forms-framework-design.md
//
// The one commit model every record-editing form composes: edits accumulate in
// a draft, the caller decides when the draft becomes real (Save) or is thrown
// away (Discard). No field commits on blur. Pure and UI-library-agnostic so the
// same kernel serves the Workbooks record modal, settings pages, and admin CRUD
// forms without re-inventing per-surface save semantics.

/** A form's values keyed by field id. Values are opaque to the kernel. */
export type FormValues = Record<string, unknown>;

export interface FormDraftState {
  /** Last saved/loaded values — what Discard returns to. */
  readonly baseline: FormValues;
  /** Current on-screen values, including unsaved edits. */
  readonly draft: FormValues;
}

/**
 * Value equality for dirty detection. Primitives compare with Object.is;
 * arrays/objects compare structurally (JSON round-trip — form values are plain
 * data by contract). `undefined` and `null` are treated as the same "empty".
 */
export function formValuesEqual(a: unknown, b: unknown): boolean {
  const na = a === undefined ? null : a;
  const nb = b === undefined ? null : b;
  if (Object.is(na, nb)) return true;
  if (typeof na !== "object" || typeof nb !== "object" || na === null || nb === null) {
    return false;
  }
  try {
    return JSON.stringify(na) === JSON.stringify(nb);
  } catch {
    return false;
  }
}

/** Start a form session from the record's current values. */
export function initFormState(values: FormValues): FormDraftState {
  return { baseline: { ...values }, draft: { ...values } };
}

/** Apply one field edit to the draft. Never mutates. */
export function withFieldEdit(
  state: FormDraftState,
  fieldId: string,
  value: unknown,
): FormDraftState {
  return { baseline: state.baseline, draft: { ...state.draft, [fieldId]: value } };
}

/** Field ids whose draft value differs from the baseline. */
export function dirtyFieldIds(state: FormDraftState): string[] {
  const ids = new Set([...Object.keys(state.baseline), ...Object.keys(state.draft)]);
  return [...ids].filter((id) => !formValuesEqual(state.baseline[id], state.draft[id]));
}

export function isFormDirty(state: FormDraftState): boolean {
  return dirtyFieldIds(state).length > 0;
}

/** The dirty subset of the draft — what Save should persist. */
export function dirtyValues(state: FormDraftState): FormValues {
  const out: FormValues = {};
  for (const id of dirtyFieldIds(state)) out[id] = state.draft[id] ?? null;
  return out;
}

/** Discard: the draft snaps back to the baseline. */
export function discarded(state: FormDraftState): FormDraftState {
  return { baseline: state.baseline, draft: { ...state.baseline } };
}

/** Commit: the draft becomes the new baseline (call after persistence succeeds). */
export function committed(state: FormDraftState): FormDraftState {
  return { baseline: { ...state.draft }, draft: { ...state.draft } };
}

/**
 * Refresh from outside (e.g. the row re-loaded): new baseline, but unsaved
 * edits on still-dirty fields are preserved so a background refresh cannot
 * silently eat what the user is typing.
 */
export function rebaselined(state: FormDraftState, values: FormValues): FormDraftState {
  const dirty = new Set(dirtyFieldIds(state));
  const draft: FormValues = { ...values };
  for (const id of dirty) draft[id] = state.draft[id];
  return { baseline: { ...values }, draft };
}
