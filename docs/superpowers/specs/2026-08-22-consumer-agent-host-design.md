---
status: binding
---

# Consumer install as a first-class agent host

**Date:** 2026-08-22  
**Status:** approved for implementation  
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

- MCP instructions are the behavioral source of truth. They are generated from
  the served install profile and the token's effective authority, so they cannot
  drift from the running platform.
- A minimal `AGENTS.md` is shipped as a consumer release asset. It identifies the
  directory as runtime material, forbids treating it as a source checkout, and
  points the agent to the MCP instructions. It does not duplicate contributor
  doctrine.
- The existing progressive-disclosure bootstrap remains first in the instruction
  string. Host orientation follows it, then organization context.

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
  and provides server `instructions` in the initialize result. DPF adopts that
  protocol seam instead of a client-specific prompt wrapper:
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

### Instruction ordering

The initialize result is composed in this order:

1. existing bounded `load_tools`/catalog recovery contract;
2. install-mode and effective-authority host contract;
3. existing organization context and decision routing.

The consumer contract tells an external development agent to coordinate through
MCP and use a separate source checkout/worktree for code. It explicitly forbids
editing the installed Compose/scripts as if they were the repository.

### Release pointer

`config/consumer-install/agent-pointer.md` is copied into
`/dpf-release-assets/AGENTS.md`
and covered by the release-asset contract test and checksum manifest. Installers
already extract and verify the entire release-asset bundle, so no second copy
list is introduced. The neutral source filename is deliberate: it must not become
an active nested `AGENTS.md` that overrides the repository rulebook while source
is being edited. The pointer contains no operational details that could drift.

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

1. Every consumer release contains the minimal root pointer and checksum coverage.
2. MCP initialize instructions identify consumer/source/unknown mode and the
   token's effective authority before organization context, without displacing
   the existing progressive-disclosure prefix.
3. Consumer instructions say runtime assets are not a source checkout and route
   code work to a separate governed checkout/worktree.
4. Consumer self-upgrade is effectively disabled and ineligible across the
   request path, runner, batch projection, MCP status, owner summary, and trigger.
5. No surface claims a sourceless consumer install is current merely because a
   Git target could not be resolved.
6. Source-backed contributor behavior and authorization enforcement remain green.
7. Unit, route, release-asset, owner UI, style, build, and exact-tree gates pass.
