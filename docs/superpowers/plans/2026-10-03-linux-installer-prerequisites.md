# Linux installer prerequisite repair

Backlog: BI-E1AA1B3C. Contributes to BI-3BE9A85C under EP-MFG-DELIVER-INSTALL.
Delivery: medium defect repair; this ordered fix design is also the implementation plan.

## Problem and evidence

At source c5ae4bd4f701c5b7f6e5cc23e2652f115d5ecfee,
`scripts/installer/lib/docker.sh` requests `docker.io docker-compose-plugin`
without configuring the upstream repository, falls back to Engine alone, and
never verifies Compose. It suppresses daemon and group setup failures. The
caller in `install-dpf.sh` runs the helper before capturing its exit status
under `set -e`, so the intended status-75 explanation is unreachable.

The [v2026.10.02 release verification](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/actions/runs/37010716830/job/110855309417)
passed on Ubuntu 24.04 with Docker 28.0.4 and Compose 2.38.2 already installed.
It skipped models and autostart. It also logged unsuccessful HTTPS setup and
missing `runtime-transition.secret`; those observations require diagnosis,
not a claim that a healthy HTTP endpoint establishes production readiness.

## Acceptance criteria

The item-body criteria are reproduced verbatim:

- Fresh Ubuntu/Debian/Fedora setup provisions a coherent Docker Engine and Compose pair and cannot report success with Compose missing.
- Existing working Docker and Compose are preserved; incomplete or conflicting installations fail clearly before workspace installation or container startup.
- Package, daemon, group setup and re-login outcomes are reported accurately.
- Host-isolated behavioral tests exercise fresh-host command selection, existing-host preservation, missing Compose and setup failures.
- Linux guidance names the recommended initial target, prerequisites, Docker Engine versus Desktop, actual release evidence, and unverified reboot, AI, backup and upgrade paths without claiming GA.

## Design grounding and research

Extend the existing helper, not the runtime topology. The canonical
[deployment contracts](../specs/2026-05-09-deployment-contracts.md), contracts
1-3 and 9, and the [native support roadmap](2026-05-09-macos-linux-native-support.md),
phases 7 and 9, own release images, lifecycle, prerequisites and provider routing.
Existing cloud provisioning in `infra/terraform/single-vm/*/user-data/install.sh`
already uses Docker's official repository. This patch does not edit Terraform.

Adopt Docker's signed repository and coherent package family from the official
[Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[Debian](https://docs.docker.com/engine/install/debian/) and
[Fedora](https://docs.docker.com/engine/install/fedora/) instructions.
Reject the Engine-only fallback and automatic removal of existing runtimes.
Preserve healthy existing installations regardless of package provenance;
incomplete installations get an actionable prerequisite refusal. Existing
Podman/rootless refusal remains intact. No new dependency, service, data model,
authority grant or automatic production upgrade is introduced.

Docker now documents [Model Runner on Engine](https://docs.docker.com/ai/model-runner/get-started/).
Correct the obsolete impossibility claim while retaining DPF's current Ollama
default; adopting a different provider is outside this repair.

## Ordered work and boundaries

One atomic deliverable, `linux-prerequisite-contract`, maps to BI-E1AA1B3C.
Tests, helper, caller and operator guidance describe the same success/failure
contract and must ship together. Full Linux certification remains BI-3BE9A85C.

1. `FLOW-PREREQUISITES`: reproduce missing-Compose acceptance and failure
   suppression with host-isolated Bash tests in
   `scripts/installer/lib/docker.test.mjs`. Never run privileged host commands.
2. `CONTRACT-DOCKER-COMPOSE`: repair `scripts/installer/lib/docker.sh` so fresh
   setup installs Engine/CLI/containerd/Buildx/Compose from the official distro
   repository. Check conflicts before host writes; do not uninstall anything.
   Explicitly handle every package, daemon and group failure, because Bash
   suppresses errexit inside a function invoked in a conditional. Verify CLI
   prerequisites before returning success or re-login status. Check existing
   Compose without changing working package installations.
3. Capture the helper return code safely in `install-dpf.sh`, retaining the
   documented re-login status 75 and accurate failure explanations.
4. Update `docs/install/linux.md`, `docs/install/platform-support-watchlist.md`
   and the obsolete Model Runner comment in `docker-compose.linux.yml`.
   Recommend Ubuntu 24.04 x86-64 as the initial pilot target, distinguish
   published architectures from host verification, and use the canonical
   hardware guide instead of the stale 10-GB disk claim. Include the remaining
   fresh-host, HTTPS/login, AI, reboot, restore and upgrade acceptance checklist.
5. `VERIFY-PREREQUISITES`: run the behavioral tests, Bash syntax checks and
   installer shellcheck. Run applicable existing installer contract tests,
   regenerate the docs index, and use the canonical pregate before publication.
   This shell/docs patch changes no typed package interface or schema.

## Impact and verification

The Workroom impact contract resolved the seven declared paths with no
additional testImpact or guardObligation entries. It requires the docs index,
Convergence-Impact attestation, exact-tree pregate and PR health verification.
Add the generated index to the claimed scope when it is regenerated.

`REQ-LINUX-PREREQUISITES` refers to all acceptance criteria above.
`CONTRACT-DOCKER-COMPOSE`, `FLOW-PREREQUISITES` and `VERIFY-PREREQUISITES`
are the plan's contract, flow and verification traceability anchors.

Unit tests must cover Ubuntu/Debian/Fedora package selection, preserved
existing Docker, missing/legacy Compose, incompatible package refusal, package
failure, daemon failure, group failure, and successful re-login status. Fake
commands record operations; the tests neither install packages nor start Docker.
The current macOS host cannot supply a Linux boot/restore/upgrade verdict.
Those runtime checks remain unrun until performed on the canonical governed
Linux target with a pinned release and a disposable declared test install.

## Compatibility and rollback

Existing healthy hosts are read-only during prerequisite verification. A
fresh install gains the coherent package source; no volume or application
data is removed. A missing Compose plugin becomes an early refusal rather
than a late deployment failure. macOS shares the existing-engine check, so
cover its healthy Desktop path. Roll back source through a signed PR; do not
automatically downgrade or remove host packages installed by a completed run.

## Backlog coverage

Atomic mapping: `linux-prerequisite-contract` -> BI-E1AA1B3C; dependencies: none.
Record the immutable plan blob with `record_plan_backlog_coverage` before
implementation. Its governed receipt is authoritative; this paragraph alone
is not coverage. Linux GA and the observed HTTPS/runtime-state warnings are
not delivered by this prerequisite repair.
