---
status: active
backlogItem: BI-0B292D84
workroom: WC-454E1BF6
---

# Packaged Workroom binding correction

This is a corrective bind-at-birth delivery under existing BI-0B292D84,
not completion of its broader four-layer Workroom integrity contract.
Source base: `29b6a6dd8aa29f1dfbb55e17fdcb8dea5d7bde1f`.
Workroom: WC-454E1BF6. Research:
`initiative-adbea6ef-ee95-46d8-aa0b-e36b7e9bd526`.

## Design grounding

Reuse the bind-at-birth direction recorded in BI-0B292D84 / DI-300EDF57581E,
the source/worktree contract in
`docs/architecture/branch-and-worktree-runbook.md`, and the pack lifecycle in
`docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md`.
The installed hook's package-relative import of a repo-only helper fails with
ERR_MODULE_NOT_FOUND. A source-tree test cannot prove packaged execution.

Keep one binder: `scripts/lib/workroom-bind.mjs::bindWorktreeToWorkroom`,
including source observation, response identity validation and reobservation.
The existing `packages/dpf-skill-pack/hooks/worktree-create.mjs` remains the
placement and caller adapter. Its copied package must locate the canonical
helper in the Git-verified DPF checkout being created/reused, rather than assume
repo scripts surround the installed pack. The created checkout is preferable
to assuming the read-only main checkout contains current code. Validate the
actual checkout, Git-derived expected branch/head, common repository and DPF source markers
before loading source code; require the identity-capable helper exports.
Use file URLs and reject paths escaping the verified source root.

Rejected: preserve the known broken relative import; duplicate a packaged
binder/authentication client; ship an unaudited second scripts tree; mutate the
read-only main checkout or installed runtime to make an import happen to work.
Missing, foreign, stale or unsupported source remains explicit fail-soft
binding failure, never cached proof. No credentials, grants or room authority
change. Existing token/agent intersection, TLS, DCO and PR controls remain.

## Acceptance criteria

- AC-PB-1: A copied package WorktreeCreate hook automatically invokes the existing canonical binder and records repository, branch, worktree, base SHA, head SHA and session before returning the created path.
- AC-PB-2: Binding loads only from the verified DPF source checkout being created or reused; foreign repositories, conflicting paths or branches, missing helpers and unsupported helper contracts never produce a binding or cached claim.
- AC-PB-3: Transport failure, authorization refusal and source drift remain explicit unsuccessful binding outcomes; worktree creation keeps its path-only stdout contract and never fabricates a marker or passing verification.
- AC-PB-4: Package and source callers reuse one binding and authentication mechanism, preserving permission intersection, existing credentials, endpoint and TLS policy, independent approval, DCO and protected publication.
- AC-PB-5: The copied-package cold regression, existing binder/claim-guard/reconciliation tests and applicable checks pass; installed acceptance is reported separately from source delivery, and the broader original four-layer acceptance remains open until demonstrated.

## Implementation and verification

One atomic deliverable, `packaged-birth-binding`: the package caller and its
cold regression must land together. No new tool, ledger, controller or binder.

1. **CT-PACKAGED-BIND / FLOW-BIRTH / VC-COLD.** Write a failing regression that
   copies the package hook away from repository scripts and runs its actual
   entry point against a temporary source Git fixture and bounded mock MCP
   server. The fixture contains the real canonical binder and its existing
   dependency closure, isolated credentials/home and empty Git hooks. Assert
   exact adoption identity/session, real cached response, and path-only stdout.
   No live database writes or canonical Workroom claims occur in this fixture.
2. Refactor the existing caller to resolve the verified source helper. Retain
   fail-soft creation on unavailable coordination and no marker on failure.
   At least 20% of effort goes to shared validation and reusable fixture setup,
   rather than duplicated source observation or auth logic.
3. **CT-SOURCE-IDENTITY / FLOW-ADOPT / VC-NEGATIVE.** Cover foreign/non-Git
   source, mismatched branch/root, missing helper, unsupported exports, denied
   or unavailable MCP and source changes. Reuse actual binder failure tests;
   exercise package-specific resolution and stdout/marker behavior.
   Run `packages/dpf-skill-pack/hooks/worktree-create.test.mjs`,
   `scripts/lib/workroom-bind.test.mjs`,
   `scripts/reconcile-workroom-bindings.test.mjs`, and existing claim guard/
   refresh suites. Consume graph-linked tests from the scope impact contract.
4. Freeze a signed commit, run affected checks and applicable policy checks,
   obtain independent source assessment and publish through protected CI and
   merge queue. Preserve any authorized DEV skipped/unrun gates explicitly.
   Do not replay uncertain provider tasks or broaden review authority.
5. **CT-INSTALLED-PACK / FLOW-ACCEPT / VC-INSTALLED.** Through canonical
   release/toolchain delivery, verify the real copied installed hook invokes
   the same source helper and records exact identity. Do not edit installed
   files or force active-client restarts. Report source, copied-package test
   and deployed/installed acceptance separately. Original broader layers stay
   open until their own acceptance is demonstrated.

## Dependencies and rollback

BI-023EF164 / PR6416 owns shared automatic source identity; this corrects its
packaged caller's remaining qualification gap. BI-CAP-21C511CA / PR6427 owns
review result readback; its canonical deployment acceptance remains separate.
BI-282AE0BC guard reuse and BI-7CCCA696 safe automatic review continuation are
next independent work. Canonical identity BI-CAP-437F7745 and role/room
configuration BI-56E9CEC2 remain separate. Original BI-0B292D84 dependencies
remain recorded in its unchanged body.

Principal risks: executing foreign checkout code, silently using an old helper
that ignores source capture, or corrupting the path returned to the harness.
Fail closed for binding on uncertain identity; keep creation fail-soft with a
clear stderr outcome. Rollback is a signed revert of this caller correction;
do not delete claims, credentials, runtime state or historical evidence.

## Backlog coverage

Parent: BI-0B292D84.
Decision: atomic.
Receipt: blocked-by: corrective plan must be committed and pushed before the
provider can verify its immutable blob; record coverage for that published head.
Rationale: source-helper resolution and the actual copied-package regression
are one binding contract and cannot be accepted independently.
Requirement references: AC-PB-1, AC-PB-2, AC-PB-3, AC-PB-4, AC-PB-5.
Contract references: CT-PACKAGED-BIND, CT-SOURCE-IDENTITY, CT-INSTALLED-PACK.
Flow references: FLOW-BIRTH, FLOW-ADOPT, FLOW-ACCEPT.
Verification references: VC-COLD, VC-NEGATIVE, VC-INSTALLED.
No independent new BI is introduced. This plan does not retire the original
four-layer feature or claim its independent acceptance receipt.

