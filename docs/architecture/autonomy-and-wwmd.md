---
title: Autonomy, WWMD, and trusted coworker decisions
description: How DPF's three-layer decision substrate (WWMD, WWWD, WSID), its scoring math, the JSI weight layer, and the proactivity and trust dials let AI coworkers earn autonomy without silently overreaching.
---

DPF is not trying to make AI coworkers autonomous by removing humans from the loop. It is trying to make autonomy **gradual, inspectable, and recoverable** — and to make every step of that gradient something an owner can see, question, and reverse.

That only works if judgment is not trapped in chat. In DPF, judgment is a platform capability: a **Decision Perspective Gate** that a coworker calls when it hits an ambiguity, and that returns an outcome with confidence, cited sources, and an append-only audit record. The same gate is callable from Build Studio, in-product coworkers, and external MCP clients under the same governance rules.

This page explains the whole substrate: the three layers of decisions, the vector retrieval and scoring math underneath them, the Job-Specific Intelligence (JSI) weight layer that refines scoring over time, and the dials — proactivity and earned trust — that move a coworker from passive assistant to active participant without ever widening its authority.

## Why this matters

AI coworkers hit open questions constantly:

- Should this feature be generalized for the Hive Mind or kept local to one install?
- Is this a quick fix, or does it violate an architectural principle?
- A customer wants non-standard payment terms — approve, counter, or decline?
- What would a competent professional in this role do here?
- Does a low-risk action fit the autonomy policy, or does a human need to decide?

Without a shared decision substrate, every agent answers those questions from prompt memory, recent conversation, or model preference. That does not scale. At scale, trust requires the coworker to show:

- which layer of doctrine owned the question — and that no other layer answered it
- which principles were consulted, and which options were compared
- which criteria pulled the answer up or down, and by how much
- how confident the gate was, and why
- where the answer was too close, stale, risky, or under-supported
- who approved, overrode, escalated, or deferred the decision

This is the step from "the agent seems reasonable" to "the platform can explain how this recommendation was reached — and can show you it had the authority to make it."

## The three layers of decisions

DPF partitions decisions into **three scopes that do not inherit each other's authority**. All three are the same engine — retrieve, frame options, score, guardrail, record — pointed at three different bodies of doctrine:

| Layer | Shorthand | Answers | Doctrine it consults | Gate |
|-------|-----------|---------|----------------------|------|
| **WWMD** | *What Would Mark Do?* | What would the **founder / platform** do here? | The founder-kernel wiki: tiered principles (commandment / core / contextual) | `principle_decide` |
| **WWWD** | *What Would We Do?* | What would **this organization** do here? | The org's own governed corpus: stance pages, spend ceilings, recorded rulings | `evaluate_org_business_decision` |
| **WSID** | *What Should I Do?* | What would a **competent professional in this role** do here? | A per-profession, source-traced corpus (23 profession families and growing) | `evaluate_profession_decision` |

The load-bearing rule is **subsidiarity**: every decision is resolved in the scope that owns it, and *no scope's doctrine binds another as authority*. A neighboring scope is advisory until the owning scope has spoken. The kernel principle [`decisions-belong-to-their-scope`](../founder-kernel/wiki/principles/decisions-belong-to-their-scope.md) states it directly, and the routing contract injected into every in-portal coworker prompt enforces it verbatim: *"never substitute the founder/platform doctrine as the organization's authority — platform doctrine is advisory to a business decision, not binding."*

One honesty detail matters for audit: the ledger's audit tier derives from the **gate that was called**, not from whatever profile the material resolution fell back to. A profession (WSID) question that had to borrow platform doctrine for material still files as a WSID decision — otherwise the tier would read empty and an operator would wrongly conclude the gate is never used.

Code references:

