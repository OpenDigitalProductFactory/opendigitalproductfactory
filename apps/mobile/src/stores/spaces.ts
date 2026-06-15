import { create } from "zustand";
import type {
  AppConfigManifest,
  InstanceDescriptor,
  Space,
  SpaceSession,
  SpacesRegistry,
} from "@dpf/types";

/**
 * Multi-space registry — the source of truth for which businesses ("spaces")
 * the app is connected to and which one is active.
 *
 * One generic binary holds connections to MANY self-hosted single-org installs,
 * each entered from the home as its own space (Slack-workspace / Mastodon
 * multi-account pattern). This is a CLIENT-side generalization of the former
 * single-install `serverConfig`; there is no server multi-tenancy.
 *
 * This module (BI-MOBAPP-SPACES / M1, increment 1a) is the typed model + the
 * tested registry logic. Wiring `serverConfig.getServerUrl()` and per-space
 * sessions onto the active space — which carries security-relevant token
 * isolation and needs live multi-install verification — is increment 1b.
 *
 * Spec: docs/superpowers/specs/2026-06-14-multi-business-town-super-app-design.html (§2–§3).
 */

/** Durable, synchronous storage for the registry (mirrors the offline queue's QueueStorage). */
export interface SpacesStorage {
  load: () => SpacesRegistry | null;
  save: (registry: SpacesRegistry) => void;
}

/* ------------------------------------------------------------------ */
/*  Pure reducers — exported for direct unit testing                   */
/* ------------------------------------------------------------------ */

/** Find a space by id, or undefined. */
export function findSpace(
  registry: SpacesRegistry,
  spaceId: string,
): Space | undefined {
  return registry.spaces.find((s) => s.spaceId === spaceId);
}

/** The active space, or null when none is selected / the active id is stale. */
export function getActiveSpace(registry: SpacesRegistry): Space | null {
  if (!registry.activeSpaceId) return null;
  return findSpace(registry, registry.activeSpaceId) ?? null;
}

/**
 * Add a space, or update the existing one with the same id (re-connect). Does
 * NOT change the active selection unless nothing was active yet, in which case
 * the added space becomes active (the first space you join is the one you land
 * in). Selecting on every add is an action-level choice, kept out of the reducer.
 */
export function addSpaceToRegistry(
  registry: SpacesRegistry,
  space: Space,
): SpacesRegistry {
  const existing = findSpace(registry, space.spaceId);
  const spaces = existing
    ? registry.spaces.map((s) =>
        s.spaceId === space.spaceId ? { ...s, ...space } : s,
      )
    : [...registry.spaces, space];
  return {
    spaces,
    activeSpaceId: registry.activeSpaceId ?? space.spaceId,
  };
}

/**
 * Remove a space. If it was active, the most-recently-used remaining space
 * becomes active (or null when none remain).
 */
