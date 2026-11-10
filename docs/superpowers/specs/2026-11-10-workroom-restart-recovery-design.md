---
status: draft
---

# Workroom scope enrollment after an ordinary container restart

Implementation item: BI-224F56F1. Design Workroom: WC-228D7A07.
Branch: `codex/workroom-restart-recovery`.
Historical contract: `docs/superpowers/specs/2026-10-14-owned-workroom-scope-release-design.md`.
The delivered historical BI-B13239B1 is not reopened. BI-7B1D74B3 owns separate agent cost controls.

## Reproduction and boundaries

At verified main `cc34280ba737347be8b4d9d575f8cdd0b5dc4d19`,
`apps/web/lib/work-capsules/scope-epoch-enrollment.server.ts:110-114` compares
the entire authenticated replacement cohort with a fresh Docker observation.
`StartedAt` changes on ordinary restart even when the container IDs, images,
daemon and project do not change. Live read-only observations found identical
portal/sandbox IDs and daemon, November 6 recorded starts and November 10
04:45:28 current starts. No running service, deployment proof or database row
was changed to reproduce this.

Two added restart regressions failed with `current-cohort-unproven` before the
candidate change; 15 existing/negative cases passed. Candidate source commit
`184bdae2f8b4e54444d8bc766635dc511fb9f37e` on the separate cost-controls branch
passed 32 enrollment/import Vitest tests, 16 authenticated-retirement Node tests
and web typecheck. It is preserved evidence, not an admitted implementation or
independent approval of this workroom. Publication and served validation are unrun.

Later `matching-canonical-run-unproven` and missing final SUR-C457D1F6 evidence
are distinct canonical-runtime recovery work. This correction cannot repair them.
Only the canonical runtime owner may advance that install through its governed path.

## Acceptance contract

- AC-1: Same authenticated replacement IDs with valid non-backward restart times no later than observation can qualify; new IDs, malformed/future/backward times, old-container presence and mismatched source/daemon/project remain held.
- AC-2: Signed retirement authentication, packaged writer/image proof, current ownership and transition admission checks retain precedence; no evidence rewriting or authorization bypass.
- AC-3: Independently establish stable loaded writer/process qualification and canonical-transition exclusion through transaction commit, or atomic abort, with meaningful after-qualification mutation, lock-race and crash/rollback evidence. Do not substitute mocked Docker or timestamp tests for that proof.
- AC-4: Reconcile one current source carrier and record research/plan admission before publication; canonical owner deploys through protected release and verifies real scope acquisition plus refusal of incompatible evidence.

## Ordered atomic delivery

1. **R1 / V1 — reproduce and bind.** Use this implementation item's current
   workroom and immutable design as the ordered fix plan. Record actual red/green
   research. Reconcile source identity and covered plan through governed writers.
2. **R2 / C1 / F1 / V2 — qualify restart continuity.** Extend the existing
   `scope-epoch-enrollment.server.ts` predicate and its colocated tests. Exact
   authenticated IDs must remain equal; accept only finite, non-backward starts
   no later than observation. Preserve receipt verification, image/writer checks,
   absence of retired IDs and canonical admission serialization. No migration,
   new persistence concept, dependency or runtime service is proposed.
3. **R3 / C2 / F2 / V3 — prove qualification through commit.** Resolve original
   reviewer obligations before publication: actual loaded production generation
   and sandbox/production DB isolation, post-qualification mutation behavior,
   transaction barriers and both canonical admission lock orders, and process
   death/rollback. Reuse `scope-epoch.pg.test.ts`, `scope-claim-store.ts` and the
   receipted-tool transaction owner. Existing PG fixture races prove lock behavior
   only, not Docker/source generation. If the architecture cannot supply the
   lifetime invariant, obtain scoped correction admission; do not silently relax it.
4. **R4 / C3 / F3 / V4 — deliver and observe.** Run affected tests/typecheck,
   deterministic guards and the exact-tree shared gate; obtain independent
   review against immutable source. Publish DCO-signed through protected PR.
   The sole canonical owner deploys. Verify real successful acquisition and
   incompatible-evidence refusal before recording delivery.

One atomic implementation item owns this sequence: reproducing, correcting,
proving and deploying the same enrollment defect are not independently useful
deliverables. No separate cost-control feature or stale-proof recovery is included.
Rollback reverts this source correction through protected release; it does not
rewrite signed proof or reset protected claims. Unknown lifetime evidence holds
acceptance and is never recorded as a passing check.

## Admission and evidence status

Design intent is allowed for WC-228D7A07. The first research receipt attempt was
rejected `malformed-receipt` because immutable artifact provenance is required.
Research and plan coverage remain pending immutable publication. No implementation
admission, completed safety review, full gate, live repair or original cost-control
delivery is claimed. Reviewer context lives in archived WC-495809CB sequence 11;
that archived room supplies historical requirements, not current source authority.
