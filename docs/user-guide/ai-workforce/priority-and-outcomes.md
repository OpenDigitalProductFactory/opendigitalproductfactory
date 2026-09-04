---
title: "Priority, Outcomes & Calibration"
area: ai-workforce
order: 4
description: "Set a cost / quality / time priority in plain terms, see what actually ran against what you asked for, and let the platform propose a better-fitted default."
relatedCode:
  - apps/web/app/(shell)/platform/ai/assignments/page.tsx
  - apps/web/app/(shell)/platform/ai/priority/outcomes/page.tsx
  - apps/web/lib/golden-triangle/compile.ts
  - apps/web/lib/golden-triangle/calibrate.ts
  - apps/web/lib/golden-triangle/telemetry-receipts.ts
  - apps/web/lib/golden-triangle/receipt.ts
---

## What This Covers

**Priority** is how you tell the platform what matters more on this work: keeping cost down,
raising quality, or going faster. You express it in plain terms; the platform translates that
into concrete routing and verification policy, then shows you what actually happened.

Three surfaces, in the order you meet them:

| Surface | What it is for |
| --- | --- |
| `/platform/ai/assignments` — **Priority & Models** | Set the everyday priority, plus advanced per-coworker guardrails |
| `/platform/ai/priority/outcomes` — **Priority — Outcomes** | See what each recent run actually did against what you asked for |
| The suggestion banner on that page | A better-fitted default, proposed from your own run history |

> `/platform/ai/priority` now redirects to `/platform/ai/assignments`. The everyday priority
> and the advanced guardrails were merged onto one surface rather than living apart.

## What It Is — and What It Deliberately Is Not

The priority control is a **preference-to-policy compiler**. You choose a posture; it produces
explicit policy adjustments against the routing and decision contracts that already exist.

It is **not** a model picker, **not** a second router, and **not** a separate model registry.
That distinction is load-bearing: a control that quietly ran its own routing beside the real
one would let the screen and the system disagree. Instead the compiler feeds the existing
routing call as **defaults** — every explicit setting, and the local-only sovereignty switch,
still wins over it.

Presets are the primary control. The triangle itself is a fine-tune and visualization layer,
colour-coded by balance, not the thing you must drag to get work done.

### Two properties that make it safe

- **Fail-open.** Any error in resolving the posture falls back to the platform's normal
  behaviour. A priority setting cannot take the inference path down with it.
- **Balanced-inert.** A Balanced posture produces no adjustments at all — byte-identical to
  having never set one. Nothing changes until you deliberately lean.

## The Work Itself Can Raise the Bar

The newer half of this: priority is no longer only about *your* preference. The **kind of work**
now sets floors the priority cannot trade away.

When work happens in a Workroom, the room's collaboration shape is passed to the compiler, and
three shapes carry a floor:

| Kind of work | Minimum quality tier | Verification |
| --- | --- | --- |
| **Outward review** — the action leaves the business under its own name | Strong | Deep |
| **Approval sign-off** — an accountable approver signs off on prepared evidence | Strong | Shallow |
| **Consequential change** — confirmed before it executes | Strong | — |

Two things about this table are deliberate:

- **Entries can only tighten.** A kind of work can raise a tier floor or deepen verification.
  It can never buy a cheaper or less-checked run than your priority asked for.
- **Anything unrecognised contributes nothing.** Ordinary conversation is unaffected, which is
  what keeps this inert until real, shaped work is happening.

So a marketing send inside an outward-review room runs at a strong tier with deep verification
even if the platform priority leans toward cost. You did not have to remember to raise it.

→ [How Governed Work Actually Runs](how-governed-work-runs.md) explains where the shape comes
from; [My Work and Workrooms](../workspace/work-rooms.md) shows the per-room panel.

## Reading the Outcomes View

`/platform/ai/priority/outcomes` answers the question a preference control usually dodges:
**did the platform actually do what I asked?**

Each recent run is compared against the priority currently in force and marked:

- **Matched** — the run delivered the tier and effort you chose.
- **Deviated** — the run landed below it.

The distinction that matters most is *why* a run deviated, and the view separates two causes
that look identical in a log:

- **An infrastructure failover** — the run fell back to a backup provider. This is a fault to
  investigate, not a decision anyone made.
- **A posture trade-off** — the system did what your priority told it to. Working as asked.

Collapsing those two into one "degraded" state is what makes most such dashboards useless. Here
they are named apart.

## The Calibration Suggestion

When enough runs accumulate, a banner at the top of the outcomes view proposes a better-fitted
default. It **suggests and never auto-applies** — the change stays your decision.

It is conservative on purpose. Below **five runs** under the current priority it says so and
stays quiet. Above that, the most actionable signal wins:

| What it says | What triggered it | What it means |
| --- | --- | --- |
| **Runs are failing over often** | 30% or more fell back to a backup provider | The tier you asked for may not be reliably available. Add capacity, or ease the quality floor. |
| **This priority may be under-provisioned** | 30% or more landed below the requested tier, or failed verification | Nudge the triangle toward Quality. |
| **You may have room to save** | A quality-leaning priority where *every* run was clean | A more balanced priority would likely still pass, while spending less. |
| **This priority looks well-fitted** | None of the above | Nothing stands out — delivering what you asked without obvious waste. |

The third one is the interesting case, and the one most platforms never offer: the system
telling you that you are **over-buying**. A control that only ever suggests spending more is a
sales funnel, not a calibration loop.

## Honest Limits

- **Outcomes are reconstructed against your *current* priority.** Recent runs are compared with
  the posture in force now, and historical failover is not reconstructed. Change the priority
  and the view re-measures the same runs against the new setting.
- **A suggestion is evidence, not an instruction.** Five runs is a small sample, chosen so the
  banner appears while it can still be useful. Treat it as a prompt to look, not a verdict.
- **Deviated does not mean failed.** A run that traded quality for cost exactly as you asked is
  marked Deviated against the requested tier while being entirely correct.

## Related

- [How Governed Work Actually Runs](how-governed-work-runs.md) — where the work's shape comes from
- [AI Operations](../platform/ai-operations.md) — the surrounding AI operations surfaces
- [Model Routing & Lifecycle](model-routing-lifecycle.md) — what the compiled policy feeds into
- [AI Cost Governance](ai-cost-governance.md) — spend tracking and budget controls

## How work rooms behave

The priority settings above answer "how does this coworker behave". *How work rooms behave*
answers a different question: how does work happening **in a room** behave, whoever is doing
it. It sets the default pace for every room, and whether rooms may act without asking.

Your default applies where nothing more specific did. A room that states its own settings
overrides it, and so does the work itself — an escalation pushes harder, and work that
leaves the business is verified first, whatever the default says. That ordering is
deliberate: a blanket preference about rooms should not overrule the shape of the job in
front of you.

Setting a looser authority default never promotes a coworker. If a coworker may only
propose, rooms will still propose. The default can restrain; it cannot grant.
