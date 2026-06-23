# Coworker Panel Header Simplification — Design Spec

**Date:** 2026-06-23
**BI:** BI-706321B1 · **Epic:** EP-COWORKER-PANEL-UX
**Status:** Approved for direct implementation (header-consolidation scope; CEO-approved 2026-06-23)
**Author surface:** Claude Code (peer delivery surface, §17)

---

## 1. Goal

Reduce the AI coworker side-panel header from ~12 resting controls to a calm, progressively-disclosed surface a **non-technical overseer** can read at a glance — without losing access to any capability. Triggered by Mark (CEO): *"the top of the AI coworker panel is rather busy and it's not clear if some of these options work or what they do."*

## 2. Current state

`apps/web/components/agent/AgentPanelHeader.tsx` renders, in the first viewport, a wall of look-alike uppercase pill-chips:

1. status dot, 2. agent name, 3. `Skills ▾` dropdown, 4. `Profile` button, 5. `provider:model` string, 6. `Priority: Balanced` (Golden Triangle), 7. agent-sensitivity badge, 8. `Hands Off/On` toggle, 9. `Advise/Act` toggle (when unified), 10. `External Access Off/On` toggle, 11. `Diagnostics` toggle (privileged), 12. a **second** page-sensitivity badge, plus `Erase` and `×`.

### Two concrete defects

- **Duplicate sensitivity badge.** `AgentCoworkerPanel.tsx` passes `sensitivityLevel={agent.sensitivity}` (line ~859) while `AgentPanelHeader` *already* renders `agent.sensitivity` (line ~138). The same value renders twice — one formatted (`Internal`), one raw (`internal`) — both uppercased by CSS. It looks like a glitch because it is one.
- **Toggles disguised as labels.** `Hands Off`, `External Access Off`, `Advise`, `Diagnostics` are clickable session switches persisted to `sessionStorage`/prefs (`agent-external-access-session.ts`, `agent-form-assist-prefs.ts`), but they are styled as flat uppercase pills with **no switch affordance** — so users cannot tell what is interactive or what it changes. This is the precise "can't tell if these work" complaint.

All control *state and handlers already exist* in the single consumer `AgentCoworkerPanel.tsx`; this is a presentation refactor, not new behavior.

## 3. Research & Benchmarking

Scan of 15 assistant UIs (current as of mid-2026; exact in-bar pixel placement is volatile and treated as current-state, not stable).

**The headline finding:** no leading product shows anywhere near ~12 resting controls. The peer ceiling is **~2–3 always-visible items**, with everything else summoned on demand or pushed to settings.

### Patterns adopted across leaders

