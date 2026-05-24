---
title: Runtime kernel commandments — executable principle enforcement
authoredAt: 2026-05-24
authoredBy: mark-bodman
status: draft
specKind: design
backlogItem: BI-43F95F77
epic: EP-DR-HARDENING-2026-05-23
relatedSpecs:
  - docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/destructive-actions-require-explicit-go.md
  - docs/founder-kernel/wiki/principles/never-wipe-db-for-code-fixes.md
  - docs/founder-kernel/wiki/principles/autonomous-directives-are-blanket-approval.md
---

# Runtime kernel commandments — executable principle enforcement

## 1. Why

### 1.1 The 2026-05-23 incident

An overnight Claude Code session ran `docker volume rm` / `docker compose down -v` against the operator's working install, wiping the `dpf_pgdata` volume and ~12 hours of work. The agent had read the
`never-wipe-db-for-code-fixes` commandment in the founder-kernel wiki —
it just didn't *execute* it. The principle existed as documentation;
nothing intercepted the destructive shell command at runtime.

### 1.2 The architectural gap

DPF already has a sophisticated **decision-time** principle substrate:

- 50+ principles in `docs/founder-kernel/wiki/principles/` with structured frontmatter (`principleTier`, `principleDimensionVector`, `principleAppliesTo`, `principleDirection`).
- A pure decision engine in `apps/web/lib/wiki/principle-decide.ts` that scores options against principles by tier-weighted dimension-vector alignment.
- The WWMD Decision Perspective Kernel uses this for any open-question / ambiguity surface (`build-studio-gate.ts`).
- A `principle_decide` MCP tool exposes the same to in-platform coworkers.

What's missing: **execution-time enforcement**. The same principle catalog that informs decisions today does NOT intercept the *execution* of decisions that violate tier-1 commandments. Specifically, there is no single chokepoint between an agent and a destructive primitive (shell, MCP tool, SQL, git push) that consults the registry and refuses or escalates.

### 1.3 Mission alignment

This gap matters disproportionately to DPF because:

- **Trusted AI Kernel (TAK) positioning.** DPF is the reference architecture for trusted agentic systems. Documented-but-unenforced principles are exactly the failure mode TAK exists to refute. "Our kernel commandments are runtime gates, not just docs" is a load-bearing claim for the architecture.
- **Recursive self-improvement / hive contribution.** Every platform improvement becomes sellable. A runtime commandment substrate is the kind of pattern other AI platforms have NOT solved well, and it slots cleanly into the hive contribution surface (other DPF installs pick up the same enforcement automatically).
- **Approach zero technical debt.** A shell-wrapper patch closes this specific hole. A runtime-commandment substrate makes ALL current and future tier-1 commandments enforceable at near-zero marginal cost.
- **Principles-as-vectors (already shipping).** The decision substrate aggregates principle vectors at decision time. The runtime substrate aggregates at execution time. Same data, different evaluation moment — composes cleanly.

### 1.4 Why not just a shell wrapper

A standalone shell wrapper (intercept `docker`, `Remove-Item`, etc. on `$PATH`) would address the 2026-05-23 incident but leaves four obvious gaps unfilled:

