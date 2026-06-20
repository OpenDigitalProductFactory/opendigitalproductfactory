import { describe, expect, it } from "vitest";
import { buildAdversarialCasePrompt, parseAdversarialCases } from "./adversarial-cases";

describe("buildAdversarialCasePrompt", () => {
  it("includes acceptance criteria, changed files, and the adversarial angles", () => {
    const p = buildAdversarialCasePrompt({
      acceptanceCriteria: ["User can submit the contact form"],
      changedFiles: ["apps/web/app/contact/route.ts"],
    });
    expect(p).toContain("User can submit the contact form");
    expect(p).toContain("apps/web/app/contact/route.ts");
    expect(p).toContain("Unauthorized");
    expect(p).toContain("Malformed");
    expect(p).toContain('"cases"');
  });

  it("tolerates empty criteria / files", () => {
    const p = buildAdversarialCasePrompt({ acceptanceCriteria: [], changedFiles: [] });
    expect(p).toContain("(none provided)");
    expect(p).toContain("(unknown)");
  });

  it("includes a diff excerpt when provided", () => {
    const p = buildAdversarialCasePrompt({
      acceptanceCriteria: ["x"],
      changedFiles: ["a"],
      diffExcerpt: "DIFFTEXT",
    });
    expect(p).toContain("DIFFTEXT");
  });
});

describe("parseAdversarialCases", () => {
  it("parses a plain JSON object", () => {
    expect(parseAdversarialCases('{"cases":["a","b"]}')).toEqual(["a", "b"]);
  });

  it("parses fenced JSON", () => {
    expect(parseAdversarialCases('```json\n{"cases":["a"]}\n```')).toEqual(["a"]);
  });

  it("extracts the JSON object from surrounding prose", () => {
    expect(parseAdversarialCases('Here you go:\n{"cases":["x"]}\nthanks')).toEqual(["x"]);
  });

  it("returns [] for malformed / empty / missing-cases input", () => {
    expect(parseAdversarialCases("")).toEqual([]);
    expect(parseAdversarialCases("not json")).toEqual([]);
    expect(parseAdversarialCases('{"nope":[]}')).toEqual([]);
    expect(parseAdversarialCases('{"cases":"x"}')).toEqual([]);
  });

  it("drops empties and clamps to the max", () => {
    const many = JSON.stringify({ cases: ["a", "", "  ", "b", "c", "d", "e", "f", "g"] });
    expect(parseAdversarialCases(many)).toEqual(["a", "b", "c", "d", "e"]);
  });
});
