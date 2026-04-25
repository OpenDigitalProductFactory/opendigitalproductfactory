import { CONTRIBUTION_COPY } from "@/lib/integrate/contribution-copy";

// Server-rendered banner that surfaces when an install is on a non-fork_only
// contribution mode but hasn't yet chosen a contributionModel after the
// post-flag deploy. Self-hides on every other config state — flag off,
// fork_only installs, or already-configured contributionModel.
//
// Paired with the runtime guard in contribute_to_hive (Phase 4's
// resolveContributionDispatch returning kind: "error" when the model is
// null). This banner is the user-facing companion to that refusal.

export interface ContributionModelBannerProps {
  /** Flag result resolved server-side. */
  enabled: boolean;
  /** PlatformDevConfig.contributionMode — fork_only / selective / contribute_all / null. */
  contributionMode: string | null;
  /** PlatformDevConfig.contributionModel — null means "unconfigured". */
  contributionModel: string | null;
}

export function ContributionModelBanner(props: ContributionModelBannerProps) {
  if (!props.enabled) return null;
  // fork_only never pushes anywhere — contributionModel is irrelevant.
  if (props.contributionMode !== "selective" && props.contributionMode !== "contribute_all") {
    return null;
  }
  // Already configured — nothing to surface.
  if (props.contributionModel !== null) return null;

  return (
    <section
      role="status"
      aria-labelledby="contribution-model-banner-heading"
      className="mb-4 rounded border border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] p-3"
      data-testid="contribution-model-banner"
    >
      <h2 id="contribution-model-banner-heading" className="mb-1 text-sm font-semibold text-[var(--dpf-text)]">
        Contribution model needs configuration
      </h2>
      <p className="text-sm text-[var(--dpf-muted)]" data-testid="contribution-model-banner-copy">
        {CONTRIBUTION_COPY.banner.needsConfiguration}
      </p>
      <a
        href="#contribution-setup"
        className="mt-2 inline-block text-sm font-medium text-[var(--dpf-accent)] underline"
        data-testid="contribution-model-banner-cta"
      >
        {CONTRIBUTION_COPY.banner.openSetupLinkLabel}
      </a>
    </section>
  );
}
