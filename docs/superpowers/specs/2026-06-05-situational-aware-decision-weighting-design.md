# Situational-Aware Decision Weighting — Design

> **Amended 2026-07-23** by [`2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`](2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md).
> REINFORCED. RC2 is not only a situational-weighting blocker — it invalidates structured scoring for 70 of 95 principles (60 core + 9 contextual + 1 heuristic) and is the prerequisite for the tier rebalance. A corpus-wide dimension census is provided there. `cost_efficiency` remains used by zero principles, as this spec predicted.
>
> **Amended 2026-07-23 (second)** — RC2 and RC3 are **resolved**; Layer 2 is **split**.
> - **RC2/RC3 fixed** under `BI-E1267C6D`. Qdrant stays the relevance index and the authoritative `WikiPage` rows are rehydrated from Postgres by `pageId`, so core/contextual principles carry their authored signed vector *and* their `principleWeight` override into structured scoring. §4's "architectural prerequisite" is discharged: **a situational principle no longer has to be promoted to `commandment` to score structurally.** The Layer 1 promotion of `proper-fix-over-quick-fix` stands on its own governance merits (§3) and is not revisited.
> - **RC3 was inert twice.** The earlier fix passed `hit["principleWeight"]` from the Qdrant payload, but `storeWikiPage` never writes that key — so the override still always fell to the tier default. §5's RC3 entry understated this: it was not "ignored on the core branch", it was unreachable from that data source at all.
> - **New root cause, RC6** — not predicted by this spec. `maxPrinciples`, documented as a cap on the core/contextual set from Qdrant, was applied to the **merged, commandments-first** candidate list. Once the commandment corpus outgrew the cap this silently starved the tail: a live call with 41 commandments against a default cap of 20 scored 20 commandments alphabetically and dropped 21 commandments plus every core hit. **This is RC4's exact failure shape one layer up** — a cap whose semantics drifted from its comment — and it meant RC2's fix would have been unobservable had it shipped alone. A recurrence guard now warns when commandment retrieval returns exactly its limit (41 of 50 slots were in use).
> - **§7's boundary note is now live.** With core/contextual carrying structured vectors, the golden-decisions gate no longer mirrors live retrieval — it still scores commandments only. Its docstring has been corrected to state the divergence rather than claim faithfulness, and the live/integration arm §7 anticipated is filed as `BI-4C0F9E21`.
> - **Layer 2's remaining scope** (`incident_severity`, `restore-service-first-under-active-incident`, a cost-sensitivity principle) moved to `BI-8D3E7757` under `EP-REDUCTION-GEAR-ARCH`. It must now follow spine reduction (`BI-AA7D80FE`), which may itself delete `cost_efficiency` as the one axis no principle scores — confirm the axis survives before authoring against it.

