---
status: proposed
backlog: BI-6196CBC3
---

# Edge image workspace closure

BI-6196CBC3 repairs the build context of the existing Edge image. It extends
[the Edge design](2026-05-09-dpf-edge-node-design.md) and retains the image
contract in [deployment contracts](2026-05-09-deployment-contracts.md).
It introduces no runtime architecture or installation configuration.

## Confirmed defect and research

Canonical publication run 40825998397 for v2026.10.29 failed in both Edge
architecture jobs, 123289763242 and 123289763184, at the deploy step:
`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. The workspace required by validators,
`@dpf/integration-shared`, is absent from the image context.

The unchanged current source at d295edfd4dc6b11e16c9a68e9cd443186661004d
reproduces the omission with a dependency-free Node diagnostic. The existing
lockfile parser and workspace graph produce the closure `services/edge-node`,
`packages/validators`, `packages/integration-shared`. The existing Docker stage
parser, restricted to instructions before the install, reports only the last
package missing. The existing ignore matcher confirms its manifest is not
excluded. Supplying that package to the diagnostic in memory removes the
missing-context result. This is a source reproduction, not a successful image
build or an execution of pnpm deploy. No source implementation was changed.

This rules out an absent lockfile importer, an additional first-party package
in the current closure, and exclusion of the missing manifest by .dockerignore
for this source check. Frozen resolution, scripts and third-party dependency
behavior still require the canonical build; they are not inferred passing.

[pnpm 10 deploy](https://pnpm.io/10.x/cli/deploy) installs workspace dependencies
into the portable target and supports the existing legacy mode. Keep that mode,
the lockfile and package versions. This is repair of missing inputs, not adoption
of another package manager or deployment mechanism.

## Objective and acceptance

**OBJ-EDGE-1:** The canonical Edge image build receives its complete first-party
workspace dependency closure before installation and deployment.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-EDGE-1 | OBJ-EDGE-1 | Copy integration-shared to its existing workspace path before the filtered install, alongside validators; leave the runner stage unchanged. |
| AC-EDGE-2 | OBJ-EDGE-1 | A graph-derived regression detects missing direct and transitive workspace context, terminates on cycles, and accepts complete context; the unchanged real Edge source fails and the corrected source passes. |
| AC-EDGE-3 | OBJ-EDGE-1 | Retain frozen lockfile, ignore-scripts, scoped unused-patch handling, deploy lockfile validation and compiled runtime-import checks; no dependency versions or package-manager settings change. |
| AC-EDGE-4 | OBJ-EDGE-1 | Canonical amd64 and arm64 Edge builds pass and publish their manifest; record downstream install verification and promotion separately. Source tests alone cannot satisfy image publication. |

## Existing substrate and implementation sequence

BI-6196CBC3 is the atomic implementation parent for the following ordered work.
All deliverables serve OBJ-EDGE-1; no new parent or child backlog item is needed.

1. D1: extend the existing graph/parser seam and add failing context regression
   cases (AC-EDGE-2). Reuse scripts/check-docker-patch-context.mjs and lockfile
   parsing or workspace traversal from scripts/sbom/runtime-surface.mjs.
   Do not add a second Dockerfile parser. The current parser records final-stage
   copies, not their order; any ordering claim must be explicitly tested.
2. D2, after D1: add the missing copy and correct the stale validators-only
   comment (AC-EDGE-1, AC-EDGE-3). Keep the minimal fix and guard together.
3. D3, after D2: run affected tests and existing guard suites, canonical merged
   qualification, independent review, signed commits and protected publication
   (AC-EDGE-1 through AC-EDGE-3). Record source and runtime evidence separately.
4. D4, after D3: the existing release coordinator observes the canonical
   multiarchitecture publisher and manifest (AC-EDGE-4), then owns any eligible
   governed install advance. Do not create a competing release or upgrade.

The regression derives workspace paths from dependency edges, not a hardcoded
COPY-line assertion. It must reject absent workspace importers and distinguish
external registry dependencies from workspace links. If stage inheritance or
instruction ordering is extended, include inherited and late-copy cases.
Missing input errors must identify the image and workspace package.

## Boundaries and compatibility

Only build inputs and their source guard change. No schema, permissions,
credentials, membership, budget, provider or live runtime record changes.
Existing workspace package code is included; runtime selection still belongs
to pnpm deploy and the current lockfile validation. There is no migration.
Revert through a normal PR if needed. Never retag existing image bytes, swap
containers by hand or treat a local image as the canonical runtime.

The shared guard seam is the bounded refactoring work: reuse traversal and
parsing while preserving existing patch-context and frozen-install behavior.
Do not broaden this repair into release orchestration or framework changes.
Historical unknown review attempts, scoped reassessment and portfolio funding
retain their existing owners and gates.

## Delivery state

Design proposal and source reproduction only. No implementation admission,
independent approval, plan coverage, image build or live acceptance is claimed.
The worktree is source-only; package-dependent checks require managed dependency
provisioning or the canonical verification environment.
