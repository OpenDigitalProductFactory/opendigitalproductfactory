# Layer 2 — Situational-Aware Decision Weighting — Design (for review)

- **Status:** draft for operator review (no registry change until approved)
- **Date:** 2026-06-05
- **Backlog:** `BI-E1267C6D`
- **Builds on:** Layer 1 (`BI-B69F0464`, merged), golden-decision baseline (`BI-8D4C6D14`, merged)
- **Spec lineage:** `2026-05-24-founder-kernel-evolution-discipline-design.md` (closed dimension registry, ring scope), `2026-06-05-situational-aware-decision-weighting-design.md` §4

## 1. Why

Operator framing: *"When these situations arise, enough dimensions must be provided to make the right call. If production is down and customers are impacted, a short-term fix is preferable to a long-term architectural change. Situational awareness is how we weight one aspect over another, and we don't capture it well enough today."*

Today the kernel cannot distinguish *normal development* from *prod-down-with-customers-impacted*: `speed_to_value` is a property of the **option**, not the **situation**, so the same static principle vectors produce the same answer in both worlds. Layer 1 made the kernel correctly prefer the proper fix; Layer 2 lets a *justified* quick fix win when the situation genuinely warrants it.

## 2. Design — situational dimensions + situational commandments

### 2.1 New governed dimensions (closed registry addition)
| Dimension | Meaning | Orthogonality |
|---|---|---|
| `incident_severity` | option addresses an active, severe, customer-impacting incident | distinct from `public_safety` (harm magnitude, not active-incident urgency) and `blast_radius` (change risk) |
| `customer_impact_active` | customers are actively impacted *right now* | distinct from `incident_severity` (an incident can be severe but not yet customer-visible) |
| `time_criticality` | the situation worsens with delay (bleeding) | distinct from `speed_to_value` (how fast the *option* delivers, regardless of situation) |

Per kernel-evolution-discipline each new dimension needs ≥2 principles using it: the three situational principles below each lead on one, and existing commandments (`destructive-actions-require-explicit-go`, `human-in-the-loop-at-phase-boundaries`) gain a small `incident_severity`/`time_criticality` term so they relax appropriately under a live incident — satisfying the ≥2 rule and keeping the dimensions load-bearing.

### 2.2 New situational principles (one lead-dimension each)
Keyed **purely on situational dimensions** so they contribute ~0 when no incident is present (zero normal-time leak):
- `restore-service-first-under-active-incident` — `{incident_severity: 1.0, public_safety: 0.3}`
- `minimize-active-customer-impact` — `{customer_impact_active: 1.0, public_safety: 0.4}`
- `respect-incident-time-pressure` — `{time_criticality: 1.0}`

**Aggregate, not amplify.** Three situational commandments at normal weight 1.0 *aggregate* to flip the call during a genuine incident — the same way the ~20 soundness/process commandments aggregate the other way in normal times. This deliberately avoids a single heavily-weighted (~3×) situational principle, which the back-test showed is what a one-principle approach would require and which reads as a hack.

### 2.3 Maximalism guard — a cost principle (no new dimension)
`cost_efficiency` already exists in the registry (PR #926) but **no principle scores it**. Add:
- `prefer-cost-effective-sound-solution` — `{cost_efficiency: 1.0}`

so a cheap, sound, additive option beats an expensive rebuild *on the merits*, not via weight tuning.

## 3. Architectural prerequisite — load core/contextual structured vectors

A situational rule is conceptually **contextual** (it only matters in incidents), not universal doctrine. But today only `commandment`-tier principles load their signed vector — `core`/`contextual` are retrieved from Qdrant **without** the vector and fall to semantic alignment (RC2, the same defect that made Layer 1's `proper-fix` inert until promotion). So a situational principle would have to be mis-tiered as a `commandment` just to score.

**Recommended:** fix the retrieval so `core`/`contextual` principles carry their signed vectors (load from Postgres, or include the vector in the Qdrant payload). This lets situational rules be `contextual` (correct tier), and — more importantly — **un-inerts the 30+ existing core principles** (`fix-the-seed`, `research-before-implementing`, the proper-fix companions, …) that currently contribute exactly 0 to every decision. This is the architecturally-correct foundation; it broadens decision behavior, so the golden baseline must be re-blessed when it lands.

**Alternative (lighter):** ship the situational principles as `commandment`-tier (they self-silence via incident dimensions = 0, so "always applied" is harmless in practice). Faster, but leaves the core tier inert and the tier semantics impure. **Operator decision required.**

## 4. Engine validation (real full corpus, 20 commandments + proposals)

Driven through the real `decide()` engine with the live corpus loaded from `docs/founder-kernel/wiki/principles/*.md`:

| Scenario | Winner | Composites | Margin |
|---|---|---|---|
| **NORMAL** (no incident) | ✅ `proper-seed-fix` | 10.15 vs 8.65 | 1.50 |
| **INCIDENT** (prod down, customers impacted) | ✅ `quick-restore` | 11.09 vs 10.82 | 0.27 (high) |
| **GUARD** (cheap-sound vs expensive rebuild) | ✅ `cheap-sound-additive` | 12.49 vs 10.50 | 1.99 |

Same kernel, same options modulo the situation. Situational principles silent in NORMAL; aggregate to flip INCIDENT; cost principle decisively holds the GUARD.

## 5. Golden panel — Layer 2 acceptance baselines

Add to `apps/web/lib/decision/golden-decisions.ts`:
- `incident-prod-down` → expected winner `quick-restore` (the situational acceptance gate)
- (the `cheap-sound-vs-rebuild-guard` already exists; re-bless with the cost principle)

These become the corpus-aware regression gates for Layer 2 — a future change that breaks situational awareness fails CI.

## 6. Open decisions for operator review

1. **Retrieval fix vs commandment-tier shortcut** (§3) — recommended: fix retrieval (un-inerts the core tier too). Heavier, re-baselines the kernel.
2. **Dimension count** — 3 situational dimensions proposed; could start with `incident_severity` alone (lower governance surface) at the cost of a heavier single principle.
3. **Situational signal source** — modelled as option features ("how well this option addresses the active incident"). Alternative: a context flag on the decision call that the handler expands into features. Option-features keeps the engine pure.

## 7. After review

On approval: file the implementation plan (`dpf-writing-plans`), add dimensions + principles via the governed authoring flow, run `principle_decide` recursively to scope each principle, wire the golden incident scenario, and re-bless the baseline. No registry change before then.
