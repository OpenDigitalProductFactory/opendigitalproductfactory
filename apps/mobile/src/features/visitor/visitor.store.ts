import { create } from "zustand";
import type { ApiError, NearbyBusiness, PublicMenu } from "@dpf/types";
import { api } from "@/src/lib/apiClient";

/**
 * Anonymous "visitor" store — the walk-up consumer surface (first cut).
 * No auth: a customer with no account finds nearby businesses by geo and
 * browses one's menu. Read-only; ordering/identity are phase 2. Spec:
 * docs/superpowers/specs/2026-08-05-viral-walkup-consumer-front-door-design.md
 * (BI-9FEB61B8).
 */
/**
 * What a visitor sees when a lookup fails. The underlying error (e.g. "fetch
 * failed: Could not connect to the server.") is for developers, so it goes to
 * the console and never to the screen.
 */
export const NEARBY_UNAVAILABLE_MESSAGE =
  "We couldn't load businesses near you. Check your connection, then try again.";
export const MENU_UNAVAILABLE_MESSAGE =
  "We couldn't load this menu. Check your connection, then try again.";
export const MENU_NOT_FOUND_MESSAGE =
  "This business's menu isn't available right now.";

/** The API client throws a plain ApiError object (not an Error) for HTTP errors. */
function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as Partial<ApiError>).code === "NOT_FOUND";
}

interface VisitorState {
  businesses: NearbyBusiness[];
  isLoadingNearby: boolean;
  nearbyError: string | null;

  menu: PublicMenu | null;
  isLoadingMenu: boolean;
  menuError: string | null;

  fetchNearby: (input: { latitude: number; longitude: number }) => Promise<void>;
  fetchMenu: (slug: string) => Promise<void>;
  clearMenu: () => void;
  reset: () => void;
}

const EMPTY = {
  businesses: [] as NearbyBusiness[],
  isLoadingNearby: false,
  nearbyError: null as string | null,
  menu: null as PublicMenu | null,
  isLoadingMenu: false,
  menuError: null as string | null,
};

export const useVisitorStore = create<VisitorState>((set) => ({
  ...EMPTY,

  fetchNearby: async ({ latitude, longitude }) => {
    set({ isLoadingNearby: true, nearbyError: null });
    try {
      const res = await api.storefront.nearby({ latitude, longitude });
      set({ businesses: res.businesses, isLoadingNearby: false });
    } catch (err) {
      console.warn("[visitor] nearby lookup failed", err);
      set({ isLoadingNearby: false, nearbyError: NEARBY_UNAVAILABLE_MESSAGE });
    }
  },

  fetchMenu: async (slug) => {
    // Clear the prior menu so the screen never shows a stale business's menu
    // while the new one loads.
    set({ isLoadingMenu: true, menuError: null, menu: null });
    try {
      const menu = await api.storefront.menu(slug);
      set({ menu, isLoadingMenu: false });
    } catch (err) {
      console.warn("[visitor] menu load failed", err);
      set({
        isLoadingMenu: false,
        menuError: isNotFound(err) ? MENU_NOT_FOUND_MESSAGE : MENU_UNAVAILABLE_MESSAGE,
      });
    }
  },

  clearMenu: () => set({ menu: null, menuError: null, isLoadingMenu: false }),
  reset: () => set({ ...EMPTY }),
}));

/**
 * Pure projection: businesses that actually have something to browse
 * (a menu) sort ahead of those that don't, preserving the server's
 * nearest-first order within each group. Keeps "See menu" businesses at
 * the top of the walk-up list.
 */
export function orderForDisplay(businesses: NearbyBusiness[]): NearbyBusiness[] {
  return [...businesses].sort((a, b) => {
    if (a.hasMenu !== b.hasMenu) return a.hasMenu ? -1 : 1;
    return 0;
  });
}
