# DPF Conformance Assessment for TAK, GAID, and TAK-JSI

## Purpose

This document assesses the current `DPF` implementation against the `TAK`, `GAID`, and `TAK-JSI`
standards family. The canonical ownership map is
[agent-standards-family.md](agent-standards-family.md).

Status values:

- `Implemented`
- `Partially Implemented`
- `Not Implemented`
- `Not Yet Assessable`

This is a first-pass conformance view. It is intended to show where `DPF` already demonstrates relevant controls and where additional work would be required to claim higher-assurance conformance.

For the purposes of this document, `DPF` is treated as the initial implementation prototype for the standards family, not as a claim of full present-day conformance.

The companion verification rubrics intended to make future conformance claims repeatable are:

- `docs/architecture/tak-conformance-tests.md`
- `docs/architecture/gaid-conformance-tests.md`
- `docs/architecture/jsi-conformance-tests.md`

## TAK Conformance

| Control Area | Status | Evidence Path | Notes | Recommended Next Step |
|--------------|--------|---------------|-------|-----------------------|
| Runtime authority mediation | Implemented | `apps/web/lib/mcp-tools.ts`, `apps/web/lib/tak/agent-grants.ts`, `apps/web/lib/coworker/authorized-surface-runtime.ts` | Tools declare `requiredCapability`; `getAvailableTools()` filters by user authority, mode, and external access posture; agent grant mapping adds a second control layer. Authorized Surface sessions also bind the principal and intersect role, coworker grants, work context, token scope, approval policy, revision, and TTL before projecting state or actions. | Extend the same explicit permission-intersection receipt beyond Authorized Surfaces to every remaining tool exposure decision. |
| Tool execution gating | Implemented | `apps/web/lib/mcp-tools.ts`, `apps/web/lib/tak/agentic-loop.ts` | Tools declare `executionMode`, `sideEffect`, and annotations; proposal-mode tools break the loop and return approval payloads rather than executing immediately. | Expand the execution-mode vocabulary beyond `immediate` and `proposal` to align more closely with the normative `TAK` oversight tiers. |
| HITL enforcement | Partially Implemented | `apps/web/lib/tak/agentic-loop.ts`, `packages/db/data/agent_registry.json` | `proposal` mode is enforced at runtime and the registry carries `hitl_tier_default`, but `HITL` tier does not yet appear to drive a uniform runtime policy engine across all actions. | Bind `hitl_tier_default` and route context into a single runtime policy decision that consistently governs all consequential actions. |
| Immutable directive handling | Partially Implemented | `apps/web/lib/tak/prompt-assembler.ts`, `apps/web/lib/tak/agent-routing.ts` | Prompt assembly separates identity, mode, authority, sensitivity, and route context into structured blocks, which is a strong foundation. However, there is not yet a full directive inventory with versioning, ownership, and audit metadata. | Add directive cataloging, version control, and governance metadata for hidden and immutable instruction classes. |
| Delegation narrowing | Partially Implemented | `apps/web/lib/tak/agent-routing.ts`, `packages/db/data/agent_registry.json` | `DPF` distinguishes route specialists and records supervisor and delegation metadata in the registry, but it does not yet provide a full receipt-backed delegated-authority chain at runtime. | Recompute and record narrowed authority at each delegation boundary, with parent-child evidence links. |
| Audit and evidence logging | Implemented | `apps/web/lib/tak/agentic-loop.ts` | Every tool execution is written to `ToolExecution` with `agentId`, `userId`, `toolName`, parameters, results, success, route context, duration, and audit class. | Add first-class links from tool execution rows to approval decisions and delegated child actions. |
| Memory and context controls | Partially Implemented | `apps/web/lib/tak/agentic-loop.ts`, `packages/db/data/agent_registry.json` | The runtime limits retained history and truncates tool and text context; the registry also carries memory metadata. This is useful but not yet a full governed memory policy model. | Add explicit retention classes, retrieval policy, freshness rules, and revalidation requirements for consequential memory use. |
| Runtime transparency | Partially Implemented | `apps/web/lib/tak/agent-routing.ts`, `apps/web/lib/tak/prompt-assembler.ts`, `apps/web/lib/tak/agentic-loop.ts`, `apps/web/lib/tak/agent-card-service.ts`, `apps/web/components/platform/AgentCardSupervisorPanel.tsx`, `apps/web/app/(shell)/platform/audit/authority/page.tsx` | The platform exposes route-specific agents, skills, sensitivity context, tool execution records, and an internal Agent Card projection with a supervisor-ready authority snapshot in the Authority & Audit workspace. The supervisor card now includes active grant and oversight metadata, pending proposal counts, latest pending proposal state, approval workflow references, recent receipt counts, receipt status, and journal links. That is a meaningful transparency posture, but not yet a complete supervisor-facing control plane for all runtime states. | Add directive versions, normalize the card state into one runtime policy object, and expose parent-child delegation and receipt chains. |
| Injection defenses | Partially Implemented | `apps/web/lib/tak/prompt-assembler.ts`, `apps/web/lib/tak/agentic-loop.ts`, `apps/web/lib/mcp-tools.ts` | The runtime includes fabrication detection, tool-use nudging, parameter sanitization, and sensitivity-aware prompting. These are real controls, but not yet a complete injection-defense architecture across prompts, tools, skills, and connectors. | Add explicit prompt-injection and connector-compromise handling with policy outcomes and test coverage. |
| Evaluation and red teaming | Partially Implemented | `docs/superpowers/specs/2026-03-25-tool-evaluation-pipeline-design.md`, runtime heuristics in `apps/web/lib/tak/agentic-loop.ts` | `DPF` has strong design intent and governance work, but the runtime evidence reviewed here does not yet show a fully integrated `TAK` conformance evaluation suite. | Define a repeatable `TAK` verification harness and red-team pack, then store the resulting evidence as part of conformance claims. |
| Proactivity boundary enforcement | Partially Implemented | `apps/web/lib/proactivity/`, `apps/web/lib/actions/agent-task-scheduler.ts`, `apps/web/lib/performance/business-analysis-watch-run.ts` | DPF resolves scoped proactivity plans and enforces scheduled-task action boundaries, including proposal paths. Watched business analysis additionally binds execution to an explicitly accepted plan fingerprint and emits evidence only for typed material changes. The control is not yet uniformly intersected with a `TAK-JSI` qualification status across every runtime surface. | Add qualification status to the canonical runtime boundary calculation and test that higher proactivity never widens it. |
| Evidence-earned autonomy | Implemented (substrate) | `apps/web/lib/autonomy/trust-graduation.ts`, `apps/web/lib/autonomy/regulatory-ceiling.ts`, `packages/db/prisma/schema.prisma` | DPF has activity/risk-scoped trust graduation, regulatory ceilings, and regression-oriented policy substrate. This is relevant `TAK` machinery, but it is not yet fed by a formal job qualification. | Intersect the existing trust ceiling with an active `TAK-JSI` qualification ceiling. |
| Golden Triangle separation | Partially Implemented | `apps/web/lib/golden-triangle.ts`, `apps/web/lib/actions/golden-triangle.ts` | DPF models cost/quality/time posture independently from agent identity and local autonomy. Formal qualification-aware route eligibility is not yet integrated. | Compile Golden Triangle posture only after hard job, data, provider, and oversight eligibility. |

