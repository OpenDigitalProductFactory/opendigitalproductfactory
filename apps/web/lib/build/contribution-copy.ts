// Shared copy source for the contribution-mode UX. Both the admin UI
// (PlatformDevelopmentForm / ForkSetupPanel / ContributionModelBanner) and
// CONTRIBUTING.md consume this module so token-scope guidance,
// pseudonymity-tradeoff disclosure, and re-setup banner text never drift
// between surfaces. A doc-sync test in Phase 7 will assert CONTRIBUTING.md
// contains the key strings verbatim.
//
// See docs/superpowers/specs/2026-04-23-public-contribution-mode-design.md
// §"Pseudonymity and the fork-account visibility tradeoff" and §"Token scope
// guidance" for the rationale behind each string.

export const CONTRIBUTION_COPY = {
  tokenScope: {
    maintainerDirect:
      "This token needs `contents:write` on the upstream repo. Only maintainers of the OpenDigitalProductFactory org should use this mode.",
    // BI-D75B87B1: this promised a fork the shipped code never creates. Both
    // shipping paths write a branch straight into the TARGET repository with
    // head and base the same repo; the fork dispatcher exists but has no
    // production caller and sits behind a default-off flag. The old wording told
    // the operator their code would land in their own namespace under their own
    // credentials, which is not what happens, so it is corrected rather than
    // softened.
    forkPr:
      "This token needs `contents:write` on the repository you are contributing to. The platform does NOT create a fork — it writes a branch named dpf/<id>/<slug> directly into that repository and opens a pull request there. Your commits are authored under this install's pseudonymous identity; your real name and email stay local.",
  },
  // BI-D75B87B1: the exposure is the TOKEN OWNER, not a fork owner — there is
  // no fork. Naming the wrong mechanism made the trade-off sound avoidable by
  // choosing a different fork target, which it is not.
  pseudonymityTradeoff:
    "The GitHub account whose token this install uses will be visible as the author of every contribution. The platform-generated commit identity (dpf-agent-<shortId>) still applies to commit metadata, but the token owner is necessarily visible on GitHub. If that is not acceptable, use a dedicated GitHub account for this install.",
  machineUserOptIn: {
    label: "I am using a dedicated machine-user GitHub account",
    description:
      "Check this if the PAT belongs to an account that is NOT your primary identity. The platform will skip the 'token owner must match fork owner' check.",
  },
  banner: {
    needsConfiguration:
      "A platform update requires re-configuring contribution mode before your next contribution. Open setup below.",
    openSetupLinkLabel: "Open setup",
  },
} as const;
