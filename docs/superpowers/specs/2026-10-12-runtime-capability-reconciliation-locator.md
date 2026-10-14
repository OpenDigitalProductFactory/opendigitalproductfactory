---
status: draft
date: 2026-10-12
backlog: BI-5ACBAC50
---

# Existing-install capability reconciliation: implementation locator

This is the immutable implementation/coverage entry for existing BI-5ACBAC50 and WC-0AD784CD. It introduces no new initiative, engine, architecture decision or desired live capability set. Normative architecture and the ordered repair remain in `docs/architecture/capability-driven-runtime-profiles.md` §Proposed existing-install reconciliation — BI-5ACBAC50, approved direction `DI-375608F0065D`.

## Evidence and boundaries

The prepared source is `e4ca1f1ad82e3b8355f7cdc2d03de77210a855c5`, with shared recursive signing, trusted packaged-probe primitives and ordinary version-2 apply. Its source tests and independent assessments are retained with original attribution; full integration, real PostgreSQL and live reconciliation are unrun. The packaged probe truthfully advertises no reconciliation support yet.

Read-only observations on 2026-10-12 still show host schema2/win32/amd64 with core only, catalog52358eb9e4f8… and state76c08f072b16…, while the portal database has nine runtime rows, seven active. This is disagreement, not authorization to activate all seven. Ordinary coordinator validation binds previous keys to database active rows, while the host actuator compares its actual snapshot; it correctly refuses the inconsistent baseline.

Use existing RuntimeCapabilityTransition JSON request/receipt storage, serializable admission, authority reservation, host journal and signed receipts. No new datastore or parallel writer is proposed. Preserve lifecycle overlays, optional volumes, independent operator state and explicit local-provider disable. No PROD action or direct install-file edit is in this source scope.

## Acceptance

AC-1: Reconciliation binds the validated actual host snapshot, keys, hashes and identity separately from the complete observed database state map.

AC-2: Explicit desired host keys, desired database states and touched keys preserve every untouched database value and report residual disagreement.

AC-3: Trusted immutable packaged protocol identity and version-2 reconciliation support are verified before authority reservation, database admission or journal creation.

AC-4: Database and host admission compare their own observed baselines; replay retains its original immutable identity.

AC-5: Compensation restores only this saga's still-owned applied state and never overwrites a subsequent writer; uncertain recovery stays explicit.

AC-6: Fresh bootstrap is host-grounded, existing sync preserves operator state, and real persistence, shared gates and served reconciliation qualify completion.

## Ordered atomic delivery

All steps belong to the same capability-reconciliation fix. Internal signing, protocol, validation and apply commits are prerequisites; none completes the operator's capability-agreement objective independently. Keep one coherent reversible source change in the existing branch, and retain separate evidence for each completed prerequisite.

1. Reuse prepared signing/probe proofs and reproduce the still-refused inconsistent baseline on the named source. Record native research with provenance, not a newly fabricated verification run.
2. Extend existing protocol/coordinator/host boundaries with separate full baselines and desired results. Validate touched keys and preserve unknown operator intent; bind immutable replay. Reuse shared serialization/hash/projection helpers rather than another codec or engine.
3. Wire trusted packaged discovery before reserve/admit/apply; add database baseline CAS and host baseline CAS. Exercise concurrent writers, intervening drift, owner/expiry failures and crash boundaries.
4. Bind compensation to this saga's applied snapshot and managed database values; subsequent writers cause recovery-required. Keep legacy unsigned-health evidence explicitly unverified.
5. Extend `packages/db/src/sync-capabilities.ts` and its existing tests for host-grounded fresh creation and state-preserving existing sync. Use the same governed preview/actuator, not a new activation path. Claim additional paths before edits.
6. Run affected source checks, real PostgreSQL/shared qualification, independent review and protected publication. The designated publisher/advance coordinator owns canonical releases. After CAN-TEST, one authorized reconciliation must prove exact host/database results, residual drift, sandbox identity and subsequent upgrade behavior.

- **Requirement CAP-RECON:** AC-1 through AC-6 above, with actual dual-baseline comparison and no blanket seed activation.
- **Contract CAP-RECON:** existing `apps/web/lib/platform-runtime/transition-protocol.ts`, `transition-coordinator.ts`, `runtime-capability-executor.ts`, shared signer, packaged actuator and transition ledger. Metadata/support checks precede privileged side effects.
- **Flow CAP-RECON:** observed host + complete observed DB → explicit desired results/touched set → trusted compatibility → reserve → DB CAS admission → host CAS apply → signed observed health → owned DB commit or owned compensation → truthful residual drift.
- **Verification CAP-RECON:** meaningful red/green protocol/coordinator/host/sync tests, real PostgreSQL two-writer/crash tests, exact-tree shared gates and served acceptance. The inherited tests are source evidence only; new runs and unrun gates retain separate attribution.

## Risks, rollback and coverage

Risks are stale baseline adoption, incomplete DB maps, mutable caller identity across awaits, legacy health promoted to verified evidence, unowned rollback and transport/version disagreement. Refuse those cases before mutation or report recovery-required without forcing restoration. Source rollback is one PR revert; any live compensation follows the existing saga's owned comparison and keeps volumes.

Declare delivery-medium@1.0.0. Existing native research receipt `initiative-25c7fd99-2ccd-4ab2-be31-fda3075d4e85`, atomic coverage `cmv5x77yo0cli01mr7dwpx9i8` against immutable locator commit `7465b88eac84a5184bb69ee34c5af8002f1b0039` / blob `4f9515a57e147c8a35f1cbe754d3481328c62647`, and implementation admission `IRD-963A57D5F5B5` were verified on continuation. CAP-RECON remains mapped only to existing BI-5ACBAC50. Workroom custody and these planning records do not establish delivery or parent completion.

The first continued coordinator prerequisite reproduced seven failing identity,
baseline and replay tests, then passed 114 affected tests across three executed
files and both official web TypeScript programs. Its narrow independent source
assessment found no blocking issues.

The production executor now captures caller identity before observation and
checks the immutable packaged protocol against the portal's baked Git identity
and packaged actuator/signer hashes. Missing or conflicting identity refuses
before host authority. Reconciliation remains unavailable even when the host
advertises support; it never falls back to the ordinary transition. This
prerequisite passed 121 affected tests across four files and both official web
TypeScript programs after the identity regression failed on the earlier source.
Independent assessment of this executor correction is pending. Dual-baseline
reconciliation, owned compensation, bootstrap sync, real PostgreSQL, the full
governed gate and live acceptance remain incomplete.
