---
status: active
---

# Recover document converter lineage from a source commit stamp

Backlog: BI-4E18BC28. Workroom: WC-D0EF64CD. Profile: fix. Shape: Medium.
This is D6 of the [existing design](../specs/2026-09-25-doctools-on-customizable-installs-design.md),
with no independently shippable child deliverable.

## Objective and evidence

Meet existing OBJ-AVAILABLE and OBJ-DURABLE for a source-built portal whose baked
version contains a commit instead of a release description. Authorized canonical
read hk1 returned platform version override null, image label latest, registry
owner present, and baked version7396fc5fd. Existing saved converter pins are
absent; the actual prototype PDF export fails converter-unavailable. The exact
served commit has a release ancestor in the mounted repository, but current
main45d7efc6b4adf45a4d5275295d6a498d41e21f18 returns no lineage context before
attempting published or fallback resolution.

## Ordered implementation

1. Reproduce the null-context defect with a bare stamped commit. Test exact
   stamped-target arguments, direct release/describe stamps, absent owner/version,
   unsupported values, failed Git reads and no reachable release. Preserve an
   actual first RED before changing production code.
2. In `doctools-source-lineage.ts`, reuse `describeSourceLineage` on the exact
   hexadecimal stamped commit with the existing mounted path and Git runner.
   Keep the pure release-tag parser strict. No mutable HEAD, tag guess, settings
   write, provider call, new image build or install-mode change.
3. Run related source-lineage and reconciler tests, including registry proof only
   through its existing supported runtime lane; label skips and infrastructure
   failures honestly. Run both web typechecks and applicable guards. Update the
   existing contributor guide for the automatic fallback.
4. Freeze signed source, obtain independent assessment and normal host/canonical
   gate evidence, then use a protected ready PR and merge queue. Serialize runtime
   gates behind the existing foreground run; do not create a private image.
5. After governed deployment, verify actual release context, a digest-pinned
   converter, the original managed prototype export and original UX engagement.
   A merged PR, derived context or queued conversion is insufficient acceptance.

## Traceability and limits

D6 covers existing AC-1/OBJ-AVAILABLE and AC-2/OBJ-DURABLE; guide update covers
AC-3/OBJ-DOCUMENTED. Existing published/ancestor/local-fallback behavior remains
owned by D2–D5 and BI-660D77EC. No schema or migration changes are planned.

Git objects and a reachable release must exist in the mounted clone. An
unresolvable, ambiguous or unknown stamp stays unavailable; this repair does not
invent provenance or authorize fetching new source, registry credentials or
operator-owned image settings. Live converter and original business proof remain
unrun until they actually succeed.