- [`decision-routing-block.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/tak/decision-routing-block.ts) — the routing contract in every coworker prompt
- [`org-business-gate.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/org-business-gate.ts), [`profession-gate.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/profession-gate.ts) — the WWWD and WSID gates

### WWMD — the platform's doctrine

WWMD is the founder kernel: tiered principles authored, reviewed, and versioned in the governed wiki. Retrieval for `principle_decide` splits **relevance from authority**:

- **Commandments always come from Postgres** — the authoring store — and are always in scope. They are never subject to a similarity search deciding whether they "apply."
- **Core and contextual principles are found by vector search in Qdrant**, which ranks relevance — core principles top-K ranked, contextual principles additionally gated by a cosine-similarity threshold (default `0.75`) so narrow operational rules only enter when genuinely close to the question.
- **A Qdrant hit alone can never score.** The vector index nominates; the real principle rows — vectors, tiers, weights — are fetched from Postgres by page id. Phantom hits (index entries whose page no longer exists) are detected and dropped, and their count is reported, because a vector index that disagrees with the authoring store is itself a finding.

This split — *Qdrant is the relevance index, Postgres is the authority* — is what keeps semantic search from quietly becoming a decision-maker.

### WWWD — your organization's business decisions

WWWD is the layer that matters for **corporate decisions**: pricing exceptions, customer goodwill, credit terms, growth-versus-stability calls, spend approvals. Its doctrine is the organization's own corpus, not the platform's:

- **Stance pages** in the org's wiki overlay — seeded at onboarding along five starter stance vectors (`customer-goodwill`, `pricing-integrity`, `growth-vs-stability`, `quality-bar`, `spend-authority`, each with optional USD ceilings) and authored by the organization from then on.
- **Authoring never auto-grants authority.** A new stance is a draft; material climbs a promotion ladder — `unconfirmed` (confidence weight 0.6) → `confirmed` (0.9) → `ruled` (1.0) — through owner review, and never silently downgrades.
- The gate reports `orgProfileSelected` honestly: it is true only when the org's **own** profile decided, never when the platform's doctrine was used as an advisory fallback.

**A corporate-decision example.** A repeat commercial customer asks for net-60 payment terms instead of standard net-15 on a $12k job (`riskTier: high`). The coworker frames three options — approve net-60, counter at net-30 with a deposit, decline. The gate retrieves against the org's WWWD corpus and finds it thin: no approved credit-terms material exists. Platform product guidance *would* match, but by the non-inherit rule it is advisory only. With zero applicable org material, low confidence, and a high risk tier, the gate returns **`escalate`** to the business owner with the three framed options and the empty-coverage explanation — it will not fabricate a credit policy the organization never authored.

Then the loop closes: the owner's resolution ("net-30 with a 25% deposit for accounts over 12 months old") is captured as draft WWWD material. Once promoted, the *next* time this class of question arises the gate retrieves real org doctrine and can return `recommend`, citing the org's own policy. **This is how the graph gets built**: the corpus starts sparse by design, and every escalation a company resolves becomes doctrine its coworkers can cite. Honest escalation early is the price of trustworthy recommendation later.

### WSID — the profession's craft

WSID answers craft questions with **source-traced professional doctrine** instead of model memory. Each profession family (data architect, DevOps, customer success, UX design, and 20 more under `docs/professions/`) has a corpus of wiki pages distilled from verifiable sources — standards bodies, professional bodies of knowledge — seeded into the platform and owned by a `wsid-<profession>` decision profile.

How retrieval works today is deliberately boring, and that is a feature: the coworker's **agent identity** maps to a profession family; the family selects its job-specific corpus pages; a **deterministic lexical ranker** scores them against the question and injects token-bounded, cited excerpts into the coworker's context. For small per-family corpora this needs no vector sidecar, works on a cold install, and is fully unit-testable. Embedding the profession corpus into the vector index is a planned extension as corpora grow — the retrieval contract stays the same, only the ranker changes. When retrieval comes back empty or low-relevance, that miss is recorded as a **growth gap**, so profession corpora grow from real use rather than speculation.

**A craft example.** A build coworker adding an `Invoice` table must choose a monetary column type: `FLOAT`, `DECIMAL(12,2)`, or integer cents. The data-architect corpus carries a commandment-tier page ("use exact numeric types for money", traced to ANSI SQL) and supporting material from DMBOK. Scoring returns `DECIMAL(12,2)` as the winner with integer cents a close second — and critically, `FLOAT` triggers a **commandment conflict flag**: a commandment-tier principle contributes strongly negatively to it, so even if a prompt nudged the model toward `FLOAT` "for performance," the gate marks it as violating professional doctrine, with the source cited.

Full end-to-end walkthroughs of all three layers, with their ledger rows, are in [Decision Perspective in Practice](/user-guide/ai-workforce/decision-perspective-in-practice).

Code references:

- [`principle-decide-pack.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/mcp/packs/principle-decide-pack.ts) — WWMD retrieval, relevance/authority split, phantom-hit detection
- [`profession-corpus.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/profession-corpus.ts) — WSID job-specific corpus retrieval
- [`seed-profession-corpus.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/db/src/seed-profession-corpus.ts) — profession corpus seeding
- [`stance-promotion.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/stance-promotion.ts) — the WWWD material promotion ladder

## The decision stack at a glance

<figure>
<svg viewBox="0 0 880 760" role="img" aria-labelledby="decision-stack-title decision-stack-desc" style="width:100%;height:auto;max-width:880px">
  <title id="decision-stack-title">The DPF decision stack</title>
  <desc id="decision-stack-desc">
    An open question is routed to the scope that owns it: WWMD platform doctrine,
    WWWD the organization's own stance corpus, or WSID the profession's job-specific
    corpus. All three feed one scoring engine (contribution equals tier weight times
    alignment), then guardrails, then one of four outcomes. Autonomy dials govern how
    the coworker may act on the outcome; every call writes an append-only ledger row,
    and resolutions flow back to grow the doctrine.
  </desc>
  <defs>
    <marker id="ds-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="var(--accent, #6aa9ff)"></path>
    </marker>
  </defs>
  <g fill="var(--surface, #14181d)" stroke="var(--border, #262d36)" stroke-width="2">
    <rect x="250" y="16" width="380" height="58" rx="14"></rect>
    <rect x="150" y="112" width="580" height="46" rx="14"></rect>
    <rect x="30" y="204" width="256" height="140" rx="14"></rect>
    <rect x="312" y="204" width="256" height="140" rx="14"></rect>
    <rect x="594" y="204" width="256" height="140" rx="14"></rect>
    <rect x="150" y="392" width="580" height="64" rx="14"></rect>
    <rect x="150" y="494" width="580" height="46" rx="14"></rect>
    <rect x="60" y="578" width="170" height="40" rx="20"></rect>
    <rect x="250" y="578" width="170" height="40" rx="20"></rect>
    <rect x="440" y="578" width="170" height="40" rx="20"></rect>
    <rect x="630" y="578" width="170" height="40" rx="20"></rect>
    <rect x="60" y="672" width="360" height="70" rx="14" stroke-dasharray="6 4"></rect>
    <rect x="470" y="672" width="360" height="70" rx="14"></rect>
  </g>
  <g fill="none" stroke="var(--accent, #6aa9ff)" stroke-width="2.5" marker-end="url(#ds-arrow)">
    <path d="M440 74 V105"></path>
    <path d="M440 158 V178 M158 178 H722" marker-end="none" stroke-linecap="round"></path>
    <path d="M158 178 V197"></path>
    <path d="M440 178 V197"></path>
    <path d="M722 178 V197" marker-end="url(#ds-arrow)"></path>
    <path d="M158 344 V366 M158 366 H722" marker-end="none" stroke-linecap="round"></path>
    <path d="M440 344 V385"></path>
    <path d="M722 344 V366"></path>
    <path d="M440 456 V487"></path>
    <path d="M440 540 V560 M440 560 H145 M440 560 H735" marker-end="none" stroke-linecap="round"></path>
    <path d="M145 560 V571"></path>
    <path d="M335 560 V571"></path>
    <path d="M525 560 V571"></path>
    <path d="M715 560 V571"></path>
    <path d="M240 640 V665"></path>
    <path d="M650 640 V665"></path>
  </g>
  <path d="M830 700 H862 V270 H856" fill="none" stroke="var(--fg-muted, #a4adb8)" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#ds-arrow)"></path>
  <g fill="var(--fg, #e6e8eb)" font-family="Segoe UI, Arial, sans-serif" text-anchor="middle">
    <text x="440" y="40" font-size="16" font-weight="700">Open question</text>
    <text x="440" y="60" fill="var(--fg-muted, #a4adb8)" font-size="12">a coworker hits an ambiguity code cannot answer</text>
    <text x="440" y="140" font-size="14" font-weight="700">Scope routing &mdash; which layer owns this decision?</text>
    <text x="158" y="230" font-size="15" font-weight="700">WWMD</text>
    <text x="158" y="250" fill="var(--fg-muted, #a4adb8)" font-size="12">platform doctrine</text>
    <text x="158" y="278" fill="var(--fg-muted, #a4adb8)" font-size="12">founder-kernel wiki</text>
    <text x="158" y="296" fill="var(--fg-muted, #a4adb8)" font-size="12">tiered principles</text>
    <text x="158" y="322" fill="var(--fg-muted, #a4adb8)" font-size="11">Qdrant ranks relevance &middot; Postgres holds authority</text>
    <text x="440" y="230" font-size="15" font-weight="700">WWWD</text>
    <text x="440" y="250" fill="var(--fg-muted, #a4adb8)" font-size="12">your business stance</text>
    <text x="440" y="278" fill="var(--fg-muted, #a4adb8)" font-size="12">org-authored corpus:</text>
    <text x="440" y="296" fill="var(--fg-muted, #a4adb8)" font-size="12">stances, ceilings, rulings</text>
    <text x="440" y="322" fill="var(--fg-muted, #a4adb8)" font-size="11">grows as your company decides</text>
    <text x="722" y="230" font-size="15" font-weight="700">WSID</text>
    <text x="722" y="250" fill="var(--fg-muted, #a4adb8)" font-size="12">profession craft</text>
    <text x="722" y="278" fill="var(--fg-muted, #a4adb8)" font-size="12">job-specific corpus,</text>
    <text x="722" y="296" fill="var(--fg-muted, #a4adb8)" font-size="12">source-traced pages</text>
    <text x="722" y="322" fill="var(--fg-muted, #a4adb8)" font-size="11">gaps recorded &rarr; corpus grows from use</text>
    <text x="440" y="418" font-size="15" font-weight="700">One scoring engine</text>
    <text x="440" y="440" fill="var(--fg-muted, #a4adb8)" font-size="12">contribution = tier weight &times; alignment &middot; composite = &Sigma; contributions &middot; margin &rarr; confidence</text>
    <text x="440" y="522" font-size="13" font-weight="700">Guardrails: commandment conflict &middot; weak coverage &middot; risk tier &middot; zero signal</text>
    <text x="145" y="602" font-size="13" font-weight="700">recommend</text>
    <text x="335" y="602" font-size="13" font-weight="700">arbitrate</text>
    <text x="525" y="602" font-size="13" font-weight="700">escalate</text>
    <text x="715" y="602" font-size="13" font-weight="700">defer</text>
    <text x="240" y="698" font-size="13" font-weight="700">Autonomy dials</text>
    <text x="240" y="718" fill="var(--fg-muted, #a4adb8)" font-size="11">proactivity &middot; risk posture &middot; earned trust</text>
    <text x="240" y="733" fill="var(--fg-muted, #a4adb8)" font-size="11">initiative and latitude &mdash; never new authority</text>
    <text x="650" y="698" font-size="13" font-weight="700">Decision ledger</text>
    <text x="650" y="718" fill="var(--fg-muted, #a4adb8)" font-size="11">append-only, reconstructable</text>
    <text x="650" y="733" fill="var(--fg-muted, #a4adb8)" font-size="11">resolutions promote back into doctrine &#8599;</text>
  </g>
</svg>
<figcaption>
The three layers consult different doctrine but share one scoring engine, one guardrail
set, one outcome contract, and one ledger. The dashed return path is the learning loop:
resolved escalations and rulings become doctrine, so the next question of the same class
is answered with higher confidence.
</figcaption>
</figure>

## How a decision runs

Every gate call, in any layer, runs the same steps:

1. **Retrieve grounded knowledge.** The `wiki_query` MCP tool searches the owning corpus — founder kernel for WWMD, the org overlay for WWWD, the profession corpus for WSID — for entities, stances, heuristics, principles, decisions, and runbooks. Two retrieval modes exist: plain **vector search** over embedded wiki content, and **PPR search**, where vector hits seed a Personalized PageRank pass over the wiki-link graph for multi-hop questions whose best answer is *connected to* rather than *textually similar to* the prompt. Principle queries also filter by tier, calling population, and ring scope so an external coding agent, an in-platform coworker, and a human review surface never accidentally use each other's guidance.
2. **Frame concrete options.** The coworker turns the ambiguity into 2–4 candidate options, each with a stable id, a plain-language description, and optional feature scores on the principle dimension registry. Feature scores are intentionally explicit: they force the caller to say which option increases or reduces maintainability, blast radius, evidence density, human load, data privacy, and so on.
3. **Select applicable principles.** Commandments are always included; core and contextual principles enter by relevance (see the WWMD section above for the relevance/authority split); callers can cap how many principles are considered so the result stays inspectable.
4. **Score.** See the math below.
5. **Guardrail and decide the outcome.** Margin, coverage, commandment conflicts, risk tier, and the autonomy policy map the scores onto one of four outcomes.
6. **Persist the ledger row.** Every call — including the ones where the platform chose *not* to decide — writes a `DecisionInteraction` record.

Code references:

- [`wiki_query` MCP tool](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/mcp-tools.ts), [`recallWikiContext`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/wiki/recall.ts), [`searchByPPR`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/wiki/ppr.ts)

## The scoring math

The shared inner engine lives in [`option-scoring.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision/option-scoring.ts) — one implementation behind both the Decision Perspective Gate and the `principle_decide` MCP tool.

