# Agent-Architecture Review → Hardening Program

**Status:** in progress (first slices shipped)
**Date:** 2026-06-19
**Author:** Mark Bodman (via Claude Code, operator-directed)
**Surfaces:** Claude Code / Codex / Build Studio (all caught by the same gates)
**Shipped slices:** [#2103](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2103) (outbound veto), [#2107](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2107) (handoff evidence), [#2112](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2112) (context-pressure gauge)

---

## 1. Context

This spec captures a structured review of DPF's agent architecture against the lessons in an external practitioner talk on "directing coding agents" (context-window management, planning discipline, verification harnesses, harness/Ralph-loop orchestration, least-privilege security, and "every bug is a permanent upgrade"), and the hardening program that followed.

The review method was six parallel read-only investigations, each mapping one lesson to DPF's **current** implementation with `file:line` citations, distinguishing IMPLEMENTED / PARTIAL / ABSENT. The headline finding: **DPF already implements most of the talk's lessons — often as enforced CI gates the talk never mentions — and the genuine gaps are predominantly *built-but-unwired* substrate rather than missing systems.** That reframes "apply what we need" from "build new machinery" to "connect machinery that already exists," which is why the first slices are small and low-risk.

### What DPF already does well (do not rebuild)

- **Verification harness** — real per-task `tsc`/`vitest`/production-build in a sandbox container (`apps/web/lib/integrate/coding-agent.ts`), plus a genuine browser-use agent that drives the live UI and screenshots it (`apps/web/lib/queue/functions/build-review-verification.ts`). This is "verify as a user would," already shipped.
- **Anti-sycophancy in planning** — plan/design reviews run two independent reviewer models plus an adversarial architect lens, merged conservatively (fail if *either* fails) — `apps/web/lib/integrate/build-reviewers.ts`. Not "looks good? → yeah."
- **Incident → enforced guard** — a catalogue of CI guards each born from a named incident (Native Dialog Guard, UX-Fit Gate, lease-guard hook, spec/plan/doc gate). This *is* "every bug is a permanent upgrade," already systematized.
- **Least-privilege tokens** — MCP tokens are read-by-default, write/admin opt-in, runtime-enforced and audited (AGENTS.md §8). The "scoped keys" defense, done right.
- **Runtime kernel gate** — a fail-closed shell guard + in-portal MCP-dispatch gate already exist (`apps/web/lib/kernel/runtime-gate.ts`); they just lacked patterns for one risk class (see §3 gap 1).

## 2. Lesson → DPF-state scorecard

| Talk lesson | DPF today | Verdict |
|---|---|---|
| Dumb zone / context mgmt | Token-budget arbitrator + durable ExecutionPlan exist — but guard the **chat** path, not the autonomous build loop | Built, unwired on the flagship loop |
| Plan > build | Spec/Plan/Doc CI gate, mandatory research section, gated Ideate→Plan | Ahead of the talk |
| Force clarifying questions | Deliberately suppressed — ideate caps at ≤1 question, "assume and proceed" | The talk's exact failure mode |
| Verification harness | Real sandbox build/test + live browser verification | Strong |
| Self-iterate til it passes | Auto-fix is opt-in + unit-tests only; a failed gate/UX run stops and waits for a human | No loop at the gate |
| Adversarial / "how could this break" | Reviewer roster is closed; security = one static checklist line | Absent (the 65→92% pillar) |
| Security: "assume it will touch it" | Strong tokens + fail-closed shell guard — but the runtime gate had no teeth for dangerous **outbound** MCP tools | Marquee gap (now closed) |
| Every bug → permanent upgrade | Incident→guard pattern is excellent; build failures auto-file nothing; learning→commons is voluntary | Capture not automatic |

## 3. The nine genuine gaps (prioritized)

Dimension key: **T** = trust, **P** = performance, **A** = architecture.

| # | Gap | Dim | Disposition |
|---|---|---|---|
| 1 | Autonomous outbound MCP tools (`send_marketing_email`, `publish_to_linkedin`, `place_linkedin_ad`) flowed through the runtime gate **un-vetoed** — the "agent emailed the whole list" incident | T | **Shipped** #2103 |
| 2 | The autonomous build loop runs unprotected against the dumb zone (arbitrator + ExecutionPlan only guard chat); no context-fill measurement | P/A | **Partially shipped** #2112 (gauge); behavior changes deferred (§5) |
| 3 | `save_phase_handoff` wrote the structured evidence half (`evidenceDigest`/`gateResult`) empty; next phase got prose only | T | **Shipped** #2107 |
| 4 | No intent-confirmation before building (ideate suppresses clarifying questions even when `confidence=low`/`riskProfile=high`) | T | **Deferred** → BI (§5) |
| 5 | No build-level self-iteration: a failed phase gate / browser-UX run stops and waits for a human instead of dispatching a bounded fix build | T/P | **Deferred** → BI (§5) |
| 6 | No adversarial / edge-case generation ("how could this break") — the pillar credited for the 65→92% quality jump | T | **Deferred** → BI (§5) |
| 7 | `ExecutionPlan` is in-memory only — durable against compaction, not against a process restart | A | **Deferred** → BI (§5) |
| 8 | Build failures auto-file no corrective BI; the capture primitives exist but require an agent to remember | T | **Deferred** → BI (§5) |
| 9 | Deliberation's adversarial middle is scaffolded but does not yet generate rebuttal content | T/A | **Deferred** → BI (§5) |

## 4. What this program shipped

### 4.1 Outbound-action veto (#2103, gap 1)

A new commandment-tier kernel principle, `outbound-actions-require-explicit-go` (`docs/founder-kernel/wiki/principles/`), adds `mcp_tool` patterns to the **already-wired** runtime gate (consulted on every `executeTool` dispatch). Autonomous sessions are refused; interactive sessions require a typed phrase.

- **Scope:** the three customer/public/money-facing outbound tools (they share one `publishApprovedDraft` handler). Drafting/staging is not gated.
- **Deliberately excluded:** governed infra-deploy tools (`apply_platform_update`, `deploy_feature`, `execute_promotion`). The self-upgrade / promotion pipeline owns its own quiescence + approval and is *intended* to run under autonomous executors; gating it on session class would break legitimate automation. Future outbound tools MUST be added to the pattern list when they ship — an outbound tool with no pattern is the loophole the principle closes.

### 4.2 Phase-handoff evidence manifest (#2107, gap 3)

A pure helper `buildPhaseHandoffEvidence()` (`apps/web/lib/explore/feature-build-types.ts`) derives `evidenceFields` + `evidenceDigest` (one line per populated field) from the build's own evidence columns, so the next phase's "Context from Previous Phase" block renders the structured manifest the schema was designed for instead of a blank Evidence section. The gate outcome is recorded into `gateResult` on auto-advance. No new contract/route/schema.

### 4.3 Context-pressure gauge (#2112, gap 2 — measurement half)

A pure module `apps/web/lib/tak/context-pressure.ts` (`estimateContextTokens` + `classifyContextPressure`) wired into the loop as **observability only**: a `[context-pressure]` log line per dispatch when the zone leaves `sharp`, and `ctxPeakTokens`/`ctxZone` on the existing `[turn]` summary. The assembled context is sent unchanged. Thresholds are heuristic, model-agnostic dumb-zone hints because the loop is model-agnostic at this layer.

## 5. Deferred follow-ups (tracked as backlog items)

These were deferred deliberately. Several change autonomous-loop or Build-Studio behavior and so should be validated by Build Studio while it is being tuned, rather than landed blind; they build on the measurement/wiring this program added. Each is filed as a governed backlog item under its natural existing epic:

| BI | Follow-up | Epic |
|---|---|---|
| `BI-9679EB1A` | Tier-aware compaction + real-window pressure ratio (gap 2) | EP-COST-001 |
| `BI-564D68F7` | Risk-gated intent confirmation (gap 4) | EP-9FC5D2FD |
| `BI-0A67ABEC` | Build-level self-iteration on gate/UX failure (gap 5) | EP-9FC5D2FD |
| `BI-02B98843` | Adversarial / edge-case verification (gap 6) | EP-9FC5D2FD |
| `BI-655507BA` | Crash-durable ExecutionPlan (gap 7) | EP-REDUCTION-GEAR-ARCH |
| `BI-9EA09823` | Automatic failure capture (gap 8) | EP-LEARNING-COMMONS |
| `BI-62ABDD8C` | Deliberation branch content generation (gap 9) | EP-BUILD-65837F |

The detail for each:

1. **Tier-aware compaction + real-window pressure ratio (gap 2 behavior half).** Thread the resolved model's `maxContextTokens` into the loop; size compaction from a fraction of the real window (never below today's floor); turn the gauge's heuristic bands into a precise ratio-of-window signal. Consider enabling `enableExecutionPlan` on the build path.
2. **Risk-gated intent confirmation (gap 4).** In `prompts/build-phase/ideate.prompt.md`, when `riskProfile.level==="high"` OR brief `confidence==="low"`, surface the brief's existing `openQuestions` and require an answer before `start_ideate_research`. Reuses `business-build-brief.ts` substrate; keeps the layman-fast path for low-risk work.
3. **Build-level self-iteration on gate/UX failure (gap 5).** On a failed `checkPhaseGate` or `uxVerificationStatus==="failed"`, auto-dispatch a bounded `kind:"fix"` build (the `FixContext`/`deriveFixUxTestCases` substrate exists) and re-enter review, capped at N attempts.
4. **Adversarial / edge-case verification (gap 6).** A step that generates negative/abuse cases from acceptance criteria and fires them at new routes (`run_endpoint_tests`) + the browser-use path, feeding failures into the fix loop.
5. **Crash-durable ExecutionPlan (gap 7).** Persist the loop's ExecutionPlan the way the Inngest build pipeline journals its steps, so a deploy mid-loop does not lose the plan.
6. **Automatic failure capture (gap 8).** In the build-failure and self-upgrade-failure paths, best-effort call the existing `record_functional_failure_evidence` / `register_tech_debt` primitives so a failure always lands a fingerprinted corrective BI.
7. **Deliberation content generation (gap 9).** Wire each deliberation branch's `routeDecision` to invoke the model and persist `recommendation`/`objections`/`rebuttals`, converting the honest-consensus structure into a real independent-perspectives debate.

