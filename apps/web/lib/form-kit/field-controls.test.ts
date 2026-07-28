import { describe, expect, it } from "vitest";
import { inputTypeFor, resolveControlKind, type FormFieldSpec } from "./field-controls";

function field(fieldType: string, overrides: Partial<FormFieldSpec> = {}): FormFieldSpec {
  return { fieldId: "f1", label: "Field", fieldType, editable: true, ...overrides };
}

describe("resolveControlKind", () => {
  it("gives free text the auto-growing editor, always", () => {
    expect(resolveControlKind(field("text"))).toBe("longtext");
    expect(resolveControlKind(field("text", { multiline: true }))).toBe("longtext");
  });

  it("keeps semantic token fields single-line with the right input type", () => {
    for (const t of ["url", "email", "phone"]) {
      expect(resolveControlKind(field(t))).toBe("text");
    }
    expect(inputTypeFor("url")).toBe("url");
    expect(inputTypeFor("email")).toBe("email");
    expect(inputTypeFor("phone")).toBe("tel");
    expect(inputTypeFor("text")).toBe("text");
  });

  it("maps the numeric family to the number control", () => {
    for (const t of ["number", "currency", "percent", "progress", "rating", "duration"]) {
      expect(resolveControlKind(field(t))).toBe("number");
    }
  });

  it("maps checkbox, select, date, datetime to their controls", () => {
    expect(resolveControlKind(field("checkbox"))).toBe("checkbox");
    expect(resolveControlKind(field("select"))).toBe("select");
    expect(resolveControlKind(field("date"))).toBe("date");
    expect(resolveControlKind(field("datetime"))).toBe("datetime");
  });

  it("keeps complex and computed kinds read-only", () => {
    for (const t of ["reference", "link", "multi_select", "image", "attachment", "formula", "lookup", "rollup"]) {
      expect(resolveControlKind(field(t))).toBe("readonly");
    }
  });

  it("never edits a non-editable field regardless of type", () => {
    expect(resolveControlKind(field("text", { editable: false }))).toBe("readonly");
  });
});
