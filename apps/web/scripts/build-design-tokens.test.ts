// BI-CD81FF7C (EP-UX-SYSTEM L0) — generator contract.
// Companion to design/tokens-utilities.test.ts: that test proves the output COMPILES,
// this one proves the output is deterministic and that the committed CSS is fresh, which
// is what the CI --check gate enforces (build-route-manifest.ts precedent).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { generate, kebab, shadow, dim } from "./build-design-tokens";

const GENERATED = resolve(__dirname, "../app/tokens.generated.css");

describe("design-token generator (BI-CD81FF7C)", () => {
  it("is deterministic — a regeneration with no token change is byte-identical", () => {
    // Byte stability is what keeps the --check gate from firing on unrelated PRs.
    expect(generate()).toBe(generate());
  });

  it("the committed CSS is in sync with the DTCG source", () => {
    // This is the assertion `pnpm --filter web check:design-tokens` makes in CI.
    expect(readFileSync(GENERATED, "utf8")).toBe(generate());
  });

  it("marks the output as generated so nobody hand-edits it", () => {
    expect(generate()).toContain("GENERATED FILE — DO NOT EDIT");
    expect(generate()).toContain("apps/web/design/tokens.json");
  });

  it("kebab-cases camelCase token keys", () => {
    expect(kebab("bodyLg")).toBe("body-lg");
    expect(kebab("body")).toBe("body");
    expect(kebab("2xs")).toBe("2xs");
  });

  it("formats DTCG dimensions with their unit", () => {
    expect(dim({ value: 16, unit: "px" })).toBe("16px");
    expect(dim({ value: 0.875, unit: "rem" })).toBe("0.875rem");
  });

  it("omits a zero spread from shadow values", () => {
    const base = { color: "rgba(0, 0, 0, 0.15)", offsetX: { value: 0, unit: "px" }, offsetY: { value: 1, unit: "px" }, blur: { value: 2, unit: "px" } };
    expect(shadow({ ...base, spread: { value: 0, unit: "px" } })).toBe("0px 1px 2px rgba(0, 0, 0, 0.15)");
    expect(shadow({ ...base, spread: { value: 3, unit: "px" } })).toBe("0px 1px 2px 3px rgba(0, 0, 0, 0.15)");
  });

  it("emits density as cascading properties, not @theme entries", () => {
    const css = generate();
    // Shells set data-dpf-density on a subtree; @theme cannot express that.
    expect(css).toMatch(/\[data-dpf-density="compact"\]/);
    expect(css).toMatch(/\[data-dpf-density="comfortable"\]/);
    const theme = css.slice(css.indexOf("@theme {"), css.indexOf("\n}"));
    expect(theme).not.toContain("--dpf-density-");
  });

  it("keeps every color alias pointing at its hand-authored --dpf-* property", () => {
    // The aliases must never inline a literal color: dark mode and runtime
    // BrandingConfig both override the --dpf-* properties, not the aliases.
    const aliasLines = generate()
      .split("\n")
      .filter((l) => l.trim().startsWith("--color-dpf-"));
    expect(aliasLines.length).toBeGreaterThan(0);
    for (const line of aliasLines) {
      expect(line, `alias must forward to a --dpf-* property: ${line}`).toMatch(
        /--color-dpf-[a-z0-9-]+:\s*var\(--dpf-[a-z0-9-]+\);/,
      );
    }
  });
});
