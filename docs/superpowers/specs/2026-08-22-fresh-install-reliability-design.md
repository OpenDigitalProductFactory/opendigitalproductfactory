---
status: binding
---

# Fresh-install reliability design

**Date:** 2026-08-22

**Status:** Implemented
**Scope:** Consumer runtime readiness, provider recovery UI, archetype-aware
generated surfaces, installer identity, PowerShell lifecycle parity, repository
salvage, and scoped label association

## Problem

A verified consumer install could still be operationally incomplete. The portal
always targeted Inngest while Compose hid Inngest and Redis behind an optional
profile; an interrupted calibration boot was never retried; and the bundled
model's provisional scores failed the router's hard floors. Windows automation
could enter `Read-Host`, lifecycle scripts assembled different Compose chains,
and uninstall deleted data by default. The provider route could display a
skeleton indefinitely, while its onboarding copy implied the working local model
was inadequate. Install output named a mutable tag but not the installed digest.
The generated pet-rescue portal also inherited commercial chrome: product-line
setup, customer publishing language, booking policies, and revenue/job workspace
outcomes contradicted the nonprofit archetype selected during onboarding.

## Goals and non-goals

- Make a default consumer topology internally complete and recover calibration
  after interruption.
- Preserve strict routing floors and scope the provisional prior to the exact
  bundled model.
- Give provider loading a bounded, actionable, accessible state.
- Keep generated operator, public, and workspace language aligned with the
  selected archetype without forking the canonical product-line data model.
- Derive rescue mission outcomes only from real donation and adoption records;
  name missing foster substrate instead of fabricating a zero.
- Make Windows install automation prompt-free and lifecycle teardown
  data-preserving by default.
- Use one PowerShell Compose-chain owner across install/start/stop/uninstall.
- Report immutable image identity and distinguish operator work from disposable
  upstream caches before later teardown.
- Retighten the label-association ratchet only for the provider form touched here.
- Do not change database schema, weaken routing contracts, scan whole drives, or
  implement governed workstation teardown in this change.

## Research and benchmarking

### Docker Compose

Compose starts services without `profiles` by default and starts profiled
services only when that profile is activated. It also defines `down --volumes`
as the explicit volume-removal operation. DPF adopts both semantics: dependencies
of an unconditional portal endpoint are unprofiled core, and ordinary stop/down
omits volume deletion. Sources: [Using profiles with Compose](https://docs.docker.com/compose/how-tos/profiles/) and [docker compose down](https://docs.docker.com/reference/cli/docker/compose/down/).

### Helm

Helm separates release removal from preservation options and makes lifecycle
scope visible to the operator. DPF adopts the explicit tier but chooses the safer
local-product default: soft uninstall preserves data, while purge requires a
separate flag and confirmation. DPF rejects a single implicit destructive
uninstall. Source: [Helm uninstall](https://helm.sh/docs/helm/helm_uninstall/).

### Git

Git's revision-set algebra supports counting commits reachable from a local
branch while excluding every remote ref. DPF adopts that exact evidence for
salvage risk and adds dirty paths and stashes. It rejects branch-name heuristics
and third-party ownership assumptions. Source: [git rev-list](https://git-scm.com/docs/git-rev-list).

## Architecture decisions

1. **Durable execution is core.** Redis and Inngest belong to `runtime:core` and
   have no Compose profile because `INNGEST_BASE_URL` is unconditional. Optional
   exporters remain capability-activated.
2. **Calibration is restart-reconcilable.** Empty providers run discovery;
   every eligible provider then queues only seed profiles with no completed eval.
   The orchestration is a pure helper with injected effects so interrupted state
   is tested without Prisma or Inngest.
3. **The prior is exact and temporary.** Only
   `ggml-org/qwen3.8-27b-gguf` receives the 85 routing floor, remains
   low-confidence, and is replaced by evaluation. Generic Qwen priors remain
   conservative.
4. **Loading has a state transition.** The provider route uses the canonical
   skeleton for 15 seconds, then renders a themed alert explaining that settings
   are safe, with a retry action. Cloud AI is described as optional.
5. **One compose-chain owner.** `compose-chain.ps1` resolves release, override,
   edge, edge actions, organization trust, PKI, and TLS. Start includes configured
   overlays; stop/uninstall name every present overlay so no resources survive
   because a caller forgot a file.
6. **Destruction is opt-in.** Windows uninstall mirrors POSIX: soft is default;
   `-Purge` removes volumes/files/state; headless purge also requires `-Yes`.
   Recursive targets are resolved and reject drive root or the user profile.
7. **Installed bytes identify themselves.** Installers display RepoDigests and
   `Created`. A failed age lookup warns but does not turn mutable network metadata
   into an installation blocker.
8. **Salvage is bounded and read-only.** The sweep accepts explicit repository
   paths, classifies remote ownership, reports unreachable commits/dirty paths/
   stashes, and exits nonzero for risk. It never enumerates a drive or mutates Git.
9. **Presentation follows archetype authorities.** Operator setup and publishing
   copy resolve beside `ArchetypeVocabulary`; public policy copy composes category
   defaults with a leaf-archetype trust override. Routes consume those projections
   and do not embed pet-rescue conditionals.
10. **Outcome projection is bounded and source-honest.** A small archetype outcome
    resolver preserves revenue and delivered-work defaults for commercial
    archetypes. Pet rescue reads 90-day donations and adopted-animal counts scoped
    to the active storefront. Foster activity is `Unavailable` until a canonical
    foster record exists; mixed currencies are not combined into a false total.

## Accessibility and UX fit

Provider loading uses `role=status` while waiting and `role=alert` only after the
dependency timeout. The retry is a real button using the shared themed primitive.
The provider configuration form now binds nine visible labels through unique
`id`/`htmlFor` pairs, reducing the repository ratchet from 435 to 426 without a
blind cross-product rewrite.

The nonprofit changes add no controls or interaction paths. They replace chrome
through existing semantic headings, fields, links, and outcome cards. Commercial
defaults remain unchanged, and the pet-rescue policy page names adoption and
surrender rather than exposing booking vocabulary.

## Verification

- Each new behavior was represented by a failing test before implementation.
- Compose projection proves core includes Redis and Inngest on all hosts.
- Unit tests cover exact-model prior scope, interrupted calibration, timeout UI,
  installer flags/image output, compose-chain completeness, purge intent, and
  salvage classification/revision arguments.
- PowerShell files parse under the 5.1 grammar; Bash installer syntax is checked.
- Release-asset tests require the shared helper in the no-checkout consumer
  bundle, covered by `SHA256SUMS`.
