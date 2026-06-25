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

export type SectionNavConfig = FamiliesSectionNavConfig | GroupedSectionNavConfig;
