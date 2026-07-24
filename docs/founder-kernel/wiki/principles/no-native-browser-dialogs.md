---
title: No Native Browser Dialogs
pageKind: principle
status: published
abstract: Portal UI never uses window.confirm/alert/prompt; it uses the in-app dialog primitive so agents can drive every flow end-to-end.
principleTier: core
principleDirection: Replace every native window.confirm/alert/prompt with the in-app dialog primitive (confirm/alert/promptDialog) so a flow is completable by DOM automation with no human in the loop.
principleDimensionVector: {"evidence_density": 0.7, "long_term_maintainability": 0.6, "reusability": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principleConsumerContexts:
  - ui
principlePublic: true
principlePublicRationale: DPF's premise is that AI agents drive the product. A flow gated behind a native OS dialog cannot be driven by an agent — it strictly requires a human hand — which breaks that premise for adopters who automate against their own install.
---

## Rule

No portal code calls the browser's native `window.confirm()`, `window.alert()`, or `window.prompt()` (bare or `window.`-prefixed). Confirming, notifying, and text-entry flows use the in-app dialog primitive instead:

```ts
import { confirmDialog, alertDialog, promptDialog } from "@/components/ui/Dialog";

if (!(await confirmDialog({ title, message, tone: "danger" }))) return;
await alertDialog(message);
const value = await promptDialog({ title, message });
```

It renders real DOM (`role="dialog"`/`"alertdialog"`, `aria-modal`, themed via `--dpf-*` tokens) with stable `data-dialog-action="confirm|cancel"` and `data-dialog-input` refs an agent can find and click. Destructive actions keep a confirm step — as in-app UI, in `danger` tone.

## Why

The platform's premise is that AI agents drive Build Studio and every other surface end-to-end. Native dialogs make that impossible: a native dialog **blocks all browser automation** — Claude-in-Chrome / CDP `Input.dispatchMouseEvent` times out while the dialog is open, and the action only commits when a **human** clicks OK. This was proven live: an operator had to click OK twice to abandon two builds because the only abandon path was gated behind a native `confirm()` (BI-297863B2). So a native dialog is not just inconsistent chrome — it is an absolute wall: no MCP tool, no HTTP route, and not even UI automation can get past it without a human. That also makes the flow untestable and breaks light/dark/branding theming.

The in-app primitive removes the wall: the same find-a-button-by-ref → click → resolve interaction an agent performs is exactly what a unit test asserts (`Dialog.test.tsx`), so the flow is both automatable and verifiable.

## Applies To

In-platform coworkers building portal components, external coding agents (Claude Code, Codex, Grok) authoring UI changes, and humans reviewing UI PRs. Symmetric across all delivery surfaces — because all changes land via PR and the gate reads the code, not which surface produced it (governance approves evidence, not provenance).

## How To Apply

Reach for `confirmDialog` / `alertDialog` / `promptDialog` from `@/components/ui/Dialog` anywhere you would have written `confirm` / `alert` / `prompt`. They are async (`await` the result) — convert the enclosing handler to `async` and the call shape is otherwise identical. Destructive confirms pass `tone: "danger"`; required prompts pass `required: true`. Never re-introduce a native dialog "just this once" — the static guard (`scripts/check-no-native-dialogs.mjs`, CI job "Repo Guard Loop") fails any PR under `apps/web` that does, on every surface.

## Decision Dimensions

- `evidence_density: 0.7` — automation-reachable UI is the precondition for functional verification (drive-the-happy-path). Native dialogs block the evidence; in-app dialogs make it a passing test.
- `long_term_maintainability: 0.6` — one primitive, testable and guardable, instead of an OS call that can't be styled, tested, or driven.
- `reusability: 0.5` — a single shared dialog composes across every surface and theme; per-call native dialogs (or bespoke one-off modals) do not.

(A consistent, themed in-app modal also lowers a layman's cognitive load versus jarring OS chrome — but `human_cognitive_load` is a cost axis, so that benefit is captured in the prose above rather than as a positive weight.)

## Examples

- **Positive:** A new "Delete provider" action calls `await confirmDialog({ title: "Delete provider", message: "…cannot be undone.", tone: "danger", confirmLabel: "Delete" })`. An agent finds `[data-dialog-action="confirm"]`, clicks it, and the delete completes — no human, no native dialog. A unit test asserts the same path.
- **Counterexample:** A new admin page guards a destructive action with `if (!confirm("Are you sure?")) return;`. The CI Repo Guard Loop (native-dialog guard) fails the PR; even if it slipped through, an agent driving that page would hang on the native dialog forever, and the only way to complete the flow would be a human clicking OK.
