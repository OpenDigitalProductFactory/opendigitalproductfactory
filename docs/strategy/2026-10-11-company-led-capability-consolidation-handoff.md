# Company-led capability consolidation: Workroom and standards handoff

**Status:** offline design and sequencing proposal, 2026-10-11. This is not an approved implementation plan, live backlog inventory, qualification, or conformance receipt. MCP was unreachable during preparation. No installed runtime files were changed.

**Source reviewed:** `520efa0ca99` on `origin/main`. Historical specs describe decisions at their dates; source inspection establishes current checked-in behavior, not deployed behavior. Existing backlog identifiers in linked specs are lookup leads, not verified open work.

**Direction:** spend approximately 80% of implementation effort consolidating existing contracts and 20% on missing behavior and bounded capability absorption. This is an effort allocation, not a token count or proof that 90% of delivery is complete.

The [REA and hardware-neutral strategy](2026-10-11-rea-absorption-and-hardware-neutral-business-ai.md), preserved in merged PR #6181, establishes the research basis. This companion maps that direction onto existing Workrooms, candidate standards, source seams, and a proposed delivery sequence. It adds no normative requirement to those standards.

## Outcome and scope

An organization states what it wants to accomplish, supplies what it already knows, and receives useful work from one platform. When an existing system prevents that work, DPF investigates the specific gap, evaluates integration or native absorption, and delivers a qualified business outcome with retained evidence and an exit path.

The governing scopes remain distinct:

| Scope | Owns | How it enters this journey |
| --- | --- | --- |
| WWWD | Organization purpose, strategy, preferences, accepted tradeoffs | Installation captures enough direction to begin; later evidence proposes refinements for the organization to accept |
| WWMD | Platform architecture, absorption, reuse, complexity shield | Determines how the capability fits canonical platform contracts and when a bridge can graduate to native behavior |
| WSID | Profession craft, evidence practices, competence and credentials | Supplies relevant professional requirements; organizational facts select applicable jurisdiction and job context |

An archetype primes defaults. An imported document supplies evidence. Neither automatically becomes confirmed organizational doctrine. Platform architectural preferences do not decide a customer's business strategy or override profession obligations.

## Existing design and implementation

| Existing surface | Evidence reviewed | Implication |
| --- | --- | --- |
| Installation and WWWD seeding | `apps/web/lib/onboarding/setup-completion-seeds.ts`, `seed-org-wwwd-corpus.ts`, `seed-org-operating-model-pages.ts` | Extend the existing idempotent setup and organization overlay; preserve operator-authored pages |
| Unified enrichment | `apps/web/lib/wiki/enrich-org-corpus.ts`; onboarding business-document and market-context routes | All intake sources already have a common enrichment seam. Routes invoke enrichment asynchronously with warning-only failure handling; durable completion, retry and recovery must be established before displaying readiness |
| Published organization guidance | `apps/web/lib/decision-perspective/org-business-gate.ts` | Reuse published organization corpora and their version hash. Verify that imported candidate additions cannot become confirmed guidance by appending directly to a published page |
| Profession and jurisdiction context | `apps/web/lib/decision-perspective/profession-corpus.ts`, `install-variant-context.ts` | Reuse the existing dimension-aware applicability logic. Undeclared jurisdiction dimensions are missing information, not evidence that no obligation applies |
| Incumbent assessment | `apps/web/lib/incumbent/coverage-ai.ts`; canonical incumbent coverage portfolio source | The proposal seam currently receives incumbent name/vendor and emits fixed-confidence proposals. Extend it with the business job and observed evidence, while preserving human-confirmed assessments |
| Workroom execution | `apps/web/lib/work-management/work-shapes.ts`, `delivery-shapes.ts`, source registry and drive modules | Reuse definition versions, stages, accountable principals, evidence kinds, stops, budgets and canonical cases; do not add a separate REA lifecycle |
| Workroom measures | `workroom-flow-state.ts`, `workroom-stage-telemetry.ts`, `workroom-flow-map.ts` | Reuse stage queues and drive-derived flow states. A terminal refusal ends flow time but is not successful throughput; standing-room time between triggers is excluded |
| Continuous improvement | `ImprovementSignal` and `ImprovementProposal` in split Prisma schema; cross-Workroom review design | Findings, reviewed proposals and delivery backlog have existing owners; do not introduce another findings queue |
| Integration authority and observations | Existing MCP discovery/quarantine, governed execution, RawSource and evidence contracts | REA observations enter these contracts. A discovered tool, provider annotation or REA session never confers DPF authority |

