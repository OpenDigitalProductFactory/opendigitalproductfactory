---
status: active
---

# Local inference concurrency verification — BI-B550D9E5

## Objective and evidence

Finish the original live acceptance after PR #6270. One actual advisory answer passed on canonical 7680e10; fifteen probes deferred under CI capacity reservations. Two parallel MCP submissions executed serially, so they did not establish contention. Bounded source lookup found controlled admission tests, but no live in-process two-caller entry point.

## Original acceptance criteria

- AC-1: Internal callers wait for the existing admission slot, then recheck host lease and GPU safety; all paths release the slot.
- AC-2: A temporarily deferred panel resumes within bounded durable retries without repeating completed branches or sealing a missing verdict.
- AC-3: Reasoning-only and truncated results are never accepted as completed answers; usage and failure evidence remain observable.
- AC-5: Automatic build routing includes eligible alternative providers when saved preferences are unavailable, preserving explicit pins, capability floors and provider-specific model selection.
- AC-4: Affected tests and typecheck pass and canonical runtime proves contention and complete-answer behavior.

AC-2, AC-3 and AC-5 retain the original merged regression coverage. This correction adds the missing diagnostic evidence for AC-1 and AC-4, without widening the acceptance contract.

## Design grounding

Reuse `docs/superpowers/specs/2026-10-04-local-inference-reliability-fix.md`, the existing `apps/web/lib/inference/inference-admission.ts` semaphore, shared local ResourceLane, caller cancellation context, endpoint tester, and EndpointTestRun results. Coordinate with PR #6345 before editing the tester and pack. No new tool, queue, store, schema, grant, runtime override or UI.

## Atomic sequence

1. Extend the existing admission primitive with optional caller-scoped observation of queued, acquired and released events. Observation cannot change scheduling, manufacture a wait, or throw into a caller. Test immediate/queued/canceled/released paths and observer isolation.
2. Add an explicitly selected concurrency diagnostic to the existing endpoint tester. Require one explicit local provider/model; reject fan-out and incompatible batch options. Start exactly two ordinary calls in the same process, each with independent event capture, under the existing finite diagnostic cancellation/output budget. Never reserve a fake slot or synthesize an answer. Settle both calls and preserve actual content, truncation/completion state, token counts and admission events in existing run results.
3. Pass only when actual events prove a caller queued while the other held a slot, release occurred, and both actual answers are nonempty and complete. Capacity/deadline/cancellation and an unobserved wait remain inconclusive; genuine answer failures remain visible. This diagnostic must never rewrite capability ratings from two simple answers.
4. Run affected admission/tester/pack suites and both web TypeScript programs. Source-only readiness currently prevents claiming local passes; use managed dependency convergence or the governed shared CI. Run protected CI, merge normally, and let the existing sole publisher qualify canonical bytes.
5. With canonical deployment, active provider and admitted host capacity, run the diagnostic once and record actual evidence against the original acceptance. Existing diagnostics owner retains combined live acceptance. No live probes during upgrade and no foreign lease/process/model reset.

Reference anchors for coverage: `CONTRACT-existing-admission`, `FLOW-two-ordinary-callers`, `VERIFY-source-regressions`, `VERIFY-canonical-two-caller-answers`.

## Published CI correction: repeatable estate context

PR #6370's run 38535433884 confirmed Estate Discovery at 977 visible words against a 972-word baseline, with unchanged semantic structure. Captured content includes the CI runner's real host and network. The authenticated shell (`apps/web/app/(shell)/layout.tsx`) executes bootstrap discovery whenever no discovery run exists. The current sweep fixture supplies no estate, so first login collects uncontrolled host data.

Extend the existing fixture before authentication with a fixed completed run, six physical/internal entities, two relationships and two review issues. Reuse existing tables and constant fixture keys; preserve pre-existing nonfixture discovery and all business products. No empty-run sentinel, baseline increase, production renderer change or collector override. Test populated context, idempotence, existing-estate preservation and failure propagation. Earlier b790 canonical 6,788-test and qualified native-review passes retain their original identity. The correction requires affected source checks and independent delta assessment; final integration belongs to protected GitHub checks. AC-4 remains open until canonical deployment and actual two-caller evidence.

The b41 protected sweep verified the first-login fix and reduced the estate to 905 words, but exposed missing review and inventory headings: manual rows lacked normalized membership, taxonomy candidates and graph-mirror projection. Replace that row-only fixture with eight fixed collected facts and five relationships passed through the existing `normalizeDiscoveredFacts` and `persistBootstrapDiscoveryRun`. Reuse its atomic transaction, quality evaluation and graph sync, without invoking live collectors or product promotion. A fixture-to-actual grouped-inventory and graph-projection contract test must establish physical members and review candidates; replay returns the existing fixed run without creating a second run. Preserve any nonfixture run before persistence. The original baseline and production renderer remain unchanged.

## Risk and rollback

## Live observation correction (BI-B550D9E5, TR-205FB057)

