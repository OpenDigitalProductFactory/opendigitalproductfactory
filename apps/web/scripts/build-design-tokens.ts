/**
 * L0 design-token generator — EP-UX-SYSTEM, BI-CD81FF7C
 * (docs/superpowers/specs/2026-07-22-holistic-ux-system-and-agent-codification-design.md, §6 L0).
 *
 * THE WRINKLE this solves: the platform had a *color* system, not a design system.
 * `--dpf-*` were plain `:root` custom properties generating NO utilities, while a stale
 * v3 `apps/web/tailwind.config.ts` declared `shadow-dpf-*`/`bg-dpf-*`/`animate-*` theme
 * entries that Tailwind v4 never reads (globals.css is CSS-first `@import "tailwindcss"`
 * with no `@config` directive). The result was ~50 call sites styling themselves with
 * class names that silently resolved to nothing. This script makes the token surface
 * real: it compiles the DTCG source into a Tailwind v4 `@theme` block, so the utilities
 * actually exist, and the stale config is deleted.
 *
 * Deterministic by construction: source order is preserved, no timestamps, so a
 * regeneration with no token changes produces identical bytes (no spurious diffs).
 *
 * Static — no DB. Output is the committed CSS.
 *
 * Usage (local):
 *   pnpm --filter web build:design-tokens
 *   pnpm --filter web check:design-tokens   # fail if stale
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// ─── Repo root (same ascent as build-route-manifest.ts) ──────────────────────

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

const ROOT = repoRoot();
const SRC_REL = "apps/web/design/tokens.json";
const OUT_REL = "apps/web/app/tokens.generated.css";

// ─── DTCG shapes (only the subset this source uses) ──────────────────────────

type Dimension = { value: number; unit: string };
type ShadowValue = {
  color: string;
  offsetX: Dimension;
  offsetY: Dimension;
  blur: Dimension;
  spread: Dimension;
};
type Token<T> = { $value: T; $description?: string };
type Group<T> = Record<string, Token<T> | string | undefined>;

type Animation = {
  duration: string;
  easing: string;
  keyframes: Record<string, string>;
};

type TokenFile = {
  space: Group<Dimension>;
  radius: Group<Dimension>;
  elevation: Group<ShadowValue>;
  font: {
    size: Group<Dimension>;
    lineHeight: Group<number>;
    weight: Group<number>;
  };
  motion: {
    duration: Group<Dimension>;
    easing: Group<number[]>;
  };
  $extensions: {
    "com.dpf.colorAliases": Record<string, string>;
    "com.dpf.animations": Record<string, Animation | string>;
    "com.dpf.density": {
      modes: Record<string, Record<string, string>>;
      default: string;
    };
  };
};

/** Metadata keys ($type/$description/...) are not tokens. */
function entries<T>(group: Group<T> | Record<string, unknown>): [string, Token<T>][] {
  return Object.entries(group ?? {}).filter(
    ([k, v]) => !k.startsWith("$") && v !== null && typeof v === "object" && "$value" in (v as object),
  ) as [string, Token<T>][];
}

/** bodyLg -> body-lg. Token keys are authored camelCase; CSS custom properties are kebab. */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function dim(d: Dimension): string {
  return `${d.value}${d.unit}`;
}

function shadow(s: ShadowValue): string {
  const parts = [dim(s.offsetX), dim(s.offsetY), dim(s.blur)];
  if (s.spread.value !== 0) parts.push(dim(s.spread));
  return `${parts.join(" ")} ${s.color}`;
}

// ─── Emit ────────────────────────────────────────────────────────────────────

const INDENT = "  ";

function section(lines: string[], title: string): void {
  if (lines.length) lines.push("");
  lines.push(`${INDENT}/* ${title} */`);
}

