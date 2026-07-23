// BI-CD81FF7C (EP-UX-SYSTEM L0) — the token surface must GENERATE, not just look defined.
//
// This is the test that earns the BI. The platform already shipped a token file that
// looked correct and produced nothing: apps/web/tailwind.config.ts declared
// shadow-dpf-*, bg-dpf-* and animate-* theme entries while globals.css uses CSS-first
// `@import "tailwindcss"` with no `@config` directive, so Tailwind v4 never read it —
// leaving ~50 call sites styling themselves with class names that silently resolved to
// nothing. A structural assertion ("the @theme block contains --shadow-dpf-xs") would
// have passed against that dead config too. So this test runs the real Tailwind compiler
// over the real generated stylesheet and asserts the RULES come out the other side.
//
// It also pins the namespace trap that bit during implementation: Tailwind v4 has no
// --duration-* theme namespace, so a --duration-dpf-base entry generates no utility at
// all. Any future token added under a namespace v4 does not expose fails here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { describe, expect, it } from "vitest";

const APP_DIR = resolve(__dirname, "../app");
const GENERATED = resolve(APP_DIR, "tokens.generated.css");

/** Every utility the L0 scales promise. Grows with tokens.json — that is the point. */
const PROMISED_UTILITIES = [
  // spacing
  "p-dpf-2xs", "p-dpf-xs", "p-dpf-sm", "p-dpf-md", "p-dpf-lg", "p-dpf-xl", "p-dpf-2xl", "p-dpf-3xl",
  "gap-dpf-md", "m-dpf-lg",
  // radius
  "rounded-dpf-sm", "rounded-dpf-md", "rounded-dpf-lg", "rounded-dpf-xl",
  // elevation — the 29 pre-existing call sites depend on these exact names
  "shadow-dpf-xs", "shadow-dpf-sm", "shadow-dpf-md", "shadow-dpf-lg",
  // type
  "text-dpf-caption", "text-dpf-body", "text-dpf-body-lg", "text-dpf-title", "text-dpf-heading", "text-dpf-display",
  // weight
  "font-dpf-regular", "font-dpf-medium", "font-dpf-semibold",
  // motion (easing only — durations are plain properties by design)
  "ease-dpf-standard", "ease-dpf-out", "ease-dpf-in",
  "animate-dpf-fade-in", "animate-dpf-slide-up", "animate-dpf-scale-in",
  // color aliases
  "bg-dpf-surface-1", "text-dpf-muted", "border-dpf-border", "bg-dpf-accent-soft", "bg-dpf-state-error",
];

let probeSeq = 0;

/** Compile the generated token layer with source scanning disabled for determinism. */
async function compile(utilities: string[]): Promise<string> {
  const css = [
    `@import "tailwindcss" source(none);`,
    `@import "./tokens.generated.css";`,
    `@source inline("${utilities.join(" ")}");`,
    "",
  ].join("\n");
  const result = await postcss([tailwind()]).process(css, {
    // The dirname must stay apps/web/app so `./tokens.generated.css` resolves. The
    // FILENAME is unique per call on purpose: @tailwindcss/postcss keys its compiler
    // cache on `from`, so reusing one path lets an earlier compile's candidate set
    // leak into a later one and silently answer the wrong question. The file need
    // not exist — only its directory is used for resolution.
    from: resolve(APP_DIR, `__token-probe-${probeSeq++}.css`),
  });
  return result.css;
}

/** Tailwind escapes the class selector (e.g. .p-dpf-2xl stays literal; : and / do not appear here). */
function hasRule(css: string, utility: string): boolean {
  return new RegExp(`\\.${utility.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`).test(css);
}

describe("L0 design tokens generate real Tailwind utilities (BI-CD81FF7C)", () => {
  it("emits a CSS rule for every utility the token scales promise", async () => {
    const css = await compile(PROMISED_UTILITIES);
    const missing = PROMISED_UTILITIES.filter((u) => !hasRule(css, u));
    expect(
      missing,
      `these utilities have a @theme entry but Tailwind generated no rule — almost always a\n` +
        `namespace that Tailwind v4 does not expose (the --duration-* trap):\n${missing.join("\n")}`,
    ).toEqual([]);
  }, 30_000);

  it("resolves color aliases through --dpf-* so dark mode and runtime branding still win", async () => {
    const css = await compile(["bg-dpf-accent"]);
    // The utility must reference the alias, and the alias must forward to the
    // hand-authored property that globals.css and BrandingConfig override.
    expect(css).toMatch(/\.bg-dpf-accent\s*\{[^}]*var\(--color-dpf-accent\)/);
    expect(css).toMatch(/--color-dpf-accent:\s*var\(--dpf-accent\)/);
  }, 30_000);

  it("pairs each type step with its line-height so hierarchy is one class", async () => {
    const css = await compile(["text-dpf-heading"]);
    expect(css).toMatch(/\.text-dpf-heading\s*\{[^}]*font-size:\s*var\(--text-dpf-heading\)/);
    expect(css).toMatch(/\.text-dpf-heading\s*\{[^}]*line-height:[^}]*--text-dpf-heading--line-height/);
  }, 30_000);

  it("emits the keyframes backing each animation utility", async () => {
    const css = await compile(["animate-dpf-fade-in", "animate-dpf-slide-up"]);
    expect(css).toMatch(/@keyframes dpf-fade-in/);
    expect(css).toMatch(/@keyframes dpf-slide-up/);
  }, 30_000);

  it("keeps durations out of @theme — v4 has no --duration-* namespace", async () => {
    // Guards the inverse: if someone 'promotes' durations into @theme, the utility
    // still will not generate, and this test says so before it ships.
    expect(readFileSync(GENERATED, "utf8")).not.toMatch(/^\s*--duration-dpf-/m);
    const css = await compile(["duration-dpf-base"]);
    expect(hasRule(css, "duration-dpf-base")).toBe(false);
  }, 30_000);

  it("is actually wired into the stylesheet the app ships", () => {
    // A generated file nothing imports is the same silent no-op in a new costume.
    expect(readFileSync(resolve(APP_DIR, "globals.css"), "utf8")).toContain(
      `@import "./tokens.generated.css"`,
    );
  });

  it("has no stale v3 tailwind config to shadow the CSS-first theme", () => {
    // The root cause. If this file returns, v4 still will not read it, and the
    // token surface silently forks again.
    expect(() => readFileSync(resolve(__dirname, "../tailwind.config.ts"), "utf8")).toThrow();
  });
});
