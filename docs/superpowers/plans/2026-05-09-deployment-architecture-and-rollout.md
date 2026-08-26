---
status: active
---

# Branch Plan: Deployment Architecture + Public Documentation Rollout

> Branch: `claude/mac-docker-compatibility-uN4Ya`
> Status: this branch's umbrella plan. Captures everything the
> branch produced (architectural specs + the installer-parity
> roadmap) and sequences the implementation epics + public-doc
> updates that follow.
>
> Companion plan: `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
> is one of the implementation epics this umbrella plan tracks
> (Epic A below). Other epics will get their own plans as they're
> taken up.

## Context

The branch started as a focused effort to add macOS / native-Linux
support to a Windows-installer-only product. Through review the
scope expanded into an architectural cleanup that produced a
deployment doctrine, an Edge Node spec, a Cloud Deployment spec, a
Build Execution Provider spec, and meaningful addenda to existing
specs (Enterprise Auth, Mobile, Storefront).

What the branch did **not** do is implement any of that. The
delivered artifacts are documents — research stubs and roadmaps —
that the doctrine declares as binding contracts for future
implementation work.

The public-facing materials (README, CONTRIBUTING, architecture
overview, getting-started guide, etc.) still describe the prior
Windows-Docker-Desktop-centric world. This umbrella plan sequences
the **doc updates** alongside the **implementation epics** so the
public docs never claim a feature that hasn't shipped, and never
omit a contract that has.

## Branch deliverables (already shipped on this branch)

### Plan
- `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
  — 10-phase macOS / Linux installer-parity roadmap (Epic A below)

### New specs (research stubs)
- `docs/superpowers/specs/2026-05-09-deployment-contracts.md` —
  doctrine: 10 canonical contracts + spec ownership map +
  maturity gates
- `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md` —
  customer-cloud deployment substrates + packaging targets +
  TAPPaaS module + LLM/MCP/CORS deltas
- `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md` —
  Edge Node architecture + Mobile Device disambiguation +
  ingestion pipeline + token model
- `docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`
  — sandbox lifecycle + agent command execution interface +
  image variants

### Existing-spec addenda
- `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`
  — `identityEdgeMode` addendum + Principal convergence addendum
- `docs/superpowers/specs/2026-03-19-mobile-companion-app-design.md`
  — deployment-doctrine alignment addendum (auth modes, customer
  URL, deep links, multipart upload bug)
- `docs/superpowers/specs/2026-03-19-storefront-foundation-design.md`
  — deployment-surface contract addendum (3 domains, CORS per
  surface, identity migration path)
- `AGENTS.md` line 51 — worktree-root convention covers macOS /
  Linux

All of the above are research stubs or addenda; per AGENTS.md §10
each new spec needs full Research & Benchmarking before it
graduates to binding implementation work. Each carries a
"Maturity gates before implementation" checklist.

## Implementation epics (each becomes its own future PR or branch)

This branch produces the architecture; subsequent branches do the
work. Suggested ordering follows the dependency chain established
in the doctrine and the cloud-deployment spec.