**Alignment.** For each option × principle pair the engine computes an `alignment` in `[-1, 1]`, preferring the structured path and falling back to the semantic one:

- *Structured alignment* — a normalized dot product between the option's feature scores and the principle's signed dimension vector:

  ```
  alignment = Σ option[dim] × principleVector[dim] / Σ |principleVector[dim]|
  ```

  Missing option dimensions contribute zero and are reported, not hidden. Structured mode requires genuine overlap — the principle must declare at least one dimension *and* the option must score at least one of those same dimensions — otherwise the pair falls back to semantic scoring rather than producing a hollow zero.

- *Semantic alignment* — cosine similarity between the option's embedding and the principle's direction embedding. It keeps the engine useful when structured features are absent, but it is tracked as a fallback: results leaning too heavily on it get flagged (below).

**Contribution and composite.** Each pair's contribution is `principle.weight × alignment`; an option's composite is the sum of its contributions. The tier sets the default weight:

| Tier | Meaning | Default weight |
|------|---------|----------------|
| Commandment | Non-negotiable doctrine in its declared scope | 1.0 |
| Core | Strong platform default | 0.4 |
| Contextual | Narrow operational rule | 0.1 |

The ratios are chosen so that one commandment at peak alignment outweighs ten contextual rules at peak alignment (1.0 vs 10 × 0.1) — the hierarchy degrades gracefully rather than acting as a hard categorical override. Weights can be attenuated by consumer context (a route-scoped principle scored without route context is attenuated to 0.3; profession-local axes attenuate toward 0.5), so doctrine pulls hardest where it actually applies.