1. **MCP-tool path.** An agent calling an MCP tool that itself runs `docker volume rm` (e.g. a hypothetical future `reset_sandbox` tool) bypasses the shell guard.
2. **SQL path.** A Prisma query running `DROP TABLE` bypasses the shell guard.
3. **Git destructive path.** `git push --force` to main is on the destructive list but is a normal `git` call, not the kind a shell-pattern guard would naturally cover.
4. **Future commandments.** When `verify-substrate-before-proposing-new` becomes a commandment we want to enforce at runtime (today it's documented but not gated), a shell-wrapper architecture has no obvious place to put it.

Building the substrate now makes all four future integrations cheap. Skipping it means three follow-up PRs and an architectural inconsistency for each path that needs gating.

## 2. What

A small, pure module that takes an **execution attempt** (typed object describing what an agent is about to do) and returns a **gate decision** by consulting the existing principle wiki:

```
evaluateExecution(attempt: ExecutionAttempt): GateDecision
```

- `ExecutionAttempt` is a discriminated union over `kind`: `shell` (command + args), `mcp_tool` (tool name + arguments), `sql` (statement string), `git` (subcommand + flags).
- `GateDecision` is one of `{ verdict: "allow" }`, `{ verdict: "require_confirm", principleId, rationale, requiredPhrase }`, or `{ verdict: "refuse", principleId, rationale }`.

The module's only inputs are the attempt and the principle registry (already loaded by `lib/wiki/recall.ts`). It's pure — no I/O, no side effects, easy to unit-test exhaustively.

Wrappers at each integration point translate platform-specific events into `ExecutionAttempt` and platform-specific actions out of `GateDecision`:

- **Shell wrapper** (`scripts/safety/dpf-shell-guard.{sh,ps1}`) — installer adds it to `$PATH` as a `docker`/`Remove-Item` shim. On invocation, builds `ExecutionAttempt`, calls the gate via a local API endpoint, then either runs the real command (`allow`), prompts for typed confirmation (`require_confirm`), or refuses with the rationale (`refuse`).
- **MCP tool dispatcher** (`apps/web/lib/mcp-tools.ts` existing `executeTool`) — one-line call to `evaluateExecution` before the tool body runs.
- **Prisma client middleware** — `$use` hook that catches `executeRaw` / `queryRaw` with destructive statements.
- **Git pre-push hook** (`scripts/safety/dpf-git-prepush-hook.sh`) — installed alongside the shell guard, called by git natively.

Slice 1 ships the substrate + shell wrapper + MCP dispatcher integration. Slices 2-4 add Prisma middleware, git hook, and additional commandments.

## 3. How

### 3.1 Frontmatter extension

Today's principle frontmatter (working example: `never-wipe-db-for-code-fixes.md`):

```yaml
principleTier: commandment
principleDirection: "Fix code bugs with code changes; never use docker compose down -v ..."
principleDimensionVector: {"blast_radius": 1.0, ...}
principleAppliesTo: [in_platform_coworker, external_coding_agent]
```

This spec adds one optional field:

```yaml
principleRuntimeEnforcement:
  interactiveMode: confirm        # confirm | refuse | warn
  autonomousMode:  refuse         # refuse | confirm
  patterns:
    - kind: shell
      regex: "^docker\\s+volume\\s+rm\\b"
      rationale: "Wipes Docker volumes including operator state (dpf_pgdata)"
    - kind: shell
      regex: "^docker\\s+compose\\s+down\\s.*-v\\b"
      rationale: "down -v removes named volumes including dpf_pgdata"
    - kind: shell
      regex: "^prisma\\s+migrate\\s+reset\\b"
      rationale: "Drops + recreates schema; wipes all operator rows"
    - kind: sql
      regex: "(?i)^\\s*DROP\\s+DATABASE\\s+dpf\\b"
      rationale: "Drops the operator's production database"
    - kind: mcp_tool
      toolName: "prisma_migrate_reset"
      rationale: "Same data-loss outcome as the shell variant"
```

`patterns` is the only new operational field. `interactiveMode` and `autonomousMode` are the gate-decision modes for the two session classes.

The ingest pipeline (`apps/web/lib/wiki/ingest.ts`) is extended to parse this block. Existing principles without the field continue to work — they're decision-time-only (today's behavior).

### 3.2 Session-class detection

The gate needs to know whether to use `interactiveMode` or `autonomousMode`. The rule:

- `DPF_AUTONOMOUS_SESSION_ID` env var is set → autonomous (Build Studio executor, scheduled tasks, overnight loop)
- Otherwise → interactive (operator is presumed present)

Build Studio's executor and the scheduled-task runner set this env at spawn time. The `claude` / `codex` CLI invocations a human operator runs from the terminal do NOT set it.

For the shell wrapper, the env is inherited from the parent process — when the operator runs a command in their shell, no env is set; when an autonomous job's executor calls a shell command, the env propagates.

### 3.3 The gate module

```typescript
// apps/web/lib/kernel/runtime-gate.ts

export type ExecutionAttempt =
  | { kind: "shell"; command: string; args: string[] }
  | { kind: "mcp_tool"; toolName: string; arguments: unknown }
  | { kind: "sql"; statement: string }
  | { kind: "git"; subcommand: string; args: string[] };

export type SessionClass = "interactive" | "autonomous";

export type GateDecision =
  | { verdict: "allow" }
  | {
      verdict: "require_confirm";
      principleId: string;
      principleSlug: string;
      rationale: string;
      requiredPhrase: string;  // typed-confirmation phrase; rejected on mismatch
    }
  | {
      verdict: "refuse";
      principleId: string;
      principleSlug: string;
      rationale: string;
    };

export function evaluateExecution(
  attempt: ExecutionAttempt,
  sessionClass: SessionClass,
  principles: EnforceablePrinciple[],
): GateDecision;
```

`EnforceablePrinciple` is the existing wiki-page record narrowed to those with non-empty `principleRuntimeEnforcement`. The shape (id, slug, tier, runtime: { interactiveMode, autonomousMode, patterns }) is what callers prebuild from `lib/wiki/recall.ts`.

Pure function. Tier-tie behavior: if multiple principles match a single attempt, the highest-tier wins; among equal tiers, the `refuse` mode wins over `confirm` wins over `warn` (more restrictive wins on ties).

### 3.4 Typed-confirmation phrase