Source comments describe typed shape gates and bindings as additive declarations, while stage tool declarations affect attachment and remain filtered by grants. Therefore, the presence of a gate or binding in a shape is not sufficient evidence that the matching runtime path enforces it. Verify each proposed path against its actual execution boundary.

Relevant design history:

- [Workroom vocabulary and ownership](../architecture/workroom-vocabulary-boundary.md): one business case and durable Workroom history; accountability, coordination, execution and access are separate axes.
- [Flow map and measurement](../superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md): existing four disclosure levels, stage queues, derived timing, and versioned comparisons.
- [Cross-Workroom learning review](../superpowers/specs/2026-09-06-cross-workroom-learning-review-design.md): compare eligible occurrences, route reviewed improvements, preserve cohorts, and distinguish definition coverage from outcome performance.
- [Edge adapter to native convergence](../architecture/edge-adapter-to-native-convergence.md): select Integrate, Native absorb, Coexist or Defer; graduate through stable canonical models and explicit system-of-record boundaries.

## Apply the candidate standards through their existing owners

The [standards family](../architecture/agent-standards-family.md) is the ownership map. The [DPF conformance assessment](../architecture/agent-standards-dpf-conformance.md) is a first-pass assessment, not current proof of every control. PAAW remains a DPF normative candidate, and GPP remains a working draft; this proposal implies no external adoption or certification.

| Candidate | Application to this work | Evidence needed before claiming it works |
| --- | --- | --- |
| [PAAW](../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md) | Trace company purpose to a BusinessProduct, operating flow, work allocation and supporting DigitalProduct capability | One accepted business outcome linked to its accountable organization, performer, work occurrence and supporting capability |
| [Profile catalog](../architecture/four-portfolio-archetype-standard-profile-catalog.md) | Compose core + facets + category + genuine leaf delta + organization/jurisdiction/contract/deployment context | Resolved applicability and version references; conflicts stay explicit. No duplicated archetype registry or implied new table |
| [GPP](../architecture/gated-permissions-process.md) | Bound investigation and implementation tools to the correct stage, subject, scope and validity | Actual allowed and refused calls through the execution boundary; off-binding reach, revocation and expiry tested |
| [TAK](../architecture/trusted-ai-kernel.md) | Intersect authority, grants, work context, data restrictions and qualification/autonomy ceilings at execution | Denial, tenant separation, data egress and destructive-action controls demonstrated on the served target |
| [GAID](../architecture/GAID.md) | Link performer and operating composition to observations, decisions and action receipts | Actor/profile references and a traceable receipt chain; ordinary execution logs are not automatically externally verifiable signed receipts |
| [TAK-JSI](../architecture/job-specific-intelligence.md) | Qualify the actual job/tool/model/data composition; revalidate material changes | Defined job acceptance, eligible assessor, representative fixtures and business outcome evidence. Inference speed does not prove competence |

First use these existing requirements as the acceptance crosswalk. Propose a standard amendment only when the pilot exposes a missing normative requirement, with the amendment routed to its owning steward. Avoid publishing another universal “absorption standard” or silently promoting an informative implementation proposal into doctrine.

## Proposed business journey within existing Workroom contracts

This is a logical journey, not a new persisted shape. Inspect existing definitions and live demand before deciding whether it needs a versioned shape extension or composition of existing shapes.

