# Spec: Coworker Button-Decision Interface

**Epic:** EP-COWORKER-INTERACTIVITY (PUC envelope flow, grant taxonomy, cross-page HITL handoff)
**Date:** 2026-07-16
**Status:** Draft for founder review
**Author:** AI Coworker (session: ai-coworker-button-interface)

## 1. Problem

When an AI coworker (or Claude in this CLI) needs the human to make a next-step decision, it ends its turn with **free-text prose** — "Want me to start there, or prioritize X first?" — and the human must **type a reply** ("go") to proceed. That reply is pure UX tax: the decision is almost always a small, discrete choice that a **single button press** would resolve faster and with less friction.

The founder's directive: *systematically boil AI→human handoffs down to button-press decisions wherever possible.*

## 2. Current state (verified 2026-07-16)

The platform already forces a next-step handoff and already renders decision buttons in one narrow case — but has no general structured multi-option decision carrier.

| Concern | Today | File |
| --- | --- | --- |
| Binary approve/reject of **one** held tool call | Live, fully wired | `AgentActionProposal` (schema.prisma ~4021); `AgentMessageBubble.tsx` ~253-445; `lib/actions/proposals.ts`; created in `lib/actions/agent-coworker.ts` ~1751 |
| Message content | Scalar `String` markdown; only structured attachment is the optional **1:1** `proposal` | `lib/tak/agent-coworker-types.ts` `AgentMessageRow` |
| **Decision vocabulary** | Enum already exists: `approve \| reject \| request-changes \| answer \| open-in-context \| dismiss \| snooze` | `lib/attention/types.ts` `AttentionActionKind` |
| "Needs you" inbox | Renders attention `actions[]` — but only `action.href` as deep-links; in-place buttons "wired in later slices" | `components/attention/AttentionInbox.tsx` |
| "What's next" signal | Interaction contract mandates free-text **Status / Evidence / Next action / Owner** closeout (prose) | `lib/tak/coworker-interaction-contract.ts` |
| "Lead with a recommendation, only offer a choice when a genuine option remains" | Prose instruction, no structured carrier | `lib/tak/decision-routing-block.ts` |
| Multi-option chip UI | Prototype `ChoiceCard` + `Message.choices[]` — **unpersisted, stubbed handlers** | `components/build-studio/cards/ChoiceCard.tsx` |

**Load-bearing constraint:** `AgentActionProposal.messageId String @unique` — one message may carry at most one binary proposal. This is what prevents attaching N discrete options to a turn today.

## 3. Design

A single coherent capability across three layers. Reuse the existing `AttentionActionKind` vocabulary end-to-end; do not invent new action names.

### 3.1 Data / contract layer — a structured Decision carrier

A coworker turn may carry an optional **`decision`**:

```ts
type CoworkerDecisionOption = {
  id: string;                 // stable id echoed back on click
  label: string;              // button text, e.g. "Go", "Fix the render first"
  kind: AttentionActionKind;  // reuse existing enum
  recommended?: boolean;      // at most one; rendered as the primary button
  value?: Json;               // optional structured payload the click resolves to
};

type CoworkerDecision = {
  prompt: string;             // the question, e.g. "Where should I start?"
  options: CoworkerDecisionOption[];  // 1..N; the degenerate "proceed?" case = a single { label: "Go", recommended: true } option
  freeTextAllowed?: boolean;  // default true — an "Other…" escape hatch preserving today's typed reply
};
```

Because `AgentActionProposal` is binary/1-action (`messageId @unique`), a decision with N options needs its **own carrier**. Two implementation options (decision for §5):
- **(A) New relation** `AgentDecision` (1:1 with `AgentMessage`, holds `options[]` + resolution), mirroring the proposal model. Cleanest audit story; consistent with existing proposal pattern.
- **(B) JSON column** `AgentMessage.decision Json?`. Lightest migration; weaker query/audit surface.

Resolution is audited the way proposals are: which option, by whom, when. The single-`AgentActionProposal` path is **subsumed** as the special case `options = [approve, reject]` so we converge on one decision concept rather than two (avoids one-concept-two-impls debt).

### 3.2 Prompt / behavior layer — teach the interaction contract to emit decisions

Augment `COWORKER_INTERACTION_CONTRACT_PROMPT` (and mirror in `decision-routing-block`): **when the closeout's Next action is owned by the human AND reduces to a small discrete choice, emit a structured `decision` instead of ending on prose.** Rules:
- Lead with the recommended option (`recommended: true`) — this preserves the existing "grounded recommendation, not a raw open question" doctrine, now machine-readable.
- The degenerate "shall I proceed?" case becomes a **single "Go" button**, `recommended: true`. This is the exact friction the founder called out.
- Keep the `freeTextAllowed` escape hatch so nothing that's genuinely open-ended is forced into buttons.
- Do **not** emit a decision when a goal/autopilot directive already authorized proceeding without asking (mirrors `feedback_drive_100_percent_means_dont_ask`).

### 3.3 UI layer — render buttons in both surfaces (cross-page HITL)

- **In-conversation:** `AgentMessageBubble` renders `decision.options` as buttons (recommended = primary). Click posts the option `id` to `/api/agent/send` (reusing the proposal approve/reject wiring), which resolves the decision and continues the turn. An "Other…" affordance re-opens the free-text input when `freeTextAllowed`.
- **Cross-page:** the same decision projects into an `AttentionItem` so it is actionable from the "Needs you" inbox. This requires finishing the already-anticipated `AttentionInbox` work: render `approve/reject/answer/...` kinds as **in-place buttons**, not just href deep-links. That is the "cross-page HITL handoff" EP-COWORKER-INTERACTIVITY already scopes.

## 4. Phasing

- **P1 — Minimal "Go" button + contract instruction.** Add the carrier (option B JSON is fine for P1), teach the interaction contract to emit a single recommended "Go" for the proceed-case, render it in `AgentMessageBubble`. Smallest change that kills the "type go" friction. Live-verify on the portal.
- **P2 — N-option decisions + recommended-first.** Multi-option choices; converge the existing `AgentActionProposal` approve/reject onto the decision carrier.
- **P3 — Cross-page inbox parity.** In-place decision buttons in `AttentionInbox` / `NeedsYouBand`; decision projects to an attention item; resolvable from either surface.

## 5. Open decisions for founder / kernel

1. **Carrier:** new `AgentDecision` relation (A, cleaner audit) vs `AgentMessage.decision Json?` (B, lighter). Recommendation: B for P1, migrate to A if audit/query needs grow.
2. **Scope to start:** full 3-layer capability vs P1-only increment.
3. **Build path:** promote to Build Studio (standing rule) vs external build.

## 6. Non-goals

- Not removing free-text input — the "Other…" escape hatch stays; buttons are the *default*, not a cage.
- Not a new epic — this lands under EP-COWORKER-INTERACTIVITY.
- Not forcing buttons on genuinely open questions or on turns already authorized to proceed autonomously.

## 7. Verification

Functional, not structural: drive the live portal coworker to a proceed-decision, confirm a "Go" button renders and a single click continues the turn (verify via DB decision-resolution row + the coworker's next turn), per the founder's structural≠functional commandment.
