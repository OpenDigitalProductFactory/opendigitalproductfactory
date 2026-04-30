| Field | Value |
| --- | --- |
| Type | Decision memo / handoff brief |
| Created | 2026-04-29 |
| Author | Claude (Opus 4.7) for Mark Bodman |
| Purpose | Single-file handoff so a future thread can resolve the orchestration spec duplication without re-doing the analysis |

# Orchestration spec duplication — decision and handoff

## Situation in one paragraph

On 2026-04-29 two AI co-authors independently produced near-duplicate specs for DPF's in-process orchestration substrate. Claude's spec landed via PR #349 as commit `2d86d2f1` ("spec(orchestration): four-primitive runtime + unified event envelope"); the matching plan landed as `cef51482`. Codex's spec, plan, and audit (which critiques the committed pair) sit uncommitted on disk in `D:/DPF/docs/superpowers/{specs,plans,audits}/2026-04-29-coworker-execution-adapter-substrate-*.md` plus `audits/evidence/2026-04-29-codex-jsonl-probe.md`. The two designs share architecture (four primitives, typed `Outcome`, governance-derived budgets, Inngest-stays-durable) but diverge on naming, migration order, and first-slice scope. A worktree at `D:/DPF-orch-1a` on `feat/orch-phase-1a-skeleton` is actively executing Phase 1A of the committed plan.

## Decision

**Merge into one repaired spec/plan; supersede both current pairs.** The Codex audit is mostly correct and the substrate plan's migration order (Build Studio as first major proving ground, main coworker loop last) is sounder than the committed plan's Phase 1 (16-file bus refactor as the foundation). But two near-identical specs in the repo is exactly the architectural ambiguity that produced this confusion in the first place.

## What's right in the Codex critique

- **Naming collision is real.** `2026-03-20-execution-adapter-framework-design.md` already claims "execution adapter" for routing/provider plumbing. Renaming the in-process layer to "coworker execution substrate" with code under `apps/web/lib/coworker-substrate/` is the right call.
- **Migration order is better.** Foundation → low-risk loops → Build Studio → fallback → deliberation → main coworker loop last. The committed plan leads with a 16-file/44-site bus refactor, which is the highest-risk slice in the lane and shouldn't be first.
- **20% refactor budget is mandatory, not optional.** Codex spec is more emphatic about this; aligns with the "approach zero technical debt" principle.
- **Build Studio as first major proving ground.** Repo evidence (build-orchestrator's `MAX_SPECIALIST_RETRIES`, sequential phase loop, parallel batch dispatch) makes this the highest-signal first migration.

## What the Codex critique gets wrong (corrected on disk 2026-04-29)

- **Event bus path is inverted.** The Codex spec/audit/evidence claimed `apps/web/lib/agent-event-bus.ts` is canonical and `apps/web/lib/tak/agent-event-bus.ts` is wrong. Reality is the opposite: the top-level path is a 2-line shim (`export * from "./tak/agent-event-bus";`); the canonical 120-line implementation is at `lib/tak/agent-event-bus.ts`. The committed orchestration spec had this right. **Fix already applied to all three Codex documents on disk** (uncommitted) — language now states the `tak/`-scoped file is canonical and the top-level path is an intentional shim.

## What the committed spec/plan have that Codex's drafts dropped

A merged version must preserve these from the committed pair:

1. **Cost monotonicity invariant** — cumulative `cost.tokens` and `cost.ms` non-decreasing across events for the same `runId`. Load-bearing observability rule.
2. **Per-PR test gate checklist** — 9 items including behavior-parity test, terminal-outcome test, event-emission test, heartbeat test, cost monotonicity, typecheck, vitest, build, DCO sign-off.
3. **Concrete migration inventory with line numbers** — 13 in-process retry/iteration surfaces cited with file+line. Codex spec lists ~7 in tables without lines.
4. **Inngest boundary discipline detail** — explicit `step.waitForEvent`, durable retries, `retries: N` at function boundary.
5. **Detailed type contracts with per-primitive worked examples.**

## What the merged plan must add (beyond either current draft)

1. **Heartbeat reset edge-case fix.** Codex spec says "any emitted progress event resets the quiet window" — that's broken for a Loop primitive whose own retries emit progress. The reset must apply only to substrate-emitted progress events, not all bus events the consumer emits inside the primitive.
2. **`RunContext.runId` ↔ `ToolExecution` linkage.** State that orchestration `runId` will be threaded through `ToolExecution.routeContext` (or equivalent) so receipts (separate spec, `2026-04-27-artifact-provenance-receipts-design.md`) and orchestration runs can be joined for forensics.
3. **`SubstrateProfile` vs `GovernanceProfile` type-name reconciliation.** Both drafts define five identically-named profiles (`economy | balanced | high-assurance | document-authority | system`) under different type names. Pick one. `GovernanceProfile` matches the Prisma model `AgentGovernanceProfile`; that's the better choice.
4. **Restore dropped migration targets.** Codex spec drops `build-pipeline.ts:95` (step retry with `MAX_RETRIES`/`RETRY_DELAYS_MS`) and `sandbox-db.ts:50,68` (`while`-loop polling). They're substrate-worthy. Either include them or document why they're excluded.
5. **Plan rigor pass.** Bring the substrate plan's task structure up to the level of the receipts plan (`2026-04-29-artifact-provenance-receipts-slice-1.md` after this thread's edits): red/green test steps, induced-failure smoke checks, explicit failing test examples, fold Codex's Phase 0 (three checklist items) into Phase 1.