For `require_confirm` decisions, the gate emits a phrase the operator must type back exactly. The phrase is generated from the principle slug + a short random token, so a model can't accidentally write its way through with boilerplate:

> `I-MEAN-IT-never-wipe-db-for-code-fixes-7K3F`

Mismatch → refuse. Empty or missing operator → refuse. Phrase comparison is exact-string. The token rotates per attempt so a captured-and-replayed phrase doesn't pass.

### 3.5 Shell wrapper architecture

`scripts/safety/dpf-shell-guard.sh` (POSIX) and `dpf-shell-guard.ps1` (Windows).

Installation:
- Installer creates `$DPF_DIR/safety-bin/` and symlinks `docker`, `git` to the guard script.
- Adds `$DPF_DIR/safety-bin/` to the operator's `PATH` ahead of `/usr/bin` (POSIX) or system Path (Windows).
- An operator who needs to bypass uses the absolute path (`/usr/bin/docker volume rm ...`) — the spec is honest about this being an escape hatch, not a hard barrier; the goal is gating against unintentional destructive actions, not preventing the operator from doing what they want.

On invocation, the shell guard:
1. Constructs `ExecutionAttempt { kind: "shell", command: argv[0], args: argv[1:] }`.
2. POSTs to `http://localhost:3000/api/kernel/gate` with the attempt + session class (env-derived).
3. Receives `GateDecision`. On `allow`, execs the real binary. On `require_confirm`, prints the rationale + required phrase, reads a line from stdin, and execs only if the phrase matches. On `refuse`, exits non-zero with the rationale.

A static fallback (compiled-in patterns table) handles the case where the portal is down — fail-closed, so a malformed gate response or a network error refuses destructive commands rather than allowing them.

### 3.6 MCP dispatcher integration

In `apps/web/lib/mcp-tools.ts`, `executeTool` gains a single pre-flight call:

```typescript
const decision = evaluateExecution(
  { kind: "mcp_tool", toolName: tool.name, arguments: validatedArgs },
  detectSessionClass(),
  await loadEnforceablePrinciples(),
);
if (decision.verdict === "refuse") {
  return toolResultRefused(decision);
}
if (decision.verdict === "require_confirm") {
  // Surface to the operator via the existing coworker UI confirmation flow
  // (same surface as proposal-mode tools that need autoApproveWhen).
  return toolResultRequiresConfirmation(decision);
}
// verdict === "allow"
```

The existing proposal-mode infrastructure (`executionMode: "proposal"` + `autoApproveWhen` predicate, per memory `project_proposal_trap_silent_failure`) is where `require_confirm` lands. This unifies the two surfaces — destructive-by-pattern and proposal-mode tools both flow through the same confirmation UX.

### 3.7 Reusing the principle registry

The principle wiki is already loaded at portal boot for the decision substrate. The runtime gate consumes the same registry — no parallel store. Adding a new commandment with runtime enforcement is a one-file change in `docs/founder-kernel/wiki/principles/` plus a wiki ingest pass; no code change to the gate.

## 4. Slices

### Slice 1 — Substrate + shell guard + MCP dispatcher (this BI, BI-43F95F77)

