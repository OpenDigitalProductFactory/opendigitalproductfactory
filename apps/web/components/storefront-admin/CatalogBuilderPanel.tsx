"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CATALOG_FULFILLMENT_ROUTES,
  resetBundleToEqualAllocation,
  type BundleAllocationMode,
  type CatalogFulfillmentRoute,
} from "@/lib/products/catalog-builder";

export type CatalogBuilderView = {
  storefrontItemId: string;
  catalogItemRowId: string;
  catalogItemId: string;
  name: string;
  fulfillmentRoute: CatalogFulfillmentRoute | null;
  bundleComponents: Array<{
    catalogItemId: string;
    name: string;
    quantity: string;
    eligibility: string;
    allocationMode: string;
    allocationPercent: string | null;
  }>;
  candidateItems: Array<{ id: string; catalogItemId: string; name: string }>;
  priceEntries: Array<{
    id: string;
    listName: string;
    skuCode: string | null;
    amount: string;
    currency: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
  promotions: Array<{
    id: string;
    name: string;
    adjustmentType: string;
    adjustmentValue: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
  configurations: Array<{
    id: string;
    name: string;
    skuCodes: string[];
    promotedFromQuote: boolean;
  }>;
  channels: Array<{
    channelKey: string;
    eligibility: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
};

type Notice = { tone: "success" | "error"; message: string } | null;

const ROUTE_LABELS: Record<CatalogFulfillmentRoute, string> = {
  "direct-purchase": "Buy directly",
  booking: "Book a time",
  "configured-purchase": "Choose options, then buy",
  quote: "Request a quote",
  subscription: "Start a subscription",
  reservation: "Reserve it",
  "verified-other": "Another verified route",
};

export function CatalogBuilderPanel({ initial }: { initial: CatalogBuilderView }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [route, setRoute] = useState(initial.fulfillmentRoute ?? "");
  const [componentId, setComponentId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [priceListName, setPriceListName] = useState("Standard prices");
  const [priceAmount, setPriceAmount] = useState("");
  const [priceValidFrom, setPriceValidFrom] = useState("");
  const [priceValidTo, setPriceValidTo] = useState("");
  const [promotionName, setPromotionName] = useState("");
  const [promotionType, setPromotionType] = useState("percentage");
  const [promotionValue, setPromotionValue] = useState("");
  const [promotionValidFrom, setPromotionValidFrom] = useState("");
  const [promotionValidTo, setPromotionValidTo] = useState("");
  const [configurationName, setConfigurationName] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [optionText, setOptionText] = useState("");
  const [quoteLineId, setQuoteLineId] = useState("");
  const [channelEligibility, setChannelEligibility] = useState(
    initial.channels.find((channel) => channel.channelKey === "storefront")
      ?.eligibility ?? "eligible",
  );

  const currentBundle = useMemo(
    () =>
      initial.bundleComponents.map((component) => ({
        catalogItemId: component.catalogItemId,
        quantity: Number(component.quantity),
        eligibility: component.eligibility,
        allocationMode: component.allocationMode as BundleAllocationMode,
        allocationPercent:
          component.allocationPercent == null
            ? null
            : Number(component.allocationPercent),
      })),
    [initial.bundleComponents],
  );

  async function command(body: Record<string, unknown>) {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/storefront/admin/catalog/${initial.catalogItemRowId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          result.message ?? result.error ?? `HTTP ${response.status}`,
        );
      }
      setNotice({
        tone: "success",
        message: result.message ?? "Saved",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not save",
      });
    } finally {
      setSaving(false);
    }
  }

  function optionsFromText(): Record<string, string> {
    return Object.fromEntries(
      optionText
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [key, ...rest] = part.split("=");
          return [key?.trim() ?? "", rest.join("=").trim()];
        })
        .filter(([key, value]) => key && value),
    );
  }

  return (
    <div className="space-y-4" data-testid="catalog-builder">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-[var(--dpf-muted)]">Packaging and sales options</p>
          <h2 className="text-lg font-semibold text-[var(--dpf-text)]">
            {initial.name}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-[var(--dpf-muted)]">
            Your ordinary price already works. Use these options only when
            customers need a package, seasonal offer, standard configuration,
            or a different way to complete the purchase.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/storefront/items/${initial.storefrontItemId}/purchases`}
            className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--dpf-border)] px-3 text-xs text-[var(--dpf-text)]"
          >
            Customer purchases and use
          </a>
          <a
            href="/storefront/items"
            className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--dpf-border)] px-3 text-xs text-[var(--dpf-text)]"
          >
            Back to what you sell
          </a>
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-xs ${
            notice.tone === "success"
              ? "border-[var(--dpf-success)] text-[var(--dpf-success)]"
              : "border-[var(--dpf-error)] text-[var(--dpf-error)]"
          }`}
        >
          {notice.message}
        </p>
      )}

      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
          How customers get it
        </h3>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Fixed prices and bookings go directly to their next step. A quote
          appears only when this choice requires one.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1">
            <span className="mb-1 block text-xs text-[var(--dpf-muted)]">
              Purchase route
            </span>
            <select
              value={route}
              onChange={(event) => setRoute(event.target.value)}
              className="min-h-[44px] w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-sm text-[var(--dpf-text)]"
            >
              <option value="">Use the storefront type</option>
              {CATALOG_FULFILLMENT_ROUTES.map((value) => (
                <option key={value} value={value}>
                  {ROUTE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              void command({
                operation: "set-fulfillment-route",
                fulfillmentRoute: route || null,
              })
            }
            className="min-h-[44px] rounded-md bg-[var(--dpf-accent)] px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            Save route
          </button>
        </div>
      </section>

      <details className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-semibold text-[var(--dpf-text)]">
          Advanced packaging and sales options
        </summary>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Open this only when you sell packages, dated prices, seasonal
          offers, reusable options, or channel-specific availability.
        </p>
        <div className="mt-4 space-y-4">
      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
          Package contents
        </h3>
        {initial.bundleComponents.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            This is currently sold on its own. Add existing things you sell
            only when this is a real package.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {initial.bundleComponents.map((component) => (
              <li
                key={component.catalogItemId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--dpf-surface-2)] px-3 py-2 text-xs"
              >
                <span className="text-[var(--dpf-text)]">
                  {component.quantity} × {component.name}
                </span>
                <span className="text-[var(--dpf-muted)]">
                  {component.allocationPercent
                    ? `${component.allocationPercent}% attribution`
                    : component.allocationMode === "equal"
                      ? "Equal attribution"
                      : "Attribution not set"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--dpf-accent)]">
            Add something to this package
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Thing you already sell">
              <select value={componentId} onChange={(event) => setComponentId(event.target.value)}>
                <option value="">Choose one</option>
                {initial.candidateItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Quantity">
              <input type="number" min="0.01" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </Field>
          </div>
          <p className="mt-2 text-xs text-[var(--dpf-muted)]">
            Changing package contents resets every component to equal
            attribution so the package remains valid. Exact percentages can be
            adjusted after the package exists.
          </p>
          <button
            type="button"
            disabled={saving || !componentId}
            onClick={() =>
              void command({
                operation: "replace-bundle",
                components: resetBundleToEqualAllocation([
                  ...currentBundle,
                  {
                    catalogItemId: componentId,
                    quantity: Number(quantity),
                    eligibility: "standalone-and-bundle",
                    allocationMode: "equal",
                    allocationPercent: null,
                  },
                ]),
              })
            }
            className="mt-3 min-h-[44px] rounded-md border border-[var(--dpf-accent)] px-4 text-sm text-[var(--dpf-accent)] disabled:opacity-50"
          >
            Add with equal attribution
          </button>
        </details>
        {initial.bundleComponents.length > 1 && (
          <RevenueAllocationEditor
            components={initial.bundleComponents}
            saving={saving}
            onSave={(components) =>
              command({
                operation: "replace-bundle",
                components,
              })
            }
          />
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
            Prices and availability
          </h3>
          <CompactRows
            empty="No additional price list. The ordinary item price remains active."
            rows={initial.priceEntries.map((entry) => ({
              key: entry.id,
              primary: `${entry.listName}: ${entry.currency} ${entry.amount}`,
              secondary: entry.skuCode ? `For ${entry.skuCode}` : "Applies to this item",
            }))}
          />
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--dpf-accent)]">
              Add a dated price
            </summary>
            <div className="mt-3 space-y-2">
              <Field label="Price list name"><input value={priceListName} onChange={(event) => setPriceListName(event.target.value)} /></Field>
              <Field label="Amount"><input type="number" min="0" step="0.01" value={priceAmount} onChange={(event) => setPriceAmount(event.target.value)} /></Field>
              <DateFields from={priceValidFrom} to={priceValidTo} setFrom={setPriceValidFrom} setTo={setPriceValidTo} />
              <ActionButton disabled={saving || !priceAmount} onClick={() => void command({
                operation: "add-price-list-entry",
                name: priceListName,
                priceAmount: Number(priceAmount),
                effectiveFrom: priceValidFrom || null,
                effectiveTo: priceValidTo || null,
              })}>Add price</ActionButton>
            </div>
          </details>
        </div>

        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
            Seasonal offers
          </h3>
          <CompactRows
            empty="No seasonal offer. Add one without creating another product."
            rows={initial.promotions.map((promotion) => ({
              key: promotion.id,
              primary: promotion.name,
              secondary: `${promotion.adjustmentType}: ${promotion.adjustmentValue}`,
            }))}
          />
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--dpf-accent)]">
              Add a seasonal offer
            </summary>
            <div className="mt-3 space-y-2">
              <Field label="Offer name"><input value={promotionName} onChange={(event) => setPromotionName(event.target.value)} /></Field>
              <Field label="Price change">
                <select value={promotionType} onChange={(event) => setPromotionType(event.target.value)}>
                  <option value="percentage">Percentage off</option>
                  <option value="fixed-amount">Amount off</option>
                  <option value="fixed-price">Special fixed price</option>
                </select>
              </Field>
              <Field label="Value"><input type="number" min="0" step="0.01" value={promotionValue} onChange={(event) => setPromotionValue(event.target.value)} /></Field>
              <DateFields from={promotionValidFrom} to={promotionValidTo} setFrom={setPromotionValidFrom} setTo={setPromotionValidTo} />
              <ActionButton disabled={saving || !promotionName || !promotionValue} onClick={() => void command({
                operation: "add-promotion",
                name: promotionName,
                adjustmentType: promotionType,
                adjustmentValue: Number(promotionValue),
                effectiveFrom: promotionValidFrom || null,
                effectiveTo: promotionValidTo || null,
              })}>Add offer</ActionButton>
            </div>
          </details>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
            Standard options
          </h3>
          <CompactRows
            empty="No reusable standard option. One-off choices stay with their quote or order."
            rows={initial.configurations.map((configuration) => ({
              key: configuration.id,
              primary: configuration.name,
              secondary: configuration.skuCodes.join(", ") || "No SKU published",
            }))}
          />
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--dpf-accent)]">
              Publish a reusable standard option
            </summary>
            <div className="mt-3 space-y-2">
              <Field label="Option name"><input value={configurationName} onChange={(event) => setConfigurationName(event.target.value)} /></Field>
              <Field label="SKU code"><input value={skuCode} onChange={(event) => setSkuCode(event.target.value)} /></Field>
              <Field label="Options (name=value, separated by commas)"><input value={optionText} onChange={(event) => setOptionText(event.target.value)} placeholder="size=large, finish=walnut" /></Field>
              <ActionButton disabled={saving || !configurationName || !skuCode} onClick={() => void command({
                operation: "publish-configuration",
                name: configurationName,
                skuCode,
                specification: optionsFromText(),
              })}>Publish standard option</ActionButton>
            </div>
          </details>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--dpf-muted)]">
              Promote a successful quoted option
            </summary>
            <div className="mt-3 space-y-2">
              <Field label="Quote line reference"><input value={quoteLineId} onChange={(event) => setQuoteLineId(event.target.value)} /></Field>
              <ActionButton disabled={saving || !quoteLineId || !configurationName || !skuCode} onClick={() => void command({
                operation: "promote-quote-configuration",
                quoteLineItemId: quoteLineId,
                name: configurationName,
                skuCode,
              })}>Promote quoted option</ActionButton>
            </div>
          </details>
        </div>

        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
            Where it can be sold
          </h3>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Eligibility does not publish anything by itself. Your storefront
            listing remains the public presentation.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Storefront">
              <select value={channelEligibility} onChange={(event) => setChannelEligibility(event.target.value)}>
                <option value="eligible">Can be sold here</option>
                <option value="ineligible">Not sold here</option>
              </select>
            </Field>
            <ActionButton disabled={saving} onClick={() => void command({
              operation: "set-channel-eligibility",
              channelKey: "storefront",
              eligibility: channelEligibility,
            })}>Save availability</ActionButton>
          </div>
        </div>
      </section>
        </div>
      </details>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block flex-1">
      <span className="mb-1 block text-xs text-[var(--dpf-muted)]">{label}</span>
      <span className="[&>input]:min-h-[44px] [&>input]:w-full [&>input]:rounded-md [&>input]:border [&>input]:border-[var(--dpf-border)] [&>input]:bg-[var(--dpf-surface-2)] [&>input]:px-3 [&>input]:text-sm [&>input]:text-[var(--dpf-text)] [&>select]:min-h-[44px] [&>select]:w-full [&>select]:rounded-md [&>select]:border [&>select]:border-[var(--dpf-border)] [&>select]:bg-[var(--dpf-surface-2)] [&>select]:px-3 [&>select]:text-sm [&>select]:text-[var(--dpf-text)]">
        {children}
      </span>
    </label>
  );
}

