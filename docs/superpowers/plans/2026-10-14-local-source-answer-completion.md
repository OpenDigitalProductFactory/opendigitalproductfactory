# Local supplied-source answer completion

Primary: BI-285EF102; related deliverable: BI-C145F650; Workroom WC-1EBA9720.

## Objective and recorded evidence

Restore complete legitimate local supplied-code answers through the coworker portal. Actual clean serializer and defective serializer controls received correct raw verdicts but the portal discarded them (RV-WC-1EBA9720-PAIRED-QUALITY-20261014T0552Z). Existing C145 was reopened; no duplicate work carrier. Canonical c4b60a7 includes prior admission and output-budget repairs. The useful 07:14 local backlog read timed out at interactive admission after 120000ms under real autonomous inference: AC-LIP-5 remains failed and this completion fix does not claim to resolve nonpreemptive long-holder latency.

## Preserved primary acceptance criteria

- AC-LIP-1: Portal HTTP inference and the local sandbox build engine use one `compute:local-inference` admission authority; local HTTP dispatch does not hold a second semaphore while waiting for that lane.
- AC-LIP-2: With one autonomous holder, one older autonomous waiter and one interactive waiter, execution order is holder → interactive → autonomous; bounded aging still lets an old autonomous waiter progress under repeated interactive arrivals.
- AC-LIP-3: Docker Model Runner and host-GPU probes execute only after local-lane admission, so internal contention queues while a genuinely external or unexpected owner still returns the existing typed busy result.
- AC-LIP-4: Aggregate queue-depth, cancellation/failure cleanup, idempotent release, single-GPU exclusion and remote-provider admission tests pass without weakening the host safety fence.
- AC-LIP-5: On the canonical live install, an interactive coworker selects and executes an attached governed DPF tool within its admission budget while autonomous local inference is active or queued; Operations evidence distinguishes queued internal contention from external host busy.

## Backlog coverage

Decision: decomposed. Receipt: cmv7sachk093501o97vd1wxcg. One independently shippable deliverable `source-answer-completion` maps to BI-C145F650, dependsOn []. Provider-verified immutable plan is b13bf59fda520dcbc19e0d412a34095c029eaa74, blob 3558d2c305137dcc26e8caa2f104330fbb610252. Primary admission work remains BI-285EF102, original branch identity unchanged.

Requirement ref: BI-C145F650/source-answer-preservation.
Contract ref: supplied-source-analysis/no-live-evidence-exemption.
Flow ref: conversational-local-reply/completion-and-caveat.
Verification ref: local-source-verdict/paired-control-and-mixed-live.

## Internal sequence for source-answer-completion

1. Claim exact taxonomy, evidence requirement, agentic loop, local degradation caveat, action wiring, colocated tests and existing user-guide paths. Consume gate-context impact and resolve graph-linked tests before Red; unavailable graph expands to bounded source search and exhaustive affected tests.
2. Write first-failing regressions for actual inline clean/defective serializer prompts, fenced source plus declared JSON verdict enum, a complete 30-character verdict surviving the local diagnostic path, and absence of the false tool-unavailable caveat. Negative cases retain live evidence for mixed current-state requests, required writer/tool contracts, malformed artifacts and code followed by operational requests.
3. Extend existing one-pass supplied-source classification conservatively: recognize only complete standalone simple synthetic functions, verify actual body closure and empty/semicolon tail; ambiguous regex/template/comment syntax remains conservative. Normalize PASS/FAIL only inside explicitly declared verdict-format clauses while retaining surrounding operational cues. No global live-word stripping or no-tools exemption.
4. Use recognized source-only analysis as narrow conversational text completion. Keep required-tool and build contracts enforced independently. Pass distinct supplied-source evidence to the caveat boundary; never pretend source is authoritative live-surface evidence.
5. Red/green affected unit tests, both web TypeScript programs, gate-context guards and updated user documentation. Independent review includes mixed live-request suffixes and preservation of writer requirements. Canonical exact-source CI, DCO PR, protected checks and merge queue. Advance only via canonical runtime process; repeat actual paired source controls on served merged bytes and verify governed live-tool behavior separately.

No phase above is independently shippable from the other phases: classifier, completion and caveat must agree before the user receives a trustworthy answer.

## Risks, rollback and stop condition

Main risk is misclassifying mixed source/live questions and weakening evidence obligations. Keep fail-closed parser boundaries and independently enforced tool requirements; no schema, credentials, model policy or general reasoning change. Revert the scoped PR through the protected process if regressions appear. Completion requires both source controls visible as useful correct portal replies and mixed-live/tool-required tests still enforced. Admission under long autonomous holders and native local review assurance retain their separately recorded pending evidence; no cloud receipt is relabeled local.

