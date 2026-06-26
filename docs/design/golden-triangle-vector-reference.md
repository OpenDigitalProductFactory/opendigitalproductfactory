# Golden Triangle — what each vector position configures

*Reference — current as of 2026-06-26. Source of truth: `apps/web/lib/golden-triangle/compile.ts` (the compiler) — this doc mirrors it; if they ever disagree, the code wins and this doc is the bug.*

This is the operator/engineer-facing answer to "what actually changes when I move the
triangle?" — the exact parameters and the features turned on/off at each position.

## How it works (the flow)

```
Cost / Quality / Time posture (the vector)
        │
        ▼  compileGoldenTrianglePolicy()   ← the only place the mapping lives
        │
        ├── PostureOverride      → model tier, effort, reasoning depth, budget class, max latency
        └── OrchestrationBudget  → verification depth, retry budget, deliberation pattern (review/debate)
        │
        ▼  applied at three seams (never re-implemented — fed in)
        ├── Routing            inferContract() — picks the model + effort for every coworker turn
        ├── Deliberation       the inline review / debate pass on high-effort coworker turns
        └── Build right-sizing resolveBuildSizing() — the build's tier + review, floored by sensitivity
```

The three axes are **not literal zero-sum math** — they're a posture the compiler reads.
The **presets sit at the corners** (Assured = Quality, Frugal = Cost, Fast = Time,
Balanced = centre); the space **between** them compiles continuously. **Maxing a
dimension is that dimension at full strength** — for Quality, the top of the ladder is
a multi-perspective *debate*, above the single *review* the Assured preset buys.

## Presets — exact settings

| Posture | Model tier | Effort | Reasoning | Budget class | Verification | Retries | Deliberation | Latency target |
|---|---|---|---|---|---|---|---|---|
| **Balanced** | — | — | — | — | none | — | none | — |
| **Fast** | — | low | low | — | none | 1 | none | 30s |
| **Frugal** | adequate | low | low | minimize-cost | shallow | 1 | none | — |
| **Assured** | frontier | high | high | quality-first | deep | 3 | **review** | — |

"—" = no override (the platform/agent default stands). **Balanced emits *no* deltas** —
it is byte-identical to the system with the triangle switched off (the cold-start
guarantee).

## Custom positions — by dominant axis + how far you push

A custom posture snaps to its **dominant axis** and reads its **intensity** (the
normalized weight of that axis):

| Where the dot is | Tier | Effort | Reasoning | Budget | Verification | Retries | Deliberation |
|---|---|---|---|---|---|---|---|
| No clear lean (every axis < 0.40) | — | — | — | — | none | — | none → **= Balanced** |
| **Quality** 0.40–0.55 ("leaning") | strong | medium | medium | quality-first | shallow | 2 | review |
| **Quality** 0.55–0.85 ("Quality-first") | frontier | high | high | quality-first | deep | 3 | review → **= Assured** |
| **Quality** ≥ 0.85 ("**Max Quality**") | frontier | **max** | high | quality-first | deep | 3 | **debate** |
| **Cost** 0.40–0.55 ("leaning") | adequate | low | low | minimize-cost | shallow | 1 | none |
| **Cost** ≥ 0.55 ("Max Cost") | adequate | low | low | minimize-cost | shallow | 1 | none → **= Frugal** |
| **Time** 0.40–0.55 ("leaning") | — | low | low | — | none | 1 | none (latency 60s) |
| **Time** ≥ 0.55 ("Max Speed") | — | low | — | — | none | 1 | none → **= Fast** |

The only thing the very top of Quality adds over Assured is **max effort + debate**
(vs. high effort + review) — that's the "Max Quality" corner.

## Features turned ON / OFF by the vector

| Feature | Enabled when | What it does |
|---|---|---|
| **Self-review** | deliberation = `review` *or* `debate` (Quality ≥ ~0.40, incl. Assured) | A distinct reviewer pass critiques the draft and returns an improved reply (or approves it). On a coworker turn this is one extra, bounded, fail-open call. |
| **Debate** | deliberation = `debate` (Quality ≥ 0.85 / "Max Quality") | Instead of a single review, an adversarial pass steelmans the case *for* and *against* the draft and synthesizes the stronger answer. |
| **Verification** | `shallow` (Frugal / mild leans) or `deep` (Assured / Quality-first+) | How hard the run checks its own work; `none` skips it. |
| **Stronger model** | tier raised to `strong` / `frontier` (Quality regions) | Routes to a more capable model; Cost pulls it down to `adequate`. |
| **More thinking** | effort `high` / `max` (Quality); `low` (Cost / Time) | The per-call reasoning/thinking budget — the primary Quality↔Cost↔Time lever. |
| **Retry budget** | 1 (Fast/Frugal) → 3 (Assured/Max Quality) | How many transient/fabrication retries a run may spend. |
| **Latency cap** | set by Fast (30s) / Time-lean (60s) | A target the router honors when picking an endpoint. |

## Hard limits that override the vector (precedence)

The posture is a *request*; these clamp it (and the UI says so when they do):

1. **Residency** — never relaxed. Restricted data stays local even at Fast/Frugal.
2. **Minimum tier floor** — an agent/task (or, for builds, the **deliverable-sensitivity**
   axis) can raise the tier; the posture can't drop below it. So a Cost dial cannot
   discount a sensitive deliverable below its floor.
3. **Max-latency ceiling** — clamps the latency target.
4. **Model availability** — if the requested tier isn't reachable, the compiler clamps
   to the best available, or **defers / blocks** (fail-closed) rather than silently
   routing to an unsafe path.

## Where the posture is read

- **Per coworker** — the priority dock at the composer sets that coworker's posture; it
  feeds routing (`routed-inference`) on every turn and selects the review/debate pass.
- **Platform / org default** — the "Priority & Models" surface; coworkers inherit it
  unless they set their own (agent → org → platform → Balanced).
- **Builds** — the build posture (default **Quality**) compiles through the same
  compiler into the build's model tier + review intensity, floored by the change's
  derived sensitivity (EP-QUALITY-RIGHTSIZING).

## Plain-language echo in the UI

The control never drifts from this table: it renders the **compiled** result live —
the label (`Max Quality`, `Quality-first`, `Frugal`, …), a one-line summary, and a chip
row showing the actual `tier · effort · verification · deliberation`, plus the
axis-guide line explaining that each corner is that dimension at full strength.