## GAID Conformance

| Control Area | Status | Evidence Path | Notes | Recommended Next Step |
|--------------|--------|---------------|-------|-----------------------|
| Stable agent identity | Partially Implemented | `packages/db/data/agent_registry.json`, `apps/web/lib/tak/agent-routing.ts` | `DPF` already carries stable agent identifiers, model bindings, supervisors, delegates, tool grants, and memory declarations. However, these identities are still platform-local and are not yet expressed as canonical `GAID` identifiers. | Introduce canonical `GAID` identifiers and bind route-facing identities to them consistently. |

Route-facing agent identity is also presentation-sensitive. Shared substrate names
must remain truthful across archetypes: the `/customer` route uses the neutral
**Relationship Manager** presentation and instructs the agent to follow the
archetype-specific labels and suppressed concepts rendered by the page. Tool and
authority identities remain stable; only owner-facing language is adapted.
| Public/private identity scoping | Not Implemented | Current implementation review | The reviewed implementation does not yet distinguish internal private identifiers from externally accredited public identifiers. | Add explicit `priv` and `pub` identity scopes, plus governed boundary mapping rules. |
| Agent identity document | Partially Implemented | `packages/db/data/agent_registry.json` | The registry approximates an internal `AIDoc` because it already captures model, supervisor, grants, `HITL`, delegation, and memory metadata. It is not yet a signed, resolvable, standardized identity document. | Define and publish a formal `AIDoc` schema, resolution mechanism, and signing model. |
| Badge and assurance declarations | Not Implemented | Current implementation review | `DPF` contains useful metadata, but it does not yet publish structured badges for capability, governance, sensitivity, or fit-for-purpose, nor does it distinguish assurance levels. | Add badge schemas and evidence-backed assurance levels, starting with self-asserted and organization-attested claims. |
| Authorization classes | Partially Implemented | `apps/web/lib/tak/agent-grants.ts`, `apps/web/lib/mcp-tools.ts` | The platform has a strong local authorization model based on capabilities, tool grants, execution mode, and side-effect posture. That is adjacent to `GAID` authorization classes, but not yet portable or standardized. | Add a portable authorization-class vocabulary that maps to the existing local control model. |
| Signed receipt model | Not Implemented | `apps/web/lib/tak/agentic-loop.ts` | `DPF` records tool executions, which is valuable, but the resulting records are not signed receipts with external verification semantics. | Introduce cryptographically verifiable action receipts for consequential actions. |
| Chain-of-custody traceability | Partially Implemented | `apps/web/lib/tak/agentic-loop.ts`, `packages/db/data/agent_registry.json` | The platform records acting agent, user, route, and tool execution details. This gives a useful internal audit trail, but it is not yet a full end-to-end custody chain across delegation and external boundaries. | Add parent-child receipt links, delegation references, and distributed trace identifiers. |
| External validation and certificates | Not Implemented | Current implementation review | The reviewed implementation does not yet bind agent identity to public certificates, external issuer validation, or public status endpoints. | Add certificate-backed external validation for publicly exposed agents and issuer-operated status services. |
| Transparency logging | Partially Implemented | Internal execution logging in `apps/web/lib/tak/agentic-loop.ts` | Internal audit logging exists, but there is no public or federated transparency log for issuance, revocation, or public identity state changes. | Add a transparency log for agent issuance, status, and revocation events. |
| Protocol interoperability profile | Partially Implemented | `apps/web/lib/mcp-tools.ts`, `apps/web/lib/identity/aidoc-resolver.ts`, `apps/web/lib/tak/agent-card-service.ts` | `DPF` models tool metadata and open-world access in a way that can align with `MCP`-style interoperability, and it now has an internal Agent Card projection that carries `TAK` and `GAID` metadata for future A2A/MCP publication. It does not yet publish public A2A Agent Cards, public verifier metadata, or external receipt status endpoints. | Publish identity and receipt metadata through protocol profiles, starting with private A2A-compatible cards and MCP server metadata before public endpoints. |

