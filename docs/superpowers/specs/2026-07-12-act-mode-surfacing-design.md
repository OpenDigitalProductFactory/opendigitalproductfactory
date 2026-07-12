# Act-mode surfacing — coworker recommendations as selectable action cards (BI-867263F4)

- **BI:** BI-867263F4 (P4, large) · **Epic:** EP-B9DD37C7 (coworker chat: runtime truthfulness, transparency & controls)
- **Depends on:** BI-80532D5C propose-interception (the loop's accumulate-and-continue diversion mechanism) merging first.
- **Kernel decisions (2026-07-12, external_coding_agent, high confidence):** approach = `advise-emits-proposals-via-interception` (11.53); presentation = `reuse-existing-approve-reject-card` (6.66, `human_cognitive_load`).

## 1. Problem

When a coworker recommends actions in chat ("I recommend: 1) add Dan Warfield as primary contact, 2) update the quote"), the text renders as an inert markdown list. Advise mode **strips** side-effecting tools before the model sees them and injects a prompt telling the model to *describe* what it would do and ask the user to flip a global Act toggle (`coworker-tool-filter.ts:45-67`, `agent-coworker.ts:1552-1567`). Nothing is clickable; the advise→act handoff is entirely conversational and the user must switch a global mode and re-ask. The `AgentActionProposal` + Approve/Reject card (`AgentMessageBubble.tsx:267-459`, `proposals.ts:20-114`) is the platform's real "click to execute" primitive, but it only fires when a tool is authored `executionMode:"proposal"` **and** the model calls it — and advise mode has already stripped the interesting tools.

## 2. Why this is now cheap: propose-interception already did the hard part

BI-80532D5C added, in the agentic loop, a **divert-and-continue** mechanism: under a propose posture a side-effecting non-artifact tool call is captured as an `AgentActionProposal` (via `interceptToolCallAsProposal`) and the loop **continues**, accumulating multiple proposals in one turn. The existing `approveProposal` executes `actionType` as a tool name. So the only remaining gap for BI-867263F4 is to route the **interactive advise turn** through that same mechanism and surface the accumulated proposals as cards.

## 3. Design

1. **Advise mode stops stripping; it proposes.** In `coworker-tool-filter.ts`, advise mode keeps side-effecting non-artifact tools in the surface (so the model can *call* them) rather than removing them. The interactive chat turn sets the interactive equivalent of `proposeSideEffects = true` (a new `agent-coworker.ts` send-path flag mirroring the scheduler's), so each such call is diverted to an `AgentActionProposal` instead of executing.
2. **Accumulate, don't return-on-first.** Reuse BI-80532D5C's continue-after-divert so a single turn surfaces **N** proposals (one per recommended action), not just the first.
3. **Render with the existing card.** Each accumulated proposal renders with the **existing** Approve/Reject proposal card (kernel UX-fit choice — no new visual language). Today the turn carries a single `proposal`; extend `AgentMessageRow` to carry `proposals[]` (or emit one assistant message per proposal) and stack the existing card per action.
4. **Execution + audit unchanged.** Approve → `approveProposal` → `executeTool` → status `executed`/`failed` + `authorizationDecisionLog` (all existing).

The advise-mode system-prompt guidance shifts from "ask the user to switch to Act mode" to "propose the concrete actions" — the model's recommendations become real, capability-checked, parameterized proposals rather than prose.

## 4. Research & Benchmarking

Reuses the platform's own proven proposal primitive rather than inventing one — the substrate map (this BI's scoping) confirms `AgentActionProposal` + `approveProposal` is the single load-bearing "click to execute" mechanism, already governance-audited. Rejected: (B) a new `recommendedActions[]` field + bespoke renderer + client-side "materialize on click" — larger new surface for no governance gain; (C) client-side prose parsing — brittle NL→tool mapping, no parameter fidelity, no capability pre-check, fights the proposal-as-DB-row model. External assistant UIs (the benchmark set in the coworker-UX consolidation spec) converge on "the model proposes a concrete, parameterized action the human one-click approves" over free-text-then-mode-switch — this adopts that pattern on the existing primitive.

## 5. Open dependency & sequencing

Implement only **after** BI-80532D5C merges (this design builds on `interceptToolCallAsProposal` and the continue-after-divert loop change). The interactive-path flag and the multi-proposal turn shape are the net-new surface; the card, execution, and audit are all reuse.

## 6. UX-Fit

Presentation reuses the existing Approve/Reject card (kernel `reuse-existing-approve-reject-card`, high confidence) — no new control a layman must learn; progressive disclosure via the same human-labeled param table already shipped. `UX-Fit-Decision:` trailer will cite this on the implementing PR.