- **Status:** draft (Layer 1 implemented in the originating PR; Layer 2 design-review-gated)
- **Date:** 2026-06-05
- **Owning epic:** [`EP-REDUCTION-GEAR-ARCH`](../../../) — Reduction Gear Architecture / founder-kernel evolution
- **Related (done):** `BI-3C1A6451` (semantic-fallback server-side embedding fix, PR #1119), `BI-746268A1` (founder-kernel evolution discipline)
- **Backlog:** `BI-B69F0464` (Layer 1, this PR), `BI-E1267C6D` (Layer 2, design-gated), `BI-A9E9ADCB` (kernel-scoring introspection tool + RC3)
- **Origin:** Operator report — "the kernel recommends the *quick fix* over the *proper fix* in a normal quick-vs-proper decision; architecture/proper-fix doctrine is out-voted." Operator refinement — "the deeper gap is *situational awareness*: a short-term fix is correct when production is down and customers are impacted; we don't capture enough dimensions to make that call."

---

## 1. Problem — verified, not assumed

A live `mcp__dpf__principle_decide` call (population `in_platform_coworker`, `ringScope: [universal-ring]`) on a textbook quick-vs-proper decision (runtime special-case patch vs seed fix, **no active incident**) returns:

| Option | Composite | Confidence |
|---|---|---|
| **quick-runtime-patch** (the shortcut) | **4.685** | high |
| proper-seed-fix (the sound fix) | 4.355 | — |

**The kernel actively recommends the shortcut**, margin 0.330, high confidence. The contribution ledger pins three structural root causes (all deterministic; embedding state does not change them):

### RC1 — Architecture is one neutral-on-shortcuts vote among ten process commandments
`Architecture Over Shortcuts` (commandment, the lone structured voice for soundness) scores **−0.009** on the shortcut vs **+0.707** on the proper fix. It does not *oppose* the shortcut, it *abstains* on it — so no `commandmentConflict` flag fires — while nine process/governance commandments (DCO `0.733`, Never Fabricate `0.692`, Build Gate `0.654`, PR-against-main `0.636`, never-ask-user `0.661`, …) all happily reward a clean, fast, well-evidenced quick fix. Architecture is outvoted 1-vs-9.

### RC2 — The dedicated `proper-fix-over-quick-fix` principle is structurally inert
`proper-fix-over-quick-fix` carries a carefully-authored signed vector
`{long_term_maintainability:0.9, schema_grounding:0.5, blast_radius:-0.3, speed_to_value:-0.4}` — but it is tier **`core`**, and the `principle_decide` handler sources core/contextual principles **from Qdrant, whose payload omits the signed vector** (`apps/web/lib/mcp-tools.ts:12446-12456`). Core principles therefore fall to **semantic** alignment, never structured. In the live ledger it (and every other core principle: `fix-the-seed`, `research-before-implementing`, …) contributed **exactly 0.000**. The authored intent of the entire core tier never reaches structured scoring.

> Note: `BI-3C1A6451` already wired server-side embeddings so the semantic path *can* produce non-zero cosine; the live 0.000 here is consistent with the embedding service returning nothing in this environment. Regardless of embedding health, **a precise quick-vs-proper judgment needs the signed structured vector, not a fuzzy direction-text cosine** — so RC2 stands on structural grounds.

### RC3 — `principleWeight` override is silently ignored on the core/contextual branch
`resolveWeight(tier, override)` honors a per-principle `principleWeight` override, but the handler only passes the override on the **commandment** branch; the core/contextual branch passes `undefined` (`mcp-tools.ts:12450-12452`). A weight override authored on a `core` principle is silently dropped.

### RC4 (latent, independent) — Commandment retrieval silently truncates 9 of 19 commandments
The handler retrieves commandments with a hardcoded **`limit: 10`** (`mcp-tools.ts:12312`) ordered by `lastReviewedAt desc, title asc`. There are **19** commandment principles. The live call returned exactly 10 — i.e. truncation is active: ~9 commandments are dropped from every universal-ring decision, contradicting both the inline comment ("Always applied") and the 2026-05-22 model in which **commandments are uncapped doctrine that should shape every relevant decision**. The `limit: 10` (and the stale `wiki-store.ts:545` comment "every commandment (cap 10)") is a leftover from when commandments were capped at 10.

### RC5 (the operator's reframe) — No situational dimensions
The 14-axis `PRINCIPLE_DIMENSIONS` registry has no axis for the *situation* (active incident, customer impact, time-criticality). So the kernel cannot know that *production-down-with-customers-impacted* legitimately flips the call toward the fast fix. `speed_to_value` is a property of the *option*, not the *situation*. The same static principle vectors cannot encode "soundness wins normally, but restoration wins during an incident."

---

## 2. What we explicitly rejected — aggressive weight escalation

The operator's first instinct (and the original task framing) was to crank `architecture`/`proper-fix` weight to ~2.5–3.0×. A back-test on the real `decide()` engine with real commandment vectors (committed as `apps/web/lib/decision/situational-weighting.backtest.test.ts`) shows this **breaks the operator's own anti-maximalism guard**: because `architecture-over-shortcuts` rewards slowness (`speed_to_value:-0.4`), amplifying it amplifies "the bigger/slower sound option wins." At ≥~1.75× a slightly-more-maintainable but far more expensive rebuild starts beating a cheap, sound, additive fix. Pure weight escalation forces an unacceptable trade-off between *aggressive-on-shortcuts* and *no-maximalism*. **Rejected.**

---

## 3. Layer 1 — ship now (in the originating PR)

The minimal, architecturally-clean fix that flips the live decision **without any weight gymnastics and with zero maximalism risk**:

1. **Raise commandment retrieval `limit` 10 → 50** (`mcp-tools.ts`), matching `listPrinciplesByTier`'s own default and the uncapped/always-applied model; fix the stale `wiki-store.ts:545` comment. Fixes RC4 and is a prerequisite for #2 to reach the decision.
2. **Promote `proper-fix-over-quick-fix` `core → commandment`** (+ a source, required for commandment tier). This moves it onto the Postgres/structured path so its authored vector finally loads, at commandment weight 1.0. Fixes RC2 for this principle.

**Why this is sufficient (verified math).** Promoting `proper-fix` adds its structured contribution: **+0.50 on the proper fix / −0.05 on the shortcut**. New composites: proper `4.86` vs quick `4.64` — **proper wins, margin 0.22 > tieMargin 0.20, high confidence.** No `architecture` weight override is introduced, so the anti-maximalism guard is untouched (and `proper-fix`'s `blast_radius:-0.3` actively penalizes bloated rebuilds).

**Justification for the promotion (governance, per AUTHORING §8A).** `proper-fix-over-quick-fix` is the operating companion to the existing `architecture-over-shortcuts` *commandment*; it carries an explicit-operator-authorization rule ("never take a shortcut without an explicit go"), structurally parallel to the `destructive-actions-require-explicit-go` commandment. Promoting it makes the operating default non-negotiable doctrine, which is the operator's stated standing rule ("I will always decide on proper fix over quick fix unless otherwise specified"). The two principles are complementary, not duplicate: `architecture` is the *why-over-time* / conflict-resolution doctrine; `proper-fix` governs *option ordering* and the *authorization gate*.

**Deferred from Layer 1:** RC3 (weight-override ignored on core branch) is not needed once `proper-fix` is a commandment; it is captured as a follow-up so authored core-weight overrides stop being silently dropped.

---

## 4. Layer 2 — situational awareness (design-review-gated)

Proven in the same engine (back-test): add a situational dimension + a situational principle and the **same kernel** makes the **right** call in both worlds.

- **New governed dimension(s):** `incident_severity` (and candidates `time_criticality`, `customer_impact_active`) added to `PRINCIPLE_DIMENSIONS`. Per kernel-evolution-discipline, each new dimension needs an orthogonality justification and ≥2 principles that use it.
- **New situational principle** `restore-service-first-under-active-incident`, keyed on `incident_severity` (+ `public_safety`), deliberately **not** on raw `speed_to_value` so it stays silent when there is no incident. Back-test: in a normal situation both options score ~0 on `incident_severity` → the principle contributes ~0 → architecture/proper-fix dominate → proper fix wins; in a prod-down incident the fast-restore option scores high on `incident_severity` → the situational principle outweighs the shortcut penalty → quick restore wins.
- **Architectural prerequisite (RC2 generalized):** a situational principle that needs structured `incident_severity` scoring must be a **commandment**, because today only commandments load their structured vector (core/contextual come from Qdrant without vectors). Layer 2 should therefore *also* decide whether to fix the retrieval split so core/contextual principles carry their signed vectors (load from Postgres, or include the vector in the Qdrant payload) — otherwise the registry's "richer dimensionalization" is only ever available to commandments.
- **Maximalism handled by dimension, not weight:** the registry already defines `cost_efficiency` (PR #926) but **no principle scores it**. A cost-sensitivity principle that rewards `cost_efficiency` lets a cheap-sound option beat an expensive rebuild on the merits, instead of via weight tuning.

Layer 2 ships behind design review because it mutates the closed dimension registry and (optionally) the retrieval architecture.

---

## 5. Follow-up backlog (separate concerns)

- **Kernel-scoring introspection MCP tool** — surface, for a given decision, which commandments were dropped by the retrieval cap, which principles fell to semantic mode, and the full per-axis ledger, so weighting regressions are observable rather than silent. (Originally suggested alongside this work; filed separately per one-concern-per-pr.)
- ~~**RC3** — honor `principleWeight` override on the core/contextual branch (or document that overrides are commandment-only).~~ **Done** (`BI-E1267C6D`). The override is read from the rehydrated Postgres row; reading it from the Qdrant payload could never have worked, because that key is not written.
- ~~**RC2 (structural)** — load core/contextual signed vectors so authored core-principle vectors stop being inert.~~ **Done** (`BI-E1267C6D`), together with **RC6** (the merged-list cap) which had to ship in the same change for RC2 to be observable at all.

---

## 6. Acceptance criteria (Layer 1)

- Committed back-test drives the real `decide()` engine with the real commandment vectors and asserts: (a) baseline reproduces the shortcut winning; (b) after promotion the proper fix wins with margin > tieMargin; (c) the cheap-sound-vs-rebuild anti-maximalism guard holds.

- `wiki_lint` clean on the promoted principle (commandment requires direction + vector + ≥1 source; no new similarity/coherence blocker).
- `pnpm typecheck` + the decision/wiki vitest suites pass.
- Functional (post-merge / turnover): after the kernel reseeds, a live `principle_decide` on the §1 scenario recommends the proper fix.

## 7. Corpus-aware golden-decision baseline (regression gate)

The frozen-ledger back-test (§6) proves the *mechanism* with fixed inputs, but is blind to corpus growth. Because the kernel is a living corpus — every new/edited principle and every new dimension shifts the weighted-vector aggregate — we also need a baseline that **re-scores canonical decisions against the real, current corpus** and fails when one silently flips.

`apps/web/lib/decision/golden-decisions.{ts,test.ts}` + `golden-decisions.baseline.json`:

- Loads the real commandment corpus from `docs/founder-kernel/wiki/principles/*.md` via the canonical `parseWikiFrontmatter` (`@dpf/db`) — so the test *is* the corpus, and any principle/dimension change re-scores automatically.
- Mirrors live retrieval for a **universal-ring** caller: full kernel, no ring filtering, population filter only, commandment tier only (core/contextual contribute 0 until Layer 2 loads their vectors). No `limit` — all commandments consulted.
- Scores a curated, growable scenario panel through the real `decide()`; **hard-fails** on a flipped winner or a margin below `marginFloor`; **soft-reports** numeric/contributor/corpus-size drift for review.
- `UPDATE_GOLDEN_BASELINE=1` regenerates the snapshot — so accepting a changed baseline is a deliberate, reviewed act.

**Verified against the full current corpus (20 commandments):**

| Scenario | Winner | Composites | Margin |
|---|---|---|---|
| `quick-vs-proper-normal` | ✅ `proper-seed-fix` | 10.12 vs 8.18 | 1.94 |
| `cheap-sound-vs-rebuild-guard` | ✅ `cheap-sound-additive` | 11.14 vs 10.20 | 0.94 |

Two corrections this surfaced: (1) the *real* post-fix margins (~1.9 / ~0.9) are larger than the PR's truncated-10 prediction (~0.22) because the full corpus is now consulted (RC4 un-truncation); (2) the anti-maximalism guard **holds against the full corpus** — its pre-merge pass was *not* an artifact of truncation. A faithful baseline must replicate real retrieval + use the canonical parser; a naive reimplementation produced a false "guard breaks" by silently dropping the process commandments.

Boundary: this gate covers **aggregation** drift (which principles are in scope → how they combine). It does not cover **retrieval-relevance** drift (Qdrant deciding which *core* principles surface) — that only starts mattering once Layer 2 makes core/contextual principles carry structured vectors, at which point a live/integration arm is added.
