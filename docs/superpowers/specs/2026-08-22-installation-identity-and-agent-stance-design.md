---
status: binding
---

# Installation Identity and Agent Stance

| Field | Value |
| --- | --- |
| Date | 2026-08-22 |
| Epic | `EP-1FABA22D` — Purpose-Aware Installation and Ecosystem Productivity |
| Surface | MCP `initialize`, installer entry points, `@dpf/db` contracts |
| Owners | Platform installation lifecycle, agent host contract |
| Related | `2026-08-08-purpose-aware-installation-ecosystem-productivity-design.md`; `2026-08-22-external-agent-operating-contract-design.md`; `2026-08-22-governed-installation-teardown-design.md` |

## 1. Decision

An installation shall assert what it **is** at install time, and that assertion
shall shape what agents connected to it may do.

`EP-1FABA22D` already landed the record: `InstallationOperatingIntentV1` stores
purpose and paired-installation intent, and `install-state.v2` carries an optional
`environmentClass`. This design adds the two halves that make the record matter:

1. a **profile snapshot builder** that derives the projection from the stored
   intent plus the canonical environment class; and
2. an **instance stance resolver** that turns that projection into the brakes
   every agent-facing surface honours.

The durable rule from the parent design is preserved:

> An installation operating profile expresses intent and compiles work. It never
> grants identity, trust, authority, or permission.

A stance is therefore only ever a **brake**. A permissive stance is the absence of
an extra caution, never a grant. Authority remains TAK, GAID, and the
`FederationLink` lifecycle.

## 2. Current repository truth

Verified on this repository and against a live consumer installation on
2026-08-22:

- `InstallationOperatingIntentV1`, `InstallationEnvironmentClass`,
  `pairedProductionInstallationRef`, and `InstallationOperatingProfileSnapshot`
  are all present in `packages/db/src/installation-operating-intent.ts`.
- **Nothing builds the snapshot.** `InstallationOperatingProfileSnapshot` was an
  unused interface; only `computeProfileFingerprint` referenced its shape.
- **Nothing consumes the intent for behaviour.** A repository-wide search found
  no reader outside the writer, its tests, and the setup panel.
- **Nothing writes `environmentClass`.** The v2 schema accepts it; neither
  `install-dpf.ps1` nor `install-dpf.sh` set it. A live install had no value.
- `buildAgentHostInstructions` told an agent the host *kind* (consumer, source,
  unknown) and its token tier, and nothing about environment, purpose, peers, or
  what the installation would lose if destroyed.
- `config/consumer-install/agent-pointer.md` ships as a byte-identical `AGENTS.md`
  to every install, so a file-scanning agent learns nothing instance-specific.
- The backlog recovery contract had a **capture gap**: `parseBacklogRecoveryBundle`
  and `reconcileBacklogRecoveryBundle` could restore a bundle, but no code
  produced one. The only bundle in the repository is hand-authored. Work created
  on an installation therefore had no path off it.

The observed consequence on a live development installation: its recorded
purpose was `operate-organization`, confirmed, with no paired installation and no
environment class — a development companion asserting that it was the business.

## 3. Research and benchmarking