**Guardrails.** Three thresholds turn raw scores into honest ones:

- `margin = winner.composite − runnerUp.composite`; a margin under the tie threshold (default **0.2**) reports `confidence: low`.
- `semanticFallbackRatio` — the share of contributions that came from semantic fallback; above **0.4** the result is flagged `structuredCoverage: weak`.
- **Commandment conflict** — any commandment-tier principle contributing below **−0.5** to the *winning* option raises a conflict flag; commandments are not merely heavy weights, they are tripwires.
- **Zero-signal guard** — if every contribution is exactly zero the engine returns `insufficientSignal` and no recommendation, rather than crowning a winner of a race nobody ran. (The check is per-contribution, not per-composite, so genuinely offsetting pulls that net to zero still count as signal.)

**The vectors behind one answer.** The composite is deliberately multi-vector — it is never just "nearest wiki page wins":

| Vector | What it evaluates | Why it matters |
|--------|-------------------|----------------|
| Semantic retrieval vector | Which pages and principles are meaningfully related to the question | Grounds the answer in current knowledge |
| Wiki-link vector | Which pages connect to the relevant pages in the wiki graph | Surfaces second-order context for multi-hop questions |
| Principle dimension vector | How each option aligns with signed principle axes | Makes trade-offs inspectable instead of rhetorical |
| Tier weighting vector | Whether the pull comes from commandment, core, or contextual doctrine | Prevents weak preferences from overruling hard rules |
| Authority and scope vector | Calling population, domain class, ring scope, profile chain | Keeps guidance local to the right actor and surface |
| Evidence quality vector | Freshness, evidence grade, review status, promotion state, recent overrides | Reduces autonomy when material is stale, weak, or often overridden |
| Risk vector | Low, medium, high, critical decision risk | High-risk calls escalate even when the recommendation looks strong |