- **Mode is one input-anchored control** (dropdown or slider), never a row of toggles — GitHub Copilot ([modes](https://github.blog/ai-and-ml/github-copilot/copilot-ask-edit-and-agent-modes-what-they-do-and-when-to-use-them/)), Cursor ([run modes](https://cursor.com/docs/agent/security/run-modes), `Shift+Tab` to rotate), Continue ([plan mode](https://docs.continue.dev/ide-extensions/agent/plan-mode)), Cline Plan/Act slider.
- **Permissions = a collapsed summary near the input that expands in place** — the direct analog to our Hands/Advise/External cluster. [Cline auto-approve](https://docs.cline.bot/features/auto-approve) *de-duplicates* its summary and pairs scoped→unscoped toggles; [Roo](https://docs.roocode.com/features/auto-approving-actions) uses a labeled tile grid with one master switch.
- **Secondary/rare actions live in a per-conversation `…` overflow or Settings** — rename/delete/profile/diagnostics (ChatGPT [delete/archive](https://help.openai.com/en/articles/8809935-how-to-delete-and-archive-chats-in-chatgpt), Claude, Linear, Slack, LibreChat).
- **Trust/state is one quiet indicator**, not a chip farm — MS Copilot data shield ([overview](https://learn.microsoft.com/en-us/copilot/overview)), LibreChat usage gauge.
- **Progressive disclosure is the explicit stated direction** — Microsoft's [May 2026 redesign](https://www.microsoft.com/en-us/microsoft-365/blog/2026/05/28/introducing-a-new-design-for-microsoft-365-copilot/) moved tools "below the expanded prompt line."
- **Capability-gating** hides controls the current model/route can't honor (Continue renders reasoning/image icons only when supported).

### Anti-patterns identified (all present in our current header)

1. A wall of ambiguous always-on toggle chips.
2. Toggles that don't read as interactive (static text-chips signal "label," not "control").
3. Duplicate state indicators (our two sensitivity badges).
4. Promoting rare/developer controls (Diagnostics, Profile, Erase) to the resting surface.
5. Meta-controls that add decisions without safety — [Cline v3.35](https://cline.bot/blog/cline-v3-35) deliberately *removed* its master toggle / "toggle all" / request-cap as complexity without safeguards. (Caution against "fixing" clutter by adding more switches.)

### Patterns rejected / gaps filled

- **Hiding the model entirely** (Replit, Linear, Slack) — rejected; we keep the `provider:model` string but demote it to the overflow footer (operators still need it for diagnostics).
- **Input-lip relocation of mode/model** (Copilot/Cursor/Cline) — the fullest market match, but it refactors the composer (`AgentMessageInput`). Deferred to a follow-up (§7) to keep this pass contained; the header-anchored expander captures the same progressive-disclosure benefit now.

## 4. Proposed design (header-consolidation scope)

**Resting header (~4 visible items + 2 icon buttons):**

- **Identity row:** status dot · agent name · `Skills ▾` dropdown.
- **Description row:** one quiet sensitivity indicator + the agent description.
- **Right cluster:** a single **posture control** · an **overflow `⋯`** · close `×`.

**Posture control** — a button whose label is a plain-language summary of the current posture (e.g. `Advise · web on`, or `Controls` when everything is at its calm default), with a small accent dot when any non-default permission is active. Clicking expands a popover ("This conversation"):

- **Mode** — `Advise | Act` segmented control (only when `useUnified` + handler present).
- **Edit fields on this page** — real toggle switch (`elevatedAssistEnabled`).
- **Web access** — real toggle switch (`externalAccessEnabled`).
- **Priority** — the existing self-contained `CoworkerPriorityControl` chip (Golden Triangle).

**Overflow `⋯` menu:**

- View profile, skills & tools (`onViewProfile`).
- Diagnostics (privileged only — `canUseDev`; keeps the "use Build Studio for code-changing work" guidance as the control's title).
- Erase conversation (destructive — opens the existing in-app confirm popover; never a native dialog, §12).
- Footer: `model · provider:model` (muted, monospace).

**Sensitivity:** the duplicate is removed; one subtle indicator derived from `agent.sensitivity` sits on the description row.

This lands the header inside the 2–3-resting-control band the benchmark set converges on, gives every toggle a real switch affordance, and fixes the duplicate-state defect.

## 5. UX-fit decision (gate, §12)

Ran `principle_decide` (population `external_coding_agent`, surface `coworker-panel-header-ux`) over three options: status-quo, partial-fix (de-dup + affordance only), consolidate-menu.

- **Result is degenerate on the mandated `human_cognitive_load` axis** — no kernel principle carries that dimension, so the supplied feature contributed nothing and the composite collapsed to a semantic text-length artifact (it nominally "recommended" status-quo because that option had the shortest description). This is the known, repeatedly-observed gap for this axis.
- `commandmentConflict: false` — no veto.
- **Decided on merits: consolidate-menu.** It is the only option that both reduces resting cognitive load (progressive disclosure: auto-derive/hide, keep the default view to a few plain choices) and fixes the duplicate-badge defect. Aligned with the platform's own progressive-disclosure doctrine (§11) and §17 "hide complexity from layman users."

`UX-Fit-Decision:` attestation is carried in the PR body.

## 6. Component architecture & files

| File | Change |
|------|--------|
| `apps/web/components/agent/AgentPanelHeader.tsx` | Rewrite: identity/description rows; posture control with expand-in-place popover (mode + edit-fields + web + priority); overflow `⋯` menu (profile, diagnostics, erase, model footer); single sensitivity indicator; local `useState` for which menu is open + outside-click backdrop. Remove the `sensitivityLevel` prop and the duplicate badge. Keep the parent-controlled erase-confirm contract. |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Drop the `sensitivityLevel={agent.sensitivity}` prop (now redundant). |
| `apps/web/components/agent/AgentPanelHeader.test.tsx` | Rewrite assertions for the new structure (resting summary, single sensitivity, open-popover switches, overflow items, erase-confirm) using `@testing-library/react`. |
| `docs/superpowers/specs/2026-06-23-coworker-panel-header-simplification-design.md` | This spec. |

**No schema, no migration, no new server actions.** All control state, handlers, and persistence are reused unchanged. Theme tokens only (`var(--dpf-*)`) — no hardcoded colors (§12). Erase keeps the in-app confirm (no native dialogs, §12).

## 7. Out of scope / follow-ups

- **Input-lip relocation (Shape 2).** Move the posture + model controls down to the composer (`AgentMessageInput`) to fully match Copilot/Cursor/Cline. Bigger blast radius; file as a follow-up BI under this epic.
- **Posture as a named mode** (Cursor-style "Read-only / Suggest / Act") instead of independent toggles — evaluate after live use of the consolidated menu.

## 8. Testing strategy

- **Unit (`AgentPanelHeader.test.tsx`):** resting header renders identity + posture summary + overflow trigger; posture summary string reflects active state (mode/edits/web); exactly one sensitivity indicator (regression guard for the duplicate); opening the posture popover reveals the edit-fields and web switches; opening overflow reveals profile/erase; erase-confirm popover renders when `clearConfirmOpen`.
- **Build gate:** `pnpm --filter web typecheck` + `pnpm --filter web build` run in CI (this is a source-only worktree; runtime-bound gates run in CI / the shared local-CI sandbox per §5).
- **UX verification:** exercise the panel on the canonical install after the change reaches it via the governed path; confirm the posture/overflow disclosures, the switch affordances, and that no second sensitivity badge appears.