| System | Useful pattern | DPF decision |
| --- | --- | --- |
| [Kubernetes namespaces and `PodSecurity` levels](https://kubernetes.io/docs/concepts/security/pod-security-admission/) | A cluster-level label decides which workloads are admissible, independent of RBAC. | Adopt the split: stance constrains, RBAC/TAK authorises. Reject stance as an authority source. |
| [Terraform workspaces](https://developer.hashicorp.com/terraform/language/state/workspaces) | One configuration, many environments, each with distinct state and blast radius. | Adopt environment class as a first-class install fact rather than a naming convention. |
| [Helm uninstall](https://helm.sh/docs/helm/helm_uninstall/) | Soft removal preserves data; purge is a separate, explicit choice. | Adopt capture-before-teardown as the default brake on non-production. |
| [Rails `RAILS_ENV` / `db:drop` guard](https://guides.rubyonrails.org/configuring.html) | The framework refuses destructive tasks in production based on a declared environment. | Adopt `teardown: forbidden` for production, resolved from the declared class. |
| [AWS Organizations SCPs](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) | Guardrails deny regardless of granted permissions. | Adopt brake-only semantics; a stance never widens what a token can do. |
| [12-Factor config](https://12factor.net/config) | Environment is configuration supplied to the deploy, not baked into code. | Adopt installer-supplied declaration recorded in installer state. |

Rejected: inferring environment class from hostname, port, or organization slug;
a new `installationRole` enum; a second trust mechanism; and defaulting an
undeclared install to `development`.

## 4. Safety invariants

1. **Undeclared means production.** `UNDECLARED_ENVIRONMENT_CLASS` is
   `production`. A missing declaration can never be the reason an agent tore
   something down.
2. **Every read fails cautious.** If installer state, the intent record, or the
   backlog count cannot be read, the composed stance is production holding
   irreplaceable work — every brake on.
3. **Production teardown is never available**, regardless of backlog state.
4. **A development instance never writes to its paired peer.** `peerWrite` is
   `read-only` whenever the local class is not production.
5. **Source authority follows the host, not the purpose.** A consumer runtime
   install resolves `sourceAuthority: none` even when its purpose is `evolve-dpf`.
6. **Capture never fabricates.** The exporter refuses to invent evidence for a
   completed item and reports what it could not represent.
7. **The stance briefing carries no secrets**, no business data, and no tool
   catalogue.

## 5. Contracts

### 5.1 Snapshot builder

`buildInstallationOperatingProfileSnapshot({ intent, environmentClass })` derives
the projection. Environment class is supplied by its own authority — installer
state for the local host fact — rather than read back out of the semantic intent,
which does not own it. The result is fingerprinted and is not a writable record.

### 5.2 Stance resolver

`resolveInstanceStance(snapshot, hostFacts, options)` is pure and total. Four
closed stances, each with a one-sentence rationale so surfaces can explain a
brake rather than assert it:

| Stance | Values | Resolved from |
| --- | --- | --- |
| `credentials` | `operator-only`, `local-permitted` | environment class |
| `teardown` | `forbidden`, `capture-required`, `permitted` | environment class + uncaptured work |
| `sourceAuthority` | `none`, `governed-worktree` | host source capability |
| `peerWrite` | `none`, `read-only`, `governed-write` | environment class + paired ref |

### 5.3 Durable work capture

`buildBacklogRecoveryBundle` produces a bundle from live rows and round-trips it
through `parseBacklogRecoveryBundle`, so a bundle that builds is guaranteed to
reconcile. `pnpm --filter @dpf/db backlog:capture` writes one bundle per epic, a
manifest, and a capture receipt at `installation.backlog-capture.v1`.

The receipt is what clears the teardown brake: `holdsIrreplaceableWork` compares
the unfinished item count at capture against the count now, so work added after a
capture re-arms it.

Three contract fields became optional to match the database, which models them as
nullable: `effortSize`, `triageOutcome`, and `scopeRationale`. On a live install
21 of 42 unfinished items had no triage outcome. Requiring those fields would have
forced the exporter either to drop half the backlog or to fabricate triage
decisions. Absent is represented as absent.

### 5.4 Authority matrix addendum

| Fact | Canonical authority |
| --- | --- |
| Local environment class | `install-state.v2.environmentClass` |
| Operating purpose and paired ref | `PlatformConfig` `installation.operating-intent.v1` |
| Source capability | install host profile (`.install-mode` + `.git`) |
| Durable capture state | `PlatformConfig` `installation.backlog-capture.v1` |
| Resolved stance | derived projection; never persisted |

## 6. Archetype generality

The stance vocabulary is deliberately archetype-neutral, so the same resolver
serves every operating purpose the parent design defines:

- **Business production install** — `production`, teardown forbidden, credentials
  operator-only.
- **Development companion** (this installation) — `development` paired with a
  production ref: teardown gated on capture, peer strictly read-only.
- **Managed-services hub (MSP)** — `production` with a `deliver-managed-services`
  purpose; each customer relationship remains its own `FederationLink`, so peer
  writes stay `governed-write` behind the approved link rather than becoming a
  property of the hub.
- **MSP development companion** — the same brakes as any development companion,
  which is what keeps an MSP's test install from writing into customer estates.
- **Community contributor** — typically `development` on a source-capable host:
  `sourceAuthority: governed-worktree`, teardown routine once work is captured.

No archetype-specific branch exists in the resolver. Specialisation belongs to
purpose blueprints and federation links, not to the brakes.

## 7. Non-goals

- No new Prisma model or table.
- No teardown execution. That is owned by the governed-teardown design; this
  design only supplies the brake and the capture it depends on.
- No agent-facing operating-profile *tool*. `operating_profile_get` belongs to the
  external agent operating contract design; this change places the briefing in the
  existing `initialize` instructions only.
- No change to federation trust, GAID, TAK, or JSI.

## 8. Acceptance criteria

1. A snapshot builds from a stored intent plus a supplied environment class and
   fingerprints deterministically.
2. Every environment class and purpose in the closed vocabularies resolves to a
   stance; equal inputs produce an equal profile.
3. Production resolves `teardown: forbidden` and `credentials: operator-only`
   regardless of backlog state.
4. A development install with uncaptured work resolves `teardown: capture-required`;
   a capture receipt covering that work resolves `permitted`.
5. A development install paired with a production ref resolves `peerWrite: read-only`.
6. An unreadable install state, intent, or backlog resolves the fully cautious
   stance.
7. MCP `initialize` includes the briefing after the host and authority lines, and
   a failure to compose it degrades that block alone.
8. Both installers accept a validated environment class and record it only when
   declared.
9. `backlog:capture` produces bundles that `parseBacklogRecoveryBundle` accepts,
   reports every item it could not represent, and records a receipt.

## 9. Decision record

- **Stance is a brake, not a grant.** Modelling stances as permissions would
  create a second authority substrate beside TAK. Rejected.
- **Undeclared is production, not development.** The failure mode of guessing
  `development` is destroyed production data; the failure mode of guessing
  `production` is an unnecessary confirmation. Asymmetric, so guess safe.
- **Briefing in `initialize`, not a new tool.** The external agent operating
  contract design owns `operating_profile_get`. Adding a tool here would create a
  competing entry point before that design lands.
- **Optional contract fields over sentinel values.** A sentinel such as
  `untriaged` would assert a triage decision the installation never made.
- **Capture reports skips rather than fabricating evidence.** Inventing an
  evidence activity to satisfy an invariant would corrupt the provenance the
  invariant exists to protect.