export function removeSpaceFromRegistry(
  registry: SpacesRegistry,
  spaceId: string,
): SpacesRegistry {
  const spaces = registry.spaces.filter((s) => s.spaceId !== spaceId);
  let activeSpaceId = registry.activeSpaceId;
  if (activeSpaceId === spaceId) {
    const fallback = [...spaces].sort(
      (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
    )[0];
    activeSpaceId = fallback?.spaceId ?? null;
  }
  return { spaces, activeSpaceId };
}

/** Set the active space if the id is known; otherwise return the registry unchanged. */
export function setActiveSpaceInRegistry(
  registry: SpacesRegistry,
  spaceId: string,
): SpacesRegistry {
  if (!findSpace(registry, spaceId)) return registry;
  return { ...registry, activeSpaceId: spaceId };
}

/** Strip runtime-only fields (session, manifest) for persistence. */
function toPersisted(registry: SpacesRegistry): SpacesRegistry {
  return {
    activeSpaceId: registry.activeSpaceId,
    spaces: registry.spaces.map((s) => ({
      spaceId: s.spaceId,
      url: s.url,
      label: s.label,
      descriptor: s.descriptor,
      lastUsedAt: s.lastUsedAt,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export interface SpacesState {
  spaces: Space[];
  activeSpaceId: string | null;
  /** Durable storage; null = in-memory only (default until the app wires it). */
  storage: SpacesStorage | null;
  configureStorage: (storage: SpacesStorage) => void;
  /** Load a persisted registry into memory (call once at app start, after configureStorage). */
  hydrate: () => void;
  /**
   * Add (or re-connect) a business from a successful connect, and enter it.
   * `spaceId` is the descriptor's instanceId; `label` defaults to the org name.
   */
  addSpace: (input: {
    url: string;
    descriptor: InstanceDescriptor;
    label?: string;
  }) => Space;
  /** Switch the active space. Returns true if switched, false if the id is unknown. */
  switchSpace: (spaceId: string) => boolean;
  /** Forget a space (disconnect). Falls the active selection back to most-recent. */
  removeSpace: (spaceId: string) => void;
  getActiveSpace: () => Space | null;
  /** Attach the latest absorbed manifest to a space (runtime only). */
  setSpaceManifest: (spaceId: string, manifest: AppConfigManifest) => void;
  /** Update a space's session metadata (authenticated / persona / display name). */
  setSpaceSession: (spaceId: string, session: SpaceSession) => void;
}

export const useSpacesStore = create<SpacesState>((set, get) => {
  const persist = () => {
    const { storage } = get();
    if (!storage) return;
    try {
      storage.save(toPersisted({ spaces: get().spaces, activeSpaceId: get().activeSpaceId }));
    } catch {
      // Best-effort; an unavailable store must never break the registry.
    }
  };

  return {
    spaces: [],
    activeSpaceId: null,
    storage: null,

    configureStorage: (storage) => set({ storage }),

    hydrate: () => {
      const { storage } = get();
      if (!storage) return;
      try {
        const saved = storage.load();
        if (saved && Array.isArray(saved.spaces)) {
          set({ spaces: saved.spaces, activeSpaceId: saved.activeSpaceId ?? null });
        }
      } catch {
        // Best-effort; corrupt/unavailable storage falls back to empty.
      }
    },

    addSpace: ({ url, descriptor, label }) => {
      const space: Space = {
        spaceId: descriptor.instanceId,
        url,
        label: label ?? descriptor.orgName,
        descriptor,
        lastUsedAt: Date.now(),
      };
      // Upsert, then enter the space (land in what you just joined).
      const next = setActiveSpaceInRegistry(
        addSpaceToRegistry(
          { spaces: get().spaces, activeSpaceId: get().activeSpaceId },
          space,
        ),
        space.spaceId,
      );
      set({ spaces: next.spaces, activeSpaceId: next.activeSpaceId });
      persist();
      return findSpace(next, space.spaceId) ?? space;
    },

    switchSpace: (spaceId) => {
      const current = { spaces: get().spaces, activeSpaceId: get().activeSpaceId };
      if (!findSpace(current, spaceId)) return false;
      const stamped = current.spaces.map((s) =>
        s.spaceId === spaceId ? { ...s, lastUsedAt: Date.now() } : s,
      );
      set({ spaces: stamped, activeSpaceId: spaceId });
      persist();
      return true;
    },

    removeSpace: (spaceId) => {
      const next = removeSpaceFromRegistry(
        { spaces: get().spaces, activeSpaceId: get().activeSpaceId },
        spaceId,
      );
      set({ spaces: next.spaces, activeSpaceId: next.activeSpaceId });
      persist();
    },

    getActiveSpace: () =>
      getActiveSpace({ spaces: get().spaces, activeSpaceId: get().activeSpaceId }),

    setSpaceManifest: (spaceId, manifest) => {
      set((state) => ({
        spaces: state.spaces.map((s) =>
          s.spaceId === spaceId ? { ...s, manifest } : s,
        ),
      }));
      // Manifest is runtime-only; no persist needed (refreshed on activation).
    },

    setSpaceSession: (spaceId, session) => {
      set((state) => ({
        spaces: state.spaces.map((s) =>
          s.spaceId === spaceId ? { ...s, session } : s,
        ),
      }));
      // Session metadata is runtime-only; tokens persist separately (1b).
    },
  };
});
