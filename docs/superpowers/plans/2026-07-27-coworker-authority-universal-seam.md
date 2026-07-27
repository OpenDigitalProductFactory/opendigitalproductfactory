# Coworker Authority Universal Seam Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

**Backlog item:** `BI-62BFAA95`  
**Work Capsule:** `WC-6D367D6F`  
**Goal:** Make every AI-coworker tool action pass one fail-closed authority decision that intersects the human, coworker, delegation chain, route, object scope, connection state, and data policy; return approval decisions to the exact originating task node without widening sibling context.

## Backlog Coverage

- Decision: atomic
- Receipt: `cms3cwgnq03kq01p5c89v774q`
- Parent: `BI-62BFAA95`
- Dependencies: none
- Rationale: The evaluator, universal enforcement seam, approval return path, and regression proof are mutually dependent parts of one safe release; shipping any phase alone would either enforce nothing or dead-end approved work.
- Delivery graph:
  - `authority-decision-contract` -> `BI-62BFAA95`
  - `universal-execution-seam` -> `BI-62BFAA95`, depends on `authority-decision-contract`
  - `hitl-call-chain-return` -> `BI-62BFAA95`, depends on `universal-execution-seam`
  - `consumer-and-regression-tests` -> `BI-62BFAA95`, depends on all preceding phases

The phases are internal sequencing, not independently safe releases. A chain-only release would improve provenance while still allowing actions that should require approval. An evaluator without the universal seam would not enforce anything. A `require-approval` result without a return path to the originating `TaskRun`/envelope would dead-end work. The complete seam must therefore land as one PR.

## Design Grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-07-17-coworker-authority-model-completion-design.md`
  - `docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md`
  - this atomic plan and its live backlog-coverage receipt
- Current code substrate reviewed:
  - `apps/web/lib/mcp-governed-execute.ts` as the universal enforcement point
  - `apps/web/lib/identity/load-effective-auth-context.ts` as the verified human-context loader
  - `apps/web/lib/tak/delegation-authority.ts`, `CoworkerActionEnvelope`, and `TaskRun` as the existing chain, approval, and return-path substrate
- Source of truth: the deterministic authority evaluator owns the decision, `AuthorizationDecisionLog` owns decision evidence, `CoworkerActionEnvelope` owns approval lifecycle, and `ToolExecution` owns execution outcome.
- Decision: extend those existing contracts at the universal seam and keep caller routes thin; do not create a parallel authority store, caller-specific policy branch, or prompt-owned approval path.

## Architecture Decision

WWMD ledger `DI-5965306B6BF9` compared:

1. combined chain-of-custody and impact-gated approval at `governedExecuteTool`;
2. chain propagation first, approval later;
3. separate checks at individual caller surfaces.

The kernel selected the combined universal seam with high confidence (composite `17.159`, margin `3.347`, no commandment conflict). The choice accepts a larger immediate blast radius in exchange for one reusable PEP, one decision receipt, and no interval where audit completeness can be mistaken for authorization completeness.

This extends, rather than duplicates:

- `apps/web/lib/mcp-governed-execute.ts` as the universal tool PEP;
- `apps/web/lib/identity/effective-auth-context.ts` and its loader as the human/relationship scope;
- `apps/web/lib/tak/delegation-authority.ts` and `DelegationChain` as the narrowing call-chain;
- `CoworkerActionEnvelope` plus `apps/web/lib/coworker/envelope-state-machine.ts` as the approve/decline/execute lifecycle;
- `TaskRun.parentTaskRunId`, `authorityScope`, `a2aMetadata`, and `input-required` as the originating-node return path;
- `AuthorizationDecisionLog` as the canonical allow/deny/require-approval evidence row;
- `DecisionInteraction` only where a governed judgment is required, not as a second authorization log.

No new Prisma model or status vocabulary is planned. The schema audit shows that
the existing `CoworkerActionEnvelope` needs nullable, indexed bindings for the
originating `TaskRun`, delegation chain, authority decision, input fingerprint,
and expiry. Extend that canonical model with an expand-only migration; do not
hide stable authority relationships inside `argsJson` or create a parallel
approval table.

## Standards Grounding

- NIST SP 800-207: keep policy decision separate from enforcement, evaluate each request using subject/resource context, and apply least privilege.
- OWASP LLM06:2025 Excessive Agency: execute actions in the user's authorization scope and require human approval for high-impact actions.
- DPF Pseudo-User Contract: an AI coworker never becomes the human principal; effective authority is the intersection of human authority and narrower coworker/delegation grants.

The evaluator is deterministic application code. Prompt text, model output, routing fallback, provider cost, and caller-supplied approval claims are evidence inputs at most; none can broaden authority.

## Phase 1: Pure Authority Decision Contract

**Create:**

- `apps/web/lib/govern/authority/coworker-authority-decision.ts`
- `apps/web/lib/govern/authority/coworker-authority-decision.test.ts`

**Refactor:**

- extract decision construction and privacy-safe explanation formatting from `mcp-governed-execute.ts`;
- keep execution, persistence, and hook orchestration outside the pure evaluator.

Define a closed result:

- `allow`
- `deny`
- `require-approval`

Inputs must be server-owned or server-resolved: effective human context, agent grants, tool action metadata, route context, object/account/employee scope, active delegation grant and chain, integration connection state, data sensitivity/masking obligations, and any already-approved envelope reference.

Fail closed when identity, object scope, delegation lineage, connection ownership, policy version, or approval binding is absent or stale. Produce concise user-readable reason and next action while keeping raw parameters, tokens, secrets, employee data, and policy internals out of evidence.

**TDD cases:**