## What the merged artifact set should look like

- One revised spec at `docs/superpowers/specs/2026-04-29-orchestration-primitives-design.md` (rewritten in place at the same path so existing references stay valid). Renamed/scoped using "coworker execution substrate" terminology where appropriate, but the canonical file path stays where it is.
- One revised plan at `docs/superpowers/plans/2026-04-29-orchestration-primitives.md` (also rewritten in place).
- Codex's substrate spec, plan, audit, and evidence files: **delete or move to `archive/`** with their content folded into the merged artifacts. The audit's findings are the rationale for the merge; preserving the audit as a historical record is fine, but the substrate spec/plan should not coexist with the merged spec/plan.

## Active executor risk

`D:/DPF-orch-1a` worktree on branch `feat/orch-phase-1a-skeleton` is implementing the committed plan's Phase 1A right now. Phase 1A per the committed plan is the orchestration module skeleton (types, assert-never, governance-profile registry, heartbeat helper) — that work is *consistent* with the merged direction; it's foundational and not specific to the migration order disagreement. **Do not block or whiplash that worktree.** The merge can land while Phase 1A is in flight; the executor's work doesn't depend on which migration target comes second.

## Next-thread brief (copy-paste ready)

> Read these five files in `D:/DPF`:
>
> 1. `docs/superpowers/audits/2026-04-29-orchestration-supersession-decision.md` (this file — read first)
> 2. `docs/superpowers/specs/2026-04-29-orchestration-primitives-design.md` (committed)
> 3. `docs/superpowers/plans/2026-04-29-orchestration-primitives.md` (committed)
> 4. `docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md` (uncommitted; has the bus-path fix already applied)
> 5. `docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md` (uncommitted)
>
> Produce a merged spec and plan that incorporates the Codex repairs (renaming, narrower first slice, Build Studio as proving ground, mandatory refactor budget) into the committed pair, preserves the load-bearing details listed in this memo's "What the committed spec/plan have that Codex's drafts dropped" section, and adds the items in "What the merged plan must add." Rewrite the committed files in place at their existing paths. Move the Codex spec/plan to `docs/superpowers/archive/2026-04-29-coworker-substrate-superseded/` with a brief `README.md` noting they were merged into the canonical files. Keep the audit and evidence as-is — they're the historical record of why the merge happened. Do not start implementation work; this is a docs-only change. Open a single PR titled "spec(orchestration): merge substrate repairs into canonical four-primitive design" with DCO sign-off. Do not block the `D:/DPF-orch-1a` worktree's Phase 1A work — that work is consistent with the merged direction.

## Anti-instructions for any future thread

- Do not commit the Codex substrate spec/plan to the repo as parallel artifacts. The merge is the right path, not coexistence.
- Do not edit the committed orchestration spec to add a "superseded" header *unless the merge has already produced its replacement.* A bare supersession pin without a replacement is worse than the current state.
- Do not whiplash the `D:/DPF-orch-1a` executor. Their Phase 1A work is consistent with the merged direction.
- If you find this memo and the merge has already happened, this file becomes the historical record — do not re-execute it.