## TAK-JSI Conformance

This section assesses existing substrate only. It does not claim that DPF currently issues a
`TAK-JSI-Qualified` credential.

| Control Area | Status | Evidence Path | Notes | Recommended Next Step |
|---|---|---|---|---|
| Versioned job profiles | Partially Implemented | `docs/professions/`, `skills/`, `docs/superpowers/specs/2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md` | DPF has profession corpora, skills, and a JSI substrate design, but no single qualification-ready job-profile schema currently composes activities, data, tools, evidence, exclusions, and validity. | Define the first bounded job profile and validate the schema against `JSI-001`. |
| Profession and decision doctrine | Partially Implemented | `docs/professions/`, `apps/web/lib/decision-perspective/`, `packages/db/src/seed-decision-perspective.ts` | WSID-style doctrine and decision-perspective substrate exist. Versioned job-qualification binding and rank/completeness checks are not yet conformance evidence. | Bind stable corpus and decision-axis versions into the first qualification scheme. |
| Operating-profile identity binding | Partially Implemented | `apps/web/lib/identity/aidoc-resolver.ts`, `apps/web/lib/tak/agent-card-service.ts` | DPF projects agent identity and operating metadata but does not yet issue a qualification record bound to a canonical `GAID` and fingerprint. | Add qualification references to the internal `AIDoc` projection before any qualification is advertised. |
| Job-specific evaluation | Not Implemented | `docs/superpowers/specs/2026-03-25-tool-evaluation-pipeline-design.md` | Generic evaluation design exists, but no completed job-profile assessment pack and qualification decision were found. | Implement a representative scenario pack with critical failures and declared thresholds. |
| Model/provider eligibility | Partially Implemented | `apps/web/lib/model-routing/`, `apps/web/lib/golden-triangle.ts` | DPF has routing and resource-posture concepts, but no formal job-profile eligibility contract was found. | Apply hard data, residency, provider, modality, tool, context, and job-fit filters before ranking. |
| Data stewardship | Partially Implemented | `packages/db/prisma/schema.prisma`, platform data-governance surfaces | DPF has sensitivity and governance substrate, but qualification-specific data ownership, quality, purpose, and evidence-minimization fields are not yet composed. | Make a named steward and data-quality contract mandatory in each data-bearing job profile. |
| Qualification lifecycle | Not Implemented | Current implementation review | No qualification-specific issue, expiry, surveillance, revalidation, restriction, suspension, or revocation record was found. | Implement the `TAK-JSI` status model and material-change triggers without duplicating the existing autonomy ledger. |
| Qualification-aware runtime ceiling | Not Implemented | `apps/web/lib/autonomy/`, `apps/web/lib/proactivity/` | DPF can enforce proactivity and regulatory/trust ceilings, but there is no active job-qualification ceiling in the intersection. | Add qualification status and scope as a fail-closed input to runtime action posture. |

