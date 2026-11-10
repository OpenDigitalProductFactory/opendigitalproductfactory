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
  // Fragment of StatCards only: a unique caption paragraph (or a wrapping
  // section after MixRow) grows the frozen /platform/ai/overview a11y tree
  // because collapseRepeatedSiblings cannot merge a new sibling kind. Sit
  // these cards in WorkforceSummaryPanel's existing KPI grid instead.
  return (
    <>
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
    </>
  );
}
