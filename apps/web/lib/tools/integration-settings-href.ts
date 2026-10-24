// apps/web/lib/tools/integration-settings-href.ts
//
// The ONE place that says where an integration's settings page is. Three
// surfaces used to spell `/platform/tools/integrations/${id}` out by hand, and
// each got it wrong differently: marketing drafts carry a channel id ("email",
// "linkedin") that is not an integration slug, and the native-integration
// catalog lists five ids with no page behind them. The room-addressing guard
// caught all three as links whose route prefix cannot accept a dynamic segment
// (BI-235E9F00; kernel principle: a room is reachable by construction).
//
// Routability is read from the generated App Router manifest, not from a
// catalog that may drift from the filesystem. A slug with no page yields null,
// and the caller must not offer a link.
import routeManifestData from "@/lib/ea/route-manifest.json";

const INTEGRATIONS_PREFIX = "/platform/tools/integrations/";
/** The integrations index — a real page, and the honest fallback when a
 *  specific integration has no page of its own. */
export const INTEGRATIONS_INDEX_HREF = "/platform/tools/integrations";

type ManifestRoute = { routePath: string; kind: string; dynamicParams: string[] };

const ROUTABLE_SLUGS: ReadonlySet<string> = new Set(
  (routeManifestData as { routes: ManifestRoute[] }).routes
    .filter((r) => r.kind === "page" && r.dynamicParams.length === 0 && r.routePath.startsWith(INTEGRATIONS_PREFIX))
    .map((r) => r.routePath.slice(INTEGRATIONS_PREFIX.length))
    .filter((slug) => slug.length > 0 && !slug.includes("/")),
);

/** Marketing channel ids are not integration slugs. This is the mapping the
 *  approval queue already relied on implicitly (isEmailChannel / isLinkedInChannel). */
const CHANNEL_TO_INTEGRATION: Readonly<Record<string, string>> = {
  email: "email-postmark",
  linkedin: "linkedin-personal-social",
};

/** Settings page for an integration slug, or null when no such page exists. */
export function integrationSettingsHref(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return ROUTABLE_SLUGS.has(slug) ? `${INTEGRATIONS_PREFIX}${slug}` : null;
}

/** Settings page for a marketing channel (or an integration slug passed as one). */
export function integrationSettingsHrefForChannel(channelId: string | null | undefined): string | null {
  if (!channelId) return null;
  return integrationSettingsHref(CHANNEL_TO_INTEGRATION[channelId] ?? channelId);
}

/** Every slug that has a page — for tests and guards. */
export function routableIntegrationSlugs(): string[] {
  return [...ROUTABLE_SLUGS].sort();
}