function DateFields(props: {
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Starts"><input type="date" value={props.from} onChange={(event) => props.setFrom(event.target.value)} /></Field>
      <Field label="Ends"><input type="date" value={props.to} onChange={(event) => props.setTo(event.target.value)} /></Field>
    </div>
  );
}

function ActionButton(props: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="min-h-[44px] rounded-md border border-[var(--dpf-accent)] px-4 text-sm text-[var(--dpf-accent)] disabled:opacity-50"
    >
      {props.children}
    </button>
  );
}

function CompactRows(props: {
  empty: string;
  rows: Array<{ key: string; primary: string; secondary: string }>;
}) {
  if (props.rows.length === 0) {
    return <p className="mt-2 text-xs text-[var(--dpf-muted)]">{props.empty}</p>;
  }
  return (
    <ul className="mt-3 space-y-2">
      {props.rows.map((row) => (
        <li key={row.key} className="rounded-md bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-xs font-medium text-[var(--dpf-text)]">{row.primary}</p>
          <p className="text-dpf-caption text-[var(--dpf-muted)]">
            {row.secondary}
          </p>
        </li>
      ))}
    </ul>
  );
}

function RevenueAllocationEditor(props: {
  components: CatalogBuilderView["bundleComponents"];
  saving: boolean;
  onSave: (
    components: Array<{
      catalogItemId: string;
      quantity: number;
      eligibility: string;
      allocationMode: "percentage";
      allocationPercent: number;
    }>,
  ) => Promise<void>;
}) {
  const [percentages, setPercentages] = useState<Record<string, string>>(() => {
    let assigned = 0;
    return Object.fromEntries(
      props.components.map((component, index) => {
        const percentage =
          component.allocationMode === "percentage" &&
          component.allocationPercent != null
            ? Number(component.allocationPercent)
            : index === props.components.length - 1
              ? 100 - assigned
              : Math.floor((100 / props.components.length) * 100) / 100;
        assigned += percentage;
        return [component.catalogItemId, String(percentage)];
      }),
    );
  });
  const values = props.components.map((component) =>
    Number(percentages[component.catalogItemId]),
  );
  const total = values.reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0,
  );
  const valid =
    values.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 100,
    ) && Math.abs(total - 100) < 0.0001;

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-[var(--dpf-muted)]">
        Set exact revenue attribution
      </summary>
      <p className="mt-2 text-xs text-[var(--dpf-muted)]">
        This divides one package sale for analysis; it does not create extra
        revenue. Percentages must total 100.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {props.components.map((component) => (
          <Field key={component.catalogItemId} label={`${component.name} (%)`}>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={percentages[component.catalogItemId] ?? ""}
              onChange={(event) =>
                setPercentages((current) => ({
                  ...current,
                  [component.catalogItemId]: event.target.value,
                }))
              }
            />
          </Field>
        ))}
      </div>
      <p
        className={`mt-2 text-xs ${
          valid
            ? "text-[var(--dpf-muted)]"
            : "text-[var(--dpf-error)]"
        }`}
      >
        Total: {Math.round(total * 100) / 100}%{valid ? "" : " — enter 100%"}
      </p>
      <ActionButton
        disabled={props.saving || !valid}
        onClick={() =>
          void props.onSave(
            props.components.map((component) => ({
              catalogItemId: component.catalogItemId,
              quantity: Number(component.quantity),
              eligibility: component.eligibility,
              allocationMode: "percentage",
              allocationPercent: Number(
                percentages[component.catalogItemId],
              ),
            })),
          )
        }
      >
        Save attribution
      </ActionButton>
    </details>
  );
}