function buildTheme(tokens: TokenFile): string[] {
  const out: string[] = [];
  const push = (prop: string, value: string) => out.push(`${INDENT}${prop}: ${value};`);

  section(out, "Spacing — 4-pt progression. Tailwind's numeric p-1..p-96 stays legal.");
  for (const [name, t] of entries<Dimension>(tokens.space)) push(`--spacing-dpf-${kebab(name)}`, dim(t.$value));

  section(out, "Radius");
  for (const [name, t] of entries<Dimension>(tokens.radius)) push(`--radius-dpf-${kebab(name)}`, dim(t.$value));

  section(out, "Elevation — defines the shadow-dpf-* utilities the codebase already calls.");
  for (const [name, t] of entries<ShadowValue>(tokens.elevation)) push(`--shadow-dpf-${kebab(name)}`, shadow(t.$value));

  section(out, "Type scale — each step carries its own paired line-height.");
  const lineHeights = new Map(entries<number>(tokens.font.lineHeight).map(([k, t]) => [k, t.$value]));
  for (const [name, t] of entries<Dimension>(tokens.font.size)) {
    const key = kebab(name);
    push(`--text-dpf-${key}`, dim(t.$value));
    const lh = lineHeights.get(name);
    if (lh !== undefined) push(`--text-dpf-${key}--line-height`, String(lh));
  }

  section(out, "Font weight");
  for (const [name, t] of entries<number>(tokens.font.weight)) push(`--font-weight-dpf-${kebab(name)}`, String(t.$value));

  section(
    out,
    "Easing. NOTE: durations are deliberately NOT here — Tailwind v4 has no --duration-*\n     theme namespace (duration-* only takes bare numbers), so a --duration-dpf-base entry\n     would generate no utility at all. That is the exact dead-token failure this BI exists\n     to remove, so durations are emitted as plain properties below instead.",
  );
  for (const [name, t] of entries<number[]>(tokens.motion.easing)) {
    push(`--ease-dpf-${kebab(name)}`, `cubic-bezier(${t.$value.join(", ")})`);
  }

  section(out, "Animations — keyframes are emitted inside @theme so v4 tree-shakes them with the utility.");
  const durations = new Map(entries<Dimension>(tokens.motion.duration).map(([k, t]) => [k, dim(t.$value)]));
  const easings = new Map(
    entries<number[]>(tokens.motion.easing).map(([k, t]) => [k, `cubic-bezier(${t.$value.join(", ")})`]),
  );
  for (const [name, spec] of Object.entries(tokens.$extensions["com.dpf.animations"])) {
    if (name.startsWith("$") || typeof spec === "string") continue;
    const key = kebab(name);
    const duration = durations.get(spec.duration);
    const easing = easings.get(spec.easing);
    if (!duration || !easing) {
      throw new Error(
        `[design-tokens] animation "${name}" references unknown duration "${spec.duration}" or easing "${spec.easing}"`,
      );
    }
    push(`--animate-dpf-${key}`, `dpf-${key} ${duration} ${easing}`);
    const steps = Object.entries(spec.keyframes)
      .map(([stop, decls]) => `${stop} { ${decls}; }`)
      .join(" ");
    out.push(`${INDENT}@keyframes dpf-${key} { ${steps} }`);
  }

  section(
    out,
    "Color aliases — value stays var(--dpf-*) so dark mode and runtime branding still win.",
  );
  for (const [name, prop] of Object.entries(tokens.$extensions["com.dpf.colorAliases"])) {
    if (name.startsWith("$")) continue;
    push(`--color-dpf-${name}`, `var(${prop})`);
  }

  return out;
}

function buildPlainProperties(tokens: TokenFile): string[] {
  const { modes, default: defaultMode } = tokens.$extensions["com.dpf.density"];
  const out: string[] = [];
  const densityDecls = (mode: string) =>
    Object.entries(modes[mode] ?? {})
      .map(([k, v]) => `${INDENT}--dpf-density-${k}: ${v};`)
      .join("\n");
  const durationDecls = entries<Dimension>(tokens.motion.duration)
    .map(([name, t]) => `${INDENT}--dpf-duration-${kebab(name)}: ${dim(t.$value)};`)
    .join("\n");

  out.push(
    "/* Motion durations. Plain properties, not @theme: Tailwind v4 exposes no --duration-*",
    "   namespace, so these can never become duration-dpf-* utilities. Consume them in CSS,",
    "   or as an arbitrary value: duration-[var(--dpf-duration-base)]. */",
    ":root {",
    durationDecls,
    "}",
    "",
    "/* Density contexts. Also not @theme entries: these are meant to cascade so a page shell",
    "   can set data-dpf-density on a subtree and the controls inside re-resolve. @theme",
    "   variables are emitted once at :root and cannot express that. */",
    ":root {",
    densityDecls(defaultMode),
    "}",
  );
  for (const mode of Object.keys(modes)) {
    out.push("", `[data-dpf-density="${mode}"] {`, densityDecls(mode), "}");
  }
  return out;
}

function generate(): string {
  const tokens = JSON.parse(readFileSync(join(ROOT, SRC_REL), "utf8")) as TokenFile;
  return [
    `/* GENERATED FILE — DO NOT EDIT.`,
    ` * Source: ${SRC_REL}`,
    ` * Generator: apps/web/scripts/build-design-tokens.ts`,
    ` * Regenerate: pnpm --filter web build:design-tokens`,
    ` */`,
    "",
    "@theme {",
    ...buildTheme(tokens),
    "}",
    "",
    ...buildPlainProperties(tokens),
    "",
  ].join("\n");
}

function main(): void {
  const check = process.argv.includes("--check");
  const outPath = join(ROOT, OUT_REL);
  const serialized = generate();

  if (check) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
    if (current !== serialized) {
      console.error(
        `[design-tokens] STALE — ${OUT_REL} is out of date. Run: pnpm --filter web build:design-tokens`,
      );
      process.exit(1);
    }
    console.error(`[design-tokens] up to date`);
    return;
  }

  writeFileSync(outPath, serialized, "utf8");
  console.error(`[design-tokens] wrote ${OUT_REL}`);
}

// Importable for tests; only runs the CLI when invoked directly.
if (process.argv[1] && /build-design-tokens\.[cm]?ts$/.test(process.argv[1])) main();

export { generate, kebab, shadow, dim };
