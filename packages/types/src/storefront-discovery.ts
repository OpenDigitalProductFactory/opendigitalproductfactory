/**
 * Public storefront discovery + menu wire types — the anonymous "visitor"
 * consumer surface (the viral walk-up front door, first cut). Shared by the
 * portal producer (apps/web/app/api/storefront/*) and the mobile visitor
 * screens (apps/mobile/src/features/nearby, .../menu).
 *
 * All of this is PUBLIC / pre-auth by design: a walk-up customer browses
 * without a login. Spec: docs/superpowers/specs/2026-08-05-viral-walkup-
 * consumer-front-door-design.md (BI-9FEB61B8).
 */

/** A business surfaced by geo proximity, enough to render the "Right here" card. */
export interface NearbyBusiness {
  /** Organization.slug — the public storefront identifier. */
  slug: string;
  name: string;
  /** Archetype category (e.g. "food-hospitality") — drives the icon/label. */
  category: string | null;
  /** Full archetype id when known (e.g. "food-hospitality/restaurant"). */
  archetypeId: string | null;
  /** Straight-line distance in metres, or null when the business published no coordinates. */
  distanceMeters: number | null;
  /** Whether this business exposes a browsable catalog/menu. */
  hasMenu: boolean;
  /** Optional single-line display address. */
  addressLine: string | null;
}

export interface NearbyBusinessesResponse {
  businesses: NearbyBusiness[];
}

/** One catalog line on the public menu. Monetary values are serialized numbers. */
export interface PublicMenuItem {
  id: string;
  name: string;
  description: string | null;
  /** Item's category — used to group the menu (e.g. "Starters", "Mains"). */
  category: string | null;
  price: number | null;
  currency: string;
  imageUrl: string | null;
}

/** A menu grouped by category. `category: null` collects uncategorised items. */
export interface PublicMenuCategory {
  category: string | null;
  items: PublicMenuItem[];
}

export interface PublicMenu {
  slug: string;
  name: string;
  category: string | null;
  categories: PublicMenuCategory[];
}
