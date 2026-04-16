"use client";

import { useState } from "react";
import Link from "next/link";

const INDUSTRY_OPTIONS = [
  { value: "healthcare-wellness", label: "Healthcare & Wellness" },
  { value: "beauty-personal-care", label: "Beauty & Personal Care" },
  { value: "trades-maintenance", label: "Trades & Maintenance" },
  { value: "professional-services", label: "Professional Services" },
  { value: "education-training", label: "Education & Training" },
  { value: "pet-services", label: "Pet Services" },
  { value: "food-hospitality", label: "Food & Hospitality" },
  { value: "retail-goods", label: "Retail & Goods" },
  { value: "fitness-recreation", label: "Fitness & Recreation" },
  { value: "nonprofit-community", label: "Nonprofit & Community" },
  { value: "hoa-property-management", label: "HOA & Property Management" },
];

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

type BusinessContextData = {
  description: string;
  targetMarket: string;
  industry: string;
  companySize: string | null;
  geographicScope: string | null;
  revenueModel: string;
  contactEmail: string;
  contactPhone: string;
};

type BusinessContextFormProps = {
  initial: BusinessContextData;
  /** When true, show the compact quick-edit layout (returning user). */
  isEdit?: boolean;
  /** Fields that were auto-populated from URL import during setup. */
  autoFilledFields?: string[];
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

export function BusinessContextForm({ initial, isEdit, autoFilledFields }: BusinessContextFormProps) {
  const [data, setData] = useState<BusinessContextData>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());

  const hasAutoFill = (autoFilledFields?.length ?? 0) > 0;

  function update<K extends keyof BusinessContextData>(field: K, value: BusinessContextData[K]) {
    setData((prev) => ({ ...prev, [field]: value }));
    setEditedFields((prev) => new Set(prev).add(field));
    setSaved(false);
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/business-context/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
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

  return (
    <div style={{ maxWidth: 560, color: "var(--dpf-text)" }}>
      {!isEdit && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Tell us about your business</h2>
          <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginBottom: 20 }}>
            This helps the platform and your AI coworker understand what you do, who you serve, and how your business operates.
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
        {/* Industry */}
        <label style={labelStyle}>
          <div style={fieldLabelStyle}>What industry are you in? *</div>
          <select
            value={data.industry}
            onChange={(e) => update("industry", e.target.value)}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Select your industry...</option>
            {INDUSTRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                {o.label}
              </option>
            ))}
          </select>
          {autoFilledFields?.includes("industry") && <AutoFillHint field="industry" editedFields={editedFields} />}
        </label>

        {/* Description */}
        <label style={labelStyle}>
          <div style={fieldLabelStyle}>What does your business do?</div>
          <textarea
            value={data.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="Describe what your business does in 1-2 sentences"
            rows={2}
            style={{ ...inputStyle, resize: "none" }}
          />
          <div style={hintStyle}>
            Your AI coworker uses this to understand your business when building features and providing guidance.
          </div>
          {autoFilledFields?.includes("description") && <AutoFillHint field="description" editedFields={editedFields} />}
        </label>

        {/* Target market */}
        <label style={labelStyle}>
          <div style={fieldLabelStyle}>Who do you serve?</div>
          <input
            type="text"
            value={data.targetMarket}
            onChange={(e) => update("targetMarket", e.target.value)}
            placeholder="e.g. Homeowners in the community, Local pet owners, Small business clients"
            style={inputStyle}
          />
          <div style={hintStyle}>
            Your stakeholders — the people who interact with your business. These aren't always "customers."
          </div>
        </label>

        {/* Company size */}
        <div style={labelStyle}>
          <div style={fieldLabelStyle}>Company size</div>
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

        {/* Contact details */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={labelStyle}>
            <div style={fieldLabelStyle}>Contact email</div>
            <input
              type="email"
              value={data.contactEmail}
              onChange={(e) => update("contactEmail", e.target.value)}
              placeholder="info@example.com"
              style={inputStyle}
            />
            {autoFilledFields?.includes("contactEmail") && <AutoFillHint field="contactEmail" editedFields={editedFields} />}
          </label>
          <label style={labelStyle}>
            <div style={fieldLabelStyle}>Contact phone</div>
            <input
              type="tel"
              value={data.contactPhone}
              onChange={(e) => update("contactPhone", e.target.value)}
              placeholder="+1 555 000 0000"
              style={inputStyle}
            />
            {autoFilledFields?.includes("contactPhone") && <AutoFillHint field="contactPhone" editedFields={editedFields} />}
          </label>
        </div>

        {/* Error / success */}
        {error && <p style={{ color: "var(--dpf-error)", fontSize: 13, margin: 0 }}>{error}</p>}
        {saved && <p style={{ color: "var(--dpf-success)", fontSize: 13, margin: 0 }}>Saved successfully.</p>}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !data.industry}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              background: "var(--dpf-accent)",
              color: "#fff",
              cursor: submitting ? "wait" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: submitting || !data.industry ? 0.7 : 1,
            }}
          >
            {submitting ? "Saving..." : isEdit ? "Save" : "Continue"}
          </button>
        </div>

        {/* Cross-link to business models */}
        {data.industry && (
          <div style={{
            marginTop: 4,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-1)",
            fontSize: 12,
            color: "var(--dpf-muted)",
          }}>
            Your business is classified as <strong style={{ color: "var(--dpf-text)" }}>
              {INDUSTRY_OPTIONS.find((o) => o.value === data.industry)?.label ?? data.industry}
            </strong>.{" "}
            <Link href="/admin/business-models" style={{ color: "var(--dpf-accent)" }}>
              See operating model templates
            </Link>{" "}
            that fit this industry.
          </div>
        )}
      </div>
    </div>
  );
}
