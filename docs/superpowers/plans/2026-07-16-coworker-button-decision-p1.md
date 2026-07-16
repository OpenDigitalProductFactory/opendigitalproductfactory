# Plan: Coworker Button-Decision Interface — P1

**BI:** BI-3237B5D6 · **Epic:** EP-COWORKER-INTERACTIVITY
**Spec:** docs/superpowers/specs/2026-07-16-coworker-button-decision-interface.md

## Goal of P1

Kill the "type go" friction: when a coworker's next action is a human decision with a small discrete option set (including the plain "shall I proceed?" case), the human resolves it with a **button press** instead of typing a reply. Ship the smallest end-to-end slice with no schema migration.

## Approach (migration-free carrier)

The coworker appends a single-line HTML-comment **sentinel** at the end of its message:
`<!--dpf-decision:{"prompt":"…","options":[{"label":"Go","recommended":true}]}-->`
The sentinel rides inside `AgentMessage.content` (already persisted + refetched), so P1 needs no DB change. It is parsed and **stripped at render**; buttons are derived client-side. Clicking an option submits its value as the human's reply through the existing send pipeline — no new server action. This mirrors the existing managed-doc-chip pattern (`extractManagedDocumentIds`).

## Steps (all complete)

1. **Parser** — `apps/web/lib/tak/decision-block.ts`: `parseDecisionFromContent` (extract + strip + normalize), `normalizeDecision` (≥1 option, ≤6, one recommended, dedupe, kind from the AttentionActionKind vocab, freeTextAllowed default true), `formatDecisionSentinel`. Pure + tested (`decision-block.test.ts`).
2. **Contract emit** — augment `COWORKER_INTERACTION_CONTRACT_PROMPT` (`coworker-interaction-contract.ts`) with the BUTTON DECISIONS clause: recommended-first, degenerate proceed → single "Go", skip when already authorized to proceed, free-text always available. Injected via `prompt-assembler.ts`. Test updated.
3. **Render** — `AgentMessageBubble.tsx`: `DecisionButtons` component; parse content, strip sentinel from the markdown + doc-id extraction, render options (recommended = primary, reject = negative). New `onDecision` prop.
4. **Wire** — `AgentCoworkerPanel.tsx`: pass `onDecision` (→ `handleSend`) only for the latest assistant turn while idle; superseded/in-flight turns render without buttons.

## Verification

- Core parser: 26 assertions against the real esbuild-transpiled source — pass.
- Syntax/transform: all touched `.ts`/`.tsx` clean via esbuild.
- Hermetic vitest suites (`decision-block.test.ts`, `coworker-interaction-contract.test.ts`): run in CI.
- Full typecheck + live portal drive: gated by CI + a rebuilt portal (source-only worktree can't run either locally).

## Follow-ups (tracked, not silent debt)

- **P2:** promote the carrier to a typed `AgentMessage.decision Json?` column (removes content-embedded sentinel + semantic-memory noise); converge `AgentActionProposal` approve/reject onto the decision carrier.
- **P3:** in-place decision buttons in `AttentionInbox` so a decision is resolvable cross-page ("Needs you" inbox), per the epic's cross-page HITL handoff.
