// apps/web/app/(shell)/platform/ai/page.tsx — AI Workforce directory (HRIS).
// EP-AI-WORKFORCE-001 (HRIS surface) §7: the roster overview. A filterable
// directory of every coworker (profession family / value stream / competency /
// jurisdiction / lifecycle / coverage-gap) with fitness-for-duty signals,
// each row linking to that coworker's record.
import { loadRoster } from "@/lib/coworker-record/roster";
import { RosterView } from "@/components/platform/coworker-record/RosterView";

export default async function PlatformAiPage() {
  const { rows, facets } = await loadRoster();

  const brokenProviders = rows.filter((r) => !r.providerHealthy);
  const coverageGaps = rows.filter((r) => r.unmapped || r.emptyCorpus);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>AI Workforce</h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          The AI workforce directory — filter by profession, competency, jurisdiction, lifecycle, and
          coverage gaps. Select a coworker to open its record.
        </p>
      </div>

      {brokenProviders.length > 0 && (
        <Banner tone="warning">
          {brokenProviders.length} coworker{brokenProviders.length !== 1 ? "s have" : " has"} an inactive
          pinned provider — they fall back to auto-routing ({brokenProviders.map((a) => a.name).join(", ")}).
        </Banner>
      )}
      {coverageGaps.length > 0 && (
        <Banner tone="warning">
          {coverageGaps.length} coworker{coverageGaps.length !== 1 ? "s" : ""} have a profession-coverage gap
          (unmapped role or empty corpus) — the demand queue for the next corpus to build.
        </Banner>
      )}

      {rows.length > 0 ? (
        <RosterView rows={rows} facets={facets} />
      ) : (
        <p style={{ fontSize: 12, color: "var(--dpf-muted)" }}>No coworkers registered yet.</p>
      )}
    </div>
  );
}

function Banner({ tone, children }: { tone: "warning"; children: React.ReactNode }) {
  const toneVar = "var(--dpf-warning)";
  return (
    <div
      style={{
        border: `1px solid ${toneVar}`,
        borderRadius: 8,
        padding: "9px 13px",
        marginBottom: 12,
        fontSize: 11,
        color: "var(--dpf-text-secondary)",
        background: "var(--dpf-surface)",
      }}
    >
      <span style={{ color: toneVar, fontWeight: 600, marginRight: 6 }}>⚠</span>
      {children}
    </div>
  );
}
