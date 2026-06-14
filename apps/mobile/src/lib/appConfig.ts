import { create } from "zustand";
import type { AppConfigManifest, AppPersona } from "@/src/lib/manifest.types";
import { getServerUrl } from "@/src/lib/serverConfig";
import { SecureStorage } from "@/src/repositories/SecureStorage";
import { useThemeStore, type ColorScheme } from "@/src/lib/theme";

/**
 * Install manifest store + loader.
 *
 * Holds the install-driven app config (capabilities, persona, vocabulary,
 * navigation) and applies its design tokens to the theme store. Fetched
 * best-effort after login; the app stays fully usable on its defaults if the
 * install hasn't shipped the `/api/v1/app/config` endpoint yet.
 */

interface AppConfigState {
  manifest: AppConfigManifest | null;
  capabilities: string[];
  persona: AppPersona | null;
  vocabulary: Record<string, string>;
  navigation: AppConfigManifest["navigation"] | null;
  setManifest: (manifest: AppConfigManifest) => void;
  reset: () => void;
  hasCapability: (key: string) => boolean;
  term: (key: string, fallback?: string) => string;
}

const EMPTY = {
  manifest: null as AppConfigManifest | null,
  capabilities: [] as string[],
  persona: null as AppPersona | null,
  vocabulary: {} as Record<string, string>,
  navigation: null as AppConfigManifest["navigation"] | null,
};

export const useAppConfigStore = create<AppConfigState>((set, get) => ({
  ...EMPTY,
  setManifest: (manifest) =>
    set({
      manifest,
      capabilities: manifest.capabilities ?? [],
      persona: manifest.persona ?? null,
      vocabulary: manifest.vocabulary ?? {},
      navigation: manifest.navigation ?? null,
    }),
  reset: () => set({ ...EMPTY }),
  hasCapability: (key) => get().capabilities.includes(key),
  term: (key, fallback) => get().vocabulary[key] ?? fallback ?? key,
}));

/**
 * Fetch the install manifest for the signed-in user. Best-effort: returns null
 * on any failure (unreachable, unauthorized, malformed, or endpoint absent).
 */
export async function fetchAppConfig(): Promise<AppConfigManifest | null> {
  try {
    const token = await SecureStorage.getAccessToken();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${getServerUrl()}/api/v1/app/config`, {
      method: "GET",
      headers,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AppConfigManifest | null;
    if (!data || typeof data.schemaVersion !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

/** Apply a manifest: store capabilities/persona/nav + re-theme from design tokens. */
export function applyAppConfig(
  manifest: AppConfigManifest,
  scheme: ColorScheme = "dark",
): void {
  useAppConfigStore.getState().setManifest(manifest);
  if (manifest.designTokens) {
    useThemeStore.getState().applyBrandingTokens(manifest.designTokens, scheme);
  }
}

/** Fetch + apply in one best-effort step (safe to call fire-and-forget). */
export async function loadAndApplyAppConfig(
  scheme: ColorScheme = "dark",
): Promise<void> {
  const manifest = await fetchAppConfig();
  if (manifest) applyAppConfig(manifest, scheme);
}
