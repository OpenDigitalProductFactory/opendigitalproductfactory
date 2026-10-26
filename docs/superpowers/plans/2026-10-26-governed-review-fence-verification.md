---
status: draft
---

# Governed review fence verification implementation plan

**DRAFT — design-only work. Do not begin source implementation until the required design gates, live coverage and implementation admission are satisfied.**

**Backlog:** BI-26EB2F63. **Epic:** EP-ABB3AC9D. **Workroom:** WC-09F64F43.
**Design:** [Governed review fence verification](../specs/2026-10-26-governed-review-fence-verification-design.md).
**Examined base:** 87332708ef1032c40f39250d9a3c493388182a61.
**Direction:** DI-4C55FAF78290; **design admission:** IRD-8FD4531D65D5.

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Definition of done: live acceptance criteria verbatim

Retrieved from `get_backlog_item(BI-26EB2F63)` on 2026-10-26 at 21:21 UTC. These statements are requirements, not reported results.

- AC-SV-1: Only the fixed owned scenario is admitted on a resolved DEV/test installation with current permission intersection, Workroom membership, matching active verification lease and immutable bounded expiry; forged, foreign, expired and production requests fail closed.
- AC-SV-2: Each fresh review uses the actual immutable request admission, eligible independent reviewer, exact server-issued owed-review packet, current execution-authority validation and captured generation; no caller can select or manufacture trusted identities, tokens or callbacks.
- AC-SV-3: Through the real authenticated MCP route and unchanged canonical writers, a correctly authenticated legacy-form session lacking only its fence reaches the precise new-effect refusal with no prior winner and zero new receipt/baseline/pin effects. Earlier authorization or malformed-input refusals do not satisfy this case.
- AC-SV-4: The valid captured session demonstrates a genuine authorized new effect and exact deduplicated replay under an explicitly designed independent assessment contract; a canned approval, fake reviewer result or existing-winner readback is not a substitute for the new-effect proof.
- AC-SV-5: Persist exact source/runtime/run/task/authority/result bindings and truthful failure, timeout, cancellation and UNKNOWN outcomes. Settle all owned tasks and close owned rooms before retiring fixture credentials; retain audit and evidence history, and reject duplicate or expired scenario execution safely.
- AC-SV-6: Add meaningful authority, isolation, transport, negative/positive, duplicate, expiry and cleanup regressions; complete scoped verification, independent design/security assessment, protected DCO delivery and canonical served execution. Report source and deployed evidence separately.

AC-SV-5's credential-retirement clause is conditional: this selected design uses the genuine requester's existing OAuth connection and creates no fixture credentials, so credential retirement is NOT_APPLICABLE. It still requires exact owned-work settlement and scenario-authority retirement; it never revokes the operator's connection.

## Current authority and backlog coverage

The item is triaging and implementation remains **input-required**. The current native reservation is sequence **24**, **HIGH / access-control**, effective **Large** because of transport-auth. It is a reservation, not implementation permission; research, design/spec/architecture review, objective baseline, plan review and coverage remain pending.

The following 15 paths are reserved:

- `docs/superpowers/specs/2026-10-26-governed-review-fence-verification-design.md`
- `docs/superpowers/plans/2026-10-26-governed-review-fence-verification.md`
- `apps/web/lib/govern/automation-fixture.ts`
- `apps/web/lib/mcp/packs/ux-verification-pack.ts`
- `apps/web/lib/operate/backlog-ingest.ts`
- `apps/web/lib/runtime-coordination/runtime-targets.ts`
- `apps/web/lib/mcp/independent-review-request.ts`
- `apps/web/lib/mcp/packs/initiative-readiness-pack.ts`
- `apps/web/lib/mcp/session-token.ts`
- `apps/web/lib/mcp/transport-auth.ts`
- `apps/web/lib/tak/native-mcp-executions.ts`
- `apps/web/lib/mcp-tool-types.ts`
- `apps/web/lib/mcp-task-attempt-state.ts`
- `apps/web/lib/governed-tool-audit.ts`
- `docs/superpowers/specs/review-writer-fence-verification-fixture.md`

