import { StatusBadge, type Intent } from "@/components/ui/report-kit";
import type { WorkWarrant } from "@/lib/decision/work-warrant";

type WarrantAltitude = WorkWarrant["altitude"];
type WarrantLane = WorkWarrant["lane"];
type WarrantEvidence = WorkWarrant["evidenceProfile"];
type WarrantReporting = WorkWarrant["reportingProfile"];

const ALTITUDE_COPY: Record<WarrantAltitude, { label: string; summary: string; intent: Intent }> = {
  WSID: {
    label: "Craft-level work",
    summary: "lightweight execution",
    intent: "neutral",
  },
  WWWD: {
    label: "Business-level work",
    summary: "operator-confirmed business review",
    intent: "accent",
  },
  WWMD: {
    label: "Architecture-level work",
    summary: "governed review",
    intent: "warning",
  },
};

const LANE_COPY: Record<WarrantLane, string> = {
  "autonomous-bs": "autonomous Build Studio lane",
  "governed-interactive": "governed review",
  "direct-expert": "direct expert review",
};

const EVIDENCE_COPY: Record<WarrantEvidence, string> = {
  minimal: "minimal evidence",
  standard: "standard evidence",
  compliance: "compliance evidence",
  architectural: "ledger evidence",
};

const REPORTING_COPY: Record<WarrantReporting, string> = {
  "one-line": "one-line update",
  business: "business summary",
  ledger: "ledger report",
};

function firstReason(warrant: WorkWarrant): string | null {
  return warrant.reasons.find((reason) => !reason.startsWith("altitude ")) ?? warrant.reasons[0] ?? null;
}

function isWorkWarrant(value: unknown): value is WorkWarrant {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkWarrant>;
  return (
    (candidate.altitude === "WSID" || candidate.altitude === "WWWD" || candidate.altitude === "WWMD") &&
    (candidate.lane === "autonomous-bs" || candidate.lane === "governed-interactive" || candidate.lane === "direct-expert") &&
    !!candidate.budget &&
    typeof candidate.budget === "object" &&
    typeof candidate.budget.modelTier === "string" &&
    typeof candidate.evidenceProfile === "string" &&
    typeof candidate.reportingProfile === "string" &&
    Array.isArray(candidate.reasons)
  );
}

export function BuildWorkWarrantBand({ warrant }: { warrant: unknown }) {
  if (!isWorkWarrant(warrant)) return null;

  const altitude = ALTITUDE_COPY[warrant.altitude];
  const model = `${warrant.budget.modelTier} model`;
  const evidence = EVIDENCE_COPY[warrant.evidenceProfile];
  const reporting = REPORTING_COPY[warrant.reportingProfile];
  const lane = LANE_COPY[warrant.lane];
  const reason = firstReason(warrant);

  return (
    <section
      data-testid="build-work-warrant-band"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 shadow-dpf-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sm font-semibold text-[var(--dpf-text)]">Work warrant</h3>
        <StatusBadge intent={altitude.intent} label={altitude.label} variant="soft" uppercase={false} />
        {warrant.needsOperatorConfirm && (
          <StatusBadge intent="warning" label="Needs confirmation" variant="soft" uppercase={false} />
        )}
      </div>
      <p className="m-0 mt-2 max-w-4xl text-xs leading-relaxed text-[var(--dpf-text-secondary)]">
        {altitude.summary}: {lane}, {model}, {evidence}, {reporting}.
      </p>
      {reason && (
        <p className="m-0 mt-1 max-w-4xl text-xs leading-relaxed text-[var(--dpf-muted)]">
          Why: {reason}
        </p>
      )}
    </section>
  );
}
