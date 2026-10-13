---
status: active
---

# Linux pilot startup and public guidance

Backlog anchor: BI-DFF7346E. Additional deliverables: BI-F3AD783E, BI-5282E468,
BI-B739AB19. Contributes to BI-3BE9A85C under EP-MFG-DELIVER-INSTALL.
This ordered fix design is the implementation plan for the user's requested
pilot repair package. Native customer acceptance remains pending.

## Evidence and design grounding

Source baseline: 1a8a1f57bfed6c1bfb000bd37145d898307224a7.
The customer installers omit the canonical runtime-transition initializer.
Release run 37010716830, job 110855309417, reports its missing key, HTTPS
timeout and root-owned federation cleanup failure. The doctor artifact shows
step-ca restarting, but lacks CA logs; no single historical root cause is claimed.

Reuse [deployment contracts](../specs/2026-05-09-deployment-contracts.md),
[Linux prerequisite repair](2026-10-03-linux-installer-prerequisites.md),
the existing runtime-transition initializer, Compose mount resolution and
pinned smallstep images. No new service, schema, authority grant or provider.

Docker documents [Compose secrets as bind-mounted files](https://docs.docker.com/compose/how-tos/use-secrets/).
The pinned upstream [entrypoint](https://github.com/smallstep/certificates/blob/v0.30.2/docker/entrypoint.sh)
initializes as the image user and prints the provisioner password. A host-owned
0600 bind is inaccessible to a different container UID. Use private stdin
staging into the existing CA volume and complete initialization in the
one-shot helper with captured, suppressed output before starting the service.
Never chmod secrets world-readable, run the CA as root or rotate existing material.

Public copy edits reuse the deployment cards in docs/index.html and existing
navigation. README, docs/README, hardware, install operations and first-login
guidance point to docs/install/linux.md. No layout or new UI flow is introduced.
Recommend Ubuntu 24.04 LTS x86-64 and the existing provider-assisted hardware
floor. Preserve early-access status; a merged source repair is not a release
or a successful customer installation.

## Acceptance criteria

The live item-body criteria are reproduced verbatim.

### BI-DFF7346E


- Fresh Bash and PowerShell customer installs initialize the key in the exact directory mounted at /dpf-state before portal startup.
- Re-running preserves existing valid key bytes; malformed keys and active transitions fail clearly without rotation.
- Tests cover custom state paths, idempotence, permission handling and failed initialization without exposing key values.
- Fresh runtime-state directories, including federation and federation/pki, are owned by the invoking user; pre-existing unsafe ownership fails before startup without deleting data.
- Linux readiness guidance and release verification distinguish the source repair from native runtime acceptance.

### BI-F3AD783E

- CA startup does not require the host user to have UID 1000 or expose password bytes in arguments, environment or logs.
- Existing matching password custody is preserved and mismatches fail without rotation.
- Transient POSIX clients can access private host paths and create host-owned files.
- Isolated tests cover staging, failure, permissions and lifecycle parity; native Linux acceptance remains pending.

### BI-5282E468

- Ollama publishes on loopback by default while containers retain service-name access.
- Missing pnpm installs the repository-pinned version and incompatible existing pnpm fails before dependency installation.
- Isolated tests verify defaults and failure paths.

### BI-B739AB19

- Main documentation and public pages link to one canonical Linux pilot guide with consistent prerequisites.
- Native Docker Engine versus Desktop and the existing Bash installer are explained accurately.
- The customer checklist covers fresh install, HTTPS/login, AI, reboot, backup/restore, upgrade and uninstall with unrun checks explicit.
- Documentation and HTML checks pass without new navigation or layout.

## Ordered deliverables and verification

1. REQ-STATE / CONTRACT-STATE / FLOW-STATE / VERIFY-STATE: BI-DFF7346E.
   Add a shared Node installer adapter resolving the actual portal /dpf-state
   and /dpf-federation bind sources from Compose config JSON without printing
   expanded secrets. Call the existing --initialize helper before PKI or portal
   startup in Bash and PowerShell. Create private host-owned federation and
   federation/pki directories before Docker creates root-owned bind directories.
   Refuse symlinks, unsafe ownership and malformed paths; never recursively
   chown or delete existing state. Preserve the canonical active-transition
   refusal. Include helpers in release assets.
   Test actual temporary-directory initialization, custom paths, idempotence,
   malformed keys, active locks, ownership checks, failed Compose and no secret
   output. The fresh-host purge issue is prevented at creation; historical
   root-owned directories require scoped operator ownership recovery.

2. REQ-PKI / CONTRACT-PKI / FLOW-PKI / VERIFY-PKI: BI-F3AD783E.
   Stage the host password through stdin into /home/step/secrets/password,
   privately and atomically, using the pinned service's normal user. Refuse
   mismatch, unsafe files and concurrent staging. Complete upstream first-time
   initialization with captured output, avoiding its password log. Retain
   existing CA volume and keys. Update service password path and both bootstrap
   scripts. Run transient POSIX clients as host UID/GID with temporary writable
   HOME/STEPPATH. Tests execute staging shell behavior with temporary volume
   fixtures and fake entrypoint, verify command input and redaction, plus
   existing authority/member/join contract tests. Do not claim native CA success.

3. REQ-HOST / CONTRACT-HOST / FLOW-HOST / VERIFY-HOST: BI-5282E468.
   Restrict Ollama's default host port to loopback; retain service-name routing.
   Use packageManager pin for missing pnpm and fail incompatible installations.
   Test bootstrap command selection, failures and loopback contract.

4. REQ-DOCS / CONTRACT-DOCS / FLOW-DOCS / VERIFY-DOCS: BI-B739AB19.
   Align the main and public entrypoints, canonical Linux guide, hardware,
   support watchlist and operating docs. Provide customer result fields and
   acceptance checks for install, HTTPS/login, AI, reboot, restore, upgrade
   and uninstall. Mark native checks unrun. Validate links, generated indexes
   and existing HTML checks; visually inspect the unchanged deployment layout.

## Impact, completion and rollback

The claimed-path impact contract is resolved with no additional testImpact or
guardObligation entries. Regenerate apps/web/lib/docs/doc-index.generated.json
and doc-impact.generated.json. Register new behavioral tests in the policy
inventory. Run affected installer tests, shell syntax/shellcheck, package
typechecks and exact-tree governed pregate; obtain independent semantic review,
publish a signed PR and verify CI. Native Linux acceptance cannot run on this
macOS authoring host and is explicitly awaiting the customer's pilot.

No live credentials, production teardown or install upgrade are performed.
Existing state is preserved; repair refuses unsafe ownership or mismatched
material. A future release delivers these source changes. Existing installations
rerun the appropriate updated bootstrap under their operating procedure; do
not claim that a source merge automatically repairs their host.
Rollback through a signed source PR; never delete CA or runtime keys to retry.

## Backlog coverage

Decomposed delivery mapping: state -> BI-DFF7346E; pki -> BI-F3AD783E;
host -> BI-5282E468; docs -> BI-B739AB19. Docs depends on the three source
deliverables. Each can ship independently but this branch preserves their
shared installer integration. Governed coverage is recorded before source
implementation and its receipt is appended here.


Coverage receipt: `cmusy0s2e7xh901jzxf5zbndo`, recorded against commit
`f56b5877ff93a54098826f14d894c90d31b7fd29`, blob
`43f520f024253bc2014767b5afd3d914c088280c`. Research receipt:
`initiative-07c48d59-0018-48ce-878e-21da964e6891`.

The host prerequisite repair also wires the PowerShell pnpm twin into the
existing customizable-install path. The substrate manifest mirrors the Ollama
loopback binding. Coverage refreshed for these guard-required parity paths:
`cmusyf43p82zd01jztvite2jp` (same immutable plan provenance).

The compiled capability/service catalog was refreshed after claiming its path;
coverage receipt `cmusyionn85lm01jzvl4bqykf` retains the same plan provenance.

## Verification checkpoint — 2026-10-03

Source-local installer, PKI, release-asset, Docker, runtime-key and substrate
tests: 77 passed, zero failed, 10 skipped because PowerShell is unavailable on
the authoring host. Bash and Node syntax checks, twin-artifact parity, catalog
freshness and whitespace checks passed. The public install card was visually
checked at 1280×720 through a local static preview.

The first preflight found a missing pnpm PowerShell twin, substrate port drift
and a stale documentation index. The twin and substrate findings are repaired
and their checks now pass. Index regeneration is blocked by the active
`WC-9B1AAEA1` edit claim on `apps/web/lib/docs/doc-index.generated.json`.
Operator approval for a narrow shared claim is pending under the MCP tool
authorization runbook. No forced claim or index write has occurred.

Implementation and documentation edits remain uncommitted at this checkpoint.
Exact-tree pregate, independent semantic review, PR publication and deployed
public-page verification remain unrun. Native Linux acceptance remains deferred
to the customer pilot; source-local passes do not establish native readiness.

## Resumption — 2026-10-13

The operator requested completion of the remaining work. The conflicting
workroom is archived; the documentation index and impact paths were claimed
normally, without a forced claim. Both generated files were refreshed. The
branch was rebased onto current main (`e4edd79cd6cfa83ac00df4dd64494090573b3e23`)
and the saved edits reapplied. Conflict resolution retains main's release-asset
helpers and its distinction between operating and development hardware sizing.
The installer repairs and public assisted-pilot guidance remain one clean
revert. Verification is rerun against this reconciled source before publication.
