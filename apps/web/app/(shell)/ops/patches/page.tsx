import Link from "next/link";
import { prisma } from "@dpf/db";

import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { StatusBadge } from "@/components/ui/report-kit";
import {
  getPatchPosture,
  type PatchPostureDb,
  type PatchPostureFinding,
} from "@/lib/patch/patch-posture";

// Live posture — never statically cached.
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ severity?: string; kind?: string; status?: string }>;
};

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

const KIND_LABEL: Record<string, string> = {
  vulnerability: "Vulnerability",
  "missing-patch": "Update available",
  "unsupported-component": "End of life",
};

const SELECT_CLASS =
  "text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] focus:outline-none focus:border-[var(--dpf-accent)]";
const OPTION_CLASS = "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]";

export default async function PatchesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const posture = await getPatchPosture(prisma as unknown as PatchPostureDb, {
    status: sp.status === "all" ? "all" : "open",
    limit: 500,
  });

  let findings = posture.findings;
  if (sp.severity) findings = findings.filter((f) => f.policySeverity === sp.severity);
  if (sp.kind) findings = findings.filter((f) => f.findingKind === sp.kind);

  const totals = posture.totals;
  const hasFilter = Boolean(sp.severity || sp.kind || sp.status);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Estate patch posture — what is out of date or exposed across discovered software.
        </p>
      </div>

      <OpsTabNav />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-6">
        <SummaryTile label="Open findings" value={totals.findings} />
        <SummaryTile label="Critical / High" value={(totals.bySeverity.critical ?? 0) + (totals.bySeverity.high ?? 0)} />
        <SummaryTile label="Actively exploited (KEV)" value={totals.kev} />
        <SummaryTile label="Affected hosts" value={totals.hosts} />
      </div>

      <form className="flex flex-wrap gap-3 mb-6">
        <select name="severity" defaultValue={sp.severity ?? ""} className={SELECT_CLASS}>
          <option value="" className={OPTION_CLASS}>
            All severities
          </option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s} className={OPTION_CLASS}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        <select name="kind" defaultValue={sp.kind ?? ""} className={SELECT_CLASS}>
          <option value="" className={OPTION_CLASS}>
            All types
          </option>
          {Object.entries(KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value} className={OPTION_CLASS}>
              {label}
            </option>
          ))}
        </select>

        <select name="status" defaultValue={sp.status ?? ""} className={SELECT_CLASS}>
          <option value="" className={OPTION_CLASS}>
            Open only
          </option>
          <option value="all" className={OPTION_CLASS}>
            All (incl. resolved)
          </option>
        </select>

        <button
          type="submit"
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          Filter
        </button>

        {hasFilter && (
          <Link
            href="/ops/patches"
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
          >
            Clear
          </Link>
        )}
      </form>

      {findings.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">
          {totals.findings === 0
            ? "No patch findings from the latest assessment. Posture is clean for everything assessed."
            : "No findings match the current filters."}
        </p>
      ) : (
        <div className="space-y-2">
          {findings.map((finding) => (
            <FindingRow key={finding.findingKey} finding={finding} />
          ))}
        </div>
      )}

      {posture.capped && (
        <p className="text-[10px] text-[var(--dpf-muted)] mt-3">
          Showing the first 500 findings. Narrow with the filters above.
        </p>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <p className="text-[11px] text-[var(--dpf-muted)]">{label}</p>
      <p className="text-2xl font-bold text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}

function FindingRow({ finding }: { finding: PatchPostureFinding }) {
  return (
    <div className="p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm text-[var(--dpf-text)] break-words">{finding.title}</span>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <StatusBadge domain="severity" status={finding.policySeverity} variant="soft" uppercase={false} />
            <span className="text-[10px] text-[var(--dpf-muted)]">
              {KIND_LABEL[finding.findingKind] ?? finding.findingKind}
            </span>
            {finding.cisaKev && (
              <StatusBadge domain="severity" status="critical" label="KEV" variant="solid" uppercase={false} />
            )}
            <span className="text-[10px] text-[var(--dpf-muted)] break-words">{finding.vendorIdentifier}</span>
          </div>
        </div>
        <div className="text-right text-[10px] text-[var(--dpf-muted)] shrink-0">
          {finding.installedVersion && <p>installed {finding.installedVersion}</p>}
          {finding.targetVersion && <p>&rarr; {finding.targetVersion}</p>}
          {finding.status !== "open" && <p>{finding.status}</p>}
        </div>
      </div>
    </div>
  );
}