- human capability and coworker grant must both authorize;
- a delegation may narrow but never widen authority;
- peer/shared-team scope cannot borrow manager scope;
- prompt content, provider fallback, and caller-supplied sensitivity cannot lower a restriction;
- reversible low-impact reads can allow;
- unauthorized actions deny;
- consequential authorized actions require approval unless the exact active envelope binds actor, action, object, task node, and parameter fingerprint;
- expired/replayed/mismatched approval denies.

## Phase 2: Universal PEP and Decision Evidence

**Modify:**

- `apps/web/lib/mcp-governed-execute.ts`
- `apps/web/lib/mcp-governed-execute.test.ts`
- `apps/web/lib/identity/load-effective-auth-context.ts`
- `apps/web/lib/tak/delegation-authority.ts`

Load or accept a server-resolved `EffectiveAuthContext` at the universal seam. Resolve the executing agent's grants and the active narrowing chain before tool execution. Invoke the pure evaluator after argument coercion but before lifecycle hooks and `executeTool`.

Persist one `AuthorizationDecisionLog` for each evaluated agent action:

- actor and human context references;
- agent and delegation references;
- action key, route, bounded object reference, sensitivity, policy version;
- `allow`, `deny`, or `require-approval`;
- privacy-safe rationale codes and decision version.

Join the resulting `ToolExecution` to the same delegation chain and decision reference. Audit-write failure for a denied or approval-required action must not permit execution. Successful allow evidence must remain observable without storing raw sensitive arguments.

Keep the existing human capability and agent grant checks as inputs to the new evaluator during refactoring, then remove duplicate branches only after parity tests prove the unified decision owns them.

## Phase 3: HITL Pause and Exact Call-Chain Resume

**Modify:**

- `apps/web/lib/coworker/envelope-actions.ts`
- `apps/web/lib/coworker/envelope-state-machine.ts`
- `apps/web/lib/tak/subagent-fanout.ts`
- `apps/web/lib/mcp/packs/screen-pack.ts`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<timestamp>_bind_coworker_envelopes_to_authority_chain/migration.sql`
- the agentic-loop caller that supplies `GovernedExecuteContext`

On `require-approval`:

1. create or reuse an idempotent `CoworkerActionEnvelope` bound to the exact action, args fingerprint, human, coworker, `TaskRun.taskRunId`, delegation chain, authority decision, and expiry;
2. set only the originating `TaskRun` to `input-required`;
3. expose a bounded decision through the existing attention/decision surface;
4. on approval, re-enter `governedExecuteTool` with the envelope id;
5. re-evaluate current authority and policy before executing;
6. resume the exact originating task node and preserve sibling tasks unchanged;
7. on decline, expiry, cancellation, or mismatch, terminate the envelope without executing.

Do not copy full parent context into child/sibling tasks. Pass stable ids and bounded authority scope; loaders resolve current state at the decision and execution boundaries.

**TDD cases:**

- a tertiary child pause points to its own task and preserves the root human;
- approval resumes that child only;
- sibling task authority/context does not change;
- parent cancellation invalidates a pending child approval;
- approval cannot be replayed for another tool, object, parameter set, route, agent, or policy version;
- a changed grant, manager relation, connection state, sensitivity, or delegation chain forces a new decision.

## Phase 4: Consumers, Architecture Projection, and Completion Gate

Wire the current coworker chat, delegated subagent, autonomous task, and external MCP paths through the same context builder. No consumer may synthesize `allow` or treat `require-approval` as success.

Update:

- `docs/superpowers/specs/2026-07-17-coworker-authority-model-completion-design.md`
- `docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md`
- relevant EA architecture projection/registry entries if the authority seam is represented there.

No operator documentation is required unless this slice changes the visible approval or denial experience. If visible copy or controls change, run `dpf-ux-fit-review` and update the relevant `docs/user-guide/` page in the same PR.

**Targeted verification:**

```powershell
pnpm --filter web exec vitest run `
  lib/govern/authority/coworker-authority-decision.test.ts `
  lib/mcp-governed-execute.test.ts `
  lib/coworker/envelope-state-machine.test.ts `
  lib/tak/subagent-fanout.test.ts `
  lib/identity/load-effective-auth-context.test.ts `
  lib/work-management/policy-envelope.test.ts
git diff --check
```

**Completion gate:**

1. exact candidate passes the shared local-integration CI gate against current accepted `main`;
2. all web unit tests and production build pass;
3. the expand-only envelope-binding migration passes the migration-safety guard and applies cleanly against existing envelope rows;
4. functional tests prove allow, deny, require-approval, exact child resume, sibling isolation, stale-policy denial, and replay denial;
5. `pnpm pr:health <pr>` reports every check terminal and green with zero unresolved threads;
6. merge-group CI passes before BI and Work Capsule completion.

## Risks and Rollback

- **Universal-seam regression:** a bad evaluator can block every coworker tool call. Mitigate with parity characterization tests before removing old checks and a single feature-local module that can be reverted with the PR.
- **Approval replay or confused deputy:** an envelope could authorize a different action or child. Bind actor, human, action, object, args fingerprint, task node, chain, route, and policy versions; re-evaluate at execution.
- **Audit leaks:** authority evidence could capture sensitive parameters. Persist bounded references, reason codes, versions, and fingerprints only.
- **Duplicate sources of truth:** `AuthorizationDecisionLog`, `DecisionInteraction`, `CoworkerActionEnvelope`, and `ToolExecution` could overlap. Keep authorization result in `AuthorizationDecisionLog`, human judgment in `DecisionInteraction`, approval lifecycle in `CoworkerActionEnvelope`, and execution outcome in `ToolExecution`.
- **Rollback:** squash-revert the PR. The nullable envelope-binding columns may remain harmlessly unused during rollback or be removed in a later contract migration; existing capability/grant checks remain behaviorally characterized so rollback restores the prior universal seam without data repair.