The once-only canonical run on served 9ca09de returned two actual READY answers, no truncation and unchanged model ratings. It correctly deferred acceptance: events were empty, release was unobserved and finish reasons absent. Served source shows local `callProvider` uses `withLocalInferenceLock`/ResourceLane, while the observer was wired only to the remote semaphore. The HTTP chat adapter also discarded `finish_reason`. Existing injected diagnostic tests manually acquired that semaphore and supplied raw choices, so they did not exercise the real path.

Reuse the caller-scoped observer across Next module caches, and add optional safe per-entry phase callbacks to the existing ResourceLane. Emit actual enqueue/acquire/cancel/timeout/release phases; release is observed only when the lane actually clears its active holder, before handing off. Preserve scheduling, priority, budgets and the existing telemetry opt-in. Carry only actual optional provider `finishReason` through AdapterResult and InferenceResult; never infer stop from text, truncation=false or a completed promise, and do not retain raw reasoning bodies. The diagnostic reads normalized evidence with legacy raw compatibility.

ResourceLane may enqueue both callers before its scheduled pump starts. Prove overlap using the observed intervals: `max(holder acquired, waiter queued) < holder released < waiter acquired`, with every event present and both release events observed. This accommodates real pre-pump queuing without manufacturing a hold, wait or timestamp. Test the real callProvider, local lane and real chat adapter against stubbed HTTP provider responses, including missing stop evidence, plus cancellation/timeout/observer isolation. No manual diagnostic-slot acquisition or fabricated normalized raw choices in the integration regression. Run affected source tests and typechecks, independent exact review and protected delivery. Repeat the bounded live acceptance only after a materially corrected containing release and CAN-TEST/NORMAL/capacity admission. The original deferred RV remains evidence, not a model-quality failure or a slot-leak finding.

Run 38564121544 confirms the NIC provenance fix, all original accessibility structures and the inventory word ceiling. Discovery alone has six extra words. Captured text also proves a remaining producer-fidelity error: the fixture's ARP hosts suggest a commercial-banking taxonomy at 8%, while real collected ARP hosts suggest network management. The real network collector supplies `osiLayer`, `osiLayerName`, `networkAddress` and `protocolFamily`; the fixture omitted them. Restore those four existing raw signal fields for both ARP facts and test normalization against a financial decoy and a network node. Never pin a taxonomy, score or lifecycle result or shorten labels to force the word count. Protected CI measures the resulting faithful fixture; a remaining legitimate difference then goes to intentional-change review rather than further fixture tailoring.

Run 38561085043 confirms all three gateway actions, leaving one extra lifecycle issue row and 15/19 extra visible words. The original collector NIC used the registered `000D3A` MAC prefix; the committed OUI registry and native read both identify Microsoft Corp. The fixture had invented a locally administered MAC, for which the canonical resolver correctly cannot identify a vendor. Represent the known-vendor NIC with fixed raw MAC `00:0D:3A:00:00:10`; let existing OUI resolution, enrichment and quality evaluation derive its lifecycle state. Never set support status or suppress issues directly. Add a contract through those existing functions asserting the known interface has no unknown-lifecycle issue while the unknown managed estate and review cases remain. Protected corrected-head CI is the final complete persistence/replay/accessibility check in its disposable database. Do not raise numeric ceilings or apply diagnostic candidate baselines.

The 33fed protected run 38557436950 confirms the canonical persistence fix restored review and subnet sections, but the fixture still omits the bootstrap runner's gateway-connection follow-up. The original measured estate has one physical and two Docker gateways with three Configure actions. Reuse `flagUnconfiguredGateways` as an exported existing helper after fixture convergence, including replay, only when the nonfixture guard permits the declared CI estate. Add two fixed Docker gateway facts to represent the same actionable issue states. Test the helper's real issue writer, covered-gateway preservation and replay repair; avoid full bootstrap execution, live collectors, promotion, renderer changes or baseline adjustments.

Observer mistakes could alter admission or leak caller context; isolate callbacks and test thrown observers and terminal cleanup. A faster first call may finish before the second queues; report that observation as inconclusive rather than manufacturing contention. Caller budgets may expire before answer content; preserve that evidence rather than relabeling it complete. Revert the optional diagnostic and observer together; the delivered reliability behavior remains independently present in PR #6270.

## Backlog coverage

One atomic deliverable mapped to BI-B550D9E5. Observer wiring without the diagnostic cannot close live acceptance, and the diagnostic without truthful events cannot prove contention. Live immutable plan coverage was recorded before source implementation: initial receipt `cmv7mw4pk07gb01ob279xxzsk`, refreshed receipt `cmv7n7i6v0be401ob8obvc2ep` after claiming the diagnostic leaf files. Both bind the plan at `ec912b9ead04be27c9b30d3bb467a9278a1bda7c`, blob `e9707b36a800aad121023de05c9d29738debf3ba`. Tester/pack integration requires the current owner's normal scope handoff and fresh coverage for that enlarged edit scope.
