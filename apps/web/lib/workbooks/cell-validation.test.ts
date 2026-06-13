import { describe, it, expect } from "vitest";
import { validateCell, storageToCellValue } from "./cell-validation";
import type { FieldType } from "./types";

function col(fieldType: FieldType, extra: Partial<{ required: boolean; config: unknown }> = {}) {
  return {
    name: "Test",
    fieldType,
    required: extra.required ?? false,
    config: (extra.config as never) ?? undefined,
  };
}

describe("validateCell", () => {
  it("accepts empty for optional fields and maps to null storage", () => {
    const r = validateCell(col("text"), null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.storage.textValue).toBeNull();
  });

  it("rejects empty for required fields", () => {
    const r = validateCell(col("text", { required: true }), "");
    expect(r.ok).toBe(false);
  });

  it("stores text in textValue", () => {
    const r = validateCell(col("text"), "hello");
    expect(r.ok && r.storage.textValue).toBe("hello");
  });

  it("rejects over-long text", () => {
    const r = validateCell(col("text"), "x".repeat(10_001));
    expect(r.ok).toBe(false);
  });

  it("coerces numeric strings and rejects non-numbers", () => {
    const ok = validateCell(col("number"), "42.5");
    expect(ok.ok && ok.storage.numberValue).toBe(42.5);
    const bad = validateCell(col("number"), "not-a-number");
    expect(bad.ok).toBe(false);
    const boolBad = validateCell(col("number"), true);
    expect(boolBad.ok).toBe(false);
  });

  it("parses dates into dateValue", () => {
    const r = validateCell(col("date"), "2026-06-06");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.storage.dateValue).toBeInstanceOf(Date);
    const bad = validateCell(col("date"), "not-a-date");
    expect(bad.ok).toBe(false);
  });

  it("requires boolean for checkbox", () => {
    expect(validateCell(col("checkbox"), true).ok).toBe(true);
    expect(validateCell(col("checkbox"), "true").ok).toBe(false);
  });

  it("validates select against configured options", () => {
    const c = col("select", { config: { options: [{ key: "a", label: "A" }] } });
    expect(validateCell(c, "a").ok).toBe(true);
    expect(validateCell(c, "z").ok).toBe(false);
  });

  it("validates multi_select keys against options", () => {
    const c = col("multi_select", { config: { options: [{ key: "a", label: "A" }, { key: "b", label: "B" }] } });
    const ok = validateCell(c, ["a", "b"]);
    expect(ok.ok && ok.storage.multiSelectValue).toEqual(["a", "b"]);
    expect(validateCell(c, ["a", "z"]).ok).toBe(false);
  });

  it("validates url and email format", () => {
    expect(validateCell(col("url"), "https://example.com").ok).toBe(true);
    expect(validateCell(col("url"), "not a url").ok).toBe(false);
    expect(validateCell(col("email"), "a@b.com").ok).toBe(true);
    expect(validateCell(col("email"), "nope").ok).toBe(false);
  });

  it("stores an image URL as text and rejects non-strings", () => {
    const c = col("image");
    const ok = validateCell(c, "/api/media/abc123");
    expect(ok.ok && ok.storage.textValue).toBe("/api/media/abc123");
    expect(validateCell(c, 42 as never).ok).toBe(false);
    // empty is allowed on a non-required image column
    expect(validateCell(c, null).ok).toBe(true);
    // required image column rejects empty
    expect(validateCell(col("image", { required: true }), null).ok).toBe(false);
  });

  it("serializes an attachment {url,name,size} and rejects missing url", () => {
    const c = col("attachment");
    const ok = validateCell(c, { url: "/api/media/file1", name: "report.pdf", size: 2048 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(JSON.parse(ok.storage.textValue ?? "{}")).toEqual({
        url: "/api/media/file1",
        name: "report.pdf",
        size: 2048,
      });
    }
    // a bare URL string is accepted (external link / resilience)
    expect(validateCell(c, "/api/media/bare").ok).toBe(true);
    // an object without a url is rejected
    expect(validateCell(c, { name: "x" } as never).ok).toBe(false);
    // empty allowed when optional, rejected when required
    expect(validateCell(c, null).ok).toBe(true);
    expect(validateCell(col("attachment", { required: true }), null).ok).toBe(false);
  });

  it("requires a referenceId for reference and enforces target type", () => {
    const c = col("reference", { config: { referenceType: "epic" } });
    const ok = validateCell(c, { referenceId: "E1", referenceType: "epic" });
    expect(ok.ok && ok.storage.referenceId).toBe("E1");
    expect(validateCell(c, { referenceId: "C1", referenceType: "customer" }).ok).toBe(false);
    expect(validateCell(c, "E1" as never).ok).toBe(false);
  });
});

describe("storageToCellValue", () => {
  it("round-trips a number", () => {
    const r = validateCell(col("number"), 7);
    expect(r.ok && storageToCellValue("number", r.storage)).toBe(7);
  });

  it("returns ISO string for dates", () => {
    const r = validateCell(col("datetime"), "2026-06-06T10:00:00.000Z");
    if (r.ok) {
      const v = storageToCellValue("datetime", r.storage);
      expect(typeof v).toBe("string");
    }
  });

  it("returns empty array for multi_select with no value", () => {
    expect(storageToCellValue("multi_select", null)).toBeNull();
  });

  it("round-trips an image URL through text storage", () => {
    const r = validateCell(col("image"), "/api/media/xyz");
    expect(r.ok && storageToCellValue("image", r.storage)).toBe("/api/media/xyz");
  });

  it("round-trips an attachment value through JSON text storage", () => {
    const r = validateCell(col("attachment"), { url: "/api/media/doc", name: "spec.docx", size: 5120 });
    expect(r.ok && storageToCellValue("attachment", r.storage)).toEqual({
      url: "/api/media/doc",
      name: "spec.docx",
      size: 5120,
    });
  });

  it("treats a legacy plain-url attachment text as {url}", () => {
    expect(storageToCellValue("attachment", { textValue: "/api/media/legacy" })).toEqual({
      url: "/api/media/legacy",
    });
  });
});