Three paths remain conflicting with WC-6CCF8DAB / BI-BCBCA8D1 and are **not claimed by this work**: `apps/web/lib/mcp/external-coworker-task-adapter.ts`, `apps/web/lib/mcp-task-submit.ts`, and `apps/web/lib/mcp-task-execution.ts`. Root owns ordinary coordination and any later claim; never force ownership or edit these while conflicting. Test and additional candidate paths below also require exact claims before edits.

The original sequence-17 impact was resolved: related tests for its ten runtime paths, style-drift guard, **Design-Grounding** trailer, and derived doc-index plus capability-completeness checks. Sequence 24 adds the two released paths above; their additional test-impact mapping remains pending and must be resolved before implementation. Native sequence 20 records a read-only map of 45 existing related test paths across those ten runtime files; no tests were executed for that mapping. Consume the exact returned test/guard commands during implementation; do not substitute this summary for that contract. Any scope change requires refreshed impact and actual sensitivity/specialist gates. No name/path avoidance may preserve a lower shape.

Derived documentation index: `node scripts/gen-doc-index.mjs --check`. Claim `apps/web/lib/docs/doc-index.generated.json` before retaining regenerated output from `node scripts/gen-doc-index.mjs`; it is not in the current reservation. This authoring assignment changes only the two draft documents.

**Coverage receipt: PENDING.** Root owns publishing the immutable design/plan, recording research, obtaining independent assessment, recording the server-selected live coverage contract and checking it. No receipt ID is fabricated here. Source implementation remains unadmitted.

Proposed coverage decision is **atomic**, subject to the normal tool's decision: authorization, trusted one-shot state, transport discrimination, original writer continuation and cleanup must ship together. A probe without containment or uncertainty handling is unsafe; a lifecycle without a served probe does not deliver AC-SV-3/4. Phases below are internal sequencing of one deliverable, not independently shippable capabilities.

| Deliverable | Existing BI | Requirement references | Contract references | Flow references | Verification references |
| --- | --- | --- | --- | --- | --- |
| Owned canonical review-fence scenario | BI-26EB2F63 | AC-SV-1; AC-SV-2; AC-SV-3; AC-SV-4; AC-SV-5; AC-SV-6 | C-SV-AUTH; C-SV-BOUND; C-SV-CONSUME; C-SV-TRANSPORT; C-SV-OUTCOME; C-SV-CLEANUP | F-SV-PREPARE; F-SV-ADMIT; F-SV-PROBE; F-SV-PUBLISH; F-SV-RETIRE | V-SV-AUTHORITY; V-SV-ATOMICITY; V-SV-TRANSPORT; V-SV-OUTCOME; V-SV-CLEANUP; V-SV-SERVED |

Dependencies: delivered BI-F646BC4E fence and its PostgreSQL composition; existing automation fixture BI-9369DEB5; ordinary canonical artifact, independent review, lease and deployment mechanisms. This capability supplies future evidence to BI-F646BC4E but does not reopen or relabel its delivered repair. BI-7CCCA696, BI-CAP-437F7745 and BI-56E9CEC2 stay separate. Intake overlap research found BI-224C94C7 covers device-host verification rather than this seam; no exhaustive absence claim is made from a truncated epic query.

## Design grounding

