// Owner-editable storefront section text (BI-C279E20B).
//
// Sections are seeded from archetype templates with empty content, and the
// section manager could only hide or reorder them — so the about and hero copy
// the public renderers read (AboutSection: content.body; HeroSection:
// content.headline / content.subheading) had no way to be written. This is the
// one definition of which section text an owner can edit, shared by the editor
// and the server route, so the form can never offer a field the server refuses.
//
// Pure: safe to import from client and server code.

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

/** Keys inside StorefrontSection.content that the public renderers read. Labels live in the storefront message catalog. */
export type SectionTextKey = "headline" | "subheading" | "body";

export type SectionTextField = {
  key: SectionTextKey;
  multiline: boolean;
  maxLength: number;
};

export const EDITABLE_SECTION_TEXT: Readonly<Record<string, readonly SectionTextField[]>> = {
  hero: [
    { key: "headline", multiline: false, maxLength: 120 },
    { key: "subheading", multiline: false, maxLength: 240 },
  ],
  about: [{ key: "body", multiline: true, maxLength: 2000 }],
};

export function editableSectionTextFields(type: string): readonly SectionTextField[] {
  return EDITABLE_SECTION_TEXT[type] ?? [];
}

/** The current value of each editable field, as strings, for the editor. */
export function readSectionText(type: string, content: unknown): Record<string, string> {
  const record = content && typeof content === "object" ? (content as Record<string, unknown>) : {};
  return Object.fromEntries(
    editableSectionTextFields(type).map((field) => [
      field.key,
      typeof record[field.key] === "string" ? (record[field.key] as string) : "",
    ]),
  );
}

export type SectionTextPatchResult = ActionResult<Record<string, unknown>>;

/**
 * Merge an owner's text edit into a section's existing content. Only the
 * section type's editable keys are accepted; other content (images, items) is
 * kept untouched. An empty value removes the key, so the renderer falls back to
 * its default (business name, tagline) instead of showing a blank.
 */
export function applySectionTextPatch(input: {
  type: string;
  content: unknown;
  text: unknown;
}): SectionTextPatchResult {
  const fields = editableSectionTextFields(input.type);
  if (fields.length === 0) {
    return err(`The ${input.type} section has no editable text.`);
  }
  if (!input.text || typeof input.text !== "object" || Array.isArray(input.text)) {
    return err("text must be an object of field values.");
  }
  const text = input.text as Record<string, unknown>;
  const allowed = new Map<string, SectionTextField>(fields.map((field) => [field.key, field]));
  const unknownKeys = Object.keys(text).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    return err(`Not editable on a ${input.type} section: ${unknownKeys.join(", ")}.`);
  }

  const next: Record<string, unknown> =
    input.content && typeof input.content === "object" && !Array.isArray(input.content)
      ? { ...(input.content as Record<string, unknown>) }
      : {};
  for (const [key, raw] of Object.entries(text)) {
    const field = allowed.get(key)!;
    if (typeof raw !== "string") return err(`${field.key} must be text.`);
    const value = raw.trim();
    if (value.length > field.maxLength) {
      return err(`${field.key} is limited to ${field.maxLength} characters.`);
    }
    if (value.length === 0) delete next[key];
    else next[key] = value;
  }
  return ok(next);
}
