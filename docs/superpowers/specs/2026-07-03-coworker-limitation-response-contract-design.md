# Coworker Limitation-Response Contract — Design

- **Date:** 2026-07-03
- **Epic:** EP-F7E35344 (AI Coworker Capability Inputs)
- **Backlog:** BI-FE37B0A1 (advise-mode strip is invisible → self-misdiagnosis) — this generalizes it into a behavioral contract for *every* limitation
- **Goal it serves:** "When faced with a limitation, an AI coworker should propose to the human how to enable and complete the task — no open-ended interaction; proactivity means suggest/ask permission for the next step, reducing cognitive load to a bare minimum while maintaining human-in-the-loop."

## Problem

When a coworker cannot complete a request, its default behavior is to **dead-end**: it explains what's wrong at length and/or deflects to "ask an administrator / that's outside what I can do here." The AI Ops Engineer did exactly this on the AI Readiness console — it summarized three blockers and routed the operator to "the COO or System Admin," when the real next step was a one-click Act-mode toggle plus, now, a tool it can call. That is high cognitive load and no path forward.

This is a *behavioral* gap, not a capability gap. The platform already has:
- the `manage_coworker_tool_grant` MCP door (PR #2556) for the self-serve case,
- the Advise→Act toggle for the mode case,
- the proactivity resolver whose action boundary already tops out at **propose** (approval card), never autonomous act.

What was missing is the instruction that turns a limitation into a **single-approve proposal** instead of a dead-end.

## Design

Add a DB-overridable **limitation-response** prompt block, injected into every coworker's system prompt on **both** the unified assembler path and the legacy persona path — surface-uniform, exactly like the existing `decision-routing` block it sits beside.

The contract instructs the coworker, whenever blocked by a limitation:
1. **Name the one enabler** in plain language ("switch me to Act mode", "let me give the Catalog Scout permission to run its scan", "turn on the <X> connection").
2. **State the smallest next step** that both enables it and completes the task — one recommended action, not a menu.
3. **Ask a single yes/no.** If only the human can flip a control, name the exact one-click control and offer to continue the moment it's on.

Explicit prohibitions: no open-ended "here's what's wrong" with no way forward; no deflection to "an administrator"; no jargon (tool names / grant keys). Explicit HITL rail: get the yes before anything that changes authority, spends money, or is hard to undo — never take such a step unprompted. This aligns with the proactivity resolver's `propose` ceiling.

### Composition with existing blocks
`decision-routing` governs *how a coworker decides what to recommend* (consult WWMD/WWWD/WSID before proposing). `limitation-response` governs *what a coworker does when it is blocked from acting on that recommendation*. They are complementary and both static/cacheable; ordering is identity → decision-routing → **limitation-response** → mode.

### Files
- `apps/web/lib/tak/limitation-response-block.ts` — constant + `loadLimitationResponseBlock()` (DB-override via PromptTemplate, offline fallback).
- `prompts/platform-identity/limitation-response.prompt.md` — seeded, editable in Admin > Prompts.
- `prompt-assembler.ts` + `agent-coworker.ts` — inject on both paths.

## Research & Benchmarking

- **Nielsen's error-message heuristic** ("clearly indicate the problem AND constructively suggest a solution"): the contract's step 2 (propose the fix) is the "constructive solution" half most agent failures omit.
- **Progressive disclosure / one-decision-at-a-time** (the `human_cognitive_load` axis in DPF's own UX-fit gate): a single yes/no beats a menu; we forbid option-menus for the unblock step.
- **Anti-pattern rejected:** autonomous self-enablement (a coworker granting itself authority to proceed). The HITL rail + the `manage_coworker_tool_grant` self-target guard both forbid it — the coworker proposes; the human authorizes.

## Verification
- Unit: `prompt-assembler.test.ts` asserts the block is present, ordered between decision-routing and mode, and carries the anti-dead-end / single-yes language.
- Both paths carry it (legacy injection mirrors the proven `decision-routing` injection).
- Build gate via CI (worktree is source-only). No schema/migration.

## UX-Fit
This is a prompt-behavior change, not a new UI control — it *reduces* cognitive load (one yes/no vs an open-ended analysis). No new form, route, or operator-configurable field is introduced; the block is editable in the existing Admin > Prompts surface.

## Follow-up shipped: runtime mode-awareness signal (BI-FE37B0A1 pinpoint half)

The prompt contract above tells a coworker *how* to respond to a limitation, but for the advise-mode case it still had to guess *which* enabler applies — a stripped tool is invisible, so the coworker could not tell "held back by Advise mode" from "not granted." That is the misdiagnosis the AI Ops Engineer made ("backlog access rejected → go to System Admin") when it actually held the grant.

Fix: surface the held-back set into the prompt. `adviseHeldBackTools(mergedTools)` (in `coworker-tool-filter.ts`) returns exactly the set the advise rule removes — side-effecting, non-`coworkerArtifact` tools the coworker already passed grant + capability gating to reach. When `coworkerMode === "advise"` and that set is non-empty, `agent-coworker.ts` appends a bounded block (mirroring the existing external-access block) to the system prompt: **"ADVISE MODE — AUTHORITY HELD BACK (NOT A MISSING PERMISSION)"** listing up to 10 of those actions, with the instruction not to claim missing access or deflect to an admin, and to propose switching to Act mode instead. The injection sits in the section both prompt paths converge on, so it covers unified and legacy in one place. Bounded at 10 (+N-more) to respect the local served-context budget.

Net effect: the coworker now knows precisely which requested actions are mode-gated vs ungranted, so the limitation-response proposal names the right enabler with certainty.