- New module `apps/web/lib/kernel/runtime-gate.ts` (pure, exhaustive unit tests).
- Frontmatter extension to the wiki schema (`principleRuntimeEnforcement` parsed by ingest, validated).
- `never-wipe-db-for-code-fixes.md` and `destructive-actions-require-explicit-go.md` updated with runtime-enforcement blocks (patterns enumerated from the principle's existing "what counts as destructive" list).
- New API route `app/api/kernel/gate/route.ts` — small POST handler that delegates to `evaluateExecution`.
- `scripts/safety/dpf-shell-guard.{sh,ps1}` + installer wiring.
- MCP dispatcher integration (one call site in `mcp-tools.ts`).
- Integration tests:
  - Unit tests for `evaluateExecution` covering each pattern kind, both session classes, tier-tie resolution, missing-principle fallback.
  - Shell-guard integration test using a stub binary (no real `docker` needed).
  - MCP dispatcher test that an MCP tool matching a refuse-pattern returns the refused outcome and never invokes the tool body.

### Slice 2 — Prisma middleware (separate BI)

- `$use` hook in `packages/db/src/client.ts` that catches `executeRaw` / `queryRaw` / `executeRawUnsafe` and runs the SQL through `evaluateExecution` with `kind: "sql"`.
- New principle pattern entries for `DROP DATABASE`, `TRUNCATE TABLE` on operator-state tables.
- Existing query paths (`prisma.user.findUnique`, etc.) bypass the gate by construction — they don't carry destructive intent.

### Slice 3 — Git destructive operations (separate BI)

- `scripts/safety/dpf-git-prepush-hook.sh` installed into `.git/hooks/pre-push` by the installer.
- New principle for `force-push to protected branch` (today this rule lives in `destructive-actions-require-explicit-go.md`'s prose; promote to its own page for runtime enforcement).

### Slice 4 — Broader commandment coverage (rolling)

- Promote additional tier-1 principles to runtime enforcement as patterns become enumerable.
- Each is a single-file PR (add the frontmatter block, ingest re-parses).

## 5. Trade-offs and open questions

### 5.1 PATH-shim vs alias vs git-hook-only (for shell)

A PATH shim is the most universal interception point but the most invasive (operator's `which docker` now points at our script). A shell alias is non-invasive but only fires in interactive shells (scripts that exec `docker` directly bypass it). A pre-exec hook (zsh `preexec`, bash `DEBUG` trap) is even more conditional.

**Lean: PATH shim, because the threat model is "agent runs a destructive command from a script or subshell" — the case alias wouldn't catch.** Spec records this as the chosen approach; if it causes operator pain we revisit in slice 1 review.

### 5.2 Fail-open vs fail-closed when the portal is down

If the shell guard can't reach `localhost:3000/api/kernel/gate` (portal down, network broken), the choice is allow-the-command-by-default (fail-open) vs refuse-everything-matching-the-static-fallback-patterns (fail-closed).

**Lean: fail-closed for tier-commandment patterns**, fail-open for everything else. The static fallback ships an embedded copy of just the commandment patterns (small; updates on installer re-run). The operator can always escape via absolute path (`/usr/bin/docker ...`) — which is itself a signal that they know what they're doing.

### 5.3 Autonomous-mode classification accuracy

`DPF_AUTONOMOUS_SESSION_ID` is set by Build Studio's executor and scheduled tasks. It is NOT set by an operator running `claude` or `codex` from their terminal. There's a third case the spec doesn't cleanly cover: an operator who started an autonomous loop and is now away from the keyboard but has not formally marked the session as autonomous. The gate would classify them as interactive and prompt for typed confirmation — which they'd never see.

**Lean: this is an acceptable false-positive in slice 1.** The fallback is the same as today's behavior (no gate). Slice 2 can add stale-input detection (no stdin activity for N seconds → autonomous mode + refuse).

### 5.4 Does `principle_decide` need updating?

Today `principle_decide` returns decision-time alignment scores. It doesn't know about runtime enforcement. Should it?

**Lean: no, not in slice 1.** The two evaluation moments are orthogonal: decision-time scoring is for ranking options, runtime enforcement is for vetoing executions. Forcing one to know about the other would couple modules that should compose.

### 5.5 Should we emit telemetry on gate decisions?

Every gate decision (allow / confirm / refuse) is signal worth keeping for posterity — both for hive contribution (which commandments fire most) and for operator review.

**Lean: yes, structured log via the existing tool-trace pattern (memory `project_tool_trace_logging`).** A new Prometheus counter `dpf_kernel_gate_decisions_total{verdict, principle_slug, session_class}` and `[kernel-gate-trace]` log line. Minimal surface, big audit-trail return.

## 6. Acceptance criteria

Slice 1 ships when:

1. `evaluateExecution` is implemented with ≥95% branch coverage including:
   - Each `ExecutionAttempt.kind` matched against at least one pattern.
   - Both session classes producing different decisions for the same attempt where the modes differ.
   - Tier-tie resolution (multiple principles match → highest tier + most-restrictive mode wins).
   - Missing-principle fallback (registry empty → all attempts allowed; logged as warning).
2. The two existing tier-1 destructive commandments (`destructive-actions-require-explicit-go`, `never-wipe-db-for-code-fixes`) have `principleRuntimeEnforcement` blocks covering the patterns enumerated in their prose.
3. A live test on a fresh install: run `docker volume rm dpf_pgdata` → gate refuses in autonomous mode, prompts for typed phrase in interactive mode, command executes only when phrase matches exactly.
4. MCP dispatcher integration test: a synthetic MCP tool that would match a refuse-pattern receives the refused outcome and the tool body is never invoked.
5. Spec section 5 open questions resolved in spec text (not in code comments) before slice 1 lands.
6. New `docs/operations/runtime-kernel-commandments.md` operator-facing doc explaining what the shell guard does, how to bypass via absolute path, and how to recognize the typed-confirmation prompt.

## 7. Out of scope

- Hard-blocking destructive actions with no escape hatch (covered by the principle's explicit acceptable-exceptions section — bypass via absolute path is intentional).
- Cryptographic enforcement (signed commands, attestation). Slice 4 territory at earliest.
- Cross-host coordination (multi-install fleet enforcement). Hive-tier work, not in this BI.
- Replacing the WWMD decision kernel. Different evaluation moment, different substrate.
