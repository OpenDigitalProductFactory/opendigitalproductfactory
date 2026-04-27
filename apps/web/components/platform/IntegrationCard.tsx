// apps/web/components/platform/IntegrationCard.tsx

type Integration = {
  id: string;
  name: string;
  vendor: string | null;
  shortDescription: string | null;
  category: string;
  pricingModel: string | null;
  rating: { toNumber(): number } | number | null;
  ratingCount: number | null;
  isVerified: boolean;
  documentationUrl: string | null;
  logoUrl: string | null;
  activeServerId?: string | null;
  connectorProfile?: {
    authModes: string[];
    capabilities: string[];
  };
  nativeIntegration?: {
    route: string;
    activationKind: "native_setup";
    label: string;
  } | null;
};

const PRICING_BADGES: Record<string, string> = {
  free: "FREE",
  paid: "PAID",
  freemium: "FREEMIUM",
  "open-source": "OSS",
};

export function IntegrationCard({ integration }: { integration: Integration }) {
  const raw = integration.rating;
  const rating =
    raw != null && typeof raw === "object" && "toNumber" in raw
      ? raw.toNumber()
      : typeof raw === "number"
      ? raw
      : null;

  const actionHref =
    integration.nativeIntegration?.route ??
    (integration.activeServerId
      ? `/platform/tools/services/${integration.activeServerId}`
      : `/platform/tools/services/activate?integrationId=${integration.id}`);

  const actionLabel = integration.nativeIntegration ? "Open Setup →" : integration.activeServerId ? "Open Service →" : "Activate →";

  return (
    <div className="border rounded-lg p-4 flex flex-col gap-2 hover:shadow-md transition-shadow bg-card">
      <div className="flex items-start gap-3">
        {integration.logoUrl ? (
          <img src={integration.logoUrl} alt="" className="w-10 h-10 rounded object-contain" />
        ) : (
          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
            {integration.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{integration.name}</span>
            {integration.isVerified && (
              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">✓ Verified</span>
            )}
            {integration.activeServerId && (
            <a
              href={actionHref}
              className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded hover:underline"
            >
              Active
            </a>
            )}
            {integration.pricingModel && (
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                {PRICING_BADGES[integration.pricingModel] ?? integration.pricingModel.toUpperCase()}
              </span>
            )}
          </div>
          {integration.vendor && (
            <p className="text-xs text-muted-foreground">{integration.vendor}</p>
          )}
        </div>
      </div>

      {integration.shortDescription && (
        <p className="text-sm text-muted-foreground line-clamp-2">{integration.shortDescription}</p>
      )}

      {integration.connectorProfile && (
        <div className="flex flex-wrap gap-2">
          <span className="text-[11px] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] px-2 py-0.5 rounded border border-[var(--dpf-border)]">
            {integration.connectorProfile.authModes[0] === "oauth_client_credentials" ? "OAuth" : "API key"}
          </span>
          {integration.connectorProfile.capabilities.includes("universal_api_call") && (
            <span className="text-[11px] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] px-2 py-0.5 rounded border border-[var(--dpf-border)]">
              Universal API
            </span>
          )}
          {integration.connectorProfile.capabilities.includes("webhook_trigger") && (
            <span className="text-[11px] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] px-2 py-0.5 rounded border border-[var(--dpf-border)]">
              Webhooks
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-auto pt-1">
        <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded">
          {integration.category}
        </span>
        <div className="flex items-center gap-3">
          {rating !== null && (
            <span className="text-xs text-muted-foreground">
              ★ {rating.toFixed(1)}{integration.ratingCount ? ` (${integration.ratingCount})` : ""}
            </span>
          )}
          {integration.documentationUrl && (
            <a
              href={integration.documentationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Docs →
            </a>
          )}
          {!integration.activeServerId && (
            <a
              href={actionHref}
              className="text-xs text-primary hover:underline"
            >
              {actionLabel}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
