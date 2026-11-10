import type { OutboundChannelAdapter } from "./contracts";
import { createLinkedInPersonalSocialAdapter } from "./linkedin-personal-social/adapter";
import { createEmailPostmarkAdapter } from "./email-postmark/adapter";
import { createLinkedInAdsAdapter } from "./linkedin-ads/adapter";
import { createWordPressOutboundAdapter } from "./wordpress-self-hosted/adapter";

// Channel adapter registry. Phases 2/3 register two adapters
// (linkedin-personal-social, email-postmark) plus channel-id aliases so a
// saved MarketingAssetTask with channel="linkedin" or channel="email" routes
// to the right adapter without needing a separate disambiguation column.

let registeredAdapters: OutboundChannelAdapter[] | null = null;

function getAdapters(): OutboundChannelAdapter[] {
  if (!registeredAdapters) {
    registeredAdapters = [
      createLinkedInPersonalSocialAdapter(),
      createEmailPostmarkAdapter(),
      createLinkedInAdsAdapter(),
      createWordPressOutboundAdapter(),
    ];
  }
  return registeredAdapters;
}

export function getAdapter(channelId: string): OutboundChannelAdapter | null {
  for (const adapter of getAdapters()) {
    if (adapter.channelId === channelId) return adapter;
  }
  // Phase 2/3 aliases: a MarketingAssetTask.channel="linkedin" routes to the
  // personal-publish adapter; channel="email" routes to email-postmark.
  // When a company-page or ads or alt-email adapter lands, route on
  // additional draft.metadata signals to disambiguate.
  if (channelId === "linkedin") {
    return getAdapters().find((a) => a.channelId === "linkedin-personal-social") ?? null;
  }
  if (channelId === "email") {
    return getAdapters().find((a) => a.channelId === "email-postmark") ?? null;
  }
  if (channelId === "wordpress") {
    return getAdapters().find((a) => a.channelId === "wordpress-self-hosted") ?? null;
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
