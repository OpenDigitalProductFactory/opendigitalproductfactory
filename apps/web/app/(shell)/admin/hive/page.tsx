import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { ContributionProvenanceTable } from "@/components/admin/ContributionProvenanceTable";
import { HiveContributionsPanel } from "@/components/admin/HiveContributionsPanel";
import { HiveResultReviewActions } from "@/components/admin/HiveResultReviewActions";
import { SeedContributionReviewTable } from "@/components/admin/SeedContributionReviewTable";
import { StatusBadge, type Intent } from "@/components/ui/report-kit";
import { getHiveContributionsView } from "@/lib/actions/hive-contributions";

const STATUS_INTENTS: Record<string, Intent> = {
  submitted: "neutral",
  curating: "accent",
  accepted: "success",
  rejected: "warning",
  withdrawn: "neutral",
};

export default async function AdminHiveContributionsPage() {
  const view = await getHiveContributionsView();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Hive Contributions</p>
      </div>
      <AdminTabNav />

      <div className="mt-6 space-y-8">
        <section>
          <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">What you share with the hive</h2>
          <p className="text-sm text-[var(--dpf-muted)] mb-4">
            One place to govern everything that flows to the hive. Device fingerprints are PII-free and default on — every
            install&apos;s discoveries make every install smarter. Opt out anytime; it&apos;s honored immediately.
          </p>
          <HiveContributionsPanel view={view} />
        </section>

        <section>
          <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">Contributor identity</h2>
          <p className="text-sm text-[var(--dpf-muted)] mb-3">
            One stable, obfuscated pseudonym used across every contribution type — attributable without being personally
            identifying.
          </p>
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-sm"
            style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
          >
            {view.contributor ?? "not yet generated"}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">Contribution provenance</h2>
          <p className="text-sm text-[var(--dpf-muted)] mb-3">
            A plain-language view of what is kept here, privately backed up, or shared with the community. A feature can
            be active on this system and also sent outward, so these states are shown separately.
          </p>
          <ContributionProvenanceTable rows={view.contributionProvenance} />
        </section>

        <section>
          <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">Seed contribution review</h2>
          <p className="text-sm text-[var(--dpf-muted)] mb-3">
            Seed changes are approved only for the installs, archetypes, or business verticals they actually fit.
            Local defaults and changes that still need parameterization cannot become fleet defaults.
          </p>
          <SeedContributionReviewTable rows={view.seedReviews} />
        </section>

        <section>
          <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">Contribution ledger</h2>
          <p className="text-sm text-[var(--dpf-muted)] mb-3">
            What was shared, when, and its curation status.
          </p>
          {view.ledger.length === 0 ? (
            <div
              className="p-6 text-sm text-[var(--dpf-muted)] rounded-lg text-center"
              style={{ background: "var(--dpf-surface-1)", border: "1px dashed var(--dpf-border)" }}
            >
              Nothing contributed yet. When the platform shares a device fingerprint or improvement, it appears here.
            </div>
          ) : (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--dpf-border)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--dpf-surface-1)" }} className="text-left text-xs text-[var(--dpf-muted)]">
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Summary</th>
                    <th className="px-3 py-2 font-medium">Redaction</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Delivery</th>
                    <th className="px-3 py-2 font-medium">Review</th>
                    <th className="px-3 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {view.ledger.map((e) => (
                    <tr key={e.id} className="border-t" style={{ borderColor: "var(--dpf-border)" }}>
                      <td className="px-3 py-2 text-[var(--dpf-text)] whitespace-nowrap">{e.contributionType}</td>
                      <td className="px-3 py-2 text-[var(--dpf-text)]">{e.summary}</td>
                      <td className="px-3 py-2 text-[var(--dpf-muted)] whitespace-nowrap">{e.redactionStatus ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <StatusBadge
                          intent={STATUS_INTENTS[e.status] ?? "neutral"}
                          label={e.status}
                          uppercase={false}
                          variant="soft"
                        />
                      </td>
                      <td className="px-3 py-2 text-[var(--dpf-muted)]">
                        {e.contributionType === "result" ? (
                          <span>{e.deliveryStatus}{e.deliveryAttempts ? ` · ${e.deliveryAttempts} attempt${e.deliveryAttempts === 1 ? "" : "s"}` : ""}</span>
                        ) : "—"}
                        {e.deliveryRemoteRef ? <a href={e.deliveryRemoteRef} className="ml-2 text-[var(--dpf-accent)] hover:underline">Open</a> : null}
                        {e.deliveryError ? <span className="mt-1 block max-w-xs text-xs text-[var(--dpf-warning)]">{e.deliveryError}</span> : null}
                      </td>
                      <td className="px-3 py-2">
                        {e.contributionType === "result" ? <HiveResultReviewActions id={e.id} status={e.status} deliveryStatus={e.deliveryStatus} /> : "—"}
                      </td>
                      <td className="px-3 py-2 text-[var(--dpf-muted)] whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
