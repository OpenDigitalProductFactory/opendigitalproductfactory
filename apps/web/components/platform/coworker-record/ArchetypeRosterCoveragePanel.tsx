import { StatCard } from "@/components/ui/report-kit";
import type { RosterCoverage } from "@/lib/coworker-record/archetype-roster-coverage";

export type RosterCoverageCopy = {
  heading: string;
  staffedLabel: string;
  missingLabel: string;
  platformOrchestrators: string;
  completeHint: string;
};

export function ArchetypeRosterCoveragePanel({
  coverage,
  copy,
}: {
  coverage: RosterCoverage;
  copy: RosterCoverageCopy;
}) {
  const complete = coverage.missing.length === 0;
  return (
    <section style={{ marginBottom: 18 }}>
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--dpf-muted)",
          marginBottom: 10,
        }}
      >
        {copy.heading}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <StatCard
          label={copy.staffedLabel}
          value={`${coverage.staffedCount}/${coverage.requiredCount}`}
          hint={coverage.archetypeId ?? copy.platformOrchestrators}
          intent={complete ? "success" : "warning"}
        />
        <StatCard
          label={copy.missingLabel}
          value={coverage.missing.length}
          hint={complete ? copy.completeHint : coverage.missing.join(", ")}
          intent={complete ? "success" : "warning"}
        />
      </div>
    </section>
  );
}
