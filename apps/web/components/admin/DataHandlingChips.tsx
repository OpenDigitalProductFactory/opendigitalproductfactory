"use client";

// Plain-language capture of what the business does with data / how it operates —
// the triggers that decide which HORIZONTAL regulations (privacy, breach, AI,
// marketing, accessibility, sector overlays) apply. Values are the
// DATA_HANDLING_PREDICATES enum in regulation-applicability.ts; the setup route
// validates against that closed set. `handles-card-data` is captured by the
// card-payments checkbox in BusinessContextForm (and bridged server-side), so it
// is deliberately omitted here to avoid double entry.
//
// Extracted from BusinessContextForm to keep that form under the module-size
// soft ceiling; presentational only (value + onToggle), no local state.

export const DATA_HANDLING_OPTIONS = [
  { value: "processes-personal-data", label: "Handle personal data (customers, staff, users)" },
  { value: "serves-consumers", label: "Serve individual consumers" },
  { value: "deploys-automated-decisioning", label: "Use AI / automated decisions about people" },
  { value: "sends-marketing", label: "Send marketing (email, SMS, or calls)" },
  { value: "publicly-accessible-service", label: "Run a public website or app" },
  { value: "handles-health-data", label: "Handle health data" },
  { value: "handles-financial-data", label: "Handle consumer financial data" },
  { value: "handles-education-data", label: "Handle student / education records" },
  { value: "government-customers", label: "Sell to government agencies" },
];

export function DataHandlingChips({
  value,
  onToggle,
  label,
}: {
  value: string[];
  onToggle: (value: string) => void;
  label: string;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {DATA_HANDLING_OPTIONS.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onToggle(o.value)}
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
