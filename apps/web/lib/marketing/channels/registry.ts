import type { OutboundChannelAdapter } from "./contracts";
import { createLinkedInPersonalSocialAdapter } from "./linkedin-personal-social/adapter";

// Channel adapter registry. Phase 2 registers one adapter
// (linkedin-personal-social) plus aliases for the storefront channel id
// `linkedin` so a saved MarketingAssetTask with channel="linkedin" routes
// to the personal-publish adapter unless a future ads/company-page adapter
// is layered in.

let registeredAdapters: OutboundChannelAdapter[] | null = null;

function getAdapters(): OutboundChannelAdapter[] {
  if (!registeredAdapters) {
    registeredAdapters = [createLinkedInPersonalSocialAdapter()];
  }
  return registeredAdapters;
}

export function getAdapter(channelId: string): OutboundChannelAdapter | null {
  for (const adapter of getAdapters()) {
    if (adapter.channelId === channelId) return adapter;
  }
  // Phase 2 alias: a MarketingAssetTask.channel="linkedin" routes to the
  // personal-publish adapter. When a company-page or ads adapter lands,
  // route on additional draft.metadata signals to disambiguate.
  if (channelId === "linkedin") {
    return getAdapters().find((a) => a.channelId === "linkedin-personal-social") ?? null;
  }
  return null;
}

export function listAdapters(): ReadonlyArray<OutboundChannelAdapter> {
  return getAdapters();
}

/** Test-only: swap in a custom adapter array. Reset to default by passing null. */
export function __setAdaptersForTest(adapters: OutboundChannelAdapter[] | null): void {
  registeredAdapters = adapters;
}
