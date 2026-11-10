/**
 * The check-in offer to confirm a site's location (BI-C318C227 §2.2).
 * Nothing here runs on its own: the job screen calls prepareOffer after a
 * successful check-in, and only a tap on "Use my location" reads the device's
 * position, once. No watch, no background location.
 */
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import type { WorkItemSite } from "@dpf/types";
import { api } from "@/src/lib/apiClient";
import { takeOneFix } from "@/src/hooks/useGeolocation";
import { chooseOffer, refusalMessage, type DismissedSites, type SiteLocationOffer } from "./site-location";

const DISMISSED_KEY = "dpf_site_location_not_now";

type Fix = { latitude: number; longitude: number; accuracyMeters: number };

export type SiteLocationPhase =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "far"; site: WorkItemSite; distanceMeters: number }
  | { kind: "done"; site: WorkItemSite }
  | { kind: "message"; text: string };

export interface SiteLocationState {
  itemId: string | null;
  offer: SiteLocationOffer;
  phase: SiteLocationPhase;
  /** The one fix taken for a far-from-address question; dropped once answered. */
  pendingFix: Fix | null;
  prepareOffer: (itemId: string, now?: Date) => Promise<void>;
  notNow: (siteIds: string[], now?: Date) => Promise<void>;
  locateAndConfirm: (site: WorkItemSite) => Promise<void>;
  confirmFar: (site: WorkItemSite) => Promise<void>;
  reset: () => void;
}

async function readDismissed(): Promise<DismissedSites> {
  try {
    const raw = await SecureStore.getItemAsync(DISMISSED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as DismissedSites) : {};
  } catch {
    return {};
  }
}

const NONE: SiteLocationOffer = { kind: "none" };

export const useSiteLocationStore = create<SiteLocationState>((set, get) => {
  async function submit(site: WorkItemSite, fix: Fix, confirmFar: boolean) {
    const itemId = get().itemId;
    if (!itemId) return;
    set({ phase: { kind: "working" } });
    try {
      const result = await api.workItems.confirmSiteLocation(site.id, { workItemId: itemId, ...fix, confirmFar });
      if (result.status === "confirmed") {
        set({ phase: { kind: "done", site }, pendingFix: null, offer: NONE });
      } else if (result.reason === "far-from-address" && result.distanceMeters !== undefined) {
        set({ phase: { kind: "far", site, distanceMeters: result.distanceMeters }, pendingFix: fix });
      } else {
        set({ phase: { kind: "message", text: refusalMessage(result.reason) }, pendingFix: null });
      }
    } catch {
      set({ phase: { kind: "message", text: "The site's location wasn't saved. Try again." }, pendingFix: null });
    }
  }

  return {
    itemId: null,
    offer: NONE,
    phase: { kind: "idle" },
    pendingFix: null,

    prepareOffer: async (itemId, now = new Date()) => {
      set({ itemId, offer: NONE, phase: { kind: "idle" }, pendingFix: null });
      try {
        const [{ sites }, dismissed] = await Promise.all([api.workItems.sites(itemId), readDismissed()]);
        set({ offer: chooseOffer(sites, dismissed, now) });
      } catch {
        // No offer is the safe outcome: check-in itself already succeeded.
        set({ offer: NONE });
      }
    },

    notNow: async (siteIds, now = new Date()) => {
      set({ offer: NONE, phase: { kind: "idle" }, pendingFix: null });
      try {
        const dismissed = await readDismissed();
        for (const id of siteIds) dismissed[id] = now.toISOString();
        await SecureStore.setItemAsync(DISMISSED_KEY, JSON.stringify(dismissed));
      } catch {
        // Forgetting a "Not now" only means the offer may appear again.
      }
    },

    locateAndConfirm: async (site) => {
      set({ phase: { kind: "working" } });
      const fix = await takeOneFix();
      if (fix.status === "denied") {
        set({ phase: { kind: "message", text: "Location permission is off, so the site's location wasn't set." } });
        return;
      }
      if (fix.status === "unavailable") {
        set({ phase: { kind: "message", text: fix.message } });
        return;
      }
      await submit(site, { latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: fix.accuracyMeters }, false);
    },

    confirmFar: async (site) => {
      const fix = get().pendingFix;
      if (!fix) return;
      await submit(site, fix, true);
    },

    reset: () => set({ itemId: null, offer: NONE, phase: { kind: "idle" }, pendingFix: null }),
  };
});