The principle dimension registry currently includes: long-term maintainability, blast radius, reusability, evidence density, human cognitive load, capacity utilization, governance compliance, public safety, speed to value, schema grounding, operational independence, data privacy, cost efficiency, and vendor lock-in.

### A worked example

A `build-specialist` coworker has built an "overdue jobs" widget for an HVAC dispatcher board and hits an open product question before shipping: *should this be generalized into the reusable workspace-home primitive library for the Hive Mind, or kept local to this install?* (`domainClass: architecture-tradeoff`, `riskTier: medium`). The numbers illustrate the real math — each cell is a contribution (`weight × alignment`); the composite is the column sum.

| Principle (tier, weight) | Option A — keep local | Option B — parameterize for the hive |
|--------------------------|----------------------:|-------------------------------------:|
| Learnings belong in the shared commons (commandment, 1.0) | +0.10 | **+0.85** |
| Architecture over shortcuts (core, 0.4) | +0.12 | **+0.32** |
| Speed to value (contextual, 0.1) | **+0.09** | +0.05 |
| **Composite** | **0.31** | **1.22** |

Option B wins with `margin = 0.91`, far above the `0.2` tie threshold, so confidence is high; structured coverage is strong and no commandment conflicts. The contextual "ship faster" pull toward Option A is genuine, but at weight `0.1` it cannot overcome a commandment-tier reusability pull at weight `1.0` — which is exactly what tier weighting is for. The gate returns `recommend` Option B with the full contribution ledger; execution and approval still belong to the caller.

