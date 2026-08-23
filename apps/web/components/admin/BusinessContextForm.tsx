"use client";

import { useState } from "react";
import Link from "next/link";
import {
  resolveArchetypeSummaryState,
  type ArchetypeSummary,
} from "./business-context-form-state";
import { EmailInput } from "@/components/ui/EmailInput";
import { DataHandlingChips } from "@/components/admin/DataHandlingChips";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { SubmitButton, FormStatus } from "@/components/ui/form";
import { BusinessDocumentUpload } from "@/components/admin/BusinessDocumentUpload";
import { RosterImport } from "@/components/admin/RosterImport";
import { MarketContextFields } from "@/components/admin/MarketContextFields";
import {
  COUNTRY_OPTIONS,
  US_STATES,
  applyCountrySelection,
  applyStateSelection,
  type OrgAddress,
} from "@/lib/shared/org-address";
import { resolveTimezoneFromAddress } from "@/lib/timezone-from-location";

// Sentinel for the "Other / not listed" country choice — reveals a free-text
// country input. Kept out of OrgAddress.countryCode, which only holds real codes.
const OTHER_COUNTRY = "__other__";

const COMPANY_SIZE_OPTIONS = [
  { value: "solo", label: "Solo", description: "Just me" },
  { value: "small", label: "Small", description: "2-10 people" },
  { value: "medium", label: "Medium", description: "11-50 people" },
  { value: "large", label: "Large", description: "50+ people" },
];

const GEOGRAPHIC_SCOPE_OPTIONS = [
  { value: "local", label: "Local", description: "City or neighborhood" },
  { value: "regional", label: "Regional", description: "State or region" },
  { value: "national", label: "National", description: "Entire country" },
  { value: "international", label: "International", description: "Multiple countries" },
];

// Risk posture (EP-ONBOARDING-INTAKE P0). Values are the canonical RISK_POSTURES
// enum; labels are plain-language display only (easily re-tuned). Pre-set from
// the industry default — sets the autonomy *envelope*, not the live level.
const RISK_POSTURE_OPTIONS = [
  { value: "conservative", label: "Cautious", description: "More employee review; AI acts only on safe, routine work" },
  { value: "balanced", label: "Balanced", description: "AI handles the everyday; checks in on consequential calls" },
  { value: "progressive", label: "Fast-moving", description: "AI runs with more autonomy; you stay in the loop on the big ones" },
];

// Jurisdiction options for the compliance-scope capture. Slugs match
// PROFESSION_JURISDICTIONS so the corpus jurisdiction-basis model can match them.
const JURISDICTION_OPTIONS = [
  { value: "us", label: "United States" },
  { value: "eu", label: "European Union" },
  { value: "uk", label: "United Kingdom" },
];

const COMPLIANCE_SCOPE_DIMENSIONS = [
  { field: "operatesIn", label: "Where the business operates" },
  { field: "sellsTo", label: "Where your customers are (you sell to)" },
  { field: "employsIn", label: "Where your employees work" },
  { field: "dataResidency", label: "Where data must stay (data residency)" },
] as const;

// Market-listing status. Values match the LISTING_STATUSES enum in
// regulation-applicability.ts so listing-gated regimes (e.g. UK Corporate
// Governance Code Provision 29) can match them. Only surfaced when the business
// operates in the UK — a listed-vs-private distinction only changes what applies
// for UK-operating companies, so a non-UK layman never sees it.
const LISTING_STATUS_OPTIONS = [
  { value: "private", label: "Private (not listed)" },
  { value: "premium-listed", label: "Premium listing (LSE Main Market / FTSE 350)" },
  { value: "standard-listed", label: "Standard listing" },
  { value: "aim-listed", label: "AIM-listed" },
  { value: "other", label: "Other / not sure" },
];


type JurisdictionScopeField = (typeof COMPLIANCE_SCOPE_DIMENSIONS)[number]["field"];

type BusinessContextData = {
  description: string;
  mission: string;
  targetMarket: string;
  sourceSystem: string;
  companySize: string | null;
  geographicScope: string | null;
  revenueModel: string;
  contactEmail: string;
  contactPhone: string;
  operatesIn: string[];
  sellsTo: string[];
  employsIn: string[];
  dataResidency: string[];
  handlesCardPayments: boolean;
  dataHandling: string[];
  listingStatus: string | null;
  riskPosture: string | null;
  address: OrgAddress;
};

