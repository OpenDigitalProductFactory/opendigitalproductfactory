import Link from "next/link";
import {
  ADDRESS_VALIDATION_ONE_ACTIVE_POLICY,
  ADDRESS_VALIDATION_PROVIDERS,
  describeAddressValidationSetup,
  suggestProviderForGeography,
  type AddressValidationSetupStatus,
} from "@/lib/shared/address-validation-provider-guidance";

type Props = {
  status: AddressValidationSetupStatus;
  /** Optional org country for the geography hint. */
  primaryCountry?: string | null;
};

/**
 * BI-SITE-5E6A18 — compact provider-choice guidance for address validation.
 * Progressive disclosure: status first, then Smarty vs Mapbox choices.
 */
export function AddressValidationProviderGuidance({ status, primaryCountry }: Props) {
  const suggested = suggestProviderForGeography({ primaryCountry });
  const suggestedName =
    ADDRESS_VALIDATION_PROVIDERS.find((p) => p.id === suggested)?.name ?? "Smarty";

  return (
    <section
      className="space-y-4 rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
      aria-labelledby="address-validation-guidance-heading"
    >
      <div>
        <h2
          id="address-validation-guidance-heading"
          className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
        >
          Address validation providers
        </h2>
        <p className="mt-1 text-dpf-body text-[var(--dpf-muted)]">{status.headline}</p>
        <p className="mt-2 text-dpf-caption text-[var(--dpf-muted)]">
          Next: {status.nextStep}
        </p>
      </div>

      <p className="text-dpf-caption text-[var(--dpf-text)]">
        {ADDRESS_VALIDATION_ONE_ACTIVE_POLICY}
      </p>

      <p className="text-dpf-caption text-[var(--dpf-muted)]">
        Suggested for this install: <span className="text-[var(--dpf-text)]">{suggestedName}</span>
        {primaryCountry ? ` (${primaryCountry})` : ""}.
      </p>

      <ul className="space-y-3">
        {ADDRESS_VALIDATION_PROVIDERS.map((provider) => (
          <li
            key={provider.id}
            className="rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-dpf-body font-dpf-semibold text-[var(--dpf-text)]">
                {provider.name}
              </span>
              {provider.id === suggested ? (
                <span className="rounded-full border border-[var(--dpf-accent)] px-2 py-0.5 text-dpf-caption text-[var(--dpf-accent)]">
                  Suggested
                </span>
              ) : null}
              {provider.needsApiKey ? (
                <span className="text-dpf-caption text-[var(--dpf-muted)]">API key</span>
              ) : (
                <span className="text-dpf-caption text-[var(--dpf-muted)]">No key</span>
              )}
            </div>
            <p className="mt-1 text-dpf-caption text-[var(--dpf-muted)]">
              Best for: {provider.bestFor}
            </p>
            <p className="mt-1 text-dpf-caption text-[var(--dpf-muted)]">{provider.notes}</p>
          </li>
        ))}
      </ul>

      <p className="text-dpf-caption text-[var(--dpf-muted)]">
        Full notes:{" "}
        <Link
          href="/docs/platform/address-validation-providers"
          className="text-[var(--dpf-accent)] hover:underline"
        >
          Address validation setup
        </Link>
        . Service registry:{" "}
        <Link href="/platform/tools/services" className="text-[var(--dpf-accent)] hover:underline">
          MCP Services
        </Link>
        .
      </p>
    </section>
  );
}

/** Server helper: status from boolean probes (kept free of Prisma). */
export function buildAddressValidationStatus(input: {
  commercialProviderDetected: boolean;
  siteLookupReady: boolean;
}): AddressValidationSetupStatus {
  return describeAddressValidationSetup(input);
}
