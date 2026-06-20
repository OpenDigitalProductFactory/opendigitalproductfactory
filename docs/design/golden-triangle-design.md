# The Golden Triangle

**A Decision-Making Primitive for the Open Digital Product Factory**

Cost · Quality · Time

> Simple gesture in. Expert settings out. Real cost and human judgment back. Defaults that learn.

*Design Document for Review — v0.1 Draft · June 2026*

---

## 1. Purpose & Thesis

**The product thesis in one sentence:** the Golden Triangle is an abstraction layer over expertise. A non-technical person should never have to know that “extended effort + three reviewer perspectives + a frontier model” is the right combination for a high-stakes decision. They pull toward the dimension they care about, and the platform — which encodes the expertise — translates that gesture into the correct technical settings.

The classic project-management triangle (cost, quality, time — the “iron triangle”) is long-standing PM acumen: you cannot maximize all three; over-investing in one dimension causes the others to suffer. This document turns that intuition into an interactive constraint model that drives real agent behavior, real cost accounting, and a learning feedback loop across the platform.

> **The gap that is the product**
> - The user sees a left column: “get this right,” “I need this now,” “keep it cheap.”
> - The platform runs a right column: model tier, effort mode, number of reviewer perspectives, verification depth, retry budget, projected and actual token cost.
> - That gap — between the simple human intent and the expert execution — is the entire feature. Nobody has to become an expert, because the platform is the expert.

**Why now.** Keeping current with new models, new ways to call them, and new agent patterns is effectively impossible for any one person through reading alone. The triangle, combined with traced outcomes and a federated benchmark network, lets the platform itself “keep up” empirically — from real usage rather than from blog posts.

## 2. Locked Design Decisions

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Weighting model | Soft priority weighting on the visual; a translation layer behind it encodes real-world couplings. Not rigid zero-sum. |
| 2 | The visual | One draggable priority point inside a triangle (Cost / Quality / Time), with named zones and a live readout. |
| 3 | Quality definition | Expertise abstraction, operationalized as agent-actionable proxies: review/perspective count, effort mode, model tier, verification/retry depth. |
| 4 | Where it lives | All three tiers, same canonical component. “What would Mark do?” first; reusable component canonical from day one; “we” / “I” inherit it. |
| 5 | Model registry | Open and extensible. Seeds with Claude plus other providers and capability-only profiles; users can register new models later. |
| 6 | Cost | Made real via token traceability. Two ledgers: predicted (budget) and actual, with drift tracked between them. |
| 7 | Feedback | Human 3-state verdict (thumbs up / mediocre / thumbs down) on outputs at all three tiers, bound to the setting that produced them. |
| 8 | Storage | Triangle position, telemetry, feedback, and benchmark records are first-class entities in the DPDM / Digital Product Graph. |
| 9 | Data architecture | Local-first on every install; roll up to project; opt-in anonymized aggregation to a cloud “hive mind.” |

## 3. The Weighting Model: Soft, Not Zero-Sum

A naive design offers three independent sliders, which lets a user cheat by maxing all three. The obvious fix is rigid zero-sum (barycentric coordinates that must sum to a constant). But **rigid zero-sum misrepresents the real decision logic**, and the LLM example shows exactly why.

### 3.1 Why couplings matter

Choosing a higher-tier model raises **cost** and improves **quality** — those two move *together*, not against each other. The genuine sacrifice lands on the third axis: **time**. So the relationship is not “three things that always trade off equally.” Some moves are coupled; the real trade-off is against whichever axis is left.

> **The resolution**
> - Soft weighting on the front: the triangle expresses priority / emphasis, not three hard-capped dials.
> - A coupling / translation layer behind it: this layer knows the real couplings (e.g. “prioritize quality” → “higher tier + more perspectives” → which also implies higher cost and slower time).
> - Result: the visual stays simple; the intelligence lives in how each position translates into actual settings.

**Example.** “Cost is no object” pulls toward the coupled quality-plus-cost region: the system spends freely for fidelity. “I need this now” pulls toward time: a fast mode and a single pass, accepting lower quality and lower cost as the by-product.

## 4. The Visual

The natural representation is a **single draggable priority point inside an equilateral triangle** with Cost, Quality, and Time at the vertices. Position encodes emphasis. The gesture is honest about trade-offs without requiring any explanation:

