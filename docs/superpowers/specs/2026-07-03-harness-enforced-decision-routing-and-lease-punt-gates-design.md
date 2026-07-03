# Harness-Enforced Decision-Routing & Lease-Punt Gates

**Date:** 2026-07-03
**Status:** Design input (advisory — not yet a plan)
**Author:** Investigation prompted by an operator-observed session anti-pattern (a Claude Code dev thread that asked the human to choose, and separately punted its runtime gates)
**Related:** BI-383668B9 (decision-routing enforcement), BI-2D167283 (lease-punt guard), EP-5560770F (Development Process Spine — distribute & enforce discipline across surfaces), BI-1208AE5D (Spec/Plan/Doc Gate, the precedent), BI-3E71E016 (coworker-prompt decision-routing contract, sibling surface), BI-38578194 (uncommitted-work guard, sibling hook), [consult-scopes-before-asking principle](../../founder-kernel/wiki/principles/consult-scopes-before-asking.md), [worktree-is-source-control-not-runtime principle](../../founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md)

---

## 1. Executive summary

Two commandment-tier disciplines are enforced only in prose and skill guidance, so a working session can silently skip them. Both surfaced in one Claude Code dev thread:

1. **Decision-routing.** The thread presented the operator a numbered menu (spec-only vs spec+implementation, "Option 3 it is") for a platform/build decision **without first consulting the governed scope** (WWMD / `principle_decide`). The `consult-scopes-before-asking` principle is `principleTier: commandment`, but nothing in the Claude Code / external-coding-agent hook plane stops a human-choice prompt that lacks a kernel-consultation ledger.

2. **Lease-punt.** The same thread correctly discovered it had no `DATABASE_URL` in its source-only worktree and correctly hand-authored the migration — then **punted** the runtime-bound gates (migration-apply, `next build`, UX) as "unrun, must run on sandbox/CI" **without claiming `local-integration-ci`** and running them. The lease substrate is fully wired and operational; the workflow that uses it is unenforced.

**The root cause is identical to the one BI-1208AE5D (Spec/Plan/Doc Gate) already fixed for a different discipline: the rule lived at memory/skill altitude, not harness altitude.** This spec proposes two sibling guards on the same hook plane, plus one small rulebook classification edit.

**Finding: no new subsystem is needed.** Both the decision surface (`principle_decide`) and the runtime surface (`claim_nonprod_environment_lease`) exist and work. The gap is a pair of pre-action interceptors that make bypass loud instead of silent — exactly the shape of the existing `lease-guard` / `root-clone-guard` / `compose-guard` hooks in `packages/dpf-skill-pack/hooks/hooks.json`.

---

## 2. Evidence (both substrates are operational, not aspirational)

