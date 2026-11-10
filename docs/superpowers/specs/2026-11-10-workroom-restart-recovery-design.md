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
2. **R3 / C2 / F2 / V3 — resolve qualification before ordinary implementation.**
   The selected evidence strategy is a bounded qualification experiment using
   the existing current-process proof and transaction-scoped canonical admission
   locks, not a new timestamp-derived authority. It must establish the complete
   lifetime described below before admitting the ordinary correction. If that
   mechanism cannot satisfy AC-3, retain the hold and obtain scoped correction
   admission; the candidate is not a substitute for that decision.
3. **R2 / C1 / F1 / V2 — qualify restart continuity.** Extend the existing
   `scope-epoch-enrollment.server.ts` predicate and its colocated tests. Exact
   authenticated IDs must remain equal; accept only finite, non-backward starts
   no later than observation. Preserve receipt verification, image/writer checks,
   absence of retired IDs and canonical admission serialization. No migration,
   new persistence concept, dependency or runtime service is proposed.
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

## Selected qualification mechanism and falsification plan

The generation under test is the actual production Node process and its loaded
writer closure, not the mutable Docker start timestamp. Candidate qualification
retains a frozen process-bound proof; acquisition and receipt publication must
remain inside the same database transaction holding both canonical admission
locks. Test the claim/receipt path from qualification through the transaction's
actual commit or rollback. The image identity and packaged source comparison
alone do not prove loaded-code immutability: live read-only inspection found a
writable container root filesystem. Enumerate writable overlays, mounts, dynamic
loads and admitted production code-changing writers; prove they cannot change
the qualified writer closure during that lifetime, or require a scoped correction.
Do not describe this unresolved guarantee as already enforced.

Source anchors below are immutable blobs at main
`4fff0a44d8b957e479a1d17379eab3041c2e2432`:

| Path | Blob | Obligation |
|---|---|---|
| `apps/web/lib/work-capsules/scope-epoch-enrollment.server.ts` | `788135e546588b9255a4cb13dcc81f68e0a54427` | Current process proof, packaged bytes and admission locks |
| `apps/web/lib/work-capsules/scope-claim-store.ts` | `7e9ff5a98791a4692d38f6f50ee7e14aaae374bc` | Qualification before receipt transaction; same transaction retained through effect |
| `apps/web/lib/work-capsules/command-receipts.ts` | `2bdda63a729f82f7bd6abe391a1875cc7433cea3` | Actual commit/rollback and no partial effect/activity/receipt |
| `apps/web/lib/work-capsules/scope-epoch.pg.test.ts` | `534170053590cb481fad2ea80fe80191f05b6432` | Both lock orders and real database barriers; qualifier remains mocked |
| `Dockerfile` | `1ae237f2282e36f31361f8ae247a6d9655b8f667` | Production standalone process and packaged writer generation |
| `docker-compose.yml` | `007b9d4790b78240ab61eb5c9cdcc2f3cca4411b` | Sandbox database isolation and actual mounts; dev-preview services are distinct |

Use a governed nonproduction target and real isolated database for a child writer
bound to the exact candidate. Terminate it after qualification, after the room
lock and before commit; independently observe complete commit or complete abort.
Force a generation/cohort change after qualification and demonstrate actual
exclusion or refusal. Predicate mocks and PG fixture locks are separate evidence
layers, never proof of production process/image isolation. Current sandbox
inspection confirmed no `PRODUCTION_DATABASE_URL` variable, but that observation
alone is not complete network, credential or writer isolation proof. No ad hoc
runtime, production crash injection or manual retirement-proof change is allowed.

## Admission and evidence status

Design intent is allowed for WC-228D7A07. The first research receipt attempt was
rejected `malformed-receipt` because immutable artifact provenance is required.
Research and plan coverage remain pending immutable publication. No implementation
admission, completed safety review, full gate, live repair or original cost-control
delivery is claimed. Reviewer context lives in archived WC-495809CB sequence 11;
that archived room supplies historical requirements, not current source authority.
