import { describe, expect, it } from "vitest";
import { applySectionTextPatch, editableSectionTextFields, readSectionText } from "./section-text";

describe("storefront section text (BI-C279E20B)", () => {
  it("offers exactly the keys the public renderers read", () => {
    expect(editableSectionTextFields("about").map((f) => f.key)).toEqual(["body"]);
    expect(editableSectionTextFields("hero").map((f) => f.key)).toEqual(["headline", "subheading"]);
    expect(editableSectionTextFields("items")).toEqual([]);
  });

  it("merges text into existing content and keeps other keys", () => {
    const result = applySectionTextPatch({
      type: "about",
      content: { imageUrl: "/a.png" },
      text: { body: "  We run our own business on the platform.  " },
    });
    expect(result).toEqual({ ok: true, data: { imageUrl: "/a.png", body: "We run our own business on the platform." } });
  });

  it("clears a field when the owner empties it, so the renderer default shows", () => {
    const result = applySectionTextPatch({ type: "hero", content: { headline: "Old" }, text: { headline: "" } });
    expect(result).toEqual({ ok: true, data: {} });
  });

  it("refuses keys the section does not render, non-text values, overlong text and sections without text", () => {
    expect(applySectionTextPatch({ type: "about", content: {}, text: { imageUrl: "x" } }).ok).toBe(false);
    expect(applySectionTextPatch({ type: "about", content: {}, text: { body: 5 } }).ok).toBe(false);
    expect(applySectionTextPatch({ type: "hero", content: {}, text: { headline: "x".repeat(121) } }).ok).toBe(false);
    expect(applySectionTextPatch({ type: "items", content: {}, text: { body: "x" } }).ok).toBe(false);
    expect(applySectionTextPatch({ type: "about", content: {}, text: "body" }).ok).toBe(false);
  });

  it("reads current values as strings for the editor", () => {
    expect(readSectionText("hero", { headline: "Hi", subheading: 3 })).toEqual({ headline: "Hi", subheading: "" });
    expect(readSectionText("about", null)).toEqual({ body: "" });
  });
});