## 6. Verification evidence

| Slice | Local evidence |
|---|---|
| #2103 | `wired-commandments.test.ts` + `load-enforceable-principles.test.ts` — 24/24 pass; gate refuses the trio autonomously, confirms interactively, leaves drafting + infra-deploy alone |
| #2107 | `phase-handoff-evidence.test.ts` — 10/10; `feature-build-types.test.ts` — 61/61 (no regression) |
| #2112 | `context-pressure.test.ts` — 10/10; no change to `routeAndCall` arguments |

Runtime-bound and Prisma-client-dependent tests (e.g. the `executeTool` gate integration, full loop suite) run in CI — the worktree has no generated Prisma client, so those are unrun-not-red locally per AGENTS.md §5. All three slices land via PR; CI runs the full suite + typecheck.

## 7. Research & Benchmarking

- **Source talk** (practitioner conversation on directing coding agents): the "dumb zone" (~250K tokens for the largest models), planning-heavy workflows, self-checking verification harnesses, the Ralph-loop / harness-engineering pattern, "anything the agent can touch, assume it will," and "every bug is a permanent upgrade." Patterns **adopted**: the outbound-action least-privilege framing (gap 1) and the dumb-zone-measurement framing (gap 2). Patterns **already exceeded** by DPF: harness orchestration (deterministic gated state machine + Inngest journal beat a hand-rolled Ralph loop), independent-reviewer planning, and the incident→enforced-guard discipline.
- **DPF substrate compared against** (the "do not rebuild" set): `runtime-gate.ts`, `build-reviewers.ts`, `coding-agent.ts`, `build-review-verification.ts`, `context-arbitrator.ts`, `execution-plan.ts`, the founder-kernel principle wiki, and the CI guard catalogue (`scripts/check-*.mjs`). The review's value was confirming these exist and isolating the un-wired seams, not proposing parallel implementations (per `verify-substrate-before-proposing-new`).

## 8. Note: AGENTS.md §5 correction

The review found AGENTS.md §5 still stated the Build Studio per-task typecheck + production-build gate was "not yet landed (audited 2026-04-24)." It **is** landed (`apps/web/lib/integrate/coding-agent.ts` shells `tsc --noEmit` + `vitest`; `build-agent-prompts.ts` requires the production build before ship). This spec's accompanying PR corrects that note so agents do not distrust a shipped safety gate.
