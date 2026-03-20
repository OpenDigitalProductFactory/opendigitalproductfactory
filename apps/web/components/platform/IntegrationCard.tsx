// apps/web/components/platform/IntegrationCard.tsx

type Integration = {
  name: string;
  vendor: string | null;
  shortDescription: string | null;
  category: string;
  pricingModel: string | null;
  rating: unknown;
  ratingCount: number | null;
  isVerified: boolean;
  documentationUrl: string | null;
  logoUrl: string | null;
};

const PRICING_BADGES: Record<string, string> = {
  free: "FREE",
  paid: "PAID",
  freemium: "FREEMIUM",
  "open-source": "OSS",
};

export function IntegrationCard({ integration }: { integration: Integration }) {
  const rating =
    typeof integration.rating === "number"
      ? integration.rating
      : integration.rating &&
        typeof (integration.rating as { toNumber?: () => number }).toNumber === "function"
      ? (integration.rating as { toNumber: () => number }).toNumber()
      : null;

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
        </div>
      </div>
    </div>
  );
}