Code references:

- [`PRINCIPLE_TIER_DEFAULT_WEIGHT`, `PRINCIPLE_DIMENSIONS`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/db/src/wiki-taxonomy.ts)
- [`option-scoring.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision/option-scoring.ts) — alignment, composite, guardrails
- [`consumer-context-attenuation.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision/consumer-context-attenuation.ts)

## From scores to an outcome

The gate returns a structured outcome, never just prose:

| Outcome | Meaning |
|---------|---------|
| `recommend` | The gate has enough signal to advise a path. Execution and approval still belong to the caller. |
| `arbitrate` | For low-risk decisions with high enough confidence, the coworker may continue under the declared autonomy policy. The dissenting view is preserved in the ledger. |
| `escalate` | Risk, conflict, low confidence, or policy boundaries require a human resolver. |
| `defer` | The corpus lacks coverage. The correct answer is to capture the gap, not guess. |

Which outcome fires is not vibes — it is a ladder. The perspective evaluator first computes a numeric confidence for the profile's authority over this domain:

```
confidence = clamp01( baseScore − riskPenalty − min(0.3, recentOverrides × 0.1) )
```

where `baseScore` is the mean effective weight of the applicable material, `riskPenalty` is `{low: 0, medium: 0.1, high: 0.25, critical: 0.5}`, and `recentOverrides` counts human overrides of this profile in the last 30 days. **The override penalty is the fastest feedback loop in the system**: every time a human corrects the gate, its confidence — and therefore its autonomy — drops immediately, and it takes sustained agreement to earn it back.

Then the ladder applies, in order: a principle conflict escalates; a `high` or `critical` risk tier **always** escalates, no matter how strong the math looks; confidence below the policy's recommendation floor escalates; `arbitrate` fires only when the profile's autonomy policy explicitly allows arbitration, the risk tier is within the policy's ceiling, and confidence clears the arbitration floor; everything that survives becomes `recommend`. The default autonomy policy ships conservative: arbitration **off**, arbitration risk ceiling `low`, recommendation floor `0.55`, arbitration floor `0.85`.

Code references:

