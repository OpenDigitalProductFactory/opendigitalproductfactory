import type { ConnectorSetupState } from "@/lib/integrations/kernel/setup-state";
import type { WordPressConnectionViewState } from "@/components/integrations/WordPressConnectPanel";

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function csvValue(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function toWordPressConnectionViewState(
  setup: ConnectorSetupState,
): WordPressConnectionViewState {
  const safe = setup.safeProjection;
  return {
    status: setup.status,
    siteUrl: stringValue(safe.siteUrl),
    username: stringValue(safe.username),
    siteName: stringValue(safe.siteName),
    origin: stringValue(safe.origin),
    supportedResourceKinds: csvValue(safe.supportedResourceKinds),
    supportedTaxonomies: csvValue(safe.supportedTaxonomies),
    unsupportedResourceTypes: csvValue(safe.unsupportedResourceTypes),
    canCreateDrafts: booleanValue(safe.canCreateDrafts),
    canPublishLive: booleanValue(safe.canPublishLive),
    canUploadMedia: booleanValue(safe.canUploadMedia),
    publicPublicationEnabled: booleanValue(safe.publicPublicationEnabled),
    lastErrorMsg: setup.lastErrorMsg,
    lastTestedAt: setup.lastTestedAt?.toISOString() ?? null,
  };
}