### 2.1 Decision-routing
| Fact | Source |
|---|---|
| `consult-scopes-before-asking` is commandment-tier: consult all governed scopes before asking a human; act on a high-confidence resolution, "Do not ask." | [docs/founder-kernel/wiki/principles/consult-scopes-before-asking.md](../../founder-kernel/wiki/principles/consult-scopes-before-asking.md) |
| WWMD is the platform-development decision surface; trigger pattern + operator-only carve-out | [packages/dpf-skill-pack/skills/dpf-decision-via-kernel/SKILL.md](../../../packages/dpf-skill-pack/skills/dpf-decision-via-kernel/SKILL.md); AGENTS.md §16 |
| The scorer is live and returns a ledger (this spec's own scoping decision was routed through it: recommended `file_bis_plus_spec`, composite 8.23, margin 0.74, high confidence, no commandment conflict) | `apps/web/lib/wiki/principle-decide.ts`; `mcp__dpf__principle_decide` |
| Hook plane has guards for leases/root-clone/compose but **none** for decision-routing | [packages/dpf-skill-pack/hooks/hooks.json](../../../packages/dpf-skill-pack/hooks/hooks.json) |

### 2.2 Lease-punt
| Fact | Source |
|---|---|
| Worktree = source control, not runtime; runtime-bound gates route through the shared lease | AGENTS.md §4/§5/§7; [worktree-is-source-control-not-runtime](../../founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md) |
| Lease is atomic (`NonProductionEnvironmentLease.activeKey` unique), TTL-bounded, reaped; four MCP tools | `apps/web/lib/nonprod/environment-lease.ts`; `apps/web/lib/mcp-tools.ts` (~902-940) |
| Dev DBs exist behind the `dev` compose profile: `dev-postgres:5433`, `dev-init` runs `prisma migrate deploy` | `docker-compose.yml`; `scripts/local-integration-ci.mjs` |

---

## 3. Design

### 3.1 Gate A — decision-routing (BI-383668B9)

**Trigger.** An agent is about to present the human a choice among 2+ options on a platform/build decision. On the Claude Code surface the clearest chokepoint is an **`AskUserQuestion` / numbered-menu pre-check**; on the coworker surface the sibling is the prompt-path contract (BI-3E71E016).

**Rule.** Block (or warn-and-require-acknowledgement) unless one of:
- a `principle_decide` ledger for this decision exists in the session, and it returned **low confidence** (margin < tieMargin) or a **commandment-conflict** flag → escalation to the human is legitimate; or
- the decision is classified **operator-owned** (see §3.3) **and** a consultation was still run and deferred (consult-then-defer, per the commandment); or
- the human explicitly pre-authorized a direct question for this specific decision.

**Non-goal.** Not every clarifying question is a governed decision. The gate targets *option-selection on platform/build decisions*, not factual lookups ("which file did you mean?") or missing-input prompts.

### 3.2 Gate B — lease-punt (BI-2D167283)

**Trigger.** An agent is about to *report* a runtime-bound gate (migration-apply, `next build`, UX verification) as unrun/blocked from a source-only worktree.

**Rule.** Require one of:
- evidence of a `local-integration-ci` lease claim + gate output (the gate actually ran on the sandbox); or
- an **explicit recorded deferral** — a structured note (in the PR body / capsule) naming the gate, the reason it is deferred, and where it will run — never a silent "unrun."

Detection can key on the same signals the thread emitted ("no DATABASE_URL", "can't run prisma migrate dev", "runtime-bound", "unrun") combined with worktree context.

### 3.3 Rulebook classification edit (secondary, from Finding 1)

Work-scope decisions (spec-only vs spec+implementation, how much to implement in one pass) are currently **unclassified** — neither explicitly WWMD-owned nor operator-owned — which is the wiggle room the thread used. Add an explicit line to AGENTS.md §16 and a kernel principle note: **work-scope/altitude decisions are platform-owned (WWMD) and must be consulted**, and even where the kernel defers the final call to the operator, the consultation is mandatory first (consult-then-defer).

---

## 4. Why harness altitude (kernel-scored)

This scoping decision — how far to take the findings — was itself routed through `principle_decide` rather than handed to the operator (the operator explicitly flagged that asking *was* the anti-pattern). The kernel recommended filing both BIs **and** drafting this spec (composite 8.23 vs 7.49 for file-only, 3.89 rulebook-only, 0.97 understand-only; margin 0.74, high confidence, no commandment conflict). Top positive contributors: *every-defect-needs-reproduction-steps*, *never-fabricate*, *build-gate-mandatory*. The two (tiny) negative contributors were, fittingly, *"do the work; don't task the operator"* and *"consult the governed scopes before asking"* — the very principles this spec exists to enforce.

---

## 5. Open questions (candidates for `principle_decide` at plan time)

1. **Block vs warn** for Gate A — hard block risks false positives on legitimate operator-only questions; warn-and-acknowledge is softer but skippable. (Interface-surface / failure-opportunity trade-off — score, don't guess.)
2. **Where Gate A lives** — an `AskUserQuestion` interceptor is Claude-Code-specific; the durable home may be the unified client-hook plane (EP-CLIENT-HOOK-PLANE). Sequencing question, not a blocker.
3. **Ledger persistence** — does the decision ledger need to persist to a session artifact the guard can read, or is in-context evidence sufficient? Ties into BI-EF42607A (process-spine conformance).

---

## 6. Relationship to existing work

- **Precedent:** BI-1208AE5D (Spec/Plan/Doc Gate) proved the memory-level → harness-level enforcement pattern; this reuses it.
- **Sibling surface:** BI-3E71E016 fixes decision-routing on the *coworker prompt* path; Gate A is the *Claude Code / external-agent hook* path.
- **Sibling hook:** BI-38578194 (uncommitted-work guard) is the same class of pre-action guard.
- **Not a duplicate of** EP-056D2A5E (resource contention) — that epic governs concurrent *execution* races; this governs *discipline enforcement*.