### Epic A — Mac / Linux installer parity
**Status:** roadmap shipped; implementation pending.
**Plan:** `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
**Branch convention:** ten phase-PRs as described in the plan;
Phase 1 (multi-arch GHCR) is the prerequisite that gates everything
else.
**Depends on:** nothing (other than a maintainer with Apple
Silicon and Linux test rigs).

### Epic B — Edge Node implementation
**Status:** spec stub shipped; needs Research & Benchmarking,
schema review, security review (heavy), and a slice plan before
implementation.
**Spec:** `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md`
**First slice:** `capability.discovery.network` only — Linux
container with `network_mode: host`, plus the native helper binary
(Mode B) for macOS / Windows hosts that need accurate host topology.
**Depends on:** Epic A Phase 1 (multi-arch GHCR images) for the
container path; nothing else.

### Epic C — Build Execution Provider extraction
**Status:** spec stub shipped; sequencing inside the spec
recommends the no-op interface extraction as step one.
**Spec:** `docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`
**First slice:** extract today's Docker-CLI sandbox lifecycle into
a `LocalDockerProvider` with no behavior change. Second slice:
`runAgentCommand` interface so codex / claude-dispatch.ts route
through providers.
**Depends on:** nothing (refactor of existing code).
**Unblocks:** cloud substrates beyond Single VM (Managed container
service, Managed Kubernetes), TAPPaaS native NixOS/Podman mode.

### Epic D — Cloud deployment templates (Single VM substrate)
**Status:** spec shipped; deployment templates not yet authored.
**Spec:** `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md`
(Single VM substrate + Terraform packaging target).
**First slice:** Terraform modules under `deploy/terraform/{aws,gcp,azure}/`
that bootstrap a Linux VM and run `install-dpf.sh --headless`.
**Depends on:** Epic A Phase 1 (multi-arch GHCR), Epic A Phase 6
(`--headless` flag in installer).

### Epic E — TAPPaaS module
**Status:** spec shipped; TAPPaaS Tool Evaluation Pipeline not yet
run.
**Spec:** `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md`
(TAPPaaS packaging target).
**First slice:** Tool Evaluation Pipeline run (per AGENTS.md §9);
then the `deploy/tappaas/` module wrapping a VM running
`install-dpf.sh --headless`.
**Depends on:** Epic A Phase 1 (multi-arch GHCR), Epic A Phase 6
(`--headless`), Tool Evaluation Pipeline approval.

### Epic F — Identity Edge mode wiring
**Status:** addendum shipped on enterprise auth spec
(`identityEdgeMode` + Principal convergence).
**Spec:** `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`
addenda.
**First slice:** `identityEdgeMode=customer-provided` support so
customers can plug in their own OIDC IdP without DPF deploying a
parallel authentik. Second slice: Principal convergence migration
(User → PrincipalAlias of kind workforce-user, etc.).
**Depends on:** existing enterprise auth implementation work
(out of this branch's scope to coordinate).

### Epic G — Mobile OIDC + customer URL + multipart fix
**Status:** addendum shipped on mobile spec.
**Spec:** `docs/superpowers/specs/2026-03-19-mobile-companion-app-design.md`
2026-05-09 addendum.
**First slice:** the multipart upload bug fix at
`packages/api-client/src/client.ts:9-12` (small, isolated, can ship
ahead of the rest). Second slice: first-launch
`mobileAuthorityCoreUrl` flow. Third slice:
`mobileAuthMode=identity-edge-oidc-pkce` once Epic F has a
target IdP to point at.
**Depends on:** Epic F for the OIDC mode; multipart fix is
independent.

### Epic H — Storefront principal-convergence migration
**Status:** addendum shipped on storefront foundation spec.
**Spec:** `docs/superpowers/specs/2026-03-19-storefront-foundation-design.md`
2026-05-09 addendum.
**First slice:** add `find-by-alias` resolution alongside the
existing `User` / `CustomerContact` direct lookup. Second slice:
retire the legacy direct lookup once Epic F's Principal convergence
migration has run.
**Depends on:** Epic F (Principal convergence migration).

### Epic I — Public documentation rollout
**Status:** this is the work this umbrella plan adds (next
section).
**Owner:** maintainers of the affected docs; coordinated against
the implementation epics' shipping cadence.
**Depends on:** various — see per-doc table below.

## Public documentation rollout

### Audit summary

The branch's architectural changes impact the following public
materials. Each row notes today's state, the impact, and when the
update should land relative to implementation epics.

| Material | Today's state | Update needed | Lands when |
|---|---|---|---|
| `README.md` | Windows-installer-centric ("Quick Start (Windows)" only); lists "Mac & Linux Installers" and "Web-Hosted SaaS" as future | Tone shift to "multi-platform deployment architecture documented; implementation in progress"; preserve current Windows quick-start; add "see deployment doctrine" pointer; do **not** add Mac/Linux quick-start sections until Epic A Phase 7 | Light tone-shift + doctrine pointer **now (this branch)**. Mac/Linux quick-start sections wait for Epic A Phase 7. Cloud quick-starts wait for Epics D / E. |
| `CONTRIBUTING.md` | Repo bootstrap section is implicitly Windows | Add a "Contributor setup on macOS / Linux" subsection pointing at `scripts/setup.sh` (rewritten in Epic A Phase 2) and the `.devcontainer/` fallback | Skeleton with TODO markers **now**; full content lands with Epic A Phase 2 |
| `AGENTS.md` | §2 says PowerShell scripts target Windows 10/11; §4 worktree convention now covers macOS/Linux | Add cross-references from §2 and §11 to the deployment doctrine; clarify that PowerShell remains the canonical Windows installer surface and bash equivalents are coming via Epic A | **Now (this branch)** — reference adds only, no behavior claims |
| `CLAUDE.md` | Pointer file to AGENTS.md | No changes needed — pointer file does its job | Never; stays a pointer |
| `CONVENTIONS.md` | Pointer file to AGENTS.md | No changes needed | Never; stays a pointer |
| `.github/copilot-instructions.md` | Pointer file to AGENTS.md | No changes needed | Never; stays a pointer |
| `.clinerules/`, `.cursor/rules/`, `.continue/rules/` | Pointer files to AGENTS.md | No changes needed | Never; stay pointers |
| `docs/architecture/platform-overview.md` | Says "Docker Model Runner is built into Docker Desktop 4.40+"; assumes Docker Desktop default | Soften to "Docker Desktop is one of three supported runtimes (alongside native Docker Engine on Linux per Epic A and managed substrates per the cloud-deployment spec)"; add link to the deployment doctrine; preserve current accuracy about today's runtime | **Now (this branch)** — updates are about scoping current claims accurately, not adding new claims |
| `docs/operations/dpf-production-runtime.md` | Localhost-and-Docker-Compose-centric runtime model | Add a "deployment substrate" pointer at the top noting these conventions are for the Single VM substrate / local install; cloud substrates and packaging targets are described in the cloud-deployment spec | **Now (this branch)** — lightweight pointer addition |
| `docs/user-guide/getting-started/index.md` | User-facing welcome; no installation mode mentioned | No changes; "what you can do" is accurate across deployment shapes | Never (or only when product-feature scope changes) |
| `docs/user-guide/getting-started/setup-and-first-login.md` | First-login UX | No changes; UX is the same regardless of substrate | Never |
| `docs/user-guide/getting-started/dev-container.md` | Dev container guide | Optional cleanup once Epic A Phase 2 lands; today's content is correct | After Epic A Phase 2 |
| `docs/user-guide/getting-started/developer-setup.md` | Developer setup | Update once `scripts/setup.sh` is rewritten in Epic A Phase 2 | After Epic A Phase 2 |
| `docs/install/macos.md` | Does not exist | Create as part of Epic A Phase 9 (docs phase of installer-parity roadmap) | Epic A Phase 9 |
| `docs/install/linux.md` | Does not exist | Create as part of Epic A Phase 9 | Epic A Phase 9 |
| `docs/install/cloud-single-vm.md` | Does not exist | Create as part of Epic D | Epic D |
| `docs/install/tappaas.md` | Does not exist | Create as part of Epic E | Epic E |
| `docs/index.html` / `_config.yml` (Jekyll site) | Repo-level GitHub Pages landing | Verify links don't break when new docs land; no proactive change | When new docs land |
| `docs/architecture/GAID.md`, `trusted-ai-kernel.md`, `trusted-ai-agent-governance-white-paper.md` | Architecture white papers | No direct impact from deployment doctrine; Edge Node + Principal convergence may warrant cross-references in a future revision | After Epics B and F land |
| `.github/PULL_REQUEST_TEMPLATE.md` | Repo PR template | No changes | Never |
| `SECURITY.md`, `CODE_OF_CONDUCT.md`, `ACKNOWLEDGMENTS.md`, `LICENSE`, `NOTICE` | Standard repo files | No changes | Never |

### What lands in THIS branch (Epic I scope)

The following doc updates can ship on this branch alongside the
architectural specs without claiming features that don't exist:

#### 1. `README.md` — tone shift + doctrine pointer
- Current line 7: *"No vendor lock-in. No consultants. No million-dollar license. **One installer to run.** Your AI workforce starts working immediately."* — soften to acknowledge the Windows installer is the GA surface today and additional installers are documented in the deployment architecture work.
- Current line 70: keep "Quick Start (Windows)" verbatim; do not add macOS / Linux quick-starts yet.
- Current line 169: keep the platform-overview.md link.
- Current line 197 ("Docker Deployment" feature row): expand to "Docker Deployment (Windows GA; macOS / Linux per
  installer-parity roadmap)".
- Current lines 207-208 ("Web-Hosted SaaS", "Mac & Linux Installers"): both move from "Future" to "In progress, see roadmap" with explicit links to the installer-parity plan and the cloud-deployment spec.
- Add a new "Deployment Architecture" subsection near the architecture link (line 169 area) pointing at:
  - `docs/superpowers/specs/2026-05-09-deployment-contracts.md` (doctrine)
  - `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md`
  - `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`

#### 2. `AGENTS.md` — cross-reference doctrine in §2 and §11
- §2 Project Architecture (line 21-22): add a sentence after "Local AI via Docker Model Runner..." referencing the deployment doctrine for the formal contract on platform / deployment-target conventions.
- §11 Data Model Stewardship (line 117): add a sentence about the Principal convergence addendum on the enterprise auth spec, so Data Model Stewardship aligns with the convergence rule.
- §10 Design Research (line 110-111): no changes needed; addenda and stubs already cite Research & Benchmarking per AGENTS.md §10.

#### 3. `docs/architecture/platform-overview.md` — soften Docker Desktop assumption
- Add a banner at the top: "This document describes the current GA runtime (Single VM substrate via Docker Desktop on Windows). Multi-platform / cloud / TAPPaaS deployment architecture is documented in the deployment doctrine at `docs/superpowers/specs/2026-05-09-deployment-contracts.md`; implementation status per the installer-parity roadmap."
- Line in "Core Services" table about Docker Model Runner: keep the current accurate statement (it IS built into Docker Desktop 4.40+); add a note: "On Linux installs without Docker Desktop, the platform's LLM provider contract (Doctrine Contract 9) substitutes Ollama in compose; on TAPPaaS deployments, the customer's AI Stack Ollama / LiteLLM is used."

#### 4. `docs/operations/dpf-production-runtime.md` — substrate pointer
- Add one paragraph at the top: "These runtime conventions describe the Single VM substrate / local install (Doctrine Contract 1 + 2). For cloud substrates (Managed container service, Managed Kubernetes) and packaging targets (TAPPaaS module, marketplace image, Helm chart), the substrate-specific runtime conventions live in the cloud-deployment spec."

#### 5. `CONTRIBUTING.md` — Mac / Linux contributor setup skeleton
- Add a subsection under "Repo bootstrap (contributors)" titled "Setup on macOS / Linux" with a stub: "macOS / native Linux contributor setup is being landed via the Mac/Linux installer-parity roadmap (Phase 2). Until that ships, run `bash scripts/setup.sh` (currently stale; will be rewritten in Phase 2) or use the dev container at `.devcontainer/devcontainer.json`."
- The full content lands when Epic A Phase 2 ships and `scripts/setup.sh` is rewritten.

That's five files updated in this branch as part of Epic I. None of them claim features that don't exist; all of them point at the doctrine / specs / roadmap so readers can follow the architecture.

### What lands in follow-up branches

Each implementation epic carries its own doc-update slice:

- **Epic A Phase 1 (multi-arch GHCR):** changelog / release notes mention multi-arch publishing; no user-facing doc changes.
- **Epic A Phase 2 (contributor setup):** `CONTRIBUTING.md` skeleton is filled in; `docs/user-guide/getting-started/developer-setup.md` updated with the rewritten `scripts/setup.sh` flow.
- **Epic A Phase 7 (full installer):** README gains "Quick Start (macOS)" and "Quick Start (Linux)" sections that mirror the existing Windows section.
- **Epic A Phase 9 (docs in installer-parity roadmap):** `docs/install/macos.md`, `docs/install/linux.md` created. README links to them. CI starts running the install paths on `macos-14` and `ubuntu-22.04`.
- **Epic B (Edge Node):** `docs/architecture/edge-node.md` created or platform-overview.md updated to describe the Edge Node's role in the runtime; user-guide gains "Onboarding a managed host" page.
- **Epic C (Build Execution Provider):** `docs/architecture/build-studio-providers.md` created or build-studio user-guide updated.
- **Epic D (cloud Single VM via Terraform):** `docs/install/cloud-single-vm.md` created with one page per hyperscaler.
- **Epic E (TAPPaaS):** `docs/install/tappaas.md` created.
- **Epic F (Identity Edge `customer-provided` mode):** enterprise auth spec graduates from research; user-guide gains "Configuring an external Identity Edge" page.
- **Epic G (Mobile OIDC + multipart fix):** mobile companion docs (if any) update; release notes.
- **Epic H (storefront principal convergence):** storefront docs update for the migration sequence.

### Sequencing

```
Epic A Phase 1 (multi-arch GHCR)        ──┐
                                          ├──> Epic A Phase 6 (--headless)