type BusinessContextFormProps = {
  initial: BusinessContextData;
  /** Active portal archetype (industry is derived from archetype.category). */
  archetypeSummary: ArchetypeSummary;
  /** When true, show the compact quick-edit layout (returning user). */
  isEdit?: boolean;
  /** Fields that were auto-populated from URL import during setup. */
  autoFilledFields?: string[];
  /** Archetype-aware starter mission the operator can apply with one click. */
  missionSuggestion?: string;
};

function AutoFillHint({ field, editedFields }: { field: string; editedFields: Set<string> }) {
  if (editedFields.has(field)) return null;
  return (
    <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--dpf-accent)", opacity: 0.6, flexShrink: 0 }} />
      Pre-filled from your website — edit if needed
    </div>
  );
}

export function BusinessContextForm({ initial, archetypeSummary, isEdit, autoFilledFields, missionSuggestion }: BusinessContextFormProps) {
  const archetypeState = resolveArchetypeSummaryState(archetypeSummary);
  const entityNoun = archetypeSummary?.category === "nonprofit-community" ? "organization" : "business";
  const [data, setData] = useState<BusinessContextData>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());
  // Progressive disclosure: the cross-border detail (sell/employ/data-residency)
  // is hidden until the operator says their business spans more than one region.
  const [showCrossBorder, setShowCrossBorder] = useState(
    initial.sellsTo.length > 0 || initial.employsIn.length > 0 || initial.dataResidency.length > 0,
  );
  // Country picker selection: a real ISO code, OTHER_COUNTRY, or "" (unset).
  // Tracked locally because OrgAddress.countryCode only ever holds real codes.
  const [countrySel, setCountrySel] = useState<string>(
    initial.address.countryCode ?? (initial.address.country ? OTHER_COUNTRY : ""),
  );

  const hasAutoFill = (autoFilledFields?.length ?? 0) > 0;

  function update<K extends keyof BusinessContextData>(field: K, value: BusinessContextData[K]) {
    setData((prev) => ({ ...prev, [field]: value }));
    setEditedFields((prev) => new Set(prev).add(field));
    setSaved(false);
  }

  function setAddress(next: OrgAddress) {
    setData((prev) => ({ ...prev, address: next }));
    setEditedFields((prev) => new Set(prev).add("address"));
    setSaved(false);
  }

  function updateAddressField(field: keyof OrgAddress, value: string) {
    const next = { ...data.address };
    if (value) next[field] = value;
    else delete next[field];
    setAddress(next);
  }

  function onCountryChange(value: string) {
    setCountrySel(value);
    // Logic lives in the canonical address module so it is testable without
    // mounting the form, and so this component stays under the module-size
    // ceiling. See applyCountrySelection for why a FIRST selection differs from a
    // country switch (IMP-066).
    setAddress(applyCountrySelection(data.address, value, countrySel, OTHER_COUNTRY));
  }

  function onStateChange(value: string) {
    setAddress(applyStateSelection(data.address, value));
  }

  // Auto-derived from the captured address — shown read-only; the operator
  // confirms/overrides it in the Operating Hours timezone picker (never typed).
  const derivedTimezone = resolveTimezoneFromAddress(data.address);

  function toggleJurisdiction(field: JurisdictionScopeField, value: string) {
    const cur = data[field];
    update(field, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
  }

  function renderScopeChips(field: JurisdictionScopeField, label: string) {
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, marginBottom: 4 }}>{label}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {JURISDICTION_OPTIONS.map((o) => {
            const on = data[field].includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggleJurisdiction(field, o.value)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  border: on ? "2px solid var(--dpf-accent)" : "1px solid var(--dpf-border)",
                  background: on
                    ? "color-mix(in srgb, var(--dpf-accent) 8%, var(--dpf-surface-1))"
                    : "var(--dpf-surface-1)",
                  color: "var(--dpf-text)",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function togglePredicate(value: string) {
    const cur = data.dataHandling;
    update("dataHandling", cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      // Send risk posture only when the operator actually chose one. An untouched
      // industry-derived default is left for setup completion to (re)seed against
      // the archetype they finally pick, so it isn't frozen as an explicit choice.
      const payload: Record<string, unknown> = { ...data };
      if (!editedFields.has("riskPosture")) delete payload.riskPosture;
      const res = await fetch("/api/business-context/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Save failed");
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid var(--dpf-border)",
    fontSize: 14,
    color: "var(--dpf-text)",
    background: "var(--dpf-surface-1)",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = { fontSize: 13 };
  const fieldLabelStyle: React.CSSProperties = { fontWeight: 600, marginBottom: 4 };
  const hintStyle: React.CSSProperties = { fontSize: 11, color: "var(--dpf-muted)", marginTop: 4 };
  // <option> needs explicit themed colors (AGENTS.md §12) — inline equivalent of
  // bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] for this style-object form.
  const optionStyle: React.CSSProperties = { background: "var(--dpf-surface-2)", color: "var(--dpf-text)" };
  const optionalHint = <span style={{ color: "var(--dpf-muted)", fontWeight: 400 }}>(optional)</span>;

  return (
    <div style={{ maxWidth: 560, color: "var(--dpf-text)" }}>
      {!isEdit && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Tell us about your {entityNoun}</h2>
          <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginBottom: 20 }}>
            This helps the platform and your AI coworker understand what you do, who you serve, and how your {entityNoun} operates.
          </p>
        </>
      )}

      {hasAutoFill && !isEdit && (
        <div style={{
          borderLeft: "4px solid var(--dpf-accent)",
          paddingLeft: 12,
          marginBottom: 16,
          fontSize: 12,
          color: "var(--dpf-muted)",
        }}>
          We pre-filled some fields from your website. Review and adjust anything that doesn&apos;t look right.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Portal template / industry (read-only; industry is derived from archetype.category) */}
        {archetypeState.kind === "picked" ? (
          <div style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-1)",
            fontSize: 13,
          }}>
            <div style={{ fontSize: 11, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
              Portal template
            </div>
            <div style={{ color: "var(--dpf-text)", fontWeight: 600 }}>
              {archetypeState.name}
              <span style={{ color: "var(--dpf-muted)", fontWeight: 400 }}>
                {" "}— {archetypeState.industryLabel}
              </span>
            </div>
          </div>
        ) : (
          <div style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px dashed var(--dpf-border)",
            background: "var(--dpf-surface-1)",
            fontSize: 12,
            color: "var(--dpf-muted)",
          }}>
            Pick a{" "}
            <Link href={archetypeState.setupHref} style={{ color: "var(--dpf-accent)" }}>
              portal template
            </Link>
            {" "}— it sets your industry category automatically.
          </div>
        )}

        {/* Description */}
        <label style={labelStyle}>
          <div style={fieldLabelStyle}>What does your {entityNoun} do?</div>
          <textarea
            name="description"
            value={data.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder={`Describe what your ${entityNoun} does in 1-2 sentences`}
            rows={2}
            style={{ ...inputStyle, resize: "none" }}
          />
          <div style={hintStyle}>
            Your AI coworker uses this to understand your {entityNoun} when building features and providing guidance.
          </div>
          {autoFilledFields?.includes("description") && <AutoFillHint field="description" editedFields={editedFields} />}
        </label>

        {/* Mission */}
        <label style={labelStyle}>
          <div style={{ ...fieldLabelStyle, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <span>Why does your {entityNoun} exist?</span>
            {missionSuggestion && data.mission.trim() === "" && (
              <button
                type="button"
                onClick={() => update("mission", missionSuggestion)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--dpf-accent)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Suggest a starter
              </button>
            )}
          </div>
          <textarea
            name="mission"
            value={data.mission}
            onChange={(e) => update("mission", e.target.value)}
            placeholder={missionSuggestion ?? "Your mission in a sentence — the difference you set out to make"}
            rows={2}
            style={{ ...inputStyle, resize: "none" }}
          />
          <div style={hintStyle}>
            Your {entityNoun} mission. Every AI coworker keeps this in mind, and it seeds what your
            organization &quot;would do&quot; when a decision comes up.
          </div>
        </label>

        {/* Business document upload (optional) */}
        <BusinessDocumentUpload />

        {/* Employee-roster CSV import (optional) — EP-ONBOARDING-INTAKE P4 */}
        <RosterImport />

        {/* Target market */}
        <label style={labelStyle}>
          <div style={fieldLabelStyle}>Who do you serve?</div>
          <input
            type="text"
            name="targetMarket"
            value={data.targetMarket}
            onChange={(e) => update("targetMarket", e.target.value)}
            placeholder="e.g. Homeowners in the community, Local pet owners, Small business clients"
            style={inputStyle}
          />
          <div style={hintStyle}>
            Your stakeholders — the people who interact with your {entityNoun}. These aren&apos;t always &quot;customers.&quot;
          </div>
        </label>

        {/* Source system / migration context */}
        <label style={labelStyle}>
          <div style={fieldLabelStyle}>What system or process are you switching from? {optionalHint}</div>
          <input
            type="text"
            name="sourceSystem"
            value={data.sourceSystem}
            onChange={(e) => update("sourceSystem", e.target.value)}
            placeholder="e.g. QuickBooks, spreadsheets, paper forms, another platform"
            style={inputStyle}
          />
          <div style={hintStyle}>
            Helps your AI coworker plan imports, migration steps, and where old records may still live.
          </div>
        </label>

        {/* Market & competitive context (optional) */}
        <MarketContextFields />

        {/* Organization size (stored in the canonical companySize field). */}
        <div style={labelStyle}>
          <div style={fieldLabelStyle}>{entityNoun === "organization" ? "Organization" : "Company"} size</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
            {COMPANY_SIZE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => update("companySize", data.companySize === o.value ? null : o.value)}
                style={{
                  padding: "8px 4px",
                  textAlign: "center",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  border: data.companySize === o.value ? "2px solid var(--dpf-accent)" : "1px solid var(--dpf-border)",
                  background: data.companySize === o.value ? "color-mix(in srgb, var(--dpf-accent) 8%, var(--dpf-surface-1))" : "var(--dpf-surface-1)",
                  color: "var(--dpf-text)",
                }}
              >
                <div style={{ fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{o.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Geographic scope */}
        <div style={labelStyle}>
          <div style={fieldLabelStyle}>Geographic reach</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
            {GEOGRAPHIC_SCOPE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => update("geographicScope", data.geographicScope === o.value ? null : o.value)}
                style={{
                  padding: "8px 4px",
                  textAlign: "center",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  border: data.geographicScope === o.value ? "2px solid var(--dpf-accent)" : "1px solid var(--dpf-border)",
                  background: data.geographicScope === o.value ? "color-mix(in srgb, var(--dpf-accent) 8%, var(--dpf-surface-1))" : "var(--dpf-surface-1)",
                  color: "var(--dpf-text)",
                }}
              >
                <div style={{ fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{o.description}</div>
              </button>
            ))}
          </div>
          {autoFilledFields?.includes("geographicScope") && <AutoFillHint field="geographicScope" editedFields={editedFields} />}
        </div>

        {/* Business address — canonical Organization.address. Drives invoices,
            local presence, and (via country + US state) a state-accurate timezone
            the operator confirms in Operating Hours — never typed (§12/§17). */}
        <div style={{ borderTop: "1px solid var(--dpf-border)", paddingTop: 14 }}>
          <div style={fieldLabelStyle}>{entityNoun === "organization" ? "Organization" : "Business"} address</div>
          <div style={hintStyle}>
            Used for your invoices, local presence, and to set your timezone. We work the timezone
            out from your address — you never have to type one.
          </div>

          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Country (drives the state picker + timezone) */}
            <label style={labelStyle}>
              <div style={fieldLabelStyle}>Country</div>
              <select name="country" autoComplete="country" value={countrySel} onChange={(e) => onCountryChange(e.target.value)} style={inputStyle}>
                <option value="" style={optionStyle}>Select country…</option>
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code} style={optionStyle}>{c.name}</option>
                ))}
                <option value={OTHER_COUNTRY} style={optionStyle}>Other / not listed</option>
              </select>
            </label>

            {countrySel === OTHER_COUNTRY && (
              <label style={labelStyle}>
                <div style={fieldLabelStyle}>Country name</div>
                <input
                  type="text"
                  name="country"
                  autoComplete="country-name"
                  value={data.address.country ?? ""}
                  onChange={(e) => updateAddressField("country", e.target.value)}
                  placeholder="Country"
                  style={inputStyle}
                />
              </label>
            )}

            {/* Street */}
            <label style={labelStyle}>
              <div style={fieldLabelStyle}>Street address</div>
              <input
                type="text"
                name="line1"
                autoComplete="address-line1"
                value={data.address.line1 ?? ""}
                onChange={(e) => updateAddressField("line1", e.target.value)}
                placeholder="123 Main St"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              <div style={fieldLabelStyle}>Address line 2 {optionalHint}</div>
              <input
                type="text"
                name="line2"
                autoComplete="address-line2"
                value={data.address.line2 ?? ""}
                onChange={(e) => updateAddressField("line2", e.target.value)}
                placeholder="Suite, unit, floor"
                style={inputStyle}
              />
            </label>

            {/* City + State/Region */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={labelStyle}>
                <div style={fieldLabelStyle}>City / Town</div>
                <input
                  type="text"
                  name="city"
                  autoComplete="address-level2"
                  value={data.address.city ?? ""}
                  onChange={(e) => updateAddressField("city", e.target.value)}
                  placeholder="City"
                  style={inputStyle}
                />
              </label>

              {countrySel === "US" ? (
                <label style={labelStyle}>
                  <div style={fieldLabelStyle}>State</div>
                  <select
                    name="stateCode"
                    autoComplete="address-level1"
                    value={data.address.stateCode ?? ""}
                    onChange={(e) => onStateChange(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="" style={optionStyle}>Select state…</option>
                    {US_STATES.map((s) => (
                      <option key={s.code} value={s.code} style={optionStyle}>{s.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label style={labelStyle}>
                  <div style={fieldLabelStyle}>State / Province / Region {optionalHint}</div>
                  <input
                    type="text"
                    name="region"
                    autoComplete="address-level1"
                    value={data.address.region ?? ""}
                    onChange={(e) => updateAddressField("region", e.target.value)}
                    placeholder="Region"
                    style={inputStyle}
                  />
                </label>
              )}
            </div>

            {/* Postal code */}
            <label style={{ ...labelStyle, maxWidth: 220 }}>
              <div style={fieldLabelStyle}>Postal / ZIP code</div>
              <input
                type="text"
                name="postalCode"
                autoComplete="postal-code"
                value={data.address.postalCode ?? ""}
                onChange={(e) => updateAddressField("postalCode", e.target.value)}
                placeholder="ZIP / postcode"
                style={inputStyle}
              />
            </label>

            {/* Read-only derived-timezone hint (confirm under Operating Hours) */}
            {derivedTimezone && (
              <div style={{ fontSize: 12, color: "var(--dpf-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--dpf-accent)", opacity: 0.7, flexShrink: 0 }} />
                <span>
                  Detected timezone:{" "}
                  <strong style={{ color: "var(--dpf-text)", fontWeight: 600 }}>{derivedTimezone}</strong>
                  {" "}— confirm or change it under Operating Hours.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Compliance & regulatory scope — progressive disclosure keeps the
            default to a couple of plain choices; cross-border detail is opt-in. */}
        <div style={{ borderTop: "1px solid var(--dpf-border)", paddingTop: 14 }}>
          <div style={fieldLabelStyle}>Compliance &amp; regulatory scope</div>
          <div style={hintStyle}>
            Where your {entityNoun} operates decides which rules each AI coworker applies — taxes and marketing
            consent follow your customers, employment law follows your staff.
          </div>

          {renderScopeChips("operatesIn", `Where is your ${entityNoun} based / where do you operate?`)}

          <DataHandlingChips
            value={data.dataHandling}
            onToggle={togglePredicate}
            label={`What does your ${entityNoun} do with data? (pick all that apply — this decides which privacy, AI, marketing and accessibility rules apply)`}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={data.handlesCardPayments}
              onChange={(e) => update("handlesCardPayments", e.target.checked)}
            />
            We accept card payments (PCI-DSS applies wherever you handle cards)
          </label>

          {/* Listing status — only relevant for UK-operating companies, where the
              listed-vs-private distinction decides whether governance rules like
              the UK Corporate Governance Code (Provision 29) apply. Hidden
              otherwise to keep the default to a couple of plain choices. */}
          {data.operatesIn.includes("uk") && (
            <label style={{ display: "block", marginTop: 12, fontSize: 13 }}>
              <div style={{ marginBottom: 4 }}>Is the company listed on a stock exchange?</div>
              <select
                value={data.listingStatus ?? ""}
                onChange={(e) => update("listingStatus", e.target.value || null)}
                style={{
                  ...inputStyle,
                  background: "var(--dpf-surface-2)",
                  color: "var(--dpf-text)",
                }}
              >
                <option value="" style={{ background: "var(--dpf-surface-2)", color: "var(--dpf-text)" }}>
                  Select…
                </option>
                {LISTING_STATUS_OPTIONS.map((o) => (
                  <option
                    key={o.value}
                    value={o.value}
                    style={{ background: "var(--dpf-surface-2)", color: "var(--dpf-text)" }}
                  >
                    {o.label}
                  </option>
                ))}
              </select>
              <div style={hintStyle}>
                UK premium-listed companies must report on board internal-controls effectiveness
                (Corporate Governance Code, Provision 29).
              </div>
            </label>
          )}

          {showCrossBorder ? (
            <div style={{ marginTop: 12, paddingLeft: 12, borderLeft: "2px solid var(--dpf-border)" }}>
              {renderScopeChips("sellsTo", "Where your customers are (you sell to)")}
              {renderScopeChips("employsIn", "Where your employees work")}
              {renderScopeChips("dataResidency", "Where data must stay (data residency)")}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCrossBorder(true)}
              style={{ marginTop: 10, fontSize: 12, color: "var(--dpf-accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              + We serve people, employ staff, or store data in other regions
            </button>
          )}
        </div>

        {/* Risk posture (EP-ONBOARDING-INTAKE P0) — one plain choice, pre-set
            from industry. Sets the autonomy envelope, not the live level: the AI
            still starts cautious and earns autonomy as it proves itself. */}
        <div style={{ borderTop: "1px solid var(--dpf-border)", paddingTop: 14 }}>
          <div style={fieldLabelStyle}>How should your AI workforce balance speed and caution?</div>
          <div style={hintStyle}>
            Sets the starting point for how much your AI does on its own. It always begins cautious
            and earns more autonomy as it proves itself — change this anytime.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 8 }}>
            {RISK_POSTURE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => update("riskPosture", o.value)}
                style={{
                  padding: "8px 6px",
                  textAlign: "left",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  border: data.riskPosture === o.value ? "2px solid var(--dpf-accent)" : "1px solid var(--dpf-border)",
                  background: data.riskPosture === o.value ? "color-mix(in srgb, var(--dpf-accent) 8%, var(--dpf-surface-1))" : "var(--dpf-surface-1)",
                  color: "var(--dpf-text)",
                }}
              >
                <div style={{ fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{o.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Contact details */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={labelStyle}>
            <div style={fieldLabelStyle}>Contact email</div>
            <EmailInput
              name="contactEmail"
              value={data.contactEmail}
              onValueChange={(v) => update("contactEmail", v)}
              autoComplete="email"
              placeholder="info@example.com"
              style={inputStyle}
            />
            {autoFilledFields?.includes("contactEmail") && <AutoFillHint field="contactEmail" editedFields={editedFields} />}
          </label>
          <label style={labelStyle}>
            <div style={fieldLabelStyle}>Contact phone</div>
            <PhoneInput
              name="contactPhone"
              value={data.contactPhone}
              onValueChange={(v) => update("contactPhone", v)}
              autoComplete="tel"
              placeholder="(415) 555-1234"
              style={inputStyle}
            />
            {autoFilledFields?.includes("contactPhone") && <AutoFillHint field="contactPhone" editedFields={editedFields} />}
          </label>
        </div>

        {/* Error / success — announced live regions */}
        <FormStatus error={error} success={saved ? "Saved successfully." : null} />

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <SubmitButton
            type="button"
            onClick={handleSubmit}
            pending={submitting}
            pendingLabel="Saving…"
          >
            {isEdit ? "Save" : "Continue"}
          </SubmitButton>
        </div>
      </div>
    </div>
  );
}