- Corners — “all-in” on one dimension.
- Center — balanced / sensible default.
- Edges — sacrificing the opposite vertex.

Supporting elements:

- **Live numeric readout** (e.g. Cost 50 / Quality 30 / Time 20).
- **Named preset zones** — “Ship fast,” “Gold-plate it,” “Lean & cheap,” “Balanced.”
- **Snap-to-preset** for quick selection, plus fine drag for nuance.
- **Live decode panel** showing the concrete settings the current position resolves to, plus projected token cost.

> **Design principle.** The visual must be designed as a canonical, reusable component from day one — even though it debuts in the “Mark” tier. Whatever criteria and visual we settle on here are reused verbatim at every layer.

## 5. The Three Decision Lenses

The triangle is not a single global setting. It is layered, and the same canonical component renders at each layer:

| Lens | Meaning | Scope |
|------|---------|-------|
| What would Mark do? | Your encoded default / philosophy — a saved triangle position plus reasoning. | Platform-level investment decisions. Highest-value; built first. |
| What would we do? | The team / org consensus position, possibly aggregated. | Shared org default; inherits the component. |
| What should I do? | Situational; the user sets it per decision. | Per-decision override; inherits the component. |

Layering: a personal default sits under an org default, which a per-decision override can supersede. As the learning loops mature, these defaults stop being hand-tuned and become **data-driven**.

## 6. The Translation Layer (the heart of the feature)

Each triangle position resolves to concrete, agent-actionable settings. This is what makes the triangle do work rather than be decoration. The layer reads from the open model registry so it is never hardcoded to specific models.

### 6.1 Quality, operationalized

Quality is the squishiest axis, so it is defined entirely by measurable proxies the agents can act on:

- **Number of reviews / perspectives** before a decision proceeds (single pass vs. multi-agent cross-examination).
- **Effort mode** (fast vs. extended / extra-effort thinking).
- **Model selection** (low → mid → high tier, plus frontier tiers where available).
- **Verification / citation depth** and **retry budget**.

> **Two mechanisms, kept separate**
> - Upstream (triangle, automatic): pulling toward quality sets the system to try harder — regardless of outcome. This is the input knob.
> - Downstream (human, over time): the judgment of whether quality was achieved comes from a person via a 3-state verdict. This is the truth signal.
> - The gap between intended quality and realized quality is the learning signal.

### 6.2 The expertise translation table

Representative positions. The user sees the first two columns; the platform runs the third.

| User pulls toward | What they mean | What the platform actually does |
|-------------------|----------------|----------------------------------|
| Quality (cost no object) | “Get this right.” | Highest available tier, extended effort, 3+ reviewer perspectives, full verification, generous retry budget. Cost↑ Time↑ Quality↑ |
| Time | “I need this now.” | Fast mode on a low/mid tier, single pass, light checks. Time↓ Cost↓ Quality↓ |
| Cost | “Keep it cheap.” | Cheapest viable model, standard mode, minimal review. Cost↓ Quality~ Time~ |
| Balanced (center) | “Sensible default.” | Mid tier, standard effort, 1–2 perspectives. |

*Note: the bindings above are expressed as tier abstractions so they survive future model changes; the current Claude binding is shown in the registry section.*

## 7. The Open Model Registry

The triangle does not care which model is used — it cares about the **capability, cost, and speed profile** a model exposes. The registry makes the platform genuinely model-agnostic, in line with Open DPDM. It seeds with Claude plus other providers, *and* capability-only “future model” profiles so a model that does not exist yet can be slotted in later.

### 7.1 Registry schema (per model)

| Field | Description |
|-------|-------------|
| provider | Vendor or source (e.g. Anthropic, or a self-hosted/open-weights source). |
| model_id / name | Identifier and human label. |
| tier | Capability class: low / mid / high / frontier. |
| cost_per_token_in / out | Input and output token pricing — the basis for real cost accounting. |
| speed_class | Relative latency / throughput profile. |
| capability_profile | Strengths (reasoning, coding, verification, long-context, tool-use). |
| modes | Supported effort modes (fast / standard / extended). |
| status | active / deprecated / capability-only (future, not yet bound). |

### 7.2 Current binding (illustrative seed)

The prototype seeds with current Claude models plus placeholders for other providers and a capability-only future profile. The binding is data, not code — when a user registers another model, it drops straight into the translation layer.

