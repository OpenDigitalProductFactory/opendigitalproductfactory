# Per-question tool-fidelity readers

Backlog: BI-F95DBC49. Workroom: WC-20BE2EE1. Profile: fix; delivery-small.
Implementation parent: BI-F95DBC49 (one atomic diagnostic correction).

## Observed defect and research

Qualified Recovery111 source91de4870dd7fda817e20ea7df563de2824e5bb55 and current base d2599a1dd31919782c4d0e8dc05822ed55330bb0 assign every golden prompt its entire class's authoritativeToolNames in `apps/web/lib/routing/tool-fidelity-harness.ts`. The runner pins a no-required-arguments class member rather than each question's reader. Thus a class-complete catalog can omit the tool needed to answer one of its questions.

Frozen run fidelity-bc33b190f7209e65a8a6407ad92d75382b239c2bb5608a64232f4d1de411aea7 completed45 observations:33 selection/execution PASS and12 selection FAIL. Its48-tool health cases3/5 selected get_ai_platform_posture; case4 selected get_build_progress_visibility for a next-model question. These are observations, not grounds to rescore historical data.

Source-backed contracts: ai-platform-posture-pack delegates to loadAiPlatformPosture, whose ModelProvider select includes status/recentFailureRate/latency and timestamps its snapshot. This answers recorded provider state, not a new endpoint probe. resolve_model_selection delegates to resolveModelSelectionByPhase with the existing routing preview and per-phase config. get_build_engine_readiness reads engine presence, not next-phase model selection; refresh:true can persist probes despite the tool's broad read declaration. Build progress is a different question. Broad class membership is therefore insufficient as a golden answer.

Existing work was checked: runner BI-C2F81AB0 and provenance BI-7C93EEE7 are DONE; BI-329AD58D corrected threadless review binding, not diagnostic grading; BI-99A31531 overlaps historic evaluation but is federated peer-owned and stays read-only. The finished Phase2 peer design and production intent taxonomy are not reopened. This correction extends the existing runner design and contracts.

## Objectives and acceptance

**OBJ-PRECISE:** Grade only readers that answer the individual question.

**OBJ-CATALOG:** Attach the required existing authorized readers at every declared surface before dispatch.

**OBJ-INTEGRITY:** Preserve provenance and historical results when the golden contract changes.

| ID | Objective | Statement |
| --- | --- | --- |
| AC-QUESTION | OBJ-PRECISE | Health/offline questions accept get_ai_platform_posture; next-phase model selection requires resolve_model_selection; unrelated same-class readers fail. |
| AC-SURFACE | OBJ-CATALOG | All nine unchanged prompts have a correct reader in every8/15/24/32/48 surface, or the observation remains unrun before inference. |
| AC-SAFETY | OBJ-CATALOG | Catalog construction uses original authorized read-only definitions, stable ordering and unique names, with no padding, authority widening or unsafe reader substitution. |
| AC-AUDIT | OBJ-INTEGRITY | Schema-valid arguments and exact actor-matched governed execution remain necessary for PASS; pure selection is not live execution proof. |
| AC-HISTORY | OBJ-INTEGRITY | New expectations change goldenDigest/cohort identity; frozen33/45 and unqualified model status remain unchanged, with90%/min5 and no cap/rating/routing write. |

## Design and boundaries

Keep GoldenCase and the existing nine prompts, order and task classes. Declare explicit correctToolNames per prompt instead of copying broad taxonomy sets. For backlog aggregate questions use existing list_backlog_items and query_backlog readers (when granted); get_backlog_item requires a target absent from these aggregate questions and is not a universal replacement. Provider state uses get_ai_platform_posture. Next-phase prediction uses resolve_model_selection. Current-build questions use get_build_progress_visibility, which resolves the active build through existing user-scoped helpers; no invented build id.

Extract one pure buildToolFidelitySurface helper alongside the scorer. Select one permitted correct reader per case, preferring a schema without required target arguments only among that case's correct readers. Pin their unique names, preserve deterministic catalog ordering, then fill with actual catalog definitions up to the exact requested size. Reject insufficient size, duplicate names, missing case coverage, unsafe expected readers or pinned readers exceeding the size. The runner marks insufficient_authorized_catalog without calling inference. Preserve all existing before/after authority, account/model/runtime/catalog checks and checkpoint/CAS behavior.

The taxonomy continues to describe broad live-evidence classes for its production consumers; this patch does not broaden its authority or change conversation evidence policy. No new tool, schema, table, provider, runtime, grant, credential, UI or migration. The public diagnostic shape and45-observation schedule remain stable. Golden bytes change naturally and existing bindingHash creates a distinct cohort; no retroactive rescore, continuation rebinding or migration.

## Ordered fix and verification

These steps are internal sequencing; the scorer and surface must land together so a golden question is never graded against an attachment that cannot answer it. This is one independently reviewable BI and PR, not separate deliverables.

1. Add failing semantic regressions in `apps/web/lib/routing/tool-fidelity-harness.test.ts`: health posture accepted; wrong same-class model/engine/queue reads rejected; next-model resolver accepted; stable original prompt order. Add pure surface regressions across all declared sizes, absent-reader/unsafe/duplicate/too-small catalog cases. Record actual RED against unchanged source, with injected definitions only (no model calls).
2. Correct per-case golden entries and extract deterministic surface construction in `apps/web/lib/routing/tool-fidelity-harness.ts`. Replace the runner's class-based pinning with that helper in `apps/web/lib/operate/tool-fidelity-runner.ts`; keep identity, dispatch, checkpoint, scoring and thresholds intact. Update `apps/web/lib/operate/tool-fidelity-runner.test.ts` fixtures and prove missing required reader causes zero inference/dispatch, and changed golden digest refuses historical continuation.
3. Run affected source tests and web plus db typechecks after readiness classification. Resolve graph-linked tests via find_related_tests for both changed production paths; stale or unresolved advice expands verification. Exercise Style Drift Guard (`node scripts/check-style-drift.mjs`), regenerate/check doc-index, run pregate:preflight, then exact-tree governed pregate and protected publication. Root independently reviews frozen plan/code; no native review approval is inferred from that assessment. No new live inference is part of this patch's verification.

Traceability: requirementRefs AC-QUESTION, AC-SURFACE, AC-SAFETY, AC-AUDIT, AC-HISTORY; contractRefs GoldenCase, buildToolFidelitySurface, scoreToolFidelitySelection; flowRefs runLocalToolFidelityDiagnostic; verificationRefs tool-fidelity-harness.test.ts, tool-fidelity-runner.test.ts.

## Risks, rollback and evidence limits

The narrow expected set can reject a newly added equivalent reader; add equivalents only after reading their real schemas/handlers and updating semantic tests. Broad posture reads recorded status and never proves a fresh network probe. Missing grants produce unrun, not model failure. A successful tool may still have no active build; its execution result stays failed and cannot qualify the model. Keep measured-routing work separate.

Rollback the code through a protected revert; preserve prior EndpointTestRun records. New goldenDigest prevents resuming a run under a different golden contract. No data rewrite, cap increase or automatic model requalification accompanies either direction.

## Backlog coverage

Atomic owner BI-F95DBC49; no dependencies or independent subdeliverables. Coverage receipt must bind this exact immutable ordered fix design before implementation. Initial intake is not a coverage receipt. Evidence status at design authoring: source assessment confirmed; unit RED/GREEN, typechecks, shared gate, publication and served acceptance UNRUN.