Epic A Phase 2 (compose portability)    ──┤      └──> Epic D (cloud Single VM)
                                          │      └──> Epic E (TAPPaaS)
Epic A Phase 3 (compose deltas)         ──┤
Epic A Phase 4 (LLM provider contract)  ──┤
Epic A Phase 5 (host hardware detect)   ──┤
                                          └──> Epic A Phase 7 (full installer)
                                                  └──> Epic A Phase 9 (docs/CI)

Epic C (Build Provider extraction)      ──> Epic A Phase 7+
                                            └──> Cloud substrates beyond Single VM

Epic B (Edge Node)                      ──┬─ depends on Epic A Phase 1
                                          └─ informs Epic A retirement of windows_exporter

Epic F (Identity Edge customer-provided) ──┬─ informs Epic G (mobile OIDC)
                                           └─ informs Epic H (storefront convergence)

Epic I (this plan's doc rollout)        ── lands in slices alongside each epic above;
                                            the THIS-BRANCH slice listed above ships
                                            now without claiming non-existent features
```

## What this branch does NOT do

Stating these explicitly so reviewers don't expect them:

- This branch does **not** implement any of the architectural specs.
  Every spec is a research stub awaiting Research & Benchmarking
  per AGENTS.md §10.
- This branch does **not** retire `install-dpf.ps1` or the existing
  Windows installer surface — that stays the GA install path.
- This branch does **not** retire `windows_exporter` install or the
  `windows-host` Prometheus scrape; those retire when Epic B's
  Discovery capability slice ships.
- This branch does **not** add Mac / Linux quick-start sections to
  the README that would imply a working installer; those wait for
  Epic A Phase 7.
- This branch does **not** implement the Build Provider extraction
  (Epic C is the no-op refactor that follows).

## What this branch DOES do

- Establishes the deployment doctrine (10 contracts, ownership map,
  maturity gates).
- Captures the Edge Node, Cloud Deployment, and Build Execution
  Provider architectures as research stubs that future
  implementation work executes against.
- Aligns three existing specs (Enterprise Auth, Mobile, Storefront)
  with the new doctrine via dated addenda.
- Updates `AGENTS.md` line 51 (worktree-root convention) for
  macOS / Linux.
- Lays out the implementation queue (Epics A–H) with explicit
  dependencies.
- Specifies Epic I (public documentation rollout) with per-document
  impact + sequencing so doc work doesn't drift behind
  implementation work or jump ahead of it.
- Ships the THIS-BRANCH slice of Epic I (5 file updates listed
  above).

## Verification

For each doc change in the THIS-BRANCH slice of Epic I:

- [ ] Link checker passes: every new path / spec reference resolves
      to a file that exists.
- [ ] No claim is made about a feature that hasn't shipped (e.g.,
      no "Quick Start (macOS)" section in README, no
      `docs/install/macos.md` link before that file exists).
- [ ] Tone is consistent with the rest of the document (architecture
      pointers framed as roadmap references, not status announcements).
- [ ] Doctrine references use the canonical paths from the spec
      ownership map (no shorthand or invented paths).

For each follow-up epic's doc-update slice (Epics A Phase 9, B, C,
D, E, F, G, H):

- [ ] The implementation it describes actually shipped before the
      doc was merged.
- [ ] Cross-references between docs and specs use the spec
      ownership map.
- [ ] Doctrine maturity-gates checklist on the relevant spec is
      satisfied before the user-facing doc declares it.

## Test environment strategy

Operational doctrine for **how each implementation epic is tested
given we don't own all 9 deployment targets**. Captured here, not
in each epic's verification gate, so the strategy doesn't drift
across PRs.

### Three tiers

**Tier 1 — CI runners (covers ~80% of testable surface):**

| Target | Runner | Cost |
|---|---|---|
| Linux native Docker | `ubuntu-22.04` | Free for OSS; pennies for private |
| macOS Apple Silicon | `macos-14` (arm64) | Free for OSS; ~$0.16/min for private |
| Multi-arch GHCR publish | any runner + QEMU + buildx | Free |
| Compose render + policy checks | any runner | Free |
| `kind` / `k3d` for k8s smoke | any runner | Free |

**Tier 2 — cheap cloud rentals (release gates only, not per-PR):**

| Target | Approach | Cost per smoke run |
|---|---|---|
| Cloud Single VM (Epic D) | t3.medium / e2-small / B1s for 1 hr | ~$0.05 |
| Cloud marketplace image | same VM, AMI-baked | ~$0.05 |
| Container service (preview) | Cloud Run / Container Apps free tier | $0 within free quota |
| Managed Kubernetes (preview) | EKS / GKE / AKS sandbox cluster, 1 hr | ~$0.10–0.30 |
| GPU-attached LLM smoke | spot GPU instance, 30 min | ~$0.50 |

A `release-gate-cloud` script that rents-tests-tears-down per
release keeps this sustainable. **Do not run on every PR.**

**Tier 3 — needs real hardware or community partners:**

| Target | What's needed | Realistic path |
|---|---|---|
| TAPPaaS (Epic E) | Proxmox host | Homelab Proxmox box, OR rent a Hetzner / OVH dedicated server (~$50-100/mo), OR partner with TAPPaaS community |
| Mobile iOS install (Epic G) | Physical device + Apple Developer Program ($99/yr) | Defer until Mobile epic actually starts; Expo simulator covers most of dev loop |
| Mobile Android install (Epic G) | Physical device + Google Play Console ($25 one-time) | Same |
| Edge Node native binary on macOS / Windows (Epic B Mode B) | Real hardware | Use the team's own laptops; sign builds; community beta testers later |
| Fresh-Mac-from-zero installer flow (Epic A Phase 7) | Real Mac | See macOS-runner caveat below |

### macOS runner caveat (binding constraint)

GitHub's `macos-14` hosted runners **do not support nested
virtualization**. Docker Desktop on macOS uses HyperKit /
Virtualization.framework; installing it from a `.dmg` on a fresh
runner doesn't work because the inner VM can't start. This means:

- `install-dpf.sh --headless` **after** Docker is pre-installed
  on the runner: testable in CI.
- `install-dpf.sh` **fresh-Mac-from-zero with no Docker installed**
  (Phase 7's flagship verification): **not** testable in CI. Needs
  one of:
  - A real Mac in the office for manual verification per release.
  - A paid bare-metal Mac rental (MacStadium, MacinCloud, AWS
    EC2 Mac instances at ~$1.08/hr).
  - A community beta tester with an Apple Silicon Mac.

The `apple-silicon-release-gate` job in Phase 9 must therefore
**not** claim it covers the fresh-from-zero install — only the
post-Docker-install path. Phase 7's verification text needs a small
update to acknowledge this. (Tracked as a tiny follow-up cleanup,
not a blocker for merging this branch.)

### What we deliberately don't test

Per the installer-parity roadmap's Out-of-Scope list and Phase 6's
unsupported-host preflight: Intel Mac, Windows on ARM,
WSL2-without-Docker-Desktop, rootless Docker, Podman/containerd,
air-gapped Linux, Linux distros older than the supported floor.
Preflight refuses these with documented `Reason:` and `Next:`
lines; no test rig needed because we don't claim support.

### Per-epic test plan

| Epic | Tier | Runner / rig |
|---|---|---|
| A Phase 1 (multi-arch GHCR + SBOM/provenance) | 1 | `ubuntu-22.04` CI |
| A Phase 2 (contributor setup) | 1 | `macos-14` + `ubuntu-22.04` CI |
| A Phase 3 (compose portability) | 1 | rendered-config policy checks in CI |
| A Phase 4 (LLM contract) | 1 (+ 2 for GPU) | CI for non-Ollama paths; Ollama-with-GPU at release gate via spot |
| A Phase 5 (host hardware detection) | 1 | `macos-14` + `ubuntu-22.04` CI |
| A Phase 6 (installer skeleton + minimum `dpf doctor`) | 1 | `macos-14` + `ubuntu-22.04` CI; `--dry-run` + `--headless` |
| A Phase 7 (full installer + autostart) | 1 + manual | `--headless` in CI; fresh-Mac-from-zero needs human + real Mac (caveat above); fresh-Linux-from-zero in CI via `cloud-init` simulation |
| A Phase 8 (lifecycle scripts) | 1 | CI |
| A Phase 9 (CI release gates) | 1 | self-validating |
| A Phase 10 (hardening + diagnostics) | 1 + 2 | CI plus occasional Tier-2 cloud smoke |
| B (Edge Node) | 1 + manual | Linux container Mode A in CI; native Mode B on team hardware first |
| C (Build Provider) | 1 | CI (no-op refactor first slice; then `kubernetes-job` provider on `kind`) |
| D (Cloud Single VM Terraform) | 2 | release-gate cloud rental, one substrate at a time |
| E (TAPPaaS) | 3 | homelab Proxmox or community partner |
| F (Identity Edge `customer-provided`) | 1 | bundled authentik in compose, CI |

> **Superseded stance (2026-08-26, EP-24741BBF / `BI-5167932D`).** Bundling authentik in compose is **reversed** — DPF absorbs the directory over its own `Principal` spine and adds no IdP to any install. `customer-provided` (consuming an external IdP as an upstream) remains supported and optional. See [Directory Service — Identity Absorption Design](../specs/2026-08-23-directory-service-identity-absorption-design.md).

| G (Mobile) | 1 + 3 | Expo simulator in CI; physical devices when graduating from preview |
| H (Storefront principal convergence) | 1 | standard CI |

### What this section is NOT

Not a budget. Not a hiring plan. Not a commitment that any
particular Tier-3 hardware will be acquired. It's a **realistic
inventory** of what each epic's verification needs so future
implementation PRs don't promise tests they can't actually run on
the rigs DPF can afford.

If a future epic finds itself blocked on a Tier-3 rig that hasn't
been arranged, the right move is to ship the epic as **Preview** in
the deployment support matrix until the rig exists or a community
partner runs it — not to silently skip the verification.

## Maturity gates before this plan is binding

Per the doctrine's uniform maturity-gates pattern:

- [ ] Research & Benchmarking complete — N/A; this is a rollout
      plan, not a feature spec.
- [ ] Open questions resolved — see "What this branch does NOT do"
      list above as the explicit deferral set.
- [ ] Schema impact reviewed — N/A; doc-only plan.
- [ ] Canonical contracts updated if shared behavior changes —
      N/A; this plan references contracts but doesn't change them.
- [ ] Security review complete — N/A; doc-only plan.
- [ ] Release / rollback story defined — each doc commit is its own
      atomic change; rollback = revert.
- [ ] Test / verification gates defined — see "Verification"
      section above.

## Source documents

- `docs/superpowers/specs/2026-05-09-deployment-contracts.md` —
  doctrine.
- `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md` —
  cloud substrates + packaging targets.
- `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md` —
  Edge Node.
- `docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`
  — Build Studio provider abstraction.
- `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`
  — Identity Edge + Principal convergence (extended in this
  branch).
- `docs/superpowers/specs/2026-03-19-mobile-companion-app-design.md`
  — Mobile companion (extended in this branch).
- `docs/superpowers/specs/2026-03-19-storefront-foundation-design.md`
  — Storefront foundation (extended in this branch).
- `docs/superpowers/plans/2026-05-09-macos-linux-native-support.md`
  — Mac / Linux installer-parity roadmap (Epic A).
- `README.md`, `AGENTS.md`, `CONTRIBUTING.md`,
  `docs/architecture/platform-overview.md`,
  `docs/operations/dpf-production-runtime.md` — public materials
  updated in this branch's Epic I slice.