| Tier | Current Claude binding | Typical use under the triangle |
|------|------------------------|--------------------------------|
| Low | Haiku-class | Time / cost emphasis; fast, cheap, single pass. |
| Mid | Sonnet-class | Balanced default. |
| High | Opus-class | Quality emphasis; extended effort. |
| Frontier | Mythos-class (where available) | Maximum quality, cost no object. |
| (other) | Other providers / open-weights | User-registered; profile-matched. |
| (future) | Capability-only profile | Reserved slot; binds when a real model is registered. |

## 8. Token & Cost Traceability (foundational dependency)

**The cost vertex has been “light at best” because there has been no real token accounting underneath.** For the triangle to be honest, cost must be measured, attributed, and traced. Without this, “pull toward cost” is just a vibe. This makes traceability a foundational dependency of the feature, not a nice-to-have.

### 8.1 What is captured, per decision / agent task

- Tokens in and out, per model call.
- Cost = tokens × registry price (in/out), per call.
- Attribution: which agent, which task, which decision, which Digital Product.
- The triangle position that produced the call.
- Roll-up: call → task → decision → agent → Digital Product → project.

### 8.2 Two ledgers and the drift between them

| Ledger | Source | Role |
|--------|--------|------|
| Predicted (budget) | Effort prediction up front — extend the existing Build Studio mechanism and widen it so any activity gets an estimate. | Budgeting and the cost projection shown before running. |
| Actual | Real traced token spend after the work runs. | Source of truth; makes cost comparison real. |
| Drift | Predicted minus actual. | A signal in its own right — tells you how good your effort predictions are and improves them over time. |

> **Design instruction.** Do not invent a new estimator. Extend Build Studio’s existing effort-prediction so it covers all activities, and pair every prediction with the corresponding actual so drift can be computed and learned from.

## 9. The Feedback Hook

Every decision / output at all three tiers carries a lightweight **3-state human verdict: thumbs up / mediocre / thumbs down**. This is the realized-quality truth signal. It binds back to the triangle position, the model used, and the traced cost.

The verdict is captured by people over time as real work is done — no LLM-as-judge is required for v1 (it can be added later as an optional, human-overridable assist). The hook must be unobtrusive enough that it is actually used.

## 10. The Benchmark Record

One object joins everything. It is the unit of learning and the basis for model comparison.

| Field group | Contents |
|-------------|----------|
| Intended quality | Triangle position; decoded settings (perspectives, effort mode, tier, verification depth). |
| Model & predicted cost | Model used (from registry); predicted token cost (Build Studio-style estimate). |
| Actual cost | Traced tokens in/out; actual cost; drift vs. predicted. |
| Realized quality | Human 3-state verdict; timestamp; rater context (tier: Mark / we / I). |
| Classification | Task-class label (shared taxonomy) for comparability across runs and installs. |

> **The whole loop in one object.** Intended quality → model + predicted cost → actual cost → realized quality. This record powers post-hoc model comparison (run the same task N ways, compare cost vs. realized quality) and feeds learned defaults back up to the three lenses.

## 11. The Two Learning Loops

Both loops run on the same benchmark record and both feed future “what would Mark / we / I do” defaults with real history rather than guesses.

| Loop | Compares | Improves |
|------|----------|----------|
| Quality loop | Intended quality (triangle) vs. realized quality (human 3-state verdict). | Quality defaults — “we set it to high quality; did we get it?” |
| Cost loop | Predicted cost (Build Studio estimate) vs. actual cost (traced tokens). | Effort-prediction accuracy; the budget ledger. |

**Closing the largest loop:** learned defaults stop being hand-tuned or even single-user-learned. A new user can start with defaults that already encode hard-won experience — which is the thesis at full scale.

## 12. Federated Data Architecture (local → project → cloud)

This is what elevates the feature from a smart knob to a platform asset: a **federated benchmark network** — local-first collection on every install, with opt-in aggregation to a shared layer that becomes collective intelligence about what settings actually work. The “reading and reading and reading” problem is solved by letting the network be the thing that keeps up.

### 12.1 The three levels

| Level | What lives here | Question it answers |
|-------|-----------------|---------------------|
| Local (every install) | Benchmark records live first on the individual environment. Works fully offline; the user owns their data. | “What works for me, on my machine?” |
| Project | Records roll up to a Digital Product / project view — the team’s own aggregate. | “For this product, what settings deliver value?” |
| Cloud (hive mind) | Opt-in, anonymized contribution to a shared pool across all installs. | “Across everyone, for this task class, which model/setting wins on cost for equal quality?” |

