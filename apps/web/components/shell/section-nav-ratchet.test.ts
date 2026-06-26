import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Clone ratchet for the canonical section nav (BI-ARCH-SECTIONNAV).
//
// Every portal section nav (`*TabNav.tsx`) renders through the one shared
// `components/shell/SectionNav.tsx` renderer. Before the migration, each surface
// carried its own copy of the underline-tab markup — a raw `<Link>` (or inline-
// styled `<a>`) with the `border-b-2 border-[var(--dpf-accent)]` active underline.
// That duplication is exactly what this BI removed, and a brand-new `*TabNav.tsx`
// that re-inlines the markup would silently re-fork it.
//
// So this guard locks the convergence in: a `*TabNav.tsx` may NOT carry the raw
// tab chrome itself (the `border-b-2` active underline, a raw `next/link`
// import, or inline `style={{`). It must build a SectionNavConfig and hand it to
// <SectionNav>. The shared renderer is the only place tab markup lives.

const WEB_ROOT = join(__dirname, "..", "..");
const COMPONENTS_ROOT = join(WEB_ROOT, "components");

function tabNavFiles(): string[] {
  return (readdirSync(COMPONENTS_ROOT, { recursive: true }) as string[])
    .map((e) => join(COMPONENTS_ROOT, e))
    .filter((p) => p.endsWith("TabNav.tsx"));
}

// The active-underline marker every flat/tab clone carried. All tab chrome now
// lives in SectionNav.tsx, so no wrapper should reference it.
const RAW_UNDERLINE = /border-b-2/;
// A wrapper that imports next/link is rendering its own anchors instead of
// delegating to the shared renderer.
const RAW_LINK_IMPORT = /from\s+["']next\/link["']/;
// Inline style objects are both a token-hygiene defect (AGENTS.md §12) and a
// sign of hand-rolled tab markup (the old StorefrontAdminTabNav).
const INLINE_STYLE = /style=\{\{/;

describe("section nav clone ratchet (BI-ARCH-SECTIONNAV)", () => {
  const files = tabNavFiles();

  it("finds the section-nav wrappers (guards against an empty pass)", () => {
    // 14 *TabNav wrappers exist today; never let this silently drop to zero.
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("routes every *TabNav through the shared SectionNav (no raw underline-tab markup)", () => {
    const offenders = files
      .map((path) => ({ path, src: readFileSync(path, "utf-8") }))
      .filter(({ src }) => RAW_UNDERLINE.test(src) || RAW_LINK_IMPORT.test(src) || INLINE_STYLE.test(src))
      .map(({ path }) => path.slice(WEB_ROOT.length + 1).replace(/\\/g, "/"));

    expect(
      offenders,
      `These *TabNav components re-inline tab markup instead of rendering through ` +
        `components/shell/SectionNav.tsx. Build a SectionNavConfig and pass it to ` +
        `<SectionNav> (add a flat/families/grouped variant if the shape is new):\n` +
        offenders.map((p) => `  ${p}`).join("\n"),
    ).toEqual([]);
  });
});
