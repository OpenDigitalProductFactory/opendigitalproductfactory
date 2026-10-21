---
status: active
---

# Repair Docker Desktop preview mount identity

**Backlog item:** BI-81AF5884
Workroom: WC-DB6884ED. Shape: delivery-small@1.0.0, fix profile.
Design: [preview mount identity](../specs/2026-10-21-preview-docker-desktop-mount-identity.md).

For agentic workers: execute this plan one independently reviewable backlog item
at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
`dpf-local-merge-ci-before-push` plus this completion gate before any success
claim, and `dpf-pr-with-dco` for handoff.

## Acceptance

- AC-1: Both the host keeper and canonical server issuer accept the observed /host_mnt/Users/... to /Users/... tuple only with fresh Docker daemon OperatingSystem evidence equal to Docker Desktop.
- AC-2: Missing, failed, unknown or native Linux daemon evidence cannot make distinct /host_mnt and direct POSIX paths equivalent.
- AC-3: Wrong roots, POSIX case changes, NUL, CR and LF, dot traversal, relative paths and prefix lookalikes remain rejected; existing direct POSIX and Windows mount behavior remains valid.
- AC-4: Existing lease, owner, SHA, clean-source, running-container, port, service and development-environment checks remain enforced.
- AC-5: First-failing regressions, affected tests and typechecks, independent review, and required shared-CI and native publication gates precede any ready code PR; unavailable gates remain unrun or inconclusive.
- AC-6: This delivery makes no runtime, production-data, credential, grant, infrastructure, deployment, merge or initialized-database-reuse change.

## Design grounding and impact

C-MOUNT and C-ENGINE are the shared matcher and fresh daemon-metadata contracts
in the design. F-KEEPER and F-ISSUER are its two existing binding flows.
The source base is `28ab249373336c86b409a6cb129370867533c6fc`.
The Workroom's claimed-path impact contract is resolved. `find_related_tests`
found `apps/web/lib/govern/preview-automation-sign-in.test.ts` for the issuer;
the ready graph had no links for the CJS helper or its declaration. Bounded
caller search therefore expands verification to the host adapter's Node suite,
the release lease contract and the shared package tests/typecheck.

## Ordered implementation and verification

One atomic deliverable, D-MOUNT, implements AC-1 through AC-6. The steps are
internal sequencing; the two consumers must agree on one canonical comparison.

1. Publish the immutable design/plan with DCO and obtain native plan coverage;
   record the observed source defect and research through the ordinary evidence
   writer before the implementation claim. Do not substitute Markdown for a
   refused receipt. This document's temporary coverage condition describes the
   immutable-provider prerequisite, not completed planning.
2. V-RED: Add regressions to `scripts/lib/dev-portal-lease-claim-key.test.mjs`
   and `apps/web/lib/govern/preview-automation-sign-in.test.ts` before changing
   behavior. Observe the exact Desktop tuple fail in both adapters. Include
   missing/failed/native-Linux evidence, wrong root and case, NUL/CR/LF, `.`/`..`,
   relative and misleading-prefix paths, direct POSIX and Windows cases. Retain
   direct equality when both paths start `/host_mnt/`; compare a nested
   `/host_mnt/host_mnt/...` source to an admitted literal `/host_mnt/...` path
   as exactly one alias translation. Use
   mocked command boundaries; do not launch Docker or a preview.
3. Implement C-MOUNT in
   `packages/integration-shared/src/preview-mount-identity.cjs` and its `.d.cts`
   declaration. Implement C-ENGINE in `scripts/lib/dev-preview-runtime.mjs`
   and `apps/web/lib/govern/preview-automation-sign-in.ts`. Prove the actual
   adapters collect and pass fresh daemon facts, including failure/renewal
   boundaries, rather than testing only caller-supplied fixture evidence. Verify
   direct POSIX and Windows success after a failed metadata read, and fence the
   aliased binding when a renewal reads changed or unknown engine metadata.
   Bound the host runner's metadata read with a per-command ten-second timeout;
   use a short-lived Node child to test timeout without Docker or runtime startup.
4. V-GREEN: Run both affected suites, `tests/release/dev-portal-lease-contract.test.mjs`,
   shared-package tests/typecheck, affected web typechecks, and the mandatory
   `node scripts/check-style-drift.mjs`. Preserve the original identity-guard
   regressions. Record exact results and any infrastructure failure separately.
5. Extend the existing preview mount section in
   `docs/install/platform-support-watchlist.md`; generate and check
   `apps/web/lib/docs/doc-index.generated.json` with `scripts/gen-doc-index.mjs`.
   Run the actual-diff context, documentation/process guards and independent
   source review. Amend source/tests if review identifies a defect.
6. V-PUBLISH: Run `pnpm run pregate:preflight`, then the required shared leased
   `pnpm run pregate` and native semantic review/failure analysis on the exact
   final immutable tree. Commit with DCO, push through the ordinary hook and
   open/attach a ready non-draft PR only after required gates pass. Check PR
   health and review findings. Do not merge, deploy or launch a runtime.

## Backlog coverage

- Decision: atomic
- Parent: BI-81AF5884
- Receipt: blocked-by: immutable design and plan must first be committed, provider-readable and bound to the current Workroom head before native coverage can be recorded.
- Rationale: The helper, trusted daemon evidence and both consumers form one mount-identity repair; any individual consumer or helper shipped alone leaves the reported preview binding incomplete.
- Deliverable: D-MOUNT -> BI-81AF5884; AC-1 through AC-6; C-MOUNT, C-ENGINE; F-KEEPER, F-ISSUER; V-RED, V-GREEN, V-PUBLISH.
- Dependencies: none

## Risks and stop condition

Preserve all existing lease, source, environment and issuer restrictions.
Unavailable engine evidence fails closed for the alias; native Linux paths
remain distinct. If native plan or publication gates cannot run, record their
exact condition and leave the corresponding transition incomplete. Do not
weaken grants, protection, reviewer independence or production integrity.

The source handoff is complete only with verified code, honest evidence and a
ready PR. Canonical installation and served acceptance remain pending separate
operator approval. Rollback restores the prior safe mount-mismatch hold without
data or schema changes. Initialized-database reuse is outside this BI.
