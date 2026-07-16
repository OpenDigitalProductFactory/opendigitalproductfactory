# Self-Upgrade Latest Run card — human-readable upgrade scope

**Date:** 2026-07-15
**Surface:** `/ops/self-upgrade` → Latest Run card (`apps/web/components/ops/SelfUpgradeClient.tsx`)
**Kernel decision:** DI-59CB13916826 (interactionId), profile `mark-dpf-platform`

## Problem

The Latest Run card rendered the upgrade as two raw 40-char git SHAs
(`currentSha → targetSha`) with no human framing. An operator could not tell how
big or how risky a run was — the identifiers meant nothing on sight. There was
"no version" because a self-upgrade run is addressed commit-to-commit and the
target commit is usually not a tagged release, so the SHA pair was the only thing
the card reached for.

Meanwhile the substrate to answer "how big?" already existed but was not on the
card:

- **Release version** — `platformVersion.version` (git-describe SemVer) already
  flows into the same status payload and renders as the *current* platform
  version at the top of the page. It describes where the install *is*, not what
  a run moves between.
- **Impact summary** — `UpgradeImpactSummary` (the "What's in this update?"
  panel) already computes an LLM headline and a counts ribbon
  (breaking / new / perf / fix + total). A `SelfUpgradeRun` even records the
  exact summary it carried via `impactSummaryId`.

## Decision

Surface the scope **on the run card itself**, in human terms:

1. Shorten the SHA pair (12 chars + ellipsis, full value on hover `title`),
   framed `Change: <from> → <to>` — precise identity, secondary.
2. Lead with the run's plain-language **headline** when recorded.
3. Show a **scope ribbon** — `N changes · 1 breaking · 5 new · 3 fixes` — drawn
   from the run's own impact summary, colored destructive when any change is
   breaking (the risk signal an operator most needs).

The digest is loaded by the run's own `impactSummaryId`
(`loadRunImpactDigest` → `getPersistedSummaryById`), **not** by a
(lineage, target) re-derivation — so a completed run keeps showing the changes
*it* applied even after the upstream target advances past its endpoints.

A tag-pair version string (e.g. `5.5.2 → 5.6.0`) was **not** adopted: tags for
arbitrary run SHAs are not reliably resolvable at runtime in a deployed image,
and fabricating one would violate Never-Fabricate. The commit count + category
breakdown is the honest, grounded "how big?" answer.

## Kernel consultation

`principle_decide` (DI-59CB13916826) scored a minimal option (short SHAs +
version/commit-count only) against the full option (also surface the counts
ribbon). Result: **full** (composite 2.806 vs 2.430, margin 0.376, strong
structured coverage, no commandment conflict). The evidence-density axis pulled
the decision toward putting the scope ribbon on the card rather than leaving the
run identified by SHAs alone.

## Scope of change (no contract change)

- Extended the impact module (shared `formatImpactCounts`, `loadRunImpactDigest`,
  `getPersistedSummaryById`, `RunImpactDigest` type). Reused by the existing
  panel and the run card.
- Display-only. No schema change, no new route, no new operator control.
