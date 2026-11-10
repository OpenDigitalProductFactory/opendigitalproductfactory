---
status: active
backlog: BI-144363E1
---

# Bounded real-Git fixture lifecycle

Workroom: WC-06199E99. Small fix; research receipt
initiative-918ef90e-bf21-460a-8f8f-840ea676f48f; implementation admission
IRD-0E03D86A71AC. This prerequisite is independently revertible from the frozen
Critic repair BI-BCBCA8D1. No engagement execution is delivered by this document.

## Evidence and existing substrate

At 4c290ad54d46c650f1fc954d175cb478dbab761d the attested-PR fixture and
merge-delivery-signal fixture duplicate asynchronous real-Git initialization.
Their execFile calls have no deadline. A partial root is inaccessible to the
caller until setup completes; teardown then dereferences undefined repo.root.
Canonical D328/EER cmvssr0550d2a01medomoyalg failed three 10-second setup hooks,
then secondary cleanup. A one-worker reproduction failed identically. A bounded
15-command probe succeeded in 26349ms, excluding neither variable load nor OS
latency. The unchanged fresh-base run passed all31 tests in13.52s. Preserve both
observations: a passing sample does not repair failure ownership.

Native spec search reports the runtime corpus absent. Source searches found
2026-10-14-bounded-local-ci-test-profile.md (worker choice, not fixture lifecycle)
and 2026-10-08-git-fixture-contact-classification-design.md (contact screening).
Neither owns this repair. Native graph has no real-git-fixture helper. Existing
scripts/fixtures/gate-worktree.mjs is synchronous and copies gate assets; it
cannot safely supply this asynchronous Vitest lifecycle. Consolidate the two
actual duplicated setup functions into apps/web/lib/testing/real-git-fixture.ts.
No dependency, schema, runtime or global Git configuration changes.

## Ordered atomic implementation

1. Keep the historical failed gate and fresh unchanged31-pass sample. Add
   deterministic actual-subprocess deadline and partial-initialization cleanup
   tests. First show that the old unbounded lifecycle leaks its temporary root.
2. Centralize owned temporary-root allocation, command diagnostics, bounded
   subprocess execution, overall setup cancellation and idempotent cleanup.
   Default command budget15s and total setup90s are explicit local fixture
   limits: the measured 26.349s sequence fits with headroom. Setup hook95s leaves
   cleanup time; failures remain failures. No global timeout or worker change.
3. Migrate the two duplicated fixture builders without changing their commit
   messages, ancestry, PR identities, revert semantics or production resolver.
   Run all31 original assertions and lifecycle regressions, types and required
   style/doc guards. At least20% of repair effort consolidates existing lifecycle
   code; no parallel gate or scheduler.
4. DCO commit, independent review, canonical protected publication and merge.
   Only then refresh and qualify the Critic branch; never relabel D328 as PASS.

These steps are internal sequencing of one fixture lifecycle repair, not
independently shippable features. BI-144363E1 is the sole delivery mapping.
Requirement refs AC-GIT-1 through AC-GIT-4 bind to lifecycle-command-bound,
lifecycle-setup-bound and lifecycle-owned-cleanup contracts, setup-command-close-
cleanup flow, and lifecycle-regressions plus original-real-Git-assertions proof.
The native derived small shape requires research and delivery; it admitted
implementation without a separate plan/spec-approval requirement. This ordered
fix design remains the canonical source capture and accompanies the repair.

## Acceptance

- AC-GIT-1: Real fixture setup has explicit finite subprocess and overall bounds with exact phase/command failure diagnostics; evidence includes complete real-Git execution under the observed host conditions.
- AC-GIT-2: Failed or timed-out setup before repo assignment cannot cause a secondary undefined-root error; only the resolved owned temporary repository is cleaned, with no leaked child/helper.
- AC-GIT-3: Existing ancestry, PR identity, revert and delivery assertions execute and retain their original meaning; no mocked Git, skipped cases or blanket timeout/guard relaxation substitutes for proof.
- AC-GIT-4: Original D328 failure and timing observations stay retained; targeted repair tests and normal protected publication checks report actual results independently of source-only progress.

## Risk and rollback

A deadline must await actual child close before cleanup. Cancellation must reject
later commands from an abandoned setup; disposal must only address the private
root allocated by this fixture, never a caller-supplied deletion path. Cleanup
failures must surface with the original setup error, not suppress it. Local Git
hooks/signing/fsmonitor must not launch unowned helpers; isolate these per
command within the synthetic fixture, without changing global configuration.
Revert this single PR to restore the old fixtures; historical evidence remains.

## Observed source verification

The initial partial-setup regression failed because access(allocatedRoot)
succeeded after the actual missing-revision Git failure. After cleanup ownership
was implemented it passed. An unawaited actual subprocess regression then failed
before the pending-command completion fence was added. A foreign GIT_DIR case
failed before per-command repository-selector isolation. All eight lifecycle
cases and all31 original assertions now pass together (39 tests, three files,
13.66s on this Windows host). Both web production and test type programs passed
before the final environment-isolation addition; commit hooks recheck the final
source. Style drift and generated doc-index checks passed. Canonical delivery
checks remain pending and must be reported separately.

The command implementation follows the [Node child-process contract](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback):
direct execution without a shell, finite timeout with SIGKILL, and completion
callback after child termination. Git hooks, signing and fsmonitor are disabled
only for this synthetic local fixture; inherited repository selectors are
removed only from its child environment. Global host configuration is untouched.
