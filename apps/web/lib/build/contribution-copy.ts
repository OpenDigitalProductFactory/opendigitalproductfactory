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
    forkPr:
      "This token needs the `public_repo` scope on your own GitHub account. It does NOT need access to the upstream repo — the platform will create a fork under your account the first time you contribute.",
  },
  pseudonymityTradeoff:
    "Your GitHub username will be visible on every PR you contribute. The platform-generated commit identity (dpf-agent-<shortId>) still applies to commit metadata, but the fork owner is necessarily visible on GitHub. If that is not acceptable, use a pseudonymous GitHub account for this install.",
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
