---
status: binding
---

# Consumer install as a first-class agent host

**Date:** 2026-08-22  
**Status:** approved for implementation  
**Amendment:** 2026-08-24 interaction-shape clarification is pending fresh P0 review; the approved self-upgrade contract is unchanged
**Backlog:** BI-11D611B3, BI-DD7DC141  
**Workroom:** WC-E08BD92F  
**Kernel decisions:** DI-06201F1778E9, DI-88D1C6E4B937

## Problem

A release-image consumer install exposes DPF through MCP but contains neither the
source rulebook nor a source checkout. An external agent therefore sees a broad
tool surface without being told what kind of host it has entered, what its token
actually authorizes, which contracts are authoritative, or where code changes
belong.

The same missing install identity makes self-upgrade dishonest. Consumer installs
run a tagged release image, while the current resolver, promoter, activation, and
rollback pipeline require a Git source target. The Upgrade Center and MCP status
can nevertheless describe that pipeline as enabled, eligible, or up to date.

## Decisions

### Agent contract: MCP plus a pointer

`DI-06201F1778E9` selected `mcp-plus-pointer` at 0.9 confidence with no
principle conflict.

The P0 operating-profile design at
`2026-08-23-external-agent-operating-profile-design.md` mechanically supersedes
the agent-contract, instruction-ordering, release-pointer, and corresponding
acceptance-criterion details in this document. The self-upgrade support projection
and every unrelated decision below remain binding.

- MCP `initialize` instructions are the bootstrap transport. The authenticated,
  principal-bound `operating_profile_get` result is the behavioral operating
  source of truth and is generated from canonical install, organization, and
  effective-authority inputs.
- A minimal generated `AGENTS.md` remains a consumer release asset. It identifies
  runtime material, forbids treating the install as source, carries release-bound
  schema compatibility metadata, and points the agent to the authenticated
  operating profile. It does not duplicate contributor doctrine or authority.
- The initialize instruction string directs a capable client to fetch and obey
  the operating profile before `load_tools`. Existing host and organization prose
  remains as a compatibility projection from the same canonical inputs.

A full file contract was rejected because it would fork contributor rules into a
release artifact. MCP-only was rejected because instruction-aware clients that
inspect a working directory before connecting would still mistake runtime assets
for source.

### Upgrade boundary: honest unsupported state now

`DI-88D1C6E4B937` selected `honest-unsupported-now` at high confidence
(composite 10.144, margin 3.159) with no principle conflict.

This change adds an authoritative support projection and applies it before any
Git resolution, queue dispatch, drain, or promoter work. A sourceless consumer
install is configured but not effectively enabled: every agent and operator
surface reports `supported=false`, `enabled=false`, and a stable reason. It is
never described as eligible, queued, or up to date.

A full release upgrade remains governed by the existing release-artifact backlog
item. A digest-only splice was rejected: comparing a registry manifest does not
define the immutable multi-image release set, verified asset refresh, Compose
overlay preservation, migrations, activation, rollback, or Windows recovery.

## Research and benchmarking

- MCP 2025-11-25 defines initialization as the first client/server interaction
  and provides server `instructions` in the initialize result. DPF uses that
  protocol seam to direct the client to the authenticated operating profile,
  rather than treating duplicated prose as the authority or adding a
  client-specific prompt wrapper:
  <https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle> and
  <https://modelcontextprotocol.io/specification/2025-11-25/schema>.
- The newer MCP discovery proposal returns server instructions through
  `server/discover`, but discovery is optional and tools can be called inline.
  DPF therefore guarantees orientation on its negotiated 2025 initialization
  path and ships the filesystem pointer for hosts that inspect before connecting;
  it does not claim a universal protocol-level before-first-call guarantee for
  future clients that skip discovery:
  <https://modelcontextprotocol.io/specification/draft/server/discover>.
- The OCI Distribution Specification makes manifests content-addressable by
  digest and defines digest-bearing manifest responses. That is the correct
  identity primitive for the future consumer updater, but not a complete release
  lifecycle by itself:
  <https://github.com/opencontainers/distribution-spec/blob/main/spec.md>.
- Existing DPF designs remain authoritative for progressive tool disclosure,
  N-1 promotion safety, batching, and the owner-readable update card. This design
  extends those contracts rather than replacing them.

## Canonical architecture

### Install host profile

`apps/web/lib/install/host-profile.ts` owns one dependency-light read model:

- `source`: a source-capable checkout is mounted and Git-backed;
- `consumer`: the install marker says consumer, release image identity is
  present, and source operations are unavailable;
- `unknown`: evidence is incomplete or contradictory, so source mutation and
  self-upgrade fail closed.

The pure classifier accepts evidence as data. The I/O adapter reads the mounted
host at `/host-dpf` (overridable for tests), never the host-only Windows path in
`DPF_HOST_INSTALL_PATH`. Both MCP orientation and self-upgrade support consume
this model; neither reimplements `.install-mode` or `.git` probing.

### Effective authority

The MCP route derives an instruction tier from the already-resolved bearer token,
not from a client claim and not from a persisted template label:

- admin grants produce platform-administration guidance;
- development grants produce governed source/workroom guidance;
- read-only scope produces observer guidance;
- remaining write grants produce domain-employee guidance.

Custom tokens are classified by their effective grants. Instructions describe
the ceiling and required workflow but never broaden authorization; tool dispatch
continues to enforce the existing scope/grant intersection.

The authority tier does not select the agent's use shape. The operating profile
derives `business-operations` versus `platform-development` from confirmed
primary/secondary installation purpose, then applies the token/grant intersection
inside that context. A development-capable token cannot silently turn a customer
business interaction into source work, and a declared `evolve-dpf` purpose does
not grant development authority.

### Instruction ordering

The initialize result is composed in this order:

1. fetch `operating_profile_get` before any business or platform action and stop
   when it is unavailable or incompatible;
2. obey its active brakes and refresh on its invalidators;
3. begin in the profile's default interaction shape and enter an alternate only
   when the profile advertises it and the task explicitly requires it;
4. use the existing bounded `load_tools`/catalog recovery contract only after
   orientation identifies the relevant capability;
5. render compatibility host and organization context from the same canonical
   inputs for clients that do not call the profile tool.

The consumer contract is business-first. For a normal customer installation it
routes the agent to organization purpose, WWWD business judgment, WSID profession
practice, authorized Work Cases, and business outcome Workrooms. It does not lead
with backlog, worktree, PR, CI, or Build Studio instructions.

When the installation explicitly declares `evolve-dpf` as a primary or secondary
purpose and the task enters that available shape, the same contract tells the
external development agent to coordinate through MCP and use a separate governed
source checkout/worktree for code. It explicitly forbids editing the installed
Compose/scripts as if they were the repository. Purpose, environment class,
source capability, and token authority remain independent facts.

### Release pointer

`config/consumer-install/agent-pointer.md` remains the neutral source template for
the installer-owned generated `/dpf-release-assets/AGENTS.md`. Generation projects
the canonical profile-schema version, schema digest, digest algorithm, and
installer-owned release-image digest, plus the exact MCP discovery and fail-closed
recovery rules. The generated asset is covered by the release-asset contract test
and checksum manifest. Installers already extract and verify the entire
release-asset bundle, so no second copy list is introduced. The neutral source
filename must not become an active nested `AGENTS.md` that overrides the repository
rulebook while source is being edited. It contains no principal-bound profile or
authority digest and cannot grant authority.

### Self-upgrade support projection

`apps/web/lib/self-upgrade/support.ts` maps the host profile and configured flag
to a stable support contract:

- `supported` and effective `enabled`;
- configured state for diagnostics;
- target kind (`git-source` or `release-artifact`);
- stable machine reason and plain-language explanation.

The runner checks it before resolving a target. The request path refuses queue
dispatch. The batch projection is non-applicable and ineligible. MCP returns the
same fields. The Upgrade Center uses the same projection to render the first
viewport and disable the trigger.

## Owner experience

On a consumer install the first release card says:

> Automatic updates aren't available for this install yet.

It explains that the current release keeps running, DPF will not queue a
source-based upgrade, and a newer consumer release must be applied through the
release installer guidance. The trigger is disabled with the same reason. It
must not show an “up to date” headline when no target exists.

The implementation reuses report-kit components, existing theme tokens, semantic
HTML, and the current progressive disclosure. No new badge, KPI, color, or
parallel status card is introduced.

## Security, scale, and data architecture

- No schema or migration is required. Install identity is runtime evidence, not
  tenant data.
- Token details and environment values are never echoed into instructions.
- Unknown or contradictory host evidence fails closed for source mutation.
- Profile computation is O(1): two bounded filesystem probes and local token
  grant classification. It does not grow with tools, tenants, or installs.
- The scale ceiling is one local host profile per portal process/request. The
  future artifact-upgrade BI owns registry caching, release-set fan-out, and
  fleet-scale distribution.

## Stray runtime file

The observed ` .Destination}}{{end}}` file has no matching expression in current
source or installer scripts and no reproducible seed path. Deleting a live file
or adding speculative cleanup would violate the seed-first rule. It is therefore
not part of this source fix; it can be removed separately if provenance is
established.

## Acceptance criteria

1. Every consumer release contains the minimal generated root pointer, its
   profile-schema and release identities, and checksum coverage.
2. MCP initialize instructions direct capable clients to fetch the authenticated
   operating profile before `load_tools`; compatibility host and organization
   prose is formatted from the same canonical inputs and never overrides the
   profile.
3. Consumer instructions say runtime assets are not a source checkout and route
   code work to a separate governed checkout/worktree.
4. Consumer self-upgrade is effectively disabled and ineligible across the
   request path, runner, batch projection, MCP status, owner summary, and trigger.
5. No surface claims a sourceless consumer install is current merely because a
   Git target could not be resolved.
6. Source-backed contributor behavior and authorization enforcement remain green.
7. Unit, route, release-asset, owner UI, style, build, and exact-tree gates pass.
8. Customer/business-purpose profiles lead with WWWD/WSID Work Case operation and
   suppress development-workroom concepts until an explicit, available
   `platform-development` shape is selected.
