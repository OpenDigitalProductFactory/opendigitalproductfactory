// /admin/data-stewardship — MDM steward queue + data-quality scorecard +
// match tuning (EP-4A12A7CB: BI-FEA49EC1 / BI-28577CD1 / BI-37F52B70 /
// BI-77489158 / BI-1ABF6443). The queue rows come from the persisted
// MdmStewardTask table; the scorecard is the published read model with its
// TrustAssessment envelope — the first consumer of the publishing contract.
import { listOpenStewardTasks } from "@/lib/mdm/steward";
import { getCustomerMasterDataQuality } from "@/lib/mdm/publish";
import { loadMatchConfig } from "@/lib/mdm/match-config";
import { listRecentAutoResolutions } from "@/lib/mdm/autonomous-steward";
import { StewardTaskList, type StewardTaskRow } from "@/components/admin/StewardTaskList";
import { MatchConfigCard } from "@/components/admin/MatchConfigCard";
import { DataStewardPanel, type AutoResolution } from "@/components/admin/DataStewardPanel";

export const dynamic = "force-dynamic";

export default async function DataStewardshipPage() {
  const [tasks, quality, accountConfig, contactConfig, recentAuto] = await Promise.all([
    listOpenStewardTasks(),
    getCustomerMasterDataQuality(),
    loadMatchConfig("customer-account"),
    loadMatchConfig("customer-contact"),
    listRecentAutoResolutions(),
  ]);

  const tiles = [
    { label: "Accounts", value: String(quality.accountsTotal) },
    { label: "Complete (site + industry)", value: `${quality.completenessPct}%` },
    { label: "Open duplicate reviews", value: String(quality.openDuplicateTasks) },
    { label: "Open staleness reviews", value: String(quality.openStaleTasks) },
    { label: "Trust tier", value: quality.trust.tier },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Data Stewardship</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Review possible duplicates and stale records, and tune how strictly new entries are
          matched. {quality.trust.summary}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
          >
            <p className="text-[10px] text-[var(--dpf-muted)]">{tile.label}</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <DataStewardPanel
          recent={recentAuto.map((r) => ({ ...r, at: r.at.toISOString() })) as AutoResolution[]}
        />
      </div>

      <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-2">Review queue</h2>
      <StewardTaskList tasks={tasks as StewardTaskRow[]} />

      <h2 className="text-sm font-semibold text-[var(--dpf-text)] mt-8 mb-2">Matching rules</h2>
      <p className="text-xs text-[var(--dpf-muted)] mb-2">
        Lower thresholds catch more possible duplicates (more reviews); higher thresholds only
        flag near-certain ones. Defaults apply until saved.
      </p>
      <div className="space-y-3">
        <MatchConfigCard domain="customer-account" config={accountConfig} />
        <MatchConfigCard domain="customer-contact" config={contactConfig} />
      </div>
    </div>
  );
}
