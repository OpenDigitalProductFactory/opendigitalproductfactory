# A1 — Converge the legacy build-specialist prompt plane onto A2A

**BI:** BI-C654F960 (Track A keystone; unblocks A2/BI-B31072B8, A3/BI-D506598C; subsumes BI-D6CFE63A)
**Status:** substrate-verified 2026-08-01, NOT yet implemented. High blast radius (build-execution path). Carries unresolved design decisions that MUST be kernel-routed before code.

## Why this is a plan, not a same-session patch

This converges the platform's most critical path (build execution). The BI itself lists three unresolved design questions (threadId, delegatesTo authority, cost/latency). A rushed pass risks regressing builds. This plan de-risks execution for a focused session.

## Substrate verification (origin/main @ 2026-08-01, re-confirmed)

- Legacy plane INTACT: `apps/web/lib/integrate/specialist-prompts.ts` still exports `SPECIALIST_PROMPTS` (:222), `DATA_ARCHITECT_PROMPT` (:30), `SPECIALIST_TOOLS` (:249), `buildSpecialistPrompt` (:283). No convergence has landed since the BI was filed.
- A2A plane INTACT: `requestCoworker` (`apps/web/lib/tak/coworker-collaboration.ts`) resolves a real Agent, enforces authority, writes a DelegationChain hop, creates a child AgentThread + TaskRun, injects corpus.
- **Blocker confirmed:** `requestCoworkerHandler` (`apps/web/lib/mcp/packs/coworker-pack.ts:69`) returns `missing_threadId` unless `context.threadId` is set; it is used as `parentThreadId` for the child thread it creates (`:83`). `reviewDesignDoc`/`reviewBuildPlan` treat `threadId` as optional — a build with no thread cannot raise a governed consultation.
- **Agent rows READY:** `data-architect`, `data-steward`, `AGT-BUILD-DA` (Build Data Architect) all exist in `Agent`. The Agent side of the convergence is present.
- **Binding defect still true:** `AgentSkillAssignment` has **0 rows** for the DA-family agents, though `dpf-data-architecture-steward` SKILL.md declares `assignTo: ["data-architect"]`. The declared binding is never materialised. (Note: `AgentSkillAssignment.agentId` FKs `Agent.id`, keyed unique on `(agentId, label)`.)

## Design decisions to route through the kernel FIRST (dpf-decision-via-kernel)

1. **How a threadless build phase obtains a parent thread.** Options: (a) give each `FeatureBuild` a root `AgentThread` at build start and thread it through the review/specialist context; (b) let `requestCoworker` accept a build-scoped context that lazily creates a root thread; (c) a synthetic system thread per build phase. Cost axis: schema/thread proliferation vs. provenance completeness. This gates BOTH A1 and A3.
2. **delegatesTo/escalatesTo authority values.** Verify (do NOT assume) that whichever Agent a build phase acts as is permitted to reach each specialist (`data-architect`, etc.). Enumerate current `delegatesTo` on the build-phase actor and each specialist; fill gaps via the governed grant path.
3. **Cost/latency:** a governed agentic loop per specialist step vs. one `minimize_cost` completion. Decide the acceptable envelope; consider tiering (cheap default, escalate on signal).

## Phased execution (each phase independently shippable + verifiable)

- **Phase 0 — materialise the declared binding (safe, bounded, no build-path risk).** Seed `AgentSkillAssignment` for the DA family so `dpf-data-architecture-steward`'s `assignTo` is real. Ship with a golden-fit test asserting the declared skill assignments materialise. This is the one piece extractable NOW without touching build execution.
- **Phase 1 — resolve decision (1) and give builds a thread.** Implement the chosen thread-provisioning mechanism behind a flag; prove a build phase can call `requestCoworker` with a real parent thread. Verify with a build that raises a governed consultation end-to-end (DelegationChain hop written, child thread + TaskRun created).
- **Phase 2 — route ONE specialist (data-architect) through requestCoworker.** Convert the data-architect build-specialist step from `buildSpecialistPrompt` to `requestCoworker`, keeping the legacy path behind a fallback flag. Verify: corpus injected by construction (closes the `resolveProfessionCorpusContext` single-caller symptom), provenance recorded, output parity on a real build.
- **Phase 3 — convert remaining specialist roles, then retire.** One role at a time; delete `SPECIALIST_PROMPTS`/`SPECIALIST_TOOLS`/`buildSpecialistPrompt` entries as each converts. Subsume the EA advisory review (BI-D6CFE63A): route it through the `ea-architect` Agent, not an anonymous `routeAndCall`.
- **Phase 4 — A2/A3 land ON this.** A2 (data-architecture corpus) becomes visible to builds for free once a real Agent invocation injects corpus. A3 (governed DA consultation at build gates) uses the thread-provisioning from Phase 1.

## Verification bar (per phase)

Functional, not structural: a real build exercising the converted path; DelegationChain/thread/TaskRun rows asserted; corpus-injection proven; the four gates green; data-impact manifest if any schema (thread-provisioning) changes. A structural pass is not verification.

## Do-not-do

- Do not inject corpus into `buildSpecialistPrompt` (the retired original framing — entrenches the legacy plane).
- Do not convert all roles in one PR (build-path blast radius). One role per PR behind a fallback.
- Do not assume `delegatesTo` values; verify them.