### 12.2 The three things this architecture lives or dies on

1. **Privacy — what actually leaves the box.** The contribution payload is metadata, not content: the settings, the model, token counts, the 3-state verdict, and a task-class label — never prompts or outputs. The payload is specified explicitly so it is auditable. Opt-in, per-tier, revocable.
2. **Comparability — a shared task taxonomy.** Aggregation is only meaningful if a “decision” on one install is comparable to one on another. A lightweight task-class classification scheme buckets records correctly.
3. **Trust of the aggregate — weighting / reputation.** Hive data can be gamed or skewed. Weighting and reputation considerations ensure a single noisy install cannot poison shared defaults.

> **The contribution payload (explicit)**
> - INCLUDED: triangle position, decoded settings, model id + tier, tokens in/out, predicted & actual cost, drift, 3-state verdict, task-class label, coarse timestamp.
> - EXCLUDED: prompts, outputs, file contents, identifiable project or customer data, free-text.
> - CONTROL: opt-in per tier (Mark / we / I), revocable, with a local preview of exactly what would be sent.

## 13. Data Model in the DPDM / Digital Product Graph

All of the following are first-class entities so they are auditable and queryable:

- **TrianglePosition** — attached to a Digital Product (default posture) and to individual decisions (override).
- **ModelRegistryEntry** — the open, user-extensible model profiles.
- **CostLedgerEntry** — predicted and actual, with drift, attributed up the roll-up chain.
- **FeedbackRecord** — the 3-state verdict bound to its decision.
- **BenchmarkRecord** — the joined object of Section 10.
- **TaskClass** — the shared taxonomy node enabling comparability.

Each carries the triangle position as a queryable attribute, so the platform can answer questions like “show every quality-weighted decision on this product and its realized verdicts and actual cost.”

## 14. Reuse Contract

The same canonical component and the same criteria are consumed everywhere:

- **Three lenses** (Mark / we / I) render the identical triangle component; only the default source and override scope differ.
- **17-agent topology** reads the active triangle to bias behavior — review depth, model choice, effort mode, verification, retry budget.
- **Per Digital Product** carries a default triangle reflecting its strategic posture.
- **Per decision / task** can override, and every run writes a benchmark record.

## 15. Build Order

1. **Token & cost traceability** — foundational dependency; the cost vertex is meaningless without it. Extend Build Studio for predictions; add actual-token tracing.
2. **Canonical triangle component + translation layer** driven by the open registry.
3. **“What would Mark do?” tier first** — the highest-value investment decisions.
4. **Feedback hook + benchmark record** — close the per-install loop.
5. **Project roll-up + comparison view** — run-the-same-task-N-ways.
6. **“we” / “I” tiers** inherit the component.
7. **Federated cloud (hive mind)** — opt-in, with privacy / comparability / trust specs from Section 12.

## 16. The Interactive Prototype (for review)

To be built alongside this spec once signed off. It will demonstrate:

- A draggable triangle (Cost / Quality / Time) with soft priority, named zones, and a live readout.
- Binding to a seeded multi-provider registry — Claude plus other providers plus a capability-only future-model example.
- A live decode panel: the concrete settings the current position resolves to.
- Predicted-vs-actual cost display, with drift shown.
- The 3-state feedback control (thumbs up / mediocre / thumbs down).
- A comparison view: the same task across two or more models, cost vs. realized quality side by side.

## 17. Open Questions for Review

1. **Preset zones** — do the four named presets (Ship fast / Gold-plate / Lean & cheap / Balanced) match how you think, or would you name them differently?
2. **Task taxonomy** — how granular should the shared task-class scheme be? Coarse buckets aggregate sooner; fine buckets compare more precisely.
3. **Hive-mind weighting** — should contribution and trust be reputation-weighted from day one, or start equal-weight and add reputation later?
4. **Frontier tier** — how should the registry handle access-restricted tiers (e.g. where a frontier model is temporarily unavailable) so the translation layer degrades gracefully?
5. **Effort-prediction reuse** — confirm the Build Studio estimator is the right base to extend, and identify the activities it does not currently cover.

---

*End of draft. The prototype is held until sign-off on this spec.*