- [`evaluator.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/evaluator.ts) — confidence formula and outcome ladder
- [`graduated-autonomy.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/graduated-autonomy.ts) — risk-tier derivation from sensitivity × lifecycle transition
- [`build-studio-gate.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/build-studio-gate.ts) — the Build Studio plan-advancement gate

## JSI: weights that learn the job

The scoring above uses declared weights. **Job-Specific Intelligence (JSI)** is the layer that lets those weights *learn* — carefully, on three deliberately different timescales, because a job is not a corpus: two organizations with identical doctrine can still weigh the same trade-off differently, and that revealed difference is data.

The [TAK-JSI standard](job-specific-intelligence.md) defines the qualification side — how an identified coworker is shown fit for a specific job, activity, data scope, and risk context, and revalidated when any of those change. The mathematical side is specified in [Vector Decisioning and JSI](vector-decisioning-and-jsi.md) and implemented as follows:

| Timescale | What moves | Mechanism | Status |
|-----------|-----------|-----------|--------|
| **Slow — doctrinal** | Commandments and principle dimension vectors | Pull request + founder ratification; versioned in the kernel | Working, and deliberately slow |
| **Medium — revealed preference** | What accumulated human rulings reveal about an org's or role's real weights | Gate instrumentation → weight inference → human-ruled proposals | Built; generating proposals from live data is the next step |
| **Fast — contextual** | Situation-level modulation (season, live signals, stated urgency) | Designed in the spec; no scoring input exists yet | Not yet built |

The medium timescale is the interesting one, and it is built end-to-end as a **propose-and-rule pipeline, never a silent mutation**:

1. **Instrumented gates persist the comparison that matters.** Each decision row can carry the full `scoredOptions` vector set, the engine's `recommendedOptionId`, and the human's `chosenOptionId` (validated server-side against the scored set). Agreement is captured too — dropping it would bias inference toward disagreement.
2. **Weight inference looks for consistent separations.** Grouped by profile and domain class, each axis is tested: how often does the human's choice separate from the engine's recommendation in the same direction, and by how much? A proposal fires only past hard gates — at least **8 samples**, **70% directional consistency**, and **0.1 mean separation**.
3. **Proposals enter at low authority and climb by ruling.** An inferred weight adjustment enters at confidence weight **0.3** — *below* even unconfirmed human-authored material (0.6) — and only a human ruling promotes it. Rejected proposals stay rejected; nothing is overwritten.

This is the platform's answer to "how do the vectors get refined as companies use it": not by online learning that silently drifts, but by turning every human choice into evidence, distilling evidence into legible proposals ("this org consistently weighs customer-goodwill higher than the default in refund decisions"), and letting a human ratify each one — with the whole chain in the ledger.

Code references:

- [`weight-inference.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/weight-inference.ts), [`weight-inference-adapter.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/weight-inference-adapter.ts), [`weight-proposal-store.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/weight-proposal-store.ts)

## Earning autonomy: from passive to proactive

A decision gate answers "what should be done?" A separate set of dials answers "how much may this coworker do on its own initiative?" DPF keeps four dials distinct on purpose — and one rule binds all of them, straight from the TAK-JSI standard: **proactivity is not autonomy**. A more proactive coworker speaks up sooner and more often; it never thereby gains a capability, bypasses an approval, or exceeds a regulatory ceiling.

**1. The proactivity dial (per coworker, owner-facing).** Every coworker has a proactivity level — **quiet**, **balanced**, or **assertive** — that governs how it participates:

- *Quiet* waits to be asked: wide batching windows, no follow-up nudges, in-app notifications only, and an action boundary of **advise**.
- *Balanced* participates: it follows up once, uses your preferred channel, and may **propose** actions for approval.
- *Assertive* is an active participant: tight response windows, multiple follow-ups, urgent channels, escalation to the owner — but its boundary is still **propose**. No level's default reaches pre-authorized execution.

Defaults are derived per activity family (a security incident is always handled assertively; regulated work like tax compliance is forced back to *advise*), and the owner can override per coworker from the portal's proactivity surface. Two **hard floors survive every level**: money leaving the business and anything public-facing always require human approval. Coworkers can even propose their own dial change — after at least 5 consecutive approved-unchanged proposals, a coworker may suggest moving one step up, with a fixed, honest impact statement: it "does not grant new tools, permissions, or approval bypasses." The owner accepts or dismisses from their inbox.

**2. The org risk posture (per organization).** Conservative / balanced / progressive — this sets the autonomy **envelope** (the ceiling and how fast autonomy may mature), not the live level. Regulated industries default to conservative, and an industry default can only raise caution, never lower it.

**3. The decision autonomy policy (per decision profile).** The arbitration switches and confidence floors described in the outcome ladder above.

**4. Trust graduation (earned, per coworker × activity × risk class).** Actual autonomy is earned through a shadow-first ladder: **shadow → propose → supervised → autopilot**. In shadow mode the coworker decides silently alongside the human and its agreement is measured; graduating one level requires observed agreement over real decisions — 20 samples at 90% agreement for the early steps, 30 at 95% for autopilot. Every shadowed decision lands in a dedicated ledger and rolls up into a per-`(coworker, activity, risk-class)` trust state. Two ceilings are absolute: irreversible, outbound, financial, and access-control actions are **capped at "propose" forever**, and jurisdiction-specific regulatory policies intersect on top of everything. And one caveat is written into the standard itself: agreement with a human is *not* proof of competence — both may share the same blind spot — which is why risk tiers and hard floors never relax on agreement statistics alone.

