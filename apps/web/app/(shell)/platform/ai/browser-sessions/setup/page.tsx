import Link from "next/link";
import { StatusBadge } from "@/components/ui/report-kit";
import type { Intent } from "@/components/ui/report-kit/statusColors";
import { LocalTime } from "@/components/ui/LocalTime";
import { listServiceAccountProfiles } from "@/lib/browser-drive/ledger";
import { ServiceAccountSetupForm } from "../ServiceAccountSetupForm";

// Service Account Browser Setup (EP-BROWSER-DRIVE, spec §9.2 / §10.1). Lists the
// provisioned service-account profiles + their credential freshness, and hosts
// the one-time attended-bootstrap form.

const CRED_INTENT: Record<string, Intent> = {
  configured: "success",
  "needs-reauth": "warning",
  unconfigured: "neutral",
  unknown: "neutral",
};

function credLabel(status: string): string {
  return status.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function ServiceAccountSetupPage() {
  const profiles = await listServiceAccountProfiles();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Service Account Browser Setup</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Scoped browser identities a coworker drives autonomously. Each holds only its own
          site logins (least-privilege) — never your personal browser session.{" "}
          <Link href="/platform/ai/browser-sessions" className="text-[var(--dpf-accent)]">
            View session ledger →
          </Link>
        </p>
      </div>

      <ServiceAccountSetupForm />

      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-2">Provisioned profiles</h2>
        {profiles.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">None yet. Set one up above.</p>
        ) : (
          <div className="rounded-lg border border-[var(--dpf-border)] divide-y divide-[var(--dpf-border)]">
            {profiles.map((p) => (
              <div key={p.actingPrincipalId} className="p-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-mono text-[var(--dpf-text)] truncate">{p.actingPrincipalId}</p>
                  <p className="text-xs text-[var(--dpf-muted)] truncate">
                    {p.siteKeys.join(", ") || "—"} · {p.targetDomains.join(", ") || "no allowlist"}
                  </p>
                  {p.lastErrorMsg ? (
                    <p className="text-xs text-[var(--dpf-muted)] truncate">{p.lastErrorMsg}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {p.lastTestedAt ? (
                    <span className="text-xs text-[var(--dpf-muted)]">
                      tested <LocalTime value={p.lastTestedAt} />
                    </span>
                  ) : null}
                  <StatusBadge intent={CRED_INTENT[p.credentialStatus] ?? "neutral"} label={credLabel(p.credentialStatus)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