## Context Economy Conformance

Assessed against `docs/architecture/context-engineering-standards.md` (P1–P13). This is the local-first token/context discipline; the binding window is the ~24,576-token served local window. Spec and architecture reviews should check changes to model-facing surfaces (tool registry, MCP route, agentic loop, prompt assembler) against these.

| Criterion | Status | Evidence Path | Notes |
|-----------|--------|---------------|-------|
| P2 Smallest high-signal set | Implemented | `apps/web/lib/tak/context-arbitrator.ts` | L0/L1/L2 per-tier budgets (EP-CTX-001); L3/L4 deferred to tools. |
| P5 Few/unambiguous tools; clean descriptions | Implemented (enforced) | `apps/web/lib/tool-description-hygiene.test.ts` | CI fails on `Phase N` / `(BI-…)` / source-path provenance in tool descriptions. The `search_*`/`record_*_evidence` families are prefix-clustered but functionally distinct (verified 2026-06-20) — exposure is scoped via R3/grants/phase; any faceting is R8-eval-gated, not a blind merge (R7 re-scoped). |
| P6 Token-efficient, capped tool results | Implemented (enforced) | `apps/web/lib/tak/tool-result-budget.ts` | Window-proportional cap on the native loop; `MCP_ROUTE_TOOL_RESULT_CHAR_CAP` on `/api/mcp/v1`, no more `data` double-dump; truncation carries a notice. |
| P7 Code execution over round-tripping | Implemented (dark) | `apps/web/lib/tak/tool-script.ts` | `run_tool_script` — governed read-only programmatic tool calling; reentry through `/api/mcp/v1` keeps the kernel gate per inner call. Gated by `tool_script_exec` grant + `programmatic_tool_calling` flag (default inert); live-verification pending. |
| P8 Cache-first prompt | Partially Implemented | `apps/web/lib/tak/prompt-assembler.ts` | `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` split present; local prefix-KV reuse unverified (R6). |
| P10 Deterministic enforcement | Implemented | `apps/web/lib/mcp-tools.ts` (kernel gate), `packages/dpf-skill-pack/hooks/` | Kernel runtime gate + PreToolUse prechecks (incl. `tool-economy-precheck.mjs`). |
| P11 Persist/re-inject across compaction | Partially Implemented | `apps/web/lib/tak/agentic-loop.ts` | `withPlanReminder` keeps the plan out of the compacted window; memory-fact re-injection tracked as R9. |
| P12 Empirical measurement | Partially Implemented (Phase 1) | `apps/web/lib/tak/context-economy-metrics.ts` | Per-turn tool-surface gauge (count + est. definition tokens, banded vs the 15-tool cliff) + tool-selection accuracy, logged in the agentic loop. Cross-task tokens-per-task rollup staged (Phase 2). |
| Deferred tool exposure on external CLI path | Implemented | `apps/web/lib/mcp/tool-tier.ts`, `apps/web/lib/mcp/load-tools.ts`, `apps/web/lib/tak/tool-intent.ts`, `packages/integration-shared/src/mcp-catalog-tier.ts` | Claude Code/Codex bootstrap with explicit `?tier=full` for host-native lazy attachment; generic/Grok/unknown clients default to core and expand by exact name or intent through `load_tools`. Client-host callability is verified separately from protocol conformance. |

