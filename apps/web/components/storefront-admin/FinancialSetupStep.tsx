"use client";

import { useState } from "react";
import { getFinancialProfile } from "@dpf/finance-templates";
import { applyFinancialProfile } from "@/lib/actions/financial-setup";

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  archetypeSlug: string;
  archetypeName: string;
  onComplete: () => void;
};

// ─── FinancialSetupStep ────────────────────────────────────────────────────────

export function FinancialSetupStep({ archetypeSlug, archetypeName, onComplete }: Props) {
  // Load profile defaults (client-safe: pure function, no DB call)
  const profile = getFinancialProfile(archetypeSlug);

  const [vatRegistered, setVatRegistered] = useState<boolean>(profile?.vatRegistered ?? false);
  const [baseCurrency, setBaseCurrency] = useState<string>(profile?.defaultCurrency ?? "GBP");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
      <div style={{ color: "var(--dpf-text)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Finances configured</h2>
        <p style={{ fontSize: 14, color: "var(--dpf-muted)", marginBottom: 16, lineHeight: 1.6 }}>
          Your finances are set up! Based on your business type, we&#39;ve configured payment terms,
          tax settings, and expense categories. You can customise these anytime in Finance Settings.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a
            href="/finance/settings"
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--dpf-border)",
              background: "var(--dpf-surface-1)",
              color: "var(--dpf-text)",
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Finance Settings
          </a>
          <button
            onClick={onComplete}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              background: "var(--dpf-accent)",
              color: "#fff",
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
    <div style={{ maxWidth: 480, color: "var(--dpf-text)" }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Financial setup</h2>

      {/* Question 1: Business type confirmation (read-only) */}
      <div
        style={{
          padding: "12px 16px",
          borderRadius: 8,
          background: "var(--dpf-surface-2)",
          border: "1px solid var(--dpf-border)",
          marginBottom: 16,
          fontSize: 13,
          color: "var(--dpf-muted)",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--dpf-text)" }}>Your business type: </span>
        {archetypeName}. We&#39;ll configure your finances to match.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Question 2: VAT registered */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Are you VAT registered?</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setVatRegistered(true)}
              style={{
                padding: "8px 20px",
                borderRadius: 6,
                border: `1px solid ${vatRegistered ? "var(--dpf-accent)" : "var(--dpf-border)"}`,
                background: vatRegistered ? "var(--dpf-accent)" : "var(--dpf-surface-1)",
                color: vatRegistered ? "#fff" : "var(--dpf-text)",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: vatRegistered ? 600 : 400,
              }}
            >
              Yes
            </button>
            <button
              onClick={() => setVatRegistered(false)}
              style={{
                padding: "8px 20px",
                borderRadius: 6,
                border: `1px solid ${!vatRegistered ? "var(--dpf-accent)" : "var(--dpf-border)"}`,
                background: !vatRegistered ? "var(--dpf-accent)" : "var(--dpf-surface-1)",
                color: !vatRegistered ? "#fff" : "var(--dpf-text)",
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
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--dpf-border)",
              fontSize: 14,
              color: "var(--dpf-text)",
              background: "var(--dpf-surface-1)",
              minWidth: 160,
            }}
          >
            <option value="GBP">GBP — British Pound</option>
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="CAD">CAD — Canadian Dollar</option>
            <option value="AUD">AUD — Australian Dollar</option>
            <option value="NZD">NZD — New Zealand Dollar</option>
            <option value="CHF">CHF — Swiss Franc</option>
            <option value="SEK">SEK — Swedish Krona</option>
            <option value="NOK">NOK — Norwegian Krone</option>
            <option value="DKK">DKK — Danish Krone</option>
            <option value="JPY">JPY — Japanese Yen</option>
            <option value="SGD">SGD — Singapore Dollar</option>
            <option value="HKD">HKD — Hong Kong Dollar</option>
            <option value="ZAR">ZAR — South African Rand</option>
            <option value="AED">AED — UAE Dirham</option>
            <option value="INR">INR — Indian Rupee</option>
            <option value="BRL">BRL — Brazilian Real</option>
            <option value="MXN">MXN — Mexican Peso</option>
            <option value="PLN">PLN — Polish Zloty</option>
            <option value="CZK">CZK — Czech Koruna</option>
          </select>
        </label>

        {error && (
          <p style={{ color: "#ef4444", fontSize: 13, margin: 0 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleSetup}
            disabled={submitting}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              background: "var(--dpf-accent)",
              color: "#fff",
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
