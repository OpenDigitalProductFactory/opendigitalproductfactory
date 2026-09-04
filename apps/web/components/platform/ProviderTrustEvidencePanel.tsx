import type {
  ProviderTrustClaimKey,
  ResolvedProviderTrustClaim,
} from "@/lib/routing/provider-suitability/evidence";
import type { ProviderConnectionPosture } from "@/lib/routing/provider-suitability/types";

const CLAIM_LABELS: Record<ProviderTrustClaimKey, string> = {
  "no-training": "No training on company data",
  "zero-retention": "Zero data retention",
  "regional-processing": "Regional processing",
  "enabled-regions": "Enabled processing regions",
  "approved-underlying-providers": "Approved router providers",
  "admin-audit-controls": "Administrative and audit controls",
  "enterprise-support-sla": "Enterprise support or SLA",
  "baa-on-file": "Business Associate Agreement (BAA)",
  "dpa-on-file": "Data Processing Agreement (DPA)",
  soc2: "SOC 2 assurance",
  iso27001: "ISO 27001 assurance",
  "fedramp-eligible": "FedRAMP eligibility",
  "service-provider-oversight-reviewed-at": "Service-provider oversight review",
  "student-data-terms-reviewed-at": "Student-data terms review",
  "financial-customer-info-reviewed-at": "Financial customer-information review",
};

function statusLabel(status: ResolvedProviderTrustClaim["status"]): string {
  if (status === "valid") return "Current";
  if (status === "missing") return "Not provided";
  if (status === "expired") return "Expired";
  if (status === "rejected") return "Rejected";
  if (status === "conflicting") return "Conflicting";
  return "Replaced";
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

const ACCOUNT_DECLARATION_CLAIMS = new Set<ProviderTrustClaimKey>([
  "no-training",
  "zero-retention",
  "regional-processing",
  "enabled-regions",
  "approved-underlying-providers",
]);

function nextActionLabel(claim: ResolvedProviderTrustClaim): string {
  if (claim.claimKey === "enabled-regions") {
    return "Confirm the required-region guarantee in Connected account and data terms above. Unverified region entitlement keeps region-restricted work blocked.";
  }
  if (claim.claimKey === "dpa-on-file") {
    return "No DPA evidence workflow is available on this page. Restricted work stays blocked until platform governance links a reviewed supplier contract or current DPA evidence.";
  }
  if (ACCOUNT_DECLARATION_CLAIMS.has(claim.claimKey)) {
    return `Update the matching declaration in Connected account and data terms above. ${claim.nextAction}`;
  }
  return `This page cannot change this evidence. Platform governance must resolve it. ${claim.nextAction}`;
}

export function ProviderTrustEvidencePanel({
  accountDeclarationSaved,
  evidenceStatus,
  lastReviewedAt,
  claims,
  requiredClaimKeys = claims.map((claim) => claim.claimKey),
  scopeHeadline,
  scopeSummary,
  actions = [],
}: {
  accountDeclarationSaved: boolean;
  evidenceStatus: ProviderConnectionPosture["evidenceStatus"];
  lastReviewedAt: string | null;
  claims: ResolvedProviderTrustClaim[];
  requiredClaimKeys?: ProviderTrustClaimKey[];
  scopeHeadline?: string;
  scopeSummary?: string;
  actions?: string[];
}) {
  const required = new Set(requiredClaimKeys);
  const restrictedClaimCount = claims.filter((claim) => required.has(claim.claimKey) && claim.status !== "valid").length;
  const restrictedWorkLimited = restrictedClaimCount > 0 || actions.length > 0;

  return (
    <section
      aria-labelledby="provider-trust-evidence-heading"
      className="mb-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="provider-trust-evidence-heading" className="m-0 text-sm font-semibold text-[var(--dpf-text)]">
            Provider trust evidence
          </h2>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Evidence applies only to this connected account. It never carries over to another key, subscription, or tenant.
          </p>
        </div>
        <span
          role="status"
          className={`rounded-full px-2 py-1 text-xs font-semibold ${restrictedWorkLimited ? "bg-[var(--dpf-warning-soft)] text-[var(--dpf-warning)]" : "bg-[var(--dpf-success-soft)] text-[var(--dpf-success)]"}`}
        >
          {scopeHeadline ?? (claims.length === 0
            ? "Restricted work not reviewed"
            : restrictedClaimCount > 0
              ? `${restrictedClaimCount} ${restrictedClaimCount === 1 ? "restriction" : "restrictions"} for restricted work`
              : "Current for restricted work")}
        </span>
      </div>

      <p className="mb-0 mt-3 text-xs font-medium text-[var(--dpf-text)]">
        {accountDeclarationSaved && lastReviewedAt
          ? `Account declaration saved · reviewed ${dateLabel(lastReviewedAt)}.`
          : "Account declaration not yet saved."}
        {scopeSummary ? ` ${scopeSummary}` : restrictedWorkLimited
          ? " General work is governed separately; sensitive or restricted work remains blocked until the evidence below is current."
          : " The current evidence supports restricted-work evaluation; routing still applies each workload's policy."}
      </p>

      {claims.length === 0 ? (
        <div className="mt-3 rounded border border-dashed border-[var(--dpf-border)] p-3 text-xs text-[var(--dpf-muted)]">
          No account-specific trust evidence is linked yet. General or public work remains governed separately; restricted work stays blocked until the required evidence is current.
        </div>
      ) : (
        <ul className="mt-3 grid list-none gap-2 p-0">
          {claims.map((claim) => (
            <li key={claim.claimKey} className="rounded border border-[var(--dpf-border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--dpf-text)]">{CLAIM_LABELS[claim.claimKey]}</span>
                <span className="text-xs text-[var(--dpf-muted)]">{statusLabel(claim.status)}</span>
              </div>
              <p className="mb-0 mt-1 text-xs text-[var(--dpf-muted)]">
                {claim.evidenceAgeDays == null ? "No dated evidence" : `${claim.evidenceAgeDays} days old`}
                {claim.expiresAt ? ` · valid until ${dateLabel(claim.expiresAt)}` : ""}
              </p>
              {claim.status !== "valid" && required.has(claim.claimKey) && (
                <p className="mb-0 mt-1 text-xs font-medium text-[var(--dpf-text)]">Next: {nextActionLabel(claim)}</p>
              )}
              {claim.status !== "valid" && !required.has(claim.claimKey) && (
                <p className="mb-0 mt-1 text-xs text-[var(--dpf-muted)]">Optional here.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {actions.length > 0 && (
        <div className="mt-3 rounded border border-[var(--dpf-warning)] bg-[var(--dpf-warning-soft)] p-3">
          <p className="m-0 text-xs font-semibold text-[var(--dpf-text)]">Next action</p>
          <ul className="mb-0 mt-1 list-disc space-y-1 pl-4 text-xs text-[var(--dpf-text)]">
            {actions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        </div>
      )}

      <p className="mb-0 mt-3 text-xs text-[var(--dpf-muted)]">
        Evidence state: {evidenceStatus.replaceAll("-", " ")}
        {lastReviewedAt ? ` · last reviewed ${dateLabel(lastReviewedAt)}` : " · not yet reviewed"}
      </p>
    </section>
  );
}
