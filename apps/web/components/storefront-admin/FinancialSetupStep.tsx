"use client";

import { useState } from "react";
import { getFinancialProfile } from "@dpf/finance-templates";
import { applyFinancialProfile } from "@/lib/actions/financial-setup";

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  archetypeSlug: string;
  archetypeName: string;
  suggestedCurrency?: string | null;
  onComplete: () => void;
};

// ─── Currency default ─────────────────────────────────────────────────────────
// Fixed USD default (not derived from the browser locale at runtime): a US
// install must pre-fill USD, and an en-GB test browser must not flip it to GBP.
// A real location signal (suggestedCurrency, from website import) still wins.
const DEFAULT_BASE_CURRENCY = "USD";

// VAT/GST is a UK/EU concept. On a USD (or other non-VAT) install we should not
// pre-select "VAT registered" even when the business-type profile commonly is in
// the UK — that is what drove the 20% UK VAT default on US installs.
const VAT_REGION_CURRENCIES = new Set(["GBP", "EUR"]);

// ─── FinancialSetupStep ────────────────────────────────────────────────────────

export function FinancialSetupStep({ archetypeSlug, archetypeName, suggestedCurrency, onComplete }: Props) {
  // Load profile defaults (client-safe: pure function, no DB call)
  const profile = getFinancialProfile(archetypeSlug);

  // Currency: a real location-detected suggestion wins; otherwise default to USD
  // (never the UK-biased profile default or a browser-locale guess).
  const initialCurrency = suggestedCurrency ?? DEFAULT_BASE_CURRENCY;
  const [baseCurrency, setBaseCurrency] = useState<string>(initialCurrency);
  // Only pre-select "VAT registered" when both the business-type profile expects
  // it AND the resolved currency is in a VAT region.
  const [vatRegistered, setVatRegistered] = useState<boolean>(
    (profile?.vatRegistered ?? false) && VAT_REGION_CURRENCIES.has(initialCurrency),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const billingProfile = profile?.billingPatternProfile;

  function formatToken(value: string) {
    return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }

  async function handleSetup() {
    setError(null);
    setSubmitting(true);
    try {
      await applyFinancialProfile(archetypeSlug, { vatRegistered, baseCurrency });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Success state ────────────────────────────────────────────────────────

  if (done) {
    return (
      <div className="text-[var(--dpf-text)]">
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Finances configured</h2>
        <p className="text-[var(--dpf-muted)]" style={{ fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
          Your finances are set up! Based on your business type, we&#39;ve configured payment terms,
          tax settings, and expense categories. You can customise these anytime in Finance Settings.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a
            href="/finance/settings"
            className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Finance Settings
          </a>
          <button
            onClick={onComplete}
            className="bg-[var(--dpf-accent)] text-white"
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ─── Setup form ───────────────────────────────────────────────────────────

  return (
    <div className="text-[var(--dpf-text)]" style={{ maxWidth: 480 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Financial setup</h2>

      {/* Question 1: Business type confirmation (read-only) */}
      <div
        className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-muted)]"
        style={{
          padding: "12px 16px",
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 13,
        }}
      >
        <span className="text-[var(--dpf-text)]" style={{ fontWeight: 600 }}>Your business type: </span>
        {archetypeName}. We&#39;ll configure your finances to match.
      </div>

      {billingProfile && (
        <div
          className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 16,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: 8,
          }}
        >
          <div>
            <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, marginBottom: 2 }}>Payment</div>
            <div className="text-[var(--dpf-text)]" style={{ fontSize: 13, fontWeight: 700 }}>
              {formatToken(billingProfile.primaryPaymentPattern)}
            </div>
          </div>
          <div>
            <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, marginBottom: 2 }}>Recurring</div>
            <div className="text-[var(--dpf-text)]" style={{ fontSize: 13, fontWeight: 700 }}>
              {formatToken(billingProfile.recurringBillingApplicability)}
            </div>
          </div>
          <div>
            <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, marginBottom: 2 }}>Invoices</div>
            <div className="text-[var(--dpf-text)]" style={{ fontSize: 13, fontWeight: 700 }}>
              {formatToken(billingProfile.invoiceExecutionMode)}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Question 2: VAT registered */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Are you VAT registered?</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setVatRegistered(true)}
              className={`border ${vatRegistered ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)] text-white" : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"}`}
              style={{
                padding: "8px 20px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: vatRegistered ? 600 : 400,
              }}
            >
              Yes
            </button>
            <button
              onClick={() => setVatRegistered(false)}
              className={`border ${!vatRegistered ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)] text-white" : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"}`}
              style={{
                padding: "8px 20px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: !vatRegistered ? 600 : 400,
              }}
            >
              No
            </button>
          </div>
        </div>

        {/* Question 3: Base currency */}
        <label style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Base currency</div>
          <select
            value={baseCurrency}
            onChange={(e) => setBaseCurrency(e.target.value)}
            className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-1)]"
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              fontSize: 14,
              minWidth: 160,
            }}
          >
            {/* Ensure the suggested currency appears even if not in the standard list */}
            {suggestedCurrency && !["GBP","USD","EUR","CAD","AUD","NZD","CHF","SEK","NOK","DKK","JPY","SGD","HKD","ZAR","AED","INR","BRL","MXN","PLN","CZK"].includes(suggestedCurrency) && (
              <option value={suggestedCurrency} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">{suggestedCurrency}</option>
            )}
            {[
              ["GBP", "British Pound"],
              ["USD", "US Dollar"],
              ["EUR", "Euro"],
              ["CAD", "Canadian Dollar"],
              ["AUD", "Australian Dollar"],
              ["NZD", "New Zealand Dollar"],
              ["CHF", "Swiss Franc"],
              ["SEK", "Swedish Krona"],
              ["NOK", "Norwegian Krone"],
              ["DKK", "Danish Krone"],
              ["JPY", "Japanese Yen"],
              ["SGD", "Singapore Dollar"],
              ["HKD", "Hong Kong Dollar"],
              ["ZAR", "South African Rand"],
              ["AED", "UAE Dirham"],
              ["INR", "Indian Rupee"],
              ["BRL", "Brazilian Real"],
              ["MXN", "Mexican Peso"],
              ["PLN", "Polish Zloty"],
              ["CZK", "Czech Koruna"],
            ].map(([code, label]) => (
              <option
                key={code}
                value={code}
                className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
              >
                {code} - {label}
              </option>
            ))}
          </select>
          {suggestedCurrency && (
            <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, marginTop: 4 }}>
              Pre-selected based on your website location — change if needed
            </div>
          )}
        </label>

        {error && (
          <p className="text-[var(--dpf-error)]" style={{ fontSize: 13, margin: 0 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleSetup}
            disabled={submitting}
            className="bg-[var(--dpf-accent)] text-white"
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              cursor: submitting ? "wait" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Setting up..." : "Set Up Finances"}
          </button>
        </div>
      </div>
    </div>
  );
}