Recommended next steps for this area are tracked in `docs/superpowers/specs/2026-06-20-context-engineering-tool-efficiency-design.md` (R3, R4, R6, R7, R8, R9) and kept current by `docs/architecture/agent-client-capability-parity.md`.

## Recommended Roadmap

### Short-Term

- Formalize a canonical internal `AIDoc` representation from the existing agent registry fields.
- Bind `hitl_tier_default`, execution mode, and proposal handling into one explicit runtime policy model.
- Add `TAK` directive governance metadata for prompt blocks and immutable instruction classes.
- Add portable authorization classes that map to current capability and tool-grant logic.

### Medium-Term

- Introduce signed action receipts for consequential tool executions.
- Add parent-child traceability for delegation and multi-agent workflows.
- Publish first-generation badges for capability, governance, data sensitivity, and fit-for-purpose.
- Add `GAID` public/private namespace handling and status management.

### Prototype Outcomes

The most important prototype outcomes implied by the current standards refresh are:

- canonical private `GAID` issuance for every materially distinct agent subject
- an internal `AIDoc` service derived from the current registry and runtime state
- owner, sponsor, responsible-team, directory-binding, entitlement-scope, and blast-radius identity fields
- an internal badge registry with applicability scope, evidence references, and assurance levels
- signed or tamper-evident receipts for consequential actions
- protocol and directory projection profiles for `LDAP`, `SCIM`, `MCP`, and `A2A`
- a phased path from private enterprise `GAID` toward federated and public verification profiles

### Submission-Ready Future Work

- Stand up an accredited-issuer-ready public identity model with revocation and transparency logging.
- Expose `GAID` claims through `MCP`, `A2A`, and HTTP transport profiles.
- Build repeatable `TAK`, `GAID`, and `TAK-JSI` conformance suites and preserve the resulting evidence.
- Extend `DPF` from platform-local identity into a demonstrable cross-boundary trust implementation suitable for standards-body review.
