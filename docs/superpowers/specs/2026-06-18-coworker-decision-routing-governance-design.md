# Coworker Decision-Routing Governance — Design

- **Date:** 2026-06-18
- **Status:** Phase 1 implemented (this PR); Phases 2–4 filed as backlog
- **Epic:** EP-F7E35344 (AI Coworker Capability Inputs)
- **Trigger:** Operator dialog — the "Scrum Master" coworker activated a deferred backlog item, then admitted "I don't have visibility into WWMD or WWWD in my current toolset" and asked the user whether to escalate, instead of routing the decision through governance itself.

## 1. Problem

In-portal AI coworkers bring raw proposals and "should we…?" questions straight to the
employee without first consulting the decision surface that owns the question. The coworker
in the trigger dialog was not hallucinating its limitation — it genuinely had no decision
machinery in its prompt. Four stacked failures, in priority order:

### F1 — The default prompt path strips skills entirely (install-wide today)
`USE_UNIFIED_COWORKER` is **`false`** on the live install (confirmed in `PlatformConfig`).
Every coworker therefore runs the **legacy persona path** at
[`agent-coworker.ts:908`](../../../apps/web/lib/actions/agent-coworker.ts), which assembles the
prompt from `agent.systemPrompt` + context and **never calls `getSkillsForAgent`**. The decision
skills (`dpf-decision-via-kernel`, `dpf-retrieve-decision-context`, `dpf-record-decision-outcome`)
are seeded and assigned `["*"]`, but they are invisible to the running coworkers. Skills are only
injected on the **unified path** ([`agent-coworker.ts:846`](../../../apps/web/lib/actions/agent-coworker.ts)),
which is off by default.

### F2 — Governance is passive even when skills are shown
On the unified path skills are listed ("Available coworker skills: …") with no instruction to
*route a decision through them before answering*. IDENTITY_BLOCK rule #23 only tells the coworker
to *attribute* Mark's / the org's recorded view if it happens to be in context — never to
*consult* `principle_decide` / the org's WWWD stance and return a grounded recommendation. There is
**no proactive decision gate** anywhere in the chat loop; governance is a tool the coworker may
choose to call, not a contract it must satisfy.

### F3 — The decision tools are reachable, but WWWD has no coworker-callable door
`principle_decide` and `wiki_query` gate only on `registry_read`, a baseline grant every coworker
holds ([`agent-grants.ts:79,243,262`](../../../apps/web/lib/tak/agent-grants.ts)) — so **WWMD is
callable**. But **WWWD** (the Decision Perspective Gate,
[`decision-perspective/build-studio-gate.ts`](../../../apps/web/lib/decision-perspective/build-studio-gate.ts))
is only invoked internally during Build Studio plan advancement — there is **no coworker-callable
tool** for an arbitrary "what would WE do?" business question. **WSID** profession corpus is
read-only context, not a decision door. Per AGENTS.md §16 raw `principle_decide` must **not** settle
a customer's business question (the non-inherit boundary); consolidation is open as **BI-E1FB2307**,
and the org resolver **BI-230C9EF7** landed.

### F4 — Skill-assignment coverage is uneven
Several user-facing personas (Customer Success, HR, Marketing, Onboarding COO, Admin) have **no**
decision skills assigned at all; the orchestrators and Enterprise Architect do. Even the personas
that have them get nothing today because of F1.

## 2. Resolution (phased)

### Phase 1 — Proactive decision-routing contract on BOTH paths *(this PR)*
A new, DB-overridable **decision-routing governance block** is injected into every coworker's
system prompt on **both** the unified and legacy paths, making the behavior surface-uniform and
flag-independent:

- New module [`decision-routing-block.ts`](../../../apps/web/lib/tak/decision-routing-block.ts) —
  exports the `DECISION_ROUTING_BLOCK` constant + `loadDecisionRoutingBlock()` (PromptTemplate
  `platform-identity/decision-routing` override, constant fallback).
- Seed file [`prompts/platform-identity/decision-routing.prompt.md`](../../../prompts/platform-identity/decision-routing.prompt.md)
  so admins can tune the contract without a redeploy.
- Unified path: added as a static (cacheable) block between identity and mode in
  [`prompt-assembler.ts`](../../../apps/web/lib/tak/prompt-assembler.ts).
- Legacy path: loaded and injected after `agent.systemPrompt`, **plus** the coworker's eligible
  skills are now rendered on the legacy path too (with the same eligible/invoked telemetry), closing
  F1 directly.

The block routes each decision class to its owning surface — platform/build → `principle_decide`
(WWMD); the organization's business call → the org's recorded stance (WWWD), explicitly **not**
the founder kernel; craft/role → the profession corpus (WSID) — and instructs the coworker to lead
with a grounded recommendation, not a raw question, and never to deflect with "should I check with
governance?". It respects the AGENTS.md §16 non-inherit boundary (platform doctrine is advisory to a
business decision, not binding).

### Phase 2 — Coworker-callable WWWD decision door *(LANDED — 2026-07-06 update)*
The governed door shipped as `evaluate_org_business_decision` (org-decision tool pack,
`apps/web/lib/decision-perspective/org-business-gate.ts`, BI-230C9EF7/EP-8AF1C996): it resolves the
org's own WWWD profile via `resolveOrgProfileId`, scores only its material, treats platform doctrine
as advisory fallback, and records every call to the `DecisionInteraction` ledger. The routing block
now points the business branch at it (BI-44526F3E Phase A). The **elicitation return path** also
exists: `record_org_business_answer` (same pack, `registry_write`, BI-44526F3E Phase C) captures a
CONFIRMED operator answer through `enrichOrgCorpus` (qa provenance, first-party trust,
draft-by-default per BI-1378), and the /wiki/review gap findings surface where the org was silent —
silence → gap finding → ask once → captured answer → reviewed stance. The onboarding COO holds the
grant and its persona instructs the interview.

### Phase 3 — Unified-path migration / legacy retirement *(filed)*
The two divergent prompt paths are the underlying architectural debt. Decide whether to default
`USE_UNIFIED_COWORKER` on (after per-persona verification) or retire the legacy path. Phase 1
removes the urgency by making the governance contract present on both, but one path should win.

### Phase 4 — Skill-assignment coverage audit *(filed)*
Ensure every user-facing persona that can face a decision carries the decision-routing skills, and
prune the EP-661D395E "stale skill" false positives (empty `SkillUsageEvent` telemetry — now being
populated by the legacy-path telemetry added in Phase 1).

## 3. Verification

- `prompt-assembler.test.ts` — new regression test asserts the block is present, correctly ordered
  (identity → routing → mode), names all three surfaces, and carries the non-inherit boundary line.
  34/34 pass.
- `pnpm --filter web typecheck` — clean.
- Substrate: source-local gates from the root clone. Live coworker-chat UX drive (gate #3) is the
  Phase 1 follow-up once merged, since it exercises the running portal's legacy path.

## 4. Research & Benchmarking

The pattern mirrors how agent frameworks inject a standing "operating contract" into the system
prompt rather than relying on optional tool discovery (e.g. Claude Code's `AGENTS.md`/system-prompt
contract, and the founder-kernel `principle_decide` scoring model already in DPF). Rejected
alternative: a hard pre-response gate that blocks the model until it calls `principle_decide` —
too brittle for conversational turns (analysis/advise turns legitimately need no decision) and
would fight IDENTITY_BLOCK rule #19. A prompt-level contract + visible skills is the
lowest-blast-radius lever that makes the behavior proactive without a runtime chokepoint.
