// Shared shape for portal section navigation (BI-ARCH-SECTIONNAV).
//
// The per-surface `*TabNav` components (Platform / Admin / Finance / Ops) used
// to each carry their own copy of the section-nav markup. They now convert
// their domain-owned nav data into this shared shape and hand it to one renderer
// (components/shell/SectionNav.tsx). Active state is resolved by the caller (it
// owns `usePathname` and its surface-specific matching rules), so this shape and
// the renderer stay pure and presentational.
//
// Section data remains domain-owned (platform-nav.ts, admin-nav.ts, etc.); this
// is only the rendering contract those surfaces converge on.

/** A single navigable link with its active state already resolved. */
export type SectionNavLink = {
  label: string;
  href: string;
  active: boolean;
};

/**
 * A single flat tab. Most flat navs link to a route (`href`); a few switch a
 * query-param view in place (`onSelect`) instead of navigating. Exactly one of
 * the two is supplied per tab — the renderer emits a `<Link>` for `href` and a
 * `<button>` for `onSelect`. The caller still owns active-state resolution.
 */
export type SectionNavTab = {
  key: string;
  label: string;
  active: boolean;
  /** Route target — rendered as a `<Link>`. */
  href?: string;
  /** In-place selection (e.g. a `?view=` switch) — rendered as a `<button>`. */
  onSelect?: () => void;
};

/** A top-level family plus the sub-items shown when it is active. */
export type SectionNavFamily = {
  key: string;
  label: string;
  href: string;
  active: boolean;
};

/** A labelled group of sibling tabs (the "grouped" style, e.g. Ops). */
export type SectionNavGroup = {
  label: string;
  tabs: SectionNavLink[];
};

/**
 * Family-style section nav: a row of top-level families plus the active
 * family's description and sub-items.
 *   - "pill": families and sub-items render as pills, sub-items always shown
 *             (Platform, Admin).
 *   - "tab":  families render as underline tabs, sub-items in a boxed panel
 *             shown only when present (Finance).
 */
export type FamiliesSectionNavConfig = {
  variant: "families";
  style: "pill" | "tab";
  /** `data-component` attribute on the root, for layout regression tests. */
  dataComponent?: string;
  /** Tighter spacing + screen-reader-only description (e.g. Operations Map). */
  dense?: boolean;
  families: SectionNavFamily[];
  /** The active family's description, shown above its sub-items. */
  description?: string;
  /** The active family's sub-items, with active state resolved. */
  subItems: SectionNavLink[];
};

/** Grouped-style section nav: labelled groups of underline tabs (Ops). */
export type GroupedSectionNavConfig = {
  variant: "grouped";
  dataComponent?: string;
  groups: SectionNavGroup[];
};

/**
 * Flat-style section nav: a single row of sibling tabs with no sub-item panel.
 * This is the shape the single-row `*TabNav` clones each carried (EA / Audit /
 * Workforce / Identity / Customer = underline links, Employee = underline buttons
 * that switch a `?view=` param, Marketing = pills, Storefront admin = emphasis).
 *   - tone "underline": `rounded-t` tabs, active = `border-b-2 border-accent`.
 *   - tone "pill":      `rounded-full` bordered pills, active = surface-2 fill.
 *   - tone "emphasis":  heavier storefront strip — larger 13px tabs, semibold +
 *                       accent-coloured active label, transparent-border inactive
 *                       (constant tab height), gap-0. Storefront admin only.
 */
export type FlatSectionNavConfig = {
  variant: "flat";
  /** Tab chrome. Defaults to "underline". */
  tone?: "underline" | "pill" | "emphasis";
  /** Render the root as a semantic `<nav>` instead of a `<div>` (Marketing/Storefront). */
  as?: "div" | "nav";
  /** Allow tabs to wrap onto multiple rows on narrow screens (Customer/Marketing). */
  wrap?: boolean;
  dataComponent?: string;
  tabs: SectionNavTab[];
};

export type SectionNavConfig =
  | FamiliesSectionNavConfig
  | GroupedSectionNavConfig
  | FlatSectionNavConfig;