Extend [Automation Persona Sign-In section 6](../specs/2026-09-03-automation-persona-sign-in-design.md#6-isolated-permission-verification-proposed-2026-09-27) and [phase 3 of its plan](2026-09-22-automation-persona-sign-in-phases.md). Preserve [writer-fence acceptance](2026-10-16-bound-review-writer-fence.md) and [canonical deployment contracts](../specs/2026-05-09-deployment-contracts.md).

Research in the draft design compares Playwright fixture scope/teardown, Temporal attempt/timeout fields, AWS FIS target/stop contracts, Azure Chaos Studio identity/scenario reporting, and the existing DPF BMAD benchmark. No dependency adoption.

Current code includes server-only `admissionGuard`, `reviewCreationAuthority` and `afterTaskCreated` in `tak/autonomous-work-run.ts`. Reuse the atomic TaskArtifact/digest-locator pattern demonstrated by `mcp-task-reassessment-admission.ts` without borrowing reassessment authority. Keep current creation lineage locks, quarantine and bound-review settlement. Earlier research from an older checkout must not justify a duplicate admission hook.

## Phase 0 — finish the governed design

**Deliverable:** reviewed, source-bound design and plan with actual live coverage. Documentation-only preparation; source implementation remains separate.

1. Review the specified Q-SV-1 through Q-SV-4 contracts with an independent authority/security assessment, distinguishing source-design choices from unrun served prerequisites. Use the genuine requester's current OAuth connection; do not mint a fixture user or new consent. Current token/authority and real reviewer/provider readiness remain necessary.
2. Publish the fixed flat repository fixture under a real DCO commit. For served execution, initialize one truthful feature/Large disposable fixture subject, then create/publish a genuinely distinct fixture branch/worktree and make its normal source claim/adoption. Run ordinary design-spec first and re-read the issuer before spec-approval; Medium body-baseline behavior is not this test. BI-26EB2F63's actual implementation shape still comes from its new scope/sensitivity, never this documentation claim. Final prepare validates that actual tuple and unchanged canonical discovery/packet/reader paths. Do not reuse BI-26EB2F63's branch, add managed-document support, seed a baseline or invent an author/reviewer.
3. Validate the completed canonical final-prepare ToolExecution as the admission root. Initial prepare atomically creates one subject and a reserved server-owned RuntimeVerification cleanup journal; a genuine distinct published source branch/claim follows, then final prepare. Preparation and start must be separate governed calls because final audit follows the handler. Prove exact current actor/room/lease/expiry checks and missing/partial audit refusal. Actual normal admission atomically inserts unique TaskArtifact keyed by prepared run+case; task/request and payload are values. Enumerate mutation/retention paths and keep RuntimeVerification JSON/metadata nonauthoritative. No new HMAC or synthetic TaskRun.
4. Keep the actual reviewer/provider loop and normal admission unchanged. Reject a fixed worker, canned approval, public skip-provider flag or generic callback.
5. Publish through the parent-owned normal DCO process and record research/coverage against the actual immutable artifact. Obtain implementation admission and exact path claims; refresh impact obligations.

**Verification:** quote-check all six live ACs; validate links and documentation whitespace; run the derived-index check and applicable documentation checks. Independent review must name any remaining design finding and distinguish it from unrun implementation/served proof. No runtime test is claimed.

## Phase 1 — shared fixture lifecycle and trusted association

**Flows:** F-SV-PREPARE and F-SV-ADMIT.
**Contracts:** C-SV-AUTH, C-SV-BOUND.
**Verification:** V-SV-AUTHORITY and V-SV-ATOMICITY.
**Internal sequencing only.**

Candidate existing paths below are governed by the current reservation/conflict table; any path absent from it **requires an exact claim**, and all edits still require implementation admission:

- `apps/web/lib/govern/automation-fixture.ts`, `automation-fixture.test.ts`, `automation-fixture-provisioning.test.ts`
- `apps/web/lib/mcp/packs/ux-verification-pack.ts` for one closed scenario registration (prepare/start/observe/retire), with normal tool/audit metadata and existing applicable grants; this is a new scoped entry, not a generic executor
- `docs/superpowers/specs/review-writer-fence-verification-fixture.md` as one future claimed/published flat fixture artifact; this draft does not create it
- `apps/web/lib/operate/backlog-ingest.ts` as the current subject creation owner, reusing its injected-store transaction surface
- Existing canonical-artifact-discovery, design-phase-recovery, repository-artifact and immutable-review-reader paths are reused unchanged; managed-document issuer/reader support is out of scope
- `apps/web/lib/runtime-coordination/runtime-targets.ts` and its tests for a reserved scenario result-key/ID namespace under existing manual-review kind, following the current reserved Small-acceptance-key pattern; no new enum/model or audit-reservation port
- Existing ingestion post-persistence indexing/advisory hooks, extracted only as needed to keep canonical subject+typed journal creation atomic and external work after commit
- `apps/web/lib/mcp/independent-review-request.ts`, `external-coworker-task-adapter.ts`
- `apps/web/lib/mcp-task-submit.ts`, `tak/autonomous-work-run.ts`
- `apps/web/lib/mcp-task-reassessment-admission.ts` as a reference only unless a justified shared refactor is claimed

Allocate approximately 20% of total effort to extracting shared fixture lifetime/current-owner/room/lease checks and atomic association/CAS preservation where repeated. Keep domain authority validators with their current owners. Resource-only fixtures must not inherit manage_users/manage_user_lifecycle requirements or use user-provisioning rights to substitute for backlog/document/review authority. No schema/configuration/model change is presumed authorized; re-scope and review any discovered need before editing it.

Write failing tests first:

- Resolved DEV/test only; current owner/coworker/room/lease intersection; expired/foreign/missing provenance; no production override.
- Current real non-credentials OAuth authority and exact issued request remain required; revoked consent/grants or ineligible reviewer refuse. No fixture user, new consent, token, role or grant is created.
- A fabricated or copied RuntimeVerification result, fake run/task ID, foreign audit handle, token/fence argument or forged locator cannot select the scenario. Require exact successful canonical prepare operation/source/actor/result. Missing, metrics-only, reserved or incomplete audit refuses.
- The actual fixed tool registration has sideEffect true and therefore ledger audit. Exercise the real registered metadata/governed wrapper: require the exact redacted completed manifest, actor/apiTokenId and actual authorityDecisionId correlation. A metrics-only empty result or retainAuditParameters alone cannot establish the root.
- Normal task creation plus server-owned manifest commits atomically; a failed association leaves no dispatchable orphan. Two starts with changed task/request IDs still contend on the same prepared run+case admission key.
- Initial preparation atomically creates the one subject and protected RuntimeVerification journal through the existing injected ingestion store; a rollback creates neither, and a post-commit crash retains exact cleanup ownership. Generic recording/import cannot use the reserved result-key/ID namespace, even with another kind, or mutate the journal. Partial/missing final audit still cannot dispatch; no forged result turns it successful.
- Unknown predecessors, quarantine, concurrent creation and current source changes retain normal refusal.
- A parent source tuple or real human requester does not substitute for the child Workroom's actual agent createdBy principal. Missing/ambiguous DCO or a registered-email principal mismatch refuses; no parent-author copying or identity rewrite.
- Ordinary non-scenario requests and existing user-fixture issuance retain behavior. No real-user-wide task scan or credential mutation occurs.

Implement only after the RED assertions execute. Record actual red/green commands, source identity and limitations; mocks of reviewer identity do not establish served authority.

## Phase 2 — one-shot probe at the real writer boundary

**Flow:** F-SV-PROBE.
**Contracts:** C-SV-CONSUME, C-SV-TRANSPORT.
**Verification:** V-SV-ATOMICITY and V-SV-TRANSPORT.
**Internal sequencing only.**

Candidate paths: honor the reservation/conflict table above and claim every additional path before edits:

- `apps/web/lib/mcp/packs/initiative-readiness-pack.ts`
- `apps/web/lib/mcp/session-token.ts`, `mcp/transport-auth.ts`
- `apps/web/app/api/mcp/v1/route.ts` only if the approved signed provenance requires route projection
- Existing `apps/web/lib/shared/task-execution-fence.ts` as an invariant owner, not a place to weaken eligibility
- Narrow scenario helper/test files beside the existing fixture owner, named only after scope admission

At the handler's validated, authenticated dispatch boundary, accept only genuine reviewer output and the original captured generation. Load the unique admission manifest and claim one probe by prepared run+case, with the admitted task, payload and fence digests as values. Check no prior winner, commit consumption and release locks before the same-installation HTTP request.

Probe the actual MCP route with the original bound authority, omitting only the fence. The signed purpose carries the exact schema/scenario, run/case, admission and spent probe artifact IDs, original task, writer, canonical payload digest, captured-fence digest and absolute expiry. The server derives them; route and handler verify them against the immutable artifacts and current expiry before dispatch. Never inject an allow decision or fake tool response. The missing-fence request cannot recurse or settle the TaskRun; a failed purpose check cannot silently become an ordinary attempt.

Meaningful RED/green cases:

- Two simultaneous original invocations yield one probe and one possible original continuation. Claim identity is prepared run+case; changed task, payload or generation cannot obtain a new claim. Duplicate callbacks reach neither repository writer while the probe is pending or UNKNOWN, and only the unique owner continues after durable qualifying negative evidence.
- No prior winner; exact missing-fence refusal reaches the unchanged writer and yields zero receipt/baseline/pin effects.
- Earlier grant/approval/artifact/source refusal is nonqualifying.
- Unrelated tasks, foreign subjects, expired leases, changed writer/arguments and replayed probe tokens cannot enter control behavior. Signed purpose must bind the consumed case/claim, task, exact writer and payload digest; caller markers are stripped and only verified context may classify the probe.
- Crash before send and crash after send both keep consumption spent; no restart reissues the request. Replaying an earlier signed RuntimeVerification result or changing its JSON cannot rearm the scenario.
- Two identical signed HTTP probe requests contend on one deterministic receive artifact under the outbound claim after governed authorization but before writer dispatch. Exactly one invokes the canonical writer; duplicates retain their real audit and return retained result or pending/UNKNOWN. Receiver crash before/after the writer does not reassign or reset consumption.
- No database writer lock remains held during HTTP; a concurrent normal cancellation can complete.
- Both canonical repository writers use the fixed genuine repository artifact with real subject/room/source/DCO provenance. Measure pre-fence content-addressed archive creation separately; require zero new receipt/baseline/pin effects, not zero total writes.

The positive baseline test must use an authentic independently produced approval in deployed execution. The source fixture's content cannot instruct the reviewer to approve; refusal remains a real result. A fixture constant or injected reviewer result can test mechanics only and must be labeled accordingly.

## Phase 3 — normal continuation, exact replay and audit classification

**Flow:** F-SV-PUBLISH.
**Contracts:** C-SV-TRANSPORT, C-SV-OUTCOME.
**Verification:** V-SV-TRANSPORT and V-SV-OUTCOME.
**Internal sequencing only.**

Candidate paths: honor the reservation/conflict table above and claim every additional path before edits:

- `apps/web/lib/tak/native-mcp-executions.ts` and its tests
- `apps/web/lib/governed-tool-audit.ts`
- `apps/web/lib/mcp-task-execution.ts`, `mcp-task-attempt-state.ts`
- `apps/web/lib/tak/terminal-tool-policy.ts` and `agentic-loop.ts` only if the existing owner settlement and durable hold cannot preserve the reviewed contract; avoid a broad error framework

After verified negative evidence, release the unchanged genuine invocation with the **original** fence. Normal repository authority/independence/generation checks decide publication. If the repository result is genuinely new, the unique owner rechecks current task/generation/expiry and immediately invokes that same unchanged repository method once with identical normalized arguments, before the original handler returns to normal settlement. Require deduplicated true and the same receipt/baseline with no added pin. Label this canonical replay inside one served invocation accurately; it is not a second HTTP request or ToolExecution. Initially deduplicated/failed/expired/UNKNOWN results never qualify or trigger replay.

Preserve every actual probe audit and authorization record. Add only server-validated control attribution; a client flag cannot hide ordinary failures from terminal policy. The probe is not a reviewer correction attempt and cannot replenish budgets. The normal original writer still counts.

Test:

- Genuine original effect once; exact subsequent replay returns the same receipt/baseline without additional pins.
- If cancellation, expiry, source or generation changes after negative evidence, the original call correctly refuses and coverage remains nonpassed.
- Negative probe never reaches model history as a prompt to correct/retry; both CLI-native folding and ordinary loop dispatch preserve normal attempt counts.
- Probe timeout/lost acknowledgement uses the existing owner settleRemoteTask with the original fence to persist input-required plus executionUncertainty before the failed ToolResult. Test through governedExecuteTool (which otherwise flattens throws to tool_threw), both CLI HTTP and ordinary loop, and outer completion. The hold must remain non-resumable, block positive continuation and survive late original callbacks. No automatic loop retry or cleared uncertainty.
- Unexpected negative-probe publication is verification FAIL with effects retained.
- A real reviewer FAIL remains a real FAIL. No fabricated baseline-positive coverage.
- Actual task settlement uses the current fenced helper and cannot revive canceled/quarantined/unknown work.

## Phase 4 — durable evidence, retirement and integrated proof

**Flow:** F-SV-RETIRE.
**Contracts:** C-SV-OUTCOME, C-SV-CLEANUP.
**Verification:** V-SV-CLEANUP and V-SV-SERVED.
**Internal sequencing only.**

Candidate paths: honor the reservation/conflict table above and claim every additional path before edits:

- `apps/web/lib/govern/automation-fixture.ts` and existing cleanup tests
- `apps/web/lib/queue/functions/data-retention-sweep.ts` only if bounded existing expiry reconciliation needs extension
- `apps/web/lib/runtime-coordination/runtime-targets.ts` and `types.ts` only if required to project the approved evidence contract
- Existing Workroom/runtime verification projections; no new page currently proposed

Report the exact source/runtime/task/request/actor/artifact/authority/nonce/result identities and canonical effect deltas, with source and deployed evidence separate. No secrets in logs, screenshots or traces. The report must not act as execution authority.

Use supported task settlement/cancellation and governed room closure only for exact manifest-owned child resources. Retirement waits for their actual settlement and consumes the scenario's own admission/probe authority. It never scans the real user's task inventory, revokes their connection or disables their identity. No fixture credentials exist, so credential retirement is NOT_APPLICABLE. Repeated cleanup is idempotent; original expiry denies further scenario execution while cleanup is pending. Preserve failure and UNKNOWN; cleanup success is not verification PASS.

Regression coverage must prove pending child prevents retirement, all real/unrelated credentials and work remain untouched, expiry never renews, root/claim history survives every normal recovery write, interrupted preparation/cleanup retains exact ownership and resumes through the existing bounded cursor, and persisted outcome classification remains truthful.

## Completion gate and proof matrix

Execute applicable checks only after current source dependencies and implementation impact are resolved. Use the normal managed bootstrap for any missing pinned source dependencies; do not create a private dependency tree or hand-built runtime. The parent completed the managed source dependency bootstrap: compile-ready / managed_bootstrap_ok, dependency probe and gate readiness passed, missing dependencies and ignored builds empty, pnpm 10.33.2. Do not repeat broad bootstrap. No Compose isolation or environment setup was created; this draft authoring does not authorize Compose operations.

| Layer | Required work | Actual status at draft |
| --- | --- | --- |
| Documentation | Exact AC text, links, lint/index verification; independent design/security review and live coverage | Pending |
| Source | Affected authority, fixture, writer-transport, native-folding and cleanup regressions; relevant TypeScript programs | UNRUN |
| PostgreSQL/route integration | Real serializable/CAS races, authenticated MCP route, canonical effect deltas and cleanup under shared canonical lease | UNRUN |
| Publication | Frozen DCO source, necessary independent review, canonical gate, push, ready PR, required CI/protected merge and `pnpm pr:health` | UNRUN |
| Deployment | Canonical containing release through existing owner/`request_self_upgrade`, actual image identity and healthy settled runtime | UNRUN |
| Served negative | Fresh owned cases, authentic request/session, exact fence refusal, no prior winner, zero receipt/baseline/pin effects | UNRUN |
| Served positive/replay | Real reviewer payload; original valid session creates new effect; exact replay deduplicates | UNRUN |
| Retirement | Exact manifest-owned task/room settlement, scenario authority retired, evidence retained | UNRUN; credentials NOT_APPLICABLE |

Do not claim PostgreSQL or transport tests passed when skipped for missing infrastructure. A source PR proves source delivery, not deployed verification. A containing deployment proves availability, not either writer case. Ordinary denied/UNKNOWN historical reviews, including any original retained outside this fixture, stay unchanged.

## Risks, rollback and resumption

Primary risks are forged scenario activation, widened identity, double dispatch, lost consumption state, recursion, deadlock while awaiting HTTP, audit contamination, uncertainty becoming retry, and premature credential retirement. Each has an explicit regression above; independent security assessment must check the implementation, not merely this table.

The scenario has a fixed two-case ceiling and one probe each. Use exact-key reads and existing indexed cleanup pagination. Raising limits or introducing generalized scenarios is new scope under EP-ABB3AC9D.

No UI surface is presently added: visual design acceptance is not applicable to this non-UI plan. Any added form, navigation, page or changed user flow reopens UX-impact assessment and browser/theme/accessibility verification.

Rollback stops new scenario entry through normal source revert and canonical deployment; preserve original-expiry denial, spent probes, real effects, evidence and pending cleanup. Never reset or delete historical tasks, restore revoked authority or turn off the writer fence.

Resume from the persisted run/task outcome and current permissions, not chat assertions. If provider readiness is unavailable, record the exact current normal-admission failure and retained state. The engineering choices above are specified. Required native design/admission gates, source regressions and actual served prerequisites remain to be completed by the delivery owner; they are not a request for the user to choose implementation details.
