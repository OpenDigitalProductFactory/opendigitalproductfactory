// Platform form-kit — field→control selection (EP-UX-SYSTEM, BI-C167C45E).
// Spec: docs/superpowers/specs/2026-07-28-platform-forms-framework-design.md
//
// One deterministic mapping from a form field's declared type to the editing
// control that renders it, so every form sizes controls to the content the same
// way instead of forcing everything through a single-line <input>. Pure and
// UI-library-agnostic; components consume the returned kind.

/** A field as the form kernel consumes it — adapted from the owning surface's
 * column/field metadata (e.g. a Workbooks ColumnDefinition). */
export interface FormFieldSpec {
  fieldId: string;
  label: string;
  /** Owning surface's field type (form-kit interprets the common vocabulary). */
  fieldType: string;
  editable: boolean;
  required?: boolean;
  /** Text fields: prefer a multi-line editor regardless of current length. */
  multiline?: boolean;
  /** select fields: the allowed options. */
  options?: Array<{ key: string; label: string }>;
}

/** The control vocabulary form components render. */
export type FormControlKind =
  | "longtext" // auto-growing textarea, starts single-line
  | "text" // single-line semantic input (url/email/phone)
  | "number"
  | "checkbox"
  | "select"
  | "date"
  | "datetime"
  | "readonly";

/** Field types stored as plain numbers (mirrors workbooks NUMERIC_FIELD_TYPES). */
const NUMBER_KINDS = new Set(["number", "currency", "percent", "progress", "rating", "duration"]);

/** Single-line by semantics: the value is an address-like token, never prose. */
const SINGLE_LINE_TEXT_KINDS = new Set(["url", "email", "phone"]);

/**
 * Resolve the editing control for a field. Free text always gets the
 * auto-growing editor (a one-row textarea behaves like an input but grows with
 * content — the Airtable/Linear record-form pattern), so long descriptions are
 * never trapped in a truncated single line.
 */
export function resolveControlKind(field: FormFieldSpec): FormControlKind {
  if (!field.editable) return "readonly";
  if (field.fieldType === "text") return "longtext";
  if (SINGLE_LINE_TEXT_KINDS.has(field.fieldType)) return "text";
  if (NUMBER_KINDS.has(field.fieldType)) return "number";
  if (field.fieldType === "checkbox") return "checkbox";
  if (field.fieldType === "select") return "select";
  if (field.fieldType === "date") return "date";
  if (field.fieldType === "datetime") return "datetime";
  // Complex kinds (reference, link, multi_select, image, attachment) and
  // computed kinds (formula, lookup, rollup) stay read-only in forms for now;
  // the spec's adoption path covers promoting them to real editors.
  return "readonly";
}

/** HTML input type for the single-line semantic text kinds. */
export function inputTypeFor(fieldType: string): string {
  if (fieldType === "url") return "url";
  if (fieldType === "email") return "email";
  if (fieldType === "phone") return "tel";
  return "text";
}