| Stage | Input and result | Owning decision and exit evidence |
| --- | --- | --- |
| Establish direction | Minimum company purpose, customers, offerings, constraints and accountable ownership; archetype starter material | WWWD context is identified as default, candidate or accepted. Missing information is visible without blocking unrelated useful work |
| Incorporate knowledge | Documents, existing systems and contextual answers become retained sources and proposed refinements | Evidence provenance, tenant scope, durable completion and conflict handling; consequential guidance follows its owning-scope acceptance path |
| Define the job gap | A business outcome cannot be achieved acceptably using current capabilities | Job, incumbent, observed limitation, required outcome and success criterion recorded on existing work/coverage records |
| Investigate | Bounded inspection of an authorized artifact or system using selected REA capability | GPP/TAK limits, license/source identity, artifact hash, environment and observation evidence; inability to inspect yields inconclusive, never invented coverage |
| Choose convergence | Compare Integrate, Native absorb, Coexist and Defer against the job and platform contracts | WWWD owns business tradeoffs; WWMD owns platform fit; WSID supplies craft constraints. Preserve outcome, rationale, exit conditions and retained evidence |
| Deliver and qualify | Refactor native seams or retain a bounded bridge, then exercise the job | Proportional delivery gates, independent review where required, correct business outcome and regression evidence; REA export success alone is insufficient |
| Learn | Review completed occurrences and material failures | Existing improvement signal/proposal chain; accepted doctrine goes to WWWD, WWMD or WSID in its owning scope, not indiscriminately into all three |

Bind exact definition versions and accepted context/evidence references at an occurrence or cycle boundary. Changes in tools, models, provider terms, source artifacts or applicable constraints trigger impact analysis and necessary revalidation. Never silently widen active rooms or reinterpret their historical receipts.

## Delivery sequence and acceptance evidence

Each row is a proposed independently reviewable slice. Live backlog reuse, delivery shape, dependency receipts and change-impact obligations are pending verification; these row labels are not backlog identifiers.

| Slice | Existing surface to consolidate | Acceptance experiment | Depends on |
| --- | --- | --- | --- |
| A. Baseline and trace | Existing setup, canonical work sources, Workroom view and standards crosswalk | Trace one current business job from company direction to outcome; record competing records, repeated questions and missing evidence. Select an archetype/job from actual demand | Live coordination recovery for current inventory |
| B. Reliable incorporation | Setup completion, enrichment facade, existing async-work/queue patterns, organization overlay | Interrupt and restart document incorporation; it resumes without duplicate source/page effects. Candidate changes cannot overwrite accepted owner material or enter authoritative guidance prematurely | A |
| C. Correct context at decisions | Existing organization alignment and profession/jurisdiction resolvers; actual coworker context call paths | Two organizations with different purposes and jurisdictions receive correctly scoped guidance; missing/conflicting context is visible; changing accepted context invalidates relevant cached decisions | A; B for document-derived context |
| D. Evidence-based gap assessment | Existing incumbent coverage proposal and canonical gap/work intake | The same observation does not create competing jobs; proposals cite job-specific evidence; confirmed assessments survive reruns; uncertainty is preserved instead of replaced with arbitrary confidence | A, C |
| E. Bounded absorption pilot | Existing integration, discovery, execution and evidence paths plus the chosen native job seam | Begin with an authorized static fixture. Prove observation custody, denied off-scope calls, retained exports, convergence choice, native job outcome and rollback. No arbitrary binary execution in the first pilot | D; applicable authority and data controls |
| F. Owner experience and learning | Existing Workroom disclosures, profile composition, flow telemetry and improvement loop | Complete the journey in both themes with keyboard access and truthful states; apply a second archetype using the same contracts; compare accepted outcomes and rework by versioned cohort | B–E for full journey; early UI review alongside B |

Allocate the initial implementation envelope approximately 20% to B, 20% to C, 15% to D, 15% to F and 10% to A/contract consolidation. Reserve approximately 20% for E and other proven missing behavior. Re-estimate after A: a new table, policy engine, context store, findings queue or parallel runtime requires explicit evidence that existing substrate is unfit. Track effort by changed responsibility, not merely files edited.