What runs proactively today is itself governed: roughly 35 scheduled watchers and reconcilers (task watchdogs, queue-health and regression detectors, backlog triage drains, the daily governed tee-up loop that stages the next build for approval) — each catalogued, classified, and individually kill-switchable by the operator, with a parity test that fails the build if a job runs uncatalogued.

Code references:

- [`proactivity-resolver.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/proactivity/proactivity-resolver.ts), [`proactivity-change-proposal.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/proactivity/proactivity-change-proposal.ts)
- [`risk-posture.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/govern/risk-posture.ts)
- [`trust-graduation.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/autonomy/trust-graduation.ts), [`regulatory-ceiling.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/autonomy/regulatory-ceiling.ts)

## The decision ledger

None of the above is trustworthy unless it is reconstructable after the fact. Every gate call — `recommend`, `arbitrate`, `escalate`, *and* `defer` — writes an append-only `DecisionInteraction` row: profile and profile version, gate key, domain class, question, options, scored options, the engine's recommendation and the human's choice, evidence bundle, cited sources, rationale, risk tier, confidence before and after, outcome, conflict flags, and any escalation or deferral capture. Profiles are never edited in place — a change snapshots a new version, so an old interaction always resolves against the doctrine that was live when it ran.

A coworker can act faster over time, but the organization can always reconstruct:

- what question was asked, and which layer owned it
- what the options were, and how each was scored
- what guidance was consulted, and what it cost the losing options
- why the gate allowed, blocked, escalated, or deferred
- whether a human overrode the recommendation — and how that override lowered future autonomy
- whether the unresolved decision became improvement material

The shadow ledger and trust states described above are a second, parallel record: they are how "this coworker has earned autopilot on invoice matching but is still proposing on refunds" is a queryable fact rather than a feeling.

Code references:

- [`DecisionInteraction`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/db/prisma/schema.prisma), [`persistDecisionInteraction`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/persistence.ts)

## The learning loop

The most important output is not the recommendation — it is the gap signal. When a gate escalates or defers, the platform has discovered that its doctrine is under-specified, conflicted, stale, or too weakly evidenced for the current class of work. Four feedback paths turn that into compounding trust:

1. **Escalation resolutions become doctrine.** A human ruling is captured as draft material and climbs the promotion ladder (`unconfirmed` → `confirmed` → `ruled`) into the owning corpus — org stances for WWWD, profession pages for WSID, kernel candidates for WWMD.
2. **Overrides cut autonomy immediately.** The 30-day override penalty in the confidence formula means correction is felt on the very next call.
3. **Revealed preference becomes weight proposals.** The JSI medium timescale distills consistent human choices into human-ruled weight adjustments.
4. **Drift is caught against golden decisions.** Canonical decisions are re-scored when the corpus changes; a corpus edit that flips one, or thins its margin, is flagged before it silently changes behavior.

That is the autonomy flywheel: coworker encounters ambiguity → gate consults the owning layer → outcome with full ledger → human resolution captured where needed → reviewed resolutions improve the corpus and the weights → future coworkers answer the same class of question with higher confidence and less interruption. The platform does not hide uncertainty; it turns uncertainty into governable work. A new install's coworkers escalate often — honestly. A mature install's coworkers escalate rarely — demonstrably.

## Current boundaries

Stated plainly, because trust requires knowing what is *not* built yet:

- The gate is advisory unless a caller's autonomy policy explicitly allows arbitration for the risk tier; the default policy ships with arbitration off. It is never a bypass around approval, authorization, test gates, source control, or runtime safety controls.
- The JSI medium timescale is built as a propose-and-rule pipeline, and the review surface is live; wiring it to generate proposals from accumulating live decisions — and to apply a ruled proposal back into a profile's weights — is the next increment. The fast (contextual) timescale is designed but not implemented.
- WSID profession corpora are deliberately small and lexically ranked today; vector-indexing them is a planned extension as they grow. Growth gaps are recorded from real use either way.
- WWWD corpora start sparse on every new install by design — early escalations are the system working, not failing. The five starter stance vectors give day-one coverage for common commercial calls.
- Trust graduation ceilings are hard: outbound, irreversible, financial, and access-control actions never graduate past "propose," and regulatory ceilings intersect on top.
- Runtime commandment enforcement is related but separate: it blocks or escalates execution attempts that violate tier-1 rules regardless of what any gate recommended.

The north star is unchanged: AI coworkers gain more room to act only when the decision path is more inspectable, better evidenced, and easier to override.
