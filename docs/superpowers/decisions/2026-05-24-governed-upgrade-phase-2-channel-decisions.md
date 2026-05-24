# Governed Upgrade Phase 2 — Channel Manifest & Release CI Decisions

| Field | Value |
| --- | --- |
| Date | 2026-05-24 |
| Status | Accepted |
| Spec | docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md §11 |
| Decision substrate | WWMD via `mcp__dpf__principle_decide` (calling population: `in_platform_coworker`) |
| Parent BI | BI-5B3FA415 |

## Context

Spec §11 listed seven open questions that needed operator decisions before Phase 2 (release CI + channel manifest) could be planned. Rather than push them onto the operator, the four highest-impact were run through the WWMD Decision Perspective Kernel with structured dimension scoring (`speed_to_value`, `blast_radius`, `long_term_maintainability`, `human_cognitive_load`, `evidence_density`, `governance_compliance`, `schema_grounding`, `public_safety`) against the in-platform-coworker principle population.

Three returned HIGH confidence and were accepted as-is. The fourth returned a margin (0.196) just below the tie-margin threshold (0.2); the operator confirmed the kernel's top pick.

## Decisions

### 1. Channel manifest host: GitHub Pages (gh-pages branch)

- WWMD composite **5.987**, margin **1.327** (HIGH confidence)
- Runner-up: Cloudflare Worker (4.660)
- Rationale: in-repo, zero-ops, no vendor dependency. Release CI publishes static JSON to the `gh-pages` branch on every release. Strongest on `long_term_maintainability` + `governance_compliance` + `speed_to_value`.
- Implication for Phase 2 plan: release CI gains a step that writes `{channel}.json` to the `gh-pages` branch via a CI-scoped deploy key or GitHub Actions' built-in `peaceiris/actions-gh-pages` pattern.

### 2. Release artifact signing: Sigstore keyless via GitHub OIDC

- WWMD composite **6.492**, margin **1.376** (HIGH confidence)
- Runner-up: cosign managed key in 1Password / GHA Secrets (5.115)
- Rationale: no key management, signatures bound to the GHA workflow identity (`token.idtoken`), public transparency log via Sigstore Rekor. Modern OSS standard — already used by Kubernetes, npm provenance, PyPI. Strongest on `public_safety` + `governance_compliance` + `long_term_maintainability`.
- Implication for Phase 2 plan: release CI uses `sigstore/cosign-installer@v3` + `cosign sign-blob` (keyless mode). Install-side verification uses `cosign verify-blob` with the certificate identity (`https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/.github/workflows/release.yml@refs/heads/main`) and the Sigstore Fulcio CA.
- Bundle signed; channel manifest signed too (detached signature alongside the JSON).

### 3. edge → beta channel soak: operator-configurable, default 24 hours

- WWMD composite **5.940**, margin **0.196** (LOW — operator review requested)
- Runner-up: fixed 48h (5.743). The kernel ranked these very close — `configurable-default-24h` slightly higher on flexibility, `48h` slightly higher on `evidence_density`.
- Operator decision: accept the recommended configurable-default-24h.
- Rationale: 24h covers a full day-night cycle including off-hours users, while leaving an operator lever for hotfixes (shorten) and risky releases (lengthen). Avoids a hard policy choice now; tunable empirically after the first few real releases.
- Implication for Phase 2 plan: `PlatformConfig` gains a `release.channelSoak.edgeToBeta` key, default value `{ "hours": 24 }`. Channel promotion job (Phase 6) reads this.

### 4. beta → stable channel soak: operator-configurable, default 7 days

- WWMD composite **6.042**, margin **0.250** (HIGH confidence)
- Runner-up: fixed 14d (5.792); fixed 7d (5.772); 3d decisively rejected (4.246).
- Rationale: 7 days covers a full week of dogfooding including a weekend, before broad rollout to non-technical operators who cannot recover from a bad upgrade. Operator-configurable per release allows shortening for security hotfixes without changing the default cadence.
- Implication for Phase 2 plan: `PlatformConfig` gains a `release.channelSoak.betaToStable` key, default value `{ "days": 7 }`. Same promotion job consumes it.

## Consequences

- Phase 2 (release CI + channel manifest) is now sufficiently scoped to plan. Open questions remaining in spec §11 (hotfix lane flow, smoke-window default criteria, first-install version backfill) are tactical and can be resolved inside the plan-writing pass rather than blocking it.
- The two soak values being `PlatformConfig`-driven means the DPF org's install (running on `edge`) can ship a release to itself faster than the beta cohort sees it, allowing internal validation of release CI machinery before opening it to external installs.
- Sigstore keyless requires `id-token: write` permission on the release CI workflow. No long-lived secrets, no key rotation policy needed. If Sigstore Rekor goes down, releases can still be produced but signature verification at install-time falls back to manifest-hash verification only.
- GitHub Pages hosting means the manifest URL is `https://opendigitalproductfactory.github.io/opendigitalproductfactory/<channel>.json` (or a custom `releases.dpf.dev` DNS CNAME later). The install must support both; the loader defaults to the GitHub Pages URL and accepts an override.

## Methodology note

Running these decisions through `principle_decide` with structured `features` produced HIGH confidence on 3/4 — versus the first attempt without features which returned LOW confidence on all four (composite 0.0 across the board). The `features` payload is load-bearing: WWMD without dimension scores is not WWMD, it's a list of options.

Pattern for future similar decision sweeps: always populate `features` for each option using the dimension registry in `packages/db/src/wiki-taxonomy.ts`. Dimensions surfaced via the kernel's `missingDimensions` on a featureless run: `blast_radius`, `evidence_density`, `governance_compliance`, `speed_to_value`, `schema_grounding`, `long_term_maintainability`, `public_safety`, `human_cognitive_load`. A 0..1 score per dimension per option is enough to differentiate.

## Open §11 questions remaining (deferred to Phase 2 plan)

- §11.5 Hotfix lane — does a security patch jump straight to `stable`, or still soak briefly in `beta` with reduced timer? Resolve during plan-writing.
- §11.6 Smoke-window criteria default — what error-rate threshold and which health endpoints constitute "healthy"? Resolve during plan-writing.
- §11.7 First-install version derivation for backfill — proposed in spec: nearest tag ancestor of current git SHA at first new-system boot. Resolve during plan-writing.
