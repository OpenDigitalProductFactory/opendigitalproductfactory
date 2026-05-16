# Coworker Execution Adapter Substrate — Spec Reconciliation Against main (2026-05-16)

| Field | Value |
| --- | --- |
| **Status** | Reconciliation pass — does the 2026-04-29 design still hold after 16 days and 267 commits on `origin/main`? |
| **Created** | 2026-05-16 |
| **Author** | Claude Opus 4.7 (1M ctx) for Mark Bodman, resuming `feat/coworker-c-status-and-a2a-sequencing` |
| **Scope** | Spec: `2026-04-29-cli-execution-adapter-routing-design.md` (branch copy). Plan: `2026-04-29-cli-execution-adapter-routing-plan.md` (branch copy). Branch HEAD: `a1decd3f` (267 commits behind `origin/main` @ `95daabea`). |
| **Branch commits in scope** | `01221806` (spec+audit+evidence), `657b560c` (plan), `a076e887` (A1 — AdapterCapabilityProfile), `35f3162e` (A2 — AdapterRunTelemetry), `6ed3cf91` (A3 — AgentThread.cliSession\*), `6814ecdc` (A4 — ExecutionAdapterSelector types), `a1decd3f` (A5 — capability probes + DB cache) |

---

## Headline

**The branch's design is still viable.** No newer spec proposes its own adapter taxonomy, capability profile table, or shadow/race mechanism. The 5 shipped commits (A1–A5) sit on schema and routing surface that no other PR has touched. Two real frictions exist (A6 vs PR #520; Phase C vs PR #602) and both are rescope, not abandon. The branch's spec at `docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md` **collides on filename with a different-content spec on main** (PR #350, in-process orchestration primitives). That must be resolved before PR.

## 1. Filename collision — must fix before PR

The branch's spec and a completely different spec on main (the Codex-authored Sequential/Parallel/Loop/Branch in-process orchestration primitives, landed via [PR #350](https://github.com/anthropics/apps/pull/350) commit `6cb090b1`) share the exact path `docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md`. They are about different problems (routing-layer adapters vs. in-process control flow). Main also carries a partial-duplicate primitives spec by Claude at `2026-04-29-orchestration-primitives-design.md` and a supersession-decision audit (`2026-04-29-orchestration-supersession-decision.md`) noting the merge is unfinished.

**Action:** rename the branch's three artifacts before opening PR. Suggested names that signal the routing-layer concern explicitly:

- `docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md`
- `docs/superpowers/plans/2026-04-29-cli-execution-adapter-routing-plan.md`
- `docs/superpowers/audits/2026-04-29-cli-substrate-status-review.md`

Audit's `evidence/2026-04-29-codex-jsonl-probe.md` can stay (no collision).

## 2. Spec section reconciliation

| Spec § | Status | Note |
| --- | --- | --- |
| §1 Problem statement | ⚠️ **shifted but compatible** | The "→ adapter-registry → chat-adapter" path is partially wrong on main. Actual chain: `routed-inference.ts → pipeline-v2 → fallback.callWithFallbackChain → ai-inference.callProvider → execution-adapter-registry.getExecutionAdapter`. `adapter-registry.ts` is now ModelCard metadata only (174 lines); `execution-adapter-registry.ts` (28 lines, populated at import by chat/cli/codex-cli/responses/embedding/image-gen/async/transcription adapters) is the canonical execution dispatcher. Update §1 wording. |
| §2 Non-goals | ✅ accurate | No change. |
| §3 Architectural model (six components) | ✅ accurate | ExecutionAdapter interface and component split still match repo shape. |
| §4.1 `AdapterCapabilityProfile` | ✅ accurate | **Already shipped on branch (A1).** Not on main; no parallel PR introduced an equivalent. |
| §4.2 `AgentThread.cliSession*` | ✅ accurate | **Already shipped on branch (A3).** Main's `AgentThread` (schema.prisma:2869) has no equivalent columns. |
| §4.3 `AdapterRunTelemetry` | ✅ accurate | **Already shipped on branch (A2).** Disjoint from `SkillUsageEvent` (PR #623 — per-skill, not per-adapter-run). Disjoint from `RouteDecisionLog` / `RouteOutcome` attribution columns (PR #607 — per-decision, not per-adapter-run). A7 should follow #607's `agentId` and #623's `skillId` columns for cross-table joinability. |
| §4.4 Hard-coded CLI check at `ai-inference.ts:353` | ⚠️ **needs rescope** | Line 353 still has `const isCliAdapter = ...`. But [PR #520](https://github.com/anthropics/apps/pull/520) (`d5ae950d`, merged 2026-05-13) added `createMcpSessionToken` plumbing through `callProvider` → `cli-adapter.ts` and refactored the cli-adapter to mount platform tools via `--mcp-config <path> --strict-mcp-config` when an mcp session token is present. **This is partial structured adapter resolution already.** Phase A6 now means "extend the existing token-gated selector into a full registry resolution," not "introduce one from zero." |
| §5 Route plan extension | ✅ accurate | `executionAdapter` is already a string field on `RoutedExecutionPlan` (`execution-plan.ts:70-83`). A4 shipped the `ExecutionAdapterSelector` types on branch. |
| §6 Execution modes (single/shadow/race) | ✅ greenfield | No shadow/race on main. F and G are unopposed. |
| §7 CLI ToolExecution custody | ⚠️ **citation stale, concept partially obsolete for Claude CLI** | The `agentic-loop.ts:1027` citation is wrong on main — line 1027 is nudge logic; ToolExecution minting lives at `apps/web/lib/mcp-governed-execute.ts:206`. More important: PR #520 already routes `mcp__dpf__*` tool_use blocks emitted by Claude CLI through the MCP server back into `governedExecuteTool`, which mints `ToolExecution` rows tagged `source: "internal-mcp-session"`. So for **Claude CLI + MCP-mounted tools, custody is already closed.** The remaining custody gap is: (a) Claude CLI's *native* tools (Bash, Read, Write, etc.) inside the harness, and (b) all Codex CLI tool calls. Phase B6 (mint from Codex events) still applies. |
| §8 Event normalization | ✅ accurate | No competing normalizer on main. Visual Control Surface spec (2026-05-10) explicitly consumes `NormalizedEvent` from this spec. |
| §9 CLI session lifecycle | ⚠️ **needs rescope vs WorkCapsule** | [PR #602](https://github.com/anthropics/apps/pull/602) added `WorkCapsule` + `WorkCapsuleActivity` tables with `executorKind`, `executorRef`, `sandboxProviderId`, `sandboxId`, `worktreePath`, `leaseExpiresAt`, `leaseHolderPrincipalId`. That's the same problem space (sandbox lease lifecycle + sweeper). Phase C's `CliSessionService` should **attach to WorkCapsule** (FK or shared identifier) at the panel-thread grain, not parallel the work-unit grain. Boundary statement needed in §9. |
| §10 Panel cockpit UX | ⚠️ **needs composition with shipped surfaces** | Phase E is **not redundant** — `2026-05-10-ai-coworker-visual-control-surface-design.md` is a many-coworker Operations Map, not a per-thread cockpit, and explicitly consumes this spec's events. But two shipped surfaces must compose with the cockpit: `AgentSkillAttributionChip` and the `/platform/ai/skills` Telemetry tab from [PR #629](https://github.com/anthropics/apps/pull/629). Cockpit should layer adapter-health LED + skill-attribution chip into one header, not three competing chips. |
| §11 MCP boundary | ✅ accurate, partially shipped | PR #520 implemented the per-call JWT scoping piece for Claude CLI. §11.3 Codex static-attach rule still applies and is greenfield. |
| §12 Phase A acceptance | ⚠️ **partially shipped** | "every existing coworker run works identically, but the route plan carries structured executionAdapter and writes a telemetry row" — A1–A5 land schema and probes; A6+A7 are still required to satisfy the acceptance gate. |
| §13 Open risks | ✅ accurate | PR #608 (provider overload classification) ratifies risk #1 mitigation pattern; Phase B should mirror its error taxonomy. |
| §14 Telemetry/observability | ✅ accurate | Should layer on top of PR #607 attribution columns. |
| §15 Migration/BC | ✅ accurate | No change. |

## 3. Plan task reconciliation

| Task | Reconciled status |
| --- | --- |
| A1 — `AdapterCapabilityProfile` model | **shipped on branch**; still applies (no main collision) |
| A2 — `AdapterRunTelemetry` model | **shipped on branch**; still applies; A7 should add `agentId` (#607 convention) and `skillId` (#623 precedent) |
| A3 — `AgentThread.cliSession*` columns | **shipped on branch**; still applies; consider FK to `WorkCapsule` per #602 (rescope question for C) |
| A4 — `ExecutionAdapterSelector` types | **shipped on branch**; still applies |
| A5 — capability probes + DB cache | **shipped on branch**; still applies |
| **A6 — replace hard-coded `isCliAdapter` check** | **needs-rescope** (partially-superseded-by #520). New task: extend the existing `mcpSession`-gated selector in `cli-adapter.ts` + `ai-inference.ts` into a full `ExecutionAdapterSelector` registry resolution that subsumes both the `isCliAdapter` short-circuit and the MCP-mode toggle. Tests must hold #520's tool-mounting behavior. |
| A7 — wire telemetry write | **still-applies**; add `agentId` + `skillId` columns to follow shipped conventions |
| A8 — Phase A integration verification | **still-applies** |
| B1 — `NormalizedEvent` taxonomy | still-applies |
| B2 — Codex JSONL replay fixtures | still-applies |
| B3 — Codex event normalizer | still-applies |
| B4 — Schema-drift detector | still-applies |
| B5 — MCP-active + `--json` refusal guard | still-applies |
| B6 — ToolExecution minting from Codex events | still-applies (closes the Codex half of the custody gap; #520 closed Claude+MCP half) |
| B7 — Codex `--json` mode behind feature flag | still-applies |
| B8 — Phase B PR | still-applies |
| C0 — locate cron substrate (pre-work) | still-applies |
| **C1–C5 — `CliSessionService`** | **needs-rescope** vs WorkCapsule (#602). Probably reshapes as: `CliSessionService` becomes the panel-thread mapper that consumes a `WorkCapsule` lease instead of allocating its own sandbox slot. |
| D1–D4 — Claude CLI normalizer parity | still-applies |
| E1–E9 — Panel cockpit UI | **still-applies but rescope E4/E7/E8** to compose with `AgentSkillAttributionChip` and Telemetry tab from #629; verify Operations Map (2026-05-10) co-existence |
| F1–F5 — Shadow mode | still-applies (greenfield) |
| G1–G4 — Race mode | still-applies (greenfield) |
| H1–H5 — Refactor allocation | still-applies; H4 (unify CLI session ID generation) gets harder if WorkCapsule owns the lease |

## 4. Things in your prompt that don't exist on main

The pause-resume prompt listed three documents that **do not exist** in `origin/main`:

- `specs/2026-05-14-coworker-memory-shape-contracts-design.md` — not found
- `audits/2026-05-12-build-coworker-tool-rejection-observations.md` — not found
- `plans/2026-05-13-ai-routing-topology-map.md` — not found

The closest extant artifact is `plans/2026-05-11-ai-routing-ux-verification-test-architecture.md` (an approved+partially-executed test plan). If those three docs lived in a different worktree that didn't merge, they may still be load-bearing context you have but the branch doesn't see. Worth confirming before relying on them.

## 5. Resume options (with trade-offs)

### Option α — open PR for Phase A as-is (5 shipped commits, no A6/A7/A8)

- **Pros:** smallest action; lands schema + types + probes so any follow-on work has a substrate; preserves the original commits intact.
- **Cons:** Phase A acceptance criteria explicitly require A6 (structured resolution) and A7 (telemetry write site). Without them, the schema is dead weight on main. Risk: orphaned tables.
- **Verdict:** rejected. Schema-without-writer is worse than nothing.

### Option β — rebase onto main, complete A6/A7/A8 with current-state awareness, then PR Phase A

- **Pros:** Phase A acceptance criteria met. The rebase blast radius is small in practice because A1/A2/A4/A5 add *new files* and only A3 touches `schema.prisma` (the `AgentThread` model, which has not had `cliSession*` columns added by any parallel PR). The two real rescopes (A6 vs #520; Phase C vs #602 — but C is later) can be absorbed into the same Phase A PR for A6. Net design held; integration risk known and bounded.
- **Cons:** 267-commit rebase cognitively expensive; cli-adapter.ts and ai-inference.ts have moved meaningfully (#520, #608, #520-adjacent). A6 work is real (not a one-line edit) because it must subsume both the `isCliAdapter` short-circuit and the `createMcpSessionToken` mounting toggle.
- **Verdict:** **recommended.**

### Option γ — abandon branch, rewrite Phase A from scratch against main

- **Pros:** clean slate.
- **Cons:** throws away 5 working commits whose content is still correct as-of main. The schema models are good; the types are good; the probes are good. Rewriting just to re-author them is waste.
- **Verdict:** rejected. No design has shifted enough to warrant a rewrite.

## Recommendation

**Option β with two scope additions before pushing:**

1. **Rename the spec, plan, and audit** to disambiguate from main's same-named orchestration primitives spec (see §1 above).
2. **Update §1 / §4.4 / §7 / §9 / §10 of the spec** with the four reconciliation notes from §2 of this audit — corrected file paths and the explicit boundary statements vs. #520, #602, #607, #623/#629, the Visual Control Surface spec, and the Operations Map spec. Update the plan's A6 task body to reflect the rescope.

Then rebase onto `origin/main`, finish A6/A7/A8 against the rebased tree, and open the Phase A PR. Phase C's WorkCapsule rescope is a known future cost and does not block Phase A.

## Reflog for the 7 branch commits (for `git show` later)

```
01221806 spec(coworker): execution adapter substrate — audit + design + Codex evidence
657b560c plan(coworker): execution adapter substrate — 8 phases, TDD task decomposition
a076e887 feat(routing): add AdapterCapabilityProfile prisma model (Phase A1)
35f3162e feat(routing): add AdapterRunTelemetry prisma model (Phase A2)
6ed3cf91 feat(coworker): add AgentThread.cliSession* columns (Phase A3)
6814ecdc feat(routing): add ExecutionAdapterSelector + capability requirement types (Phase A4)
a1decd3f feat(routing): adapter capability probes + DB-backed cache (Phase A5)
```