For each slice, the implementation plan must name the current Workroom `changeImpactContract`, actual `testImpact` and `guardObligation`, independently shippable live BI, and exact acceptance evidence. Unresolved impact requires resolution or exhaustive coverage, not an exemption. High-sensitivity authority/data changes may raise proportional gates even when the code diff is small.

## UI refinement

Reuse the four disclosures in the flow-map design: workspace glance, area/portfolio summary, shape map and room evidence. Keep job, purpose, accountable person, current stage, blocker and next action visible in the existing room; show provider/artifact/tool detail when it helps explain a decision.

For onboarding and incorporation, expose plain states such as “received,” “being incorporated,” “needs your decision,” and “usable for this work.” Do not collapse setup completion, asynchronous invocation, accepted guidance and qualified execution into one green “ready” badge. Map display states to canonical records and durable completion evidence; do not create a UI-owned readiness database.

Review one compact owner journey against the [complexity-shield acceptance standard](../architecture/complexity-shield-acceptance-standard.md). Use its existing operator-step bound, progressive disclosure, shared read model and authority expectations. Correctable conflicts identify the missing fact or competing assertion and preserve both sources. The owner makes a business decision without being asked to select GPP modes, manage REA sessions or approve routine technical phases.

The visible journey should be understandable before adding a flow map. Maps must render only constructs supported by the actual runtime and flag partial data. Working, awaiting-person, blocked, awaiting-trigger and done remain distinct; a blocked investigation cannot animate as productive execution merely because a lease exists.

## Measurement, sovereignty and rollback

Use existing queue/Workroom measures to separate processing, waiting, blockage and time between demand. Add business acceptance evidence to these measures rather than interpreting every terminal state as success. Record:

- Time from a stated need to an accepted, correct business outcome, including correction and rework.
- Repeated context questions, duplicate data entry and competing records encountered on the journey.
- Human decisions genuinely needed, failed authority/context checks, recovery after interruption, and exit/export success.
- Inference, tool, data and review time separately, with costs and quality for the actual operating composition.

Compare like jobs, risk contexts and profile versions; show counts and denominators for small samples. A faster model can reduce inference time while increasing correction or qualification cost. Local/hybrid routing is eligible only after job, data, jurisdiction, tool support and deployment constraints are satisfied; provider loss never permits a silent cloud fallback that violates those constraints.

Treat CADA and other jurisdiction developments through the existing legal-compliance requirement lifecycle, with dated primary evidence and applicable geographic scope. Do not hard-code a proposal, jurisdiction slogan or hardware forecast into global enforcement. The strategy companion owns the external REA/Taalas/CADA research and caveats.

Roll back a refactor or capability through its reviewed release path; retain original sources, canonical IDs, accepted organization material and historical Workroom evidence. Pin observation-tool/artifact versions, support source/evidence export, and leave an organization productive with an explicit reduced capability when a provider or adapter is unavailable.

## Promotion to governed implementation after recovery

Query current backlog, epics, Workrooms, decisions and applicable standards/profile versions. Reuse valid records and distinguish unfinished implementation from unfinished acceptance. Reconcile this source handoff with the merged strategy and historical design references; no historical identifier is presumed current.

Then bind the initiative to its actual scope and independent design review, decompose independently shippable work into live BIs, write the immutable implementation plan, and obtain server-selected plan coverage through `record_plan_backlog_coverage`. Claim implementation only after readiness admits it. The [planning skill](../../packages/dpf-skill-pack/skills/dpf-writing-plans/SKILL.md) explicitly says unavailable MCP stops coverage and that Markdown checkboxes are not a fallback. This handoff records the offline design boundary rather than substituting for that receipt.

Current unrun work: live epic/backlog overlap, kernel decision lookup/scoring, scope claim, independent design approval, plan coverage, served UI verification, runtime qualification and deployment. Source documentation verification is separate. The first implementation target is reliable company-context incorporation and propagation; the bounded REA pilot follows that foundation.
