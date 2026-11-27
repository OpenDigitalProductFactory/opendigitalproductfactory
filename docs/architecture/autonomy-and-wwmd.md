---
title: Autonomy, WWMD, and trusted coworker decisions
description: How Mark Bodman's operating philosophy is operationalized in DPF's three-layer decision substrate (WWMD, WWWD, WSID), how the platform migrated from one large corpus into focused scopes paired with GPP, the complete vector and weighting model, real autonomous decision examples from the ledger, and the next phase of granular GPP enforcement.
---

DPF is not trying to make AI coworkers autonomous by removing humans from the loop. It is trying to make autonomy **gradual, inspectable, and recoverable** — and to make every step of that gradient something an owner can see, question, and reverse.

That only works if judgment is not trapped in chat. In DPF, judgment is a core platform capability: a **Decision Perspective Gate** that a coworker calls when it hits an ambiguity, and that returns a scored outcome with confidence, cited sources, and an append-only audit record. The same gate is callable from Build Studio, in-product coworkers, standing Workrooms, and external MCP clients under the same governance rules.

This page explains the whole architecture end to end:

1. **How Mark Bodman thinks — and how WWMD operationalizes that method at the core of DPF**
2. **The three decision scopes and the current WWMD / WSID / WWWD corpus DPF ships**
3. **Why and how DPF migrated out of one large corpus and a single advisory gate into focused scopes paired with GPP**
4. **The complete vector registry, weighting math, evidence discounting, quality gates, and JSI fluid weights**
5. **Real examples from the live decision ledger where autonomous decisions saved time and facilitated autonomy**
6. **The next phase in GPP — granular, focus-area bindings that make vectors operationally impactful**

---

## How Mark Bodman thinks — and how WWMD operationalizes it

People who follow Mark Bodman's writing — across The Open Group's *Shift to Digital Product* (W205) and IT4IT v3, the Common Service Data Model (CSDM), *Architecture & Governance Magazine*, and years of enterprise-architecture and platform commentary — often ask the same question: *"How do you think about this?"*

When Mark first experimented with a scoped GPT built from years of his articles and platform decisions, the reaction was striking — people said it felt like having him in the room. It also crystallized the real design problem. A personality clone is a party trick. **What an organization actually needs is not a database of past answers; it is the embodiment of a way of thinking.**

A decision is merely the residue of applying a *method* to a *situation*. Retrieval-only AI (RAG over notes and documents) can look up past residues, but when a coworker meets a genuinely new trade-off, retrieval papers over competing priorities and presents every answer with uniform certainty. WWMD (*What Would Mark Do?*) takes the opposite stance: encode the **method** — stances, heuristics, tiered principles, explicit trade-off vectors, confidence calibration, and honest escalation — as a versioned, auditable platform substrate.

Six core convictions from Mark's founder-kernel corpus are not commentary bolted onto DPF; they are literally wired into how the platform works:

1. **Digital Product is the unit of organization.** Anything that runs code, has one accountable party, and delivers outcomes for a consumer party is a Digital Product. Portfolio strategy, funding, persistent teams, lifecycle, and governance all reduce to that primitive — replacing time-bound project theater with rolling investment and durable ownership (`stances/digital-product-is-the-unit-of-organization`, `stances/persistent-product-teams-over-projects`).
2. **IT4IT is the integrating substrate, not a rival framework.** Rather than fighting framework-vs-framework battles across ITIL, COBIT, TOGAF, DevOps, and SAFe, DPF keys its lifecycles, value-stream teams, coworker routing, and Workroom orchestration off IT4IT v3's seven canonical value streams (*Evaluate, Explore, Integrate, Deploy, Release, Operate, Consume*) (`stances/it4it-is-substrate`).
3. **One canonical data model beats integrating two systems of record ("reuse the camera in your pocket").** Two platforms claiming authority over the same entities reliably march through *Independent → Honeymoon → Ugly Reckoning* as semantic drift destroys trust. DPF is built as one cohesive platform over one canonical relational model (Postgres, pgvector, and the in-Postgres graph mirror) rather than an integration hub wiring point tools together (`stances/dont-integrate-ea-platform`, `heuristics/reuse-the-camera-in-your-pocket`).
4. **Trust the data spine on three pillars — or every forecast inherits the lie.** A coworker's judgment is only as trustworthy as the operational record beneath it. That spine requires *Ingestion* (auto-populate, because manually maintained inventory is already wrong), *Insight* (actually use the data in daily operations and decisions), and *Governance & Health* (named humans own, triage, and prune it) (`stances/trust-the-cmdb-or-rebuild-it`, `heuristics/auto-populate-or-its-wrong`).
5. **Deliver forecasts, not raw models (the meteorology mental model).** An enterprise architect — and an AI coworker — should function like a meteorologist, not hand executives raw radar imagery. A forecast states a recommendation, its explicit confidence, and the trade-offs accepted, updates as conditions change, and stays useful even when wrong because it made the unknowns legible. **WWMD, WWWD, and WSID are literally forecast questions** (`stances/ea-is-meteorology`, `heuristics/be-a-meteorologist`).
6. **Contextualize before transforming — and earn confidence in drops, lose it in buckets.** Map an organization's existing operating model first instead of preaching transformation; that map becomes its own WWWD overlay (`stances/contextualize-dont-transform`). Pair multi-perspective cognitive diversity (Scott Page's diversity-prediction theorem) with context-as-architecture ("when intelligence is abundant, context is the scarce resource; agent infrastructure is 80% plumbing" — Nate B. Jones). Treat confidence as a live operating state that rises slowly on confirmed agreement and drops immediately when a human overrules the gate.

This is why WWMD sits at the core of DPF — and why it is deliberately **scoped** to platform evolution rather than imposed on every customer's business.

---

## Why a decision substrate matters

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

---

## The three layers of decisions — and the corpus DPF ships today

DPF partitions decisions into **three scopes that do not inherit each other's authority**. All three use the same core engine — retrieve, frame options, score, guardrail, record — pointed at three distinct bodies of doctrine:

| Layer | Shorthand | Answers | Doctrine it consults | Gate |
|-------|-----------|---------|----------------------|------|
| **WWMD** | *What Would Mark Do?* | How should the **platform and its ecosystem** evolve here? | The founder-kernel wiki: tiered principles, stances, heuristics, and canonical entities | `principle_decide` |
| **WWWD** | *What Would We Do?* | What would **this organization** do here? | The org's own governed corpus: plain-language stance pages, spend ceilings, recorded rulings | `evaluate_org_business_decision` |
| **WSID** | *What Should I Do?* | What would a **competent professional in this role** do here? | A per-profession, source-traced craft corpus across 27 profession families | `evaluate_profession_decision` |

The load-bearing rule is **subsidiarity**: every decision is resolved in the scope that owns it, and *no scope's doctrine binds another as authority*. A neighboring scope is advisory until the owning scope has spoken. The kernel principle [`decisions-belong-to-their-scope`](../founder-kernel/wiki/principles/decisions-belong-to-their-scope.md) states it directly, and the routing contract injected into every in-portal coworker prompt enforces it verbatim: *"never substitute the founder/platform doctrine as the organization's authority — platform doctrine is advisory to a business decision, not binding."*

One honesty detail matters for audit: the ledger's audit tier derives from the **gate that was called**, not from whatever profile the material resolution fell back to. A profession (WSID) question that had to borrow platform doctrine as advisory fallback still files as a WSID decision — otherwise the tier would read empty and an operator would wrongly conclude the gate is never used.

### What ships in the corpus today

Volatile counts are generated from source in [`architecture-counts.generated.md`](architecture-counts.generated.md). As of the 2026-11-27 repository snapshot, the shipped decision corpus spans:

| Corpus layer | Shipped contents | Vectorization & structure |
|---|---|---|
| **WWMD (Founder Kernel)** (`docs/founder-kernel/wiki/`) | **115 principles** (33 commandments, 71 core, 8 contextual, plus 3 specialized), **7 stances**, **7 heuristics**, **5 canonical entities** | All **115/115 principles** carry signed `principleDimensionVector` weights (average **4.5 axes per principle** across 22 active axes). **90 universal**, **24 AI-coworker-universal**, **1 specialist**, and **0 `route-domain-specific`** principles remain in the kernel after the corpus rebalance. Ring-scoped across Rings 1–5 and external coordination; 62 classified public. |
| **WSID (Profession Craft)** (`docs/professions/`) | **27 profession families** and **228 source-traced craft pages** | **109 pages** carry explicit signed dimension vectors (average **2.88 axes**). Tiered into **17 commandments, 82 core, 6 contextual, 4 standards**, and **119 craft reference pages**. Stratified by competency into **61 foundational**, **127 practitioner** (114 explicit + 13 default), and **40 expert** pages. |
| **WWWD (Organization Business)** | **8 owner-facing starter stance vectors** seeded per business archetype, plus org-authored rulings and identity pages | Plain-language stances with explicit USD ceilings where applicable (`customer-goodwill`, `pricing-integrity`, `spend-authority`), climbing the promotion ladder `unconfirmed (0.6) → confirmed (0.9) → ruled (1.0)` through owner review. |

### WWMD — platform evolution and the ecosystem

WWMD owns the decisions about how the platform itself evolves and how the shared ecosystem behaves: build and architecture trade-offs, what generalizes into the Hive Mind commons versus stays local, and contribution and governance standards for the substrate every install shares. It is deliberately *not* the layer for a customer's business calls — that is WWWD's job.

Retrieval for `principle_decide` splits **relevance from authority**:

- **Commandments always come from Postgres** — the authoring store — and are always in scope. They are never subject to a similarity search deciding whether they "apply."
- **Core and contextual principles are found by vector search in pgvector**, which ranks relevance — core principles top-K ranked (default 5), contextual principles additionally gated by a cosine-similarity threshold (default `0.75`) so narrow operational rules only enter when genuinely close to the question.
- **A vector hit alone can never score.** The vector index nominates; the real principle rows — vectors, tiers, weights — are hydrated from Postgres by page id. Phantom hits (index entries whose page no longer exists) are detected and dropped, and their count is reported, because a vector index that disagrees with the authoring store is itself a finding.

This split — *the vector index is the relevance index, the principle rows are the authority* — is what keeps semantic search from quietly becoming a decision-maker.

### WSID — the profession's craft across 27 families

WSID answers craft questions with **source-traced professional doctrine** instead of raw model memory. The 27 shipped profession families cover both platform engineering and business operations:

- **Engineering, data & security:** `data-architect` (21 pages), `enterprise-architecture` (14), `software-engineer` (13), `ux-design` (12), `security` (9), `frontend-engineer` (8), `qa-engineer` (8), `devops-platform` (8), `release-service-management` (7), `build-studio` (5), `mcp-integration` (4).
- **Business, operations & governance:** `operations` (19), `legal-compliance` (16), `finance` (11), `product-manager` (8), `portfolio-management` (8), `marketing` (8), `hr-people-ops` (8), `scrum-master` (7), `customer-success` (7), `strategy-executive` (6), `documentation-content` (6), `external-intelligence` (5), `admin-operations` (4), `agricultural-operations` (4), `market-research` (1), `manufacturing-operations` (1).

Every WSID page is research-sourced from verifiable standards and bodies of knowledge (ANSI SQL, DAMA-DMBOK2, OWASP ASVS, US GAAP, ISO/IEC standards, Martin Fowler's evolutionary database and parallel-change references, Nielsen Norman Group, OpenGitOps, SemVer, and domain regulations) rather than synthesized from ungrounded model memory.

WSID also governs craft context along **four orthogonal variant axes** (`packages/db/src/wiki-taxonomy.ts`):

- **Jurisdiction (`professionJurisdiction`):** `global`, `us`, `eu`, `uk` — shielding coworkers from applying the wrong regional rule (e.g., US GAAP vs. IFRS, CAN-SPAM vs. GDPR).
- **Jurisdiction basis (`professionJurisdictionBasis`):** `global`, `operating` (where the business is established), `selling` (where the customer is), `employing` (where staff work), or `data-residency` (where data subjects reside).
- **Competency level (`professionCompetencyLevel`):** `foundational` (non-negotiable basics, SFIA ~1–2), `practitioner` (day-to-day practice, SFIA ~3–4), and `expert` (nuanced trade-off judgment, SFIA ~5–7).
- **Business archetype (`professionArchetype`):** `universal` or any of the 25 canonical industry categories (from `trades-maintenance` and `healthcare-wellness` to `banking-financial-services` and `public-sector`).

**High-stakes hold.** Machine-seeded craft doctrine for compliance- or finance-adjacent professions is never silently activated on a fresh install. Derived material in families whose contexts touch finance or compliance lands held (`draft` / `candidate`) and invisible to the gate until a human explicitly approves and promotes it in `/coworker-decisions/review`.

How retrieval works today is deliberately deterministic and inspectable: the coworker's **agent identity** maps to a profession family; the family selects its job-specific corpus pages; a deterministic ranker scores them against the question and injects token-bounded, cited excerpts into context. When retrieval comes back empty or low-relevance, that miss is recorded as a **growth gap** so profession corpora grow from real operational demand rather than speculation.

### WWWD — your organization's business decisions

WWWD is the layer that owns **corporate decisions**: pricing exceptions, customer goodwill, credit terms, data handling, routine delegation, growth-versus-stability calls, and spend approvals. Its doctrine is the organization's own corpus, never the platform's:

- **Eight starter stance vectors** seeded at onboarding from the chosen business archetype — `customer-goodwill`, `pricing-integrity`, `growth-vs-stability`, `quality-bar`, `spend-authority`, `data-handling`, `routine-operations`, and `decision-scope` — with explicit USD ceilings on goodwill, pricing, and spend that vary by business type (for example, $60 goodwill for a restaurant, $150 for a clinic, $200 for a software platform, and *no discretionary ceiling* for public sector).
- **Authoring never auto-grants authority.** Seeded or drafted stances climb a promotion ladder — `unconfirmed` (0.6) → `confirmed` (0.9) → `ruled` (1.0) — through owner review and never silently downgrade.
- **Alignment is not a licence to act.** Even when a proposal matches recorded org stance, the gate acts autonomously only when the owner has already *ruled* on that class (`settledByRuling`); a novel proposal surfaces honestly as a **New proposition** so the owner sees genuinely new ideas rather than having the business frozen in its past.
- The gate reports `orgProfileSelected` honestly: true only when the org's **own** profile decided, never when platform doctrine served as advisory fallback.

Full end-to-end walkthroughs of all three layers, with their ledger rows, are in [Decision Perspective in Practice](../user-guide/ai-workforce/decision-perspective-in-practice.md).

Code references:

- [`decision-routing-block.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/tak/decision-routing-block.ts) — the routing contract in every coworker prompt
- [`principle-decide-pack.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/mcp/packs/principle-decide-pack.ts) — WWMD retrieval, relevance/authority split, phantom-hit detection
- [`org-business-gate.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/org-business-gate.ts), [`profession-gate.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/profession-gate.ts) — the WWWD and WSID gates
- [`profession-corpus.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/profession-corpus.ts), [`seed-profession-corpus.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/db/src/seed-profession-corpus.ts) — WSID job-specific corpus retrieval and seeding
- [`stance-promotion.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/stance-promotion.ts) — the WWWD material promotion ladder

---

## Migrating out of one large corpus and `principle_decide` into focused scopes + GPP

DPF did not start with three clean corpora and per-stage permission bindings. It started the way almost every platform starts: **one large founder corpus (WWMD) and one general advisory tool (`principle_decide`).** Understanding why we migrated out of that shape — and what replaced it — is the key to understanding how DPF scales autonomy.

### What broke with one monolithic corpus

When we measured the single-corpus era (July 2026, over 95 kernel principles), three structural bottlenecks appeared in live decision ledgers:

1. **One specialist's craft colonized platform doctrine.** Fifty of 95 kernel principles (~53%) were self-tagged `route-domain-specific` — 39 of them pure software-engineering practices (`all-changes-land-via-pr`, `dco-sign-off-required`, `branch-guard-before-implementation`). Roughly 41% of WWMD was one specialist's craft sitting at founder-doctrine altitude, while the `software-engineer` WSID corpus held only 9 pages.
2. **A flat vector space collapsed in discrimination.** Across 19 available axes, principles used an average of only 3.6 axes, with `long_term_maintainability` loaded by 68% of principles and `cost_efficiency` by zero — an effective rank of roughly **6**. Worse, `principleConsumerContexts` was not yet filtered at retrieval time and core/contextual signed vectors were not hydrated from Postgres, so a UI rule (`no-hardcoded-colors`) could score top-2 on a pure backend architecture call with zero UI content.
3. **Advice was disconnected from permission.** `principle_decide` could return a strong recommendation, yet tool reach was governed separately. Without a formal binding between *which scope decided* and *which tools that decision unlocks*, a coworker either faced repetitive per-call approval prompts (approval fatigue) or risked overly broad standing grants.

### How the migration resolved it

We executed the shift in four deliberate layers — without throwing away the shared math or the relational ledger:

| Shift | Before (single corpus + advisory gate) | After (focused scopes + GPP) |
|---|---|---|
| **Corpus placement** | 50 `route-domain-specific` principles mixed into WWMD; 9 pages in `software-engineer` | **0 `route-domain-specific`** principles left in the 115-principle founder kernel; specialist craft migrated into **27 WSID profession families (228 pages)** |
| **Vector architecture** | One flat list where software vocabulary (`schema_grounding`, `reusability`) crowded out other professions | **Spine vs. profession-local split**: **16 shared spine axes** + **8 demoted profession-local axes** + **11 namespaced craft axes** (`<profession>/<axis>`), every local axis projecting onto the spine in one hop |
| **Scoring & hydration** | Vector search payload scored directly; merged cap dropped core/contextual rules behind commandments | **Relevance/authority split**: pgvector nominates, Postgres hydrates real vectors/weights; consumer-context (`0.3`) and local-axis (`0.5`) attenuation; **5-part MCDA `autonomyEligible` quality gate**; pure portable `scoped-judgment` scorer |
| **Decision-to-action coupling** | `principle_decide` returned prose/scores; tool approvals fired per call or via blanket posture | **[Gated Permissions Process (GPP)](gated-permissions-process.md)**: binds one owning scope's gate (WWMD, WWWD, or WSID) to an exact stage's capability envelope inside a Workroom, enforced per call by TAK and receipted by GAID |

This separation is why Mark's founder kernel can stay sharp, high-altitude, and faithful to his thinking — while a data architect, UX designer, finance specialist, or DevOps coworker reasons at full craft resolution inside its own WSID corpus, and an organization authors its own WWWD business stances without inheriting platform preferences.

---

## The decision stack at a glance

<figure>
<svg viewBox="0 0 880 760" role="img" aria-labelledby="decision-stack-title decision-stack-desc" style="width:100%;height:auto;max-width:880px">
  <title id="decision-stack-title">The DPF decision stack</title>
  <desc id="decision-stack-desc">
    An open question is routed to the scope that owns it: WWMD platform evolution
    and ecosystem, WWWD the organization's own stance corpus, or WSID the
    profession's job-specific corpus. All three feed one scoring engine (contribution equals tier weight times
    alignment), then guardrails, then one of four outcomes. GPP bindings and autonomy dials govern how
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
    <text x="158" y="250" fill="var(--fg-muted, #a4adb8)" font-size="12">platform evolution &amp; ecosystem</text>
    <text x="158" y="278" fill="var(--fg-muted, #a4adb8)" font-size="12">founder-kernel wiki</text>
    <text x="158" y="296" fill="var(--fg-muted, #a4adb8)" font-size="12">115 tiered principles</text>
    <text x="158" y="322" fill="var(--fg-muted, #a4adb8)" font-size="11">pgvector ranks relevance &middot; Postgres holds authority</text>
    <text x="440" y="230" font-size="15" font-weight="700">WWWD</text>
    <text x="440" y="250" fill="var(--fg-muted, #a4adb8)" font-size="12">your business stance</text>
    <text x="440" y="278" fill="var(--fg-muted, #a4adb8)" font-size="12">org-authored corpus:</text>
    <text x="440" y="296" fill="var(--fg-muted, #a4adb8)" font-size="12">8 stance vectors, ceilings, rulings</text>
    <text x="440" y="322" fill="var(--fg-muted, #a4adb8)" font-size="11">grows as your company decides</text>
    <text x="722" y="230" font-size="15" font-weight="700">WSID</text>
    <text x="722" y="250" fill="var(--fg-muted, #a4adb8)" font-size="12">profession craft</text>
    <text x="722" y="278" fill="var(--fg-muted, #a4adb8)" font-size="12">27 profession families,</text>
    <text x="722" y="296" fill="var(--fg-muted, #a4adb8)" font-size="12">228 source-traced pages</text>
    <text x="722" y="322" fill="var(--fg-muted, #a4adb8)" font-size="11">gaps recorded &rarr; corpus grows from use</text>
    <text x="440" y="418" font-size="15" font-weight="700">One scoring engine (35 defined decision axes)</text>
    <text x="440" y="440" fill="var(--fg-muted, #a4adb8)" font-size="12">contribution = tier weight &times; alignment &middot; composite = &Sigma; contributions &middot; margin &rarr; confidence</text>
    <text x="440" y="522" font-size="13" font-weight="700">Guardrails: commandment conflict &middot; coverage &middot; &plusmn;10% sensitivity &middot; risk tier &middot; zero signal</text>
    <text x="145" y="602" font-size="13" font-weight="700">recommend</text>
    <text x="335" y="602" font-size="13" font-weight="700">arbitrate</text>
    <text x="525" y="602" font-size="13" font-weight="700">escalate</text>
    <text x="715" y="602" font-size="13" font-weight="700">defer</text>
    <text x="240" y="698" font-size="13" font-weight="700">GPP bindings &amp; autonomy dials</text>
    <text x="240" y="718" fill="var(--fg-muted, #a4adb8)" font-size="11">stage envelopes &middot; proactivity &middot; earned trust</text>
    <text x="240" y="733" fill="var(--fg-muted, #a4adb8)" font-size="11">binds decisions to tool reach &mdash; never widens authority</text>
    <text x="650" y="698" font-size="13" font-weight="700">Decision ledger</text>
    <text x="650" y="718" fill="var(--fg-muted, #a4adb8)" font-size="11">append-only, hash-chained, reconstructable</text>
    <text x="650" y="733" fill="var(--fg-muted, #a4adb8)" font-size="11">resolutions promote back into doctrine &#8599;</text>
  </g>
</svg>
<figcaption>
The three layers consult different doctrine but share one scoring engine, one guardrail
set, one outcome contract, and one relational ledger. GPP binds gate outcomes to bounded
stage tool envelopes enforced by TAK. The dashed return path is the learning loop:
resolved escalations and rulings promote back into doctrine and feed JSI weight proposals.
</figcaption>
</figure>

---

## How a decision runs

Every gate call, in any layer, runs the same six steps:

1. **Retrieve grounded knowledge.** The gate searches the owning corpus — founder kernel for WWMD, the org overlay for WWWD, the profession corpus for WSID — for entities, stances, heuristics, principles, decisions, and runbooks. Two retrieval modes exist for wiki search: plain **vector search** over pgvector embeddings, and **PPR search**, where vector hits seed a Personalized PageRank pass over the wiki-link graph for multi-hop questions whose best answer is *connected to* rather than *textually similar to* the prompt. Principle queries also filter by tier, calling population, consumer contexts, and ring scope so an external coding agent, an in-platform coworker, and a human review surface never silently inherit each other's guidance.
2. **Frame concrete options.** The caller turns the ambiguity into 2–4 candidate options, each with a validated unique `id`, a plain-language description, and structured feature scores (`0..1`) on the decision dimension registry. (Malformed option sets — missing IDs, duplicate IDs, missing descriptions — are refused fail-fast before scoring, and features travel positionally so caller-supplied ID typos can never collapse options onto one map.)
3. **Select applicable principles.** Commandments come straight from Postgres; core and contextual principles enter by relevance and are rehydrated from Postgres by page ID so real vectors and weights govern.
4. **Score.** See the vector and weighting detail below.
5. **Guardrail and decide the outcome.** Margin, feature coverage, weight sensitivity, structured coverage, commandment conflicts, evidence quality, risk tier, and autonomy policy map the scores onto `recommend`, `arbitrate`, `escalate`, or `defer`.
6. **Persist the ledger row.** Every call — including holds, escalations, and deferrals — writes an append-only, hash-chained `DecisionInteraction` record.

Code references:

- [`wiki_query` MCP tool](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/mcp-tools.ts), [`recallWikiContext`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/wiki/recall.ts), [`searchByPPR`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/wiki/ppr.ts)
- [`option-input-contract.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision/option-input-contract.ts) — fail-fast option validation

---

## Vectors and weighting in detail

This is the mechanical core that turns "principles in a wiki" into inspectable, reproducible judgment. DPF currently defines **35 decision axes** across two compile-enforced registries — **24 core axes** in `PRINCIPLE_DIMENSIONS` (16 spine + 8 profession-local) and **11 namespaced craft axes** in `PROFESSION_LOCAL_AXES` — plus **8 owner-facing business stance vectors** for WWWD. Every single axis is defined with its question, polarity, scope, and rationale in the [Decision Vectors reference](decision-vectors.md) and mapped across industries in [Decision Vectors by Business Type](decision-vectors-by-archetype.md).

### 1. The 35 defined decision axes

#### The shared spine — 16 commensurable axes

The spine is the shared currency that lets a security objection, a UX objection, a data-model objection, and a business-direction objection be weighed in one ledger:

| Group | Axes | Role in the ledger |
|---|---|---|
| **Universal trade-offs & quality (6)** | `long_term_maintainability`, `governance_compliance`, `evidence_density`, `speed_to_value`, `reversibility`, `cost_efficiency` | Durability, policy compliance, verifiable backing, delivery speed (legitimately negative when a principle trades speed for rigor), undoability, and money |
| **Universal obligations & informed authorization (3)** | `public_safety`, `data_privacy`, `legibility_of_consequence` | Stay on the spine regardless of frequency — harm to external people, personal-data protection, and whether an operator can foresee consequences before approving |
| **Universal cost axes (3 — higher is worse)** | `blast_radius`, `human_cognitive_load`, `operator_effort` | Estate exposure if wrong, cognitive burden on humans, and operator steps/elapsed time |
| **Constitutional business alignment (4)** | `mission_fit`, `market_fit`, `product_fit`, `gtm_fit` | Shared currency for how an option fits an organization's declared mission, chosen market, offer portfolio, and go-to-market route — independently vetoable, never widening authority |

#### Profession-local axes with single-hop spine projection — 19 axes

Vectors multiply *inside* the profession where the criteria actually live, without inflating the shared spine. Every local axis is typed (`benefit` or `cost`), sourced, and declares a mandatory `projectsOnto` target on the spine (weight split evenly across multiple targets, polarity-matched at compile/test time):

- **8 demoted core axes (`PRINCIPLE_DIMENSION_SCOPE`):**
  - `software-engineer`: `schema_grounding` → `long_term_maintainability`; `reusability` → `long_term_maintainability`
  - `devops-platform`: `operational_independence` → `long_term_maintainability` + `blast_radius`; `vendor_lock_in` (**cost**) → `long_term_maintainability`
  - `operations`: `capacity_utilization` → `cost_efficiency`
  - `security`: `evidence_confidence` → `evidence_density`; `business_disruption` (**cost**) → `blast_radius`
  - `marketing`: `customer_consent_state` → `governance_compliance`
- **11 namespaced craft axes (`PROFESSION_LOCAL_AXES`):**
  - `ux-design`: `hierarchy_flatness`, `content_density`, `disclosure_debt`, `perceptual_clutter` (all **cost** → `human_cognitive_load`)
  - `data-architect`: `referential_backing` (benefit → `long_term_maintainability`); `migration_fleet_risk` (**cost** → `blast_radius`)
  - `software-engineer`: `supersession_debt` (**cost** → `human_cognitive_load`)
  - `security`: `exposure_surface` (**cost** → `blast_radius`)
  - `devops-platform`: `upgrade_continuity` (benefit → `reversibility`)
  - `mcp-integration`: `protocol_window_conformance` (benefit → `governance_compliance`); `context_economy` (benefit → `cost_efficiency`)

**An install may never invent private axes.** It may re-weight the shared axes, author its 8 plain-language WWWD stances, or contribute new sourced craft axes upstream to a profession corpus. That constraint preserves cross-install comparability so the Hive Mind can generalize across organizations.

### 2. The scoring math and sign convention

The shared inner engine lives in [`option-scoring.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/validators/src/judgment/option-scoring.ts) (packaged as `@dpf/scoped-judgment` — one implementation behind `principle_decide`, the Decision Perspective Gate, and internal server callers).

**Alignment.** For each option × principle pair the engine computes an `alignment` in `[-1, 1]`, preferring the structured path and falling back to semantic embeddings only when structured overlap is absent:

- *Structured alignment* — an L1-normalized dot product between the option's non-negative feature scores (`0..1`) and the principle's signed dimension vector:

  ```
  alignment(option, principle) = ( Σ option[dim] × principleVector[dim] ) / ( Σ |principleVector[dim]| )
  ```

  Missing option dimensions contribute zero and are reported, not hidden. Structured mode requires **two-sided overlap** (`hasScoreableOverlap`): the principle must declare at least one dimension *and* the option must score at least one of those same dimensions, preventing a hollow `0` from masquerading as active neutrality.
- *Semantic alignment* — cosine similarity between the option's embedding and the principle's direction embedding. Kept as a fallback when structured features are absent, and explicitly tracked so heavy reliance flags weak coverage.

**Sign convention — why five axes are named for the bad thing.** Option features are non-negative (`0..1`): an option cannot exhibit *negative* blast radius. Therefore a principle that *opposes* a cost must carry a **negative weight** on it. Five axes in `PRINCIPLE_COST_DIMENSIONS` are costs — `blast_radius`, `human_cognitive_load`, `vendor_lock_in`, `business_disruption`, `operator_effort` — plus the cost-framed namespaced axes above. Early in DPF's history, `never-wipe-db-for-code-fixes` carried `+1.0` on `blast_radius`, causing the scorer to *reward* wiping the database as its top-aligned option. A seed- and test-time sign-convention guard now fails CI if any principle assigns a positive weight to a cost axis, and cost axes are deliberately named for the deficit so benefit-shaped names cannot re-introduce sign inversions.

**Tier weighting and context attenuation.** Each pair's contribution is `effectiveWeight × alignment`, and an option's composite is the sum of its contributions — preserving a full **contribution ledger** showing every principle's individual vote. Tier sets the default weight:

| Tier | Meaning | Default weight |
|---|---|---|
| **Commandment** | Non-negotiable doctrine in its declared scope | **1.0** |
| **Core** | Strong platform or craft default | **0.4** |
| **Contextual** | Narrow operational rule | **0.1** |

One commandment at full alignment outweighs ten contextual rules at full alignment (`1.0` vs `10 × 0.1`), so the hierarchy degrades gracefully without turning every decision into a brittle binary switch.

When a principle carries narrower scope than the caller declared, its **weight** (not its vector — shrinking an unscored vector term in place would reduce the L1 denominator and paradoxically *raise* normalized alignment) is attenuated:

- A `route-domain-specific` rule reached by a contextless caller is attenuated to **`0.3`**.
- Profession-local axis share further attenuates toward a **`0.5`** floor when scored outside its craft context.

### 3. Multi-vector architecture and mathematical grounding

One decision never collapses to "nearest wiki page wins." Seven distinct vectors shape a single verdict:

| Vector | What it evaluates | Why it matters |
|---|---|---|
| Semantic retrieval vector | Which pages and principles are meaningfully related to the question | Grounds the answer in current knowledge |
| Wiki-link vector | Which pages connect to the relevant pages in the wiki graph (PPR) | Surfaces second-order context for multi-hop questions |
| Principle dimension vector | How each option aligns with signed principle axes (spine + local) | Makes trade-offs inspectable instead of rhetorical |
| Tier weighting vector | Whether the pull comes from commandment, core, or contextual doctrine | Prevents weak preferences from overruling hard rules |
| Authority and scope vector | Calling population, domain class, consumer contexts, ring scope, profile chain | Keeps guidance local to the right actor and surface |
| Evidence quality vector | Freshness, evidence grade, review status, promotion state, recent overrules | Reduces autonomy when material is stale, weak, or overruled |
| Risk vector | Low, medium, high, critical decision risk | High-risk calls escalate even when the math looks strong |

Every piece sits on established decision mathematics rather than ad-hoc heuristics (full citations and build status in [Vector Decisioning and JSI](vector-decisioning-and-jsi.md) and [principle_decide math identity](principle-decide-mcda-identity.md)):

- **Simple Additive Weighting / Weighted Sum Model (SAW/WSM)** (Churchman & Ackoff 1954; Hwang & Yoon 1981) for the inspectable contribution ledger.
- **Vector Space Model** (Salton, Wong & Yang 1975) for semantic retrieval and cosine fallback.
- **Eigenvector mathematics in retrieval:** Personalized PageRank computes the stationary distribution — the principal eigenvector — of a random walk over the wiki link graph for multi-hop recall.
- **GRADE-like multiplicative evidence discounting** (Guyatt et al. 2008) for domain confidence.
- **AHP hierarchical problem decomposition** (Saaty 1980) for the spine/profession-local hierarchy — while being explicit that DPF does *not* run Saaty pairwise-matrix eigendecomposition at decide-time (pairwise elicitation is reserved as a candidate cold-start technique for new installs with no decision history).

### 4. Guardrails, evidence discounting, and the `autonomyEligible` gate

Raw scores never authorize unattended execution on their own. Two layers of guardrails convert scores into honest outcomes:

**MCDA quality gates (`autonomyEligible`, in `principle_decide`).** Unattended proceed requires `signalQuality.autonomyEligible === true`, meaning **all five** checks pass simultaneously:

1. A recommendation exists with **high** confidence (`margin >= 0.2` tie threshold).
2. **Feature coverage:** at least **3 feature axes** scored on every option (`minFeatureKeys: 3`).
3. **Weight sensitivity:** the winning option stays stable under **±10%** (`sensitivityEpsilon: 0.1`) one-at-a-time swings of principle weights.
4. **Structured coverage:** `semanticFallbackRatio <= 0.4` (results leaning too heavily on semantic fallback flag `structuredCoverage: weak`).
5. **No commandment conflict:** no commandment-tier principle contributes below **−0.5** to the winning option, and zero-signal inputs (`all contributions === 0`) return `insufficientSignal` rather than crowning a winner of a race nobody ran.

If any check fails, the result stays **advisory** — the ledger and blockers surface clearly, and the caller must not auto-execute. Likewise, under the emerging OS-binding contract, partial or failed evidence retrieval degrades the evidence and **holds the verdict** rather than manufacturing an autonomous answer from incomplete recall.

**Evidence discounting and decidability (in `evaluateDecisionPerspective`).** Before any profile recommends or arbitrates, each supporting item's effective weight is discounted multiplicatively:

```
effectiveWeight = confidenceWeight × freshness × evidenceGrade × reviewState × promotionState
```

- `freshness`: current `1.0` · stale `0.5` · superseded `0.2` · contradicted `0`
- `evidenceGrade`: A `1.0` · B `0.75` · C `0.4` · D `0`
- `reviewState`: approved `1.0` · draft `0.35` · rejected `0`
- `promotionState`: promoted `1.0` · candidate `0.45` · revoked `0`

Domain confidence is then penalized by risk tier (`low: 0`, `medium: 0.1`, `high: 0.25`, `critical: 0.5`) and by genuine **recent human overrules** in the last 30 days (capped at `0.3`, at `0.1` per overrule):

```
confidence = clamp01( baseScore − riskPenalty − min(0.3, recentOverrules × 0.1) )
```

Two operational lessons are wired directly into this formula:

- **Only real overrules penalize confidence.** Answering an escalation that carried no recommendation, or agreeing with the gate, never lowers confidence — otherwise working through a review queue would suppress the very next decision.
- **Every consult reports `decidability`.** Because `effectiveWeight` is a product, a low factor (such as `candidate` at `0.45`) can place an entire corpus's *ceiling* below the recommendation band no matter how many pages you add. Separating `material-below-confidence` ("author better material") from `ceiling-below-recommendation-band` ("promote or refresh what exists") tells the operator which lever will actually work.

### 5. From scores to an outcome

The gate returns one of four structured outcomes — never just prose:

| Outcome | Meaning |
|---|---|
| `recommend` | Enough signal to advise a path, with composite scores, margin, and per-principle contributions. Execution and approval still belong to the caller or GPP binding. |
| `arbitrate` | For decisions within the profile's risk ceiling and above its arbitration floor, the coworker may continue under the declared autonomy policy. Any dissenting view stays in the ledger. |
| `escalate` | Risk, conflict, low confidence, or policy boundaries require an accountable human resolver. |
| `defer` | The corpus lacks coverage to frame the decision responsibly. The gap is captured rather than guessed past. |

The default autonomy policy ships conservative: arbitration **off**, arbitration risk ceiling `low`, recommendation floor `0.55`, arbitration floor `0.85`. A `high` or `critical` risk tier escalates unless an explicit ratified policy admits it.

Code references:

- [`PRINCIPLE_TIER_DEFAULT_WEIGHT`, `PRINCIPLE_DIMENSIONS`, `PRINCIPLE_COST_DIMENSIONS`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/db/src/wiki-taxonomy.ts)
- [`PRINCIPLE_DIMENSION_SCOPE`, `PRINCIPLE_DIMENSION_SOURCING`, `projectVectorOntoSpine`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/db/src/dimension-scope.ts)
- [`PROFESSION_LOCAL_AXES`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/db/src/profession-local-axes.ts)
- [`option-scoring.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/validators/src/judgment/option-scoring.ts) — alignment, composite, guardrails
- [`consumer-context-attenuation.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision/consumer-context-attenuation.ts)
- [`evaluator.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/evaluator.ts), [`graduated-autonomy.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/graduated-autonomy.ts), [`build-studio-gate.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/build-studio-gate.ts)

---

## Autonomous decisions in practice — real examples from the ledger

DPF dogfoods its own decision substrate every day to build, triage, govern, and operate itself. Across nearly five months of live operation on DPF's own reference installation (2026-07-06 through 2026-11-27), the relational `DecisionInteraction` ledger recorded **6,098 governed decisions**:

| Outcome | Recorded count | Where it ran |
|---|---:|---|
| **`recommend`** | **2,506** | 2,194 `kernel-consult` (WWMD `principle_decide`), 232 `build-studio`, 43 `org-business` (WWWD), 37 other |
| **`arbitrate`** | **1,529** | 1,295 `backlog-triage`, 232 `build-studio`, 2 `profession` (WSID) |
| **`escalate`** | **1,265** | 954 `profession` (WSID), 102 `org-business` (WWWD), 102 `build-studio`, 95 `kernel-consult`, 12 other |
| **`defer`** | **753** | 409 `profession` (WSID), 331 `kernel-consult`, 13 `build-studio` |
| **Human rulings captured** | **549** | Recorded resolutions feeding back into doctrine and measurement |

*Note on evidence scope:* these figures are an observed operational snapshot from DPF's own dogfood installation, not a universal customer benchmark. They show what the substrate actually does under sustained daily load — including both where autonomy saved hours of human interruption and where honest escalation held the line.

### Example 1 — 15 open architecture questions resolved in one governed sweep (WWMD)

During the workspace-home architecture push (2026-06-04), five in-flight design and plan PRs accumulated **15 open architectural questions** — from caching boundaries and map-widget choice to shell-chrome ownership and fixture seeding. Normally those 15 questions would have stalled five PRs waiting for synchronous founder review.

Instead, every question was framed as 2–4 concrete options with explicit feature vectors and run through `principle_decide`:

- **12 of 15 verdicts confirmed** the proposed plan defaults with high confidence (margins from `0.24` to `3.57`, composites `5.33` to `6.17`) — producing an immutable ADR audit trail without waiting for a meeting.
- **3 of 15 verdicts caught and inverted** subtle architectural shortcuts *before a line of code was written*:
  1. Splitting the worker-mode shell-chrome switch into its own focused backlog item instead of coupling it into a vertical workspace PR (`margin 0.53`).
  2. Splitting `VerticalWorkspaceHome` into an explicit shared substrate component rather than letting "first PR wins" create a race (`margin 0.41`).
  3. Delegating HVAC fixture seeding to the universal orchestrator instead of a one-off admin button (`margin 2.78`).

**Time saved and autonomy facilitated:** Hours of back-and-forth review collapsed into one auditable design pass, and the platform's own principles caught three coupling defects before they became merge conflicts or technical debt.

### Example 2 — Autonomous backlog triage at scale (1,295 `arbitrate` decisions)

On an active software platform with dozens of concurrent workrooms, guards, and automated detectors filing defects, backlog triage quickly becomes a founder bottleneck. Under DPF's `backlog-triage` gate, well-scoped, verifiable maintenance and bug items are evaluated for scope clarity, risk, and policy alignment and arbitrated automatically:

- *"Stop leaking disposable Postgres volumes from synthetic restore builds" — build, or leave for a human?* → **`arbitrate` (`confidence: 0.98`, medium risk)** — clearly scoped cleanup bug with specified code, regression test, docs, and explicit exclusions.
- *"Backlog duplicate checks lose coverage when semantic search is unavailable"* → **`arbitrate` (`confidence: 0.92`, medium risk)**.
- *"Skill curator archives a brand-new empty skill on its first daily run: add an age grace floor before archival"* → **`arbitrate` (`confidence: 0.98`, medium risk)**.

**Time saved and autonomy facilitated:** Over **1,295 triage decisions** resolved autonomously with a recorded rationale per item, keeping the delivery queue moving continuously while reserving human triage attention for ambiguous, under-scoped, or high-impact work.

### Example 3 — Build Studio plan advancement and automated stall recovery

When an autonomous build hits a phase boundary or stalls, waking a human for every routine recovery destroys throughput. Two live paths illustrate how the gate keeps work flowing safely:

- **Governed design/plan advancement (`build-studio` gate: 232 `arbitrate`, 232 `recommend`, 102 `escalate`):** When a build's design and plan meet readiness and confidence thresholds under the active autonomy policy, the gate arbitrates advancement directly (`confidence 0.75–1.0`) and logs the ledger row; when confidence drops or a conflict surfaces, it pauses and escalates.
- **Automated `build-stall` recovery (`kernel-consult`):** When a build stops on an `empty-change` blocker with no damaging consequence, regulatory exposure, or restricted data, the kernel evaluates whether to wake a human or route recovery back to a coworker. Across repeated live incidents, `principle_decide` recommended **`route-to-agent`** (`composite 11.318`, `margin 6.285`, `confidence 0.99`, strongest contributors *Propose, Acknowledge, Reassign (PAR)* and *Ship Real Functionality*, **all 5 `autonomyEligible` quality gates passed**) — letting recovery proceed unattended instead of paging the operator.

### Example 4 — Complex infrastructure and ownership routing without a founder meeting

Autonomous coding agents working across multi-component architecture frequently hit genuine ownership and boundary questions. Two real November 2026 `kernel-consult` decisions show the vector math settling complex trade-offs cleanly:

- **Docker-authority migration (immutable portal recipe):** When moving the portal to a read-only root with no Docker socket, the legacy `ChangePromotion` path still ran `docker exec pg_dump` and `git apply` inside the portal container. `principle_decide` scored the architectural options and recommended **`route-via-governed-source-and-self-upgrade`** (`composite 12.381`, `margin 2.205`, `confidence 0.91`, top contributors *Research and Use Standards* and *Classify ambiguous requests before acting*, `autonomyEligible: true`).
- **Database backup and recovery-point ownership across converging planes:** Choosing between split backup writers versus consolidating recovery points under one governed owner, `principle_decide` recommended **`one-dpf-backup-writer`** (`composite 9.839`, `margin 2.039`, `confidence 0.95`, top contributors *Research and Use Standards* and *Single Source of Truth*, `autonomyEligible: true`).

**Time saved and autonomy facilitated:** Instead of stalling an agentic delivery thread overnight waiting for the founder to weigh in on ownership boundaries, Mark's documented platform principles resolved the trade-off transparently, cited the exact doctrine that carried the vote, and let the agent proceed to implementation and review.

### Example 5 — Honest escalation and craft guardrails (WSID and WWWD)

Autonomy is only trustworthy when the gate also knows when to **stop**. The live ledger's **954 WSID profession escalations**, **102 WWWD business escalations**, and **753 deferrals** are not failures of autonomy — they are proof that the safety rails actually fire:

- **WSID craft guardrails:** In Build Studio design and plan reviews, when `wsid-enterprise-architecture` detects high-risk scope or architectural misalignment (such as a design drifting onto the wrong domain or sitting below the `0.55` recommendation floor), the gate refuses to rubber-stamp it — returning **`escalate`** and opening a tracked corpus gap where craft coverage is thin. And at the code-craft level (as walked through in [Decision Perspective in Practice](../user-guide/ai-workforce/decision-perspective-in-practice.md)), asking whether to store invoice money as `FLOAT`, `DECIMAL(12,2)`, or integer cents triggers a **`commandmentConflict`** on `FLOAT` traced directly to ANSI SQL (ISO/IEC 9075) and DAMA-DMBOK.
- **WWWD business boundaries:** When a commercial customer asks for net-60 payment terms on a $12k job (`riskTier: high`) and the organization has no authored credit-terms stance yet, WWWD refuses to borrow platform doctrine as authority and returns **`escalate`** with framed options. Once the owner rules ("net-30 with a 25% deposit for accounts over 12 months old") and promotes that stance, the *next* similar request retrieves real organization doctrine instead of interrupting the owner again.

### Worked math example — reading a contribution ledger

To see how the column sums work in a single frame, suppose a `build-specialist` coworker builds an "overdue jobs" widget for a trades dispatcher board and asks (`domainClass: architecture-tradeoff`, `riskTier: medium`): *should this be generalized into the reusable workspace-home primitive library for the Hive Mind, or kept local to this install?* Each cell is `weight × alignment`:

| Principle (tier, weight) | Option A — keep local | Option B — parameterize for the hive |
|---|---:|---:|
| Learnings belong in the shared commons (commandment, 1.0) | +0.10 | **+0.85** |
| Architecture over shortcuts (core, 0.4) | +0.12 | **+0.32** |
| Speed to value (contextual, 0.1) | **+0.09** | +0.05 |
| **Composite** | **0.31** | **1.22** |

Option B wins with `margin = 0.91` (well above the `0.2` tie threshold), strong structured coverage, and zero commandment conflict. The contextual "ship faster" pull toward Option A is real, but at weight `0.1` it cannot override a commandment-tier reusability pull at `1.0`. The gate returns `recommend` Option B with the full contribution ledger; execution and approval remain governed by the stage's permission envelope.

---

## From a decision to a permission — and the next phase in GPP

An outcome from the decision ladder settles a *question*. It does not, by itself, make any tool reachable. The **[Gated Permissions Process (GPP)](gated-permissions-process.md)** is the standard that pairs the two.

Each stage of a Workroom's work shape carries a **Gated Permission** binding that names:

- which **authority scope** owns the gate (WWMD, WWWD, or WSID)
- which **capability set** an `admit` from that gate unlocks
- for which **subject scope** (repository, environment, customer, account)
- under what **preconditions**, **validity window**, and **stop conditions**

`TAK` then enforces the intersection on every call, and `GAID` records the receipt citing the binding version and gate decision. A strong score never widens the tool envelope, and holding a grant never answers who decided. See the [GPP pairing diagram](gated-permissions-process.md#73-the-pairing-at-a-glance) and [Build Studio as a GPP model](gated-permissions-process.md#annex-c-informative-build-studio-as-a-gpp-model).

### Where GPP stands today — stated plainly

DPF has already shipped the core GPP machinery: **47 declared work shapes**, **all four graph execution constructs** (parallel split/join, rework edges and refuse routes, non-interrupting stage deadlines, and sub-shapes), the first **document-compiled shape** (`inquiry-response-watch@1.0.0`), CI ratchets for consequence classification and unmediated tool call sites, and **HMAC-signed `GppPermit` handles** (`gpp1.<permitId>.<keyId>.<mac>`) bound to the SHA-256 `paramHash` of exact call arguments and sealed decision lineage.

**What is still the bottleneck today:** the live binding table currently carries only **two catch-all WWWD bindings** (`tak-alignment-admit` and `human-checkpoint-admit`), both matching every consequential tool generically and running in shadow mode. Because no per-focus-area binding yet couples routine operational tools directly to their owning WSID or WWMD decision mechanism, routine actions — releasing a nonprod test-environment lease, handing over a Workroom executor within the same scope — still fall through to human approval cards. That is the exact approval fatigue GPP exists to cure.

### The next phase in GPP: granular, focus-area operational bindings

We now have **35 defined decision axes**, **115 vectorized founder-kernel principles**, **27 WSID profession families (228 craft pages)**, and **47 work shapes**. The next phase of GPP is learning to apply those vectors and corpora in a **granular, operationally impactful way** — binding specific focus areas and tool sets directly to the scope and expert corpus that owns them:

> *"GPP is supposed to be a coupling of a permission gate — ideally `principle_decide` and its equivalents per WWMD, WWWD, or WSID level — each over a specific focus area. We are meant to be extensible, but in the right ways which each corpus helps steer."* — Mark Bodman

**The defining example — deleting a database: one tool, three contexts, three outcomes.**
Consider a single high-consequence capability: deleting a database. A naive per-tool policy either forbids it everywhere (crippling test-environment automation) or allows it everywhere (catastrophic in production). Under granular GPP focus-area bindings, **context — not just the tool name — governs the outcome**:

| Context | Owning GPP binding | Outcome |
|---|---|---|
| **Test / nonprod environment administration**, inside a Workroom whose mandate covers that environment | `devops-platform` (**WSID**) binding scoped to the nonprod subject | Admitted by the owning craft gate's decision; **no human interruption** |
| **Production**, inside an ordinary delivery Workroom | No binding admits a destructive production subject | **Refused**, or held for the owner with the exact consequence stated |
| **Production**, inside a **break-fix Workroom** whose approved approach is delete-and-rebuild | Break-fix stage binding on that exact production subject; preconditions: recorded approved approach, verified backup/restore point, recorded human acknowledgement, and a **single-use `paramHash`-bound permit** | **Admitted once** with a GAID receipt; post-implementation review is mandatory |

And the negative cases are enforced mechanically, not by prompt politeness: presenting a nonprod permit against a production database fails immediately with `param_mismatch`; presenting a break-fix permit outside its stage or after one use fails as expired/exhausted; a missing backup or acknowledgement holds with a named remedy.

Four concrete increments define this next phase:

1. **Focus-area bindings per discipline.** Replace catch-all predicates with named tool sets bound to their owning resolver: **WSID** (`evaluate_profession_decision`) for craft areas like `scrum-master` workroom handovers, `devops-platform` nonprod leases, `data-architect` schema changes, and `portfolio-management` spend checks; **WWMD** (`principle_decide`) for platform governance; **WWWD** (`evaluate_org_business_decision`) for business-outward commitments. Adding a new focus area means adding one binding and its owning corpus pages — no custom authorization code path.
2. **Tiered by measured usage and promoted one binding at a time.** Common, low-consequence tools earn standing workroom-mandate bindings; rarer or higher-consequence tools require narrower expert-admitted bindings. Each binding moves from shadow to `enforced` via an explicit, revertable PR backed by 14 days of clean `GppPermitObservation` evidence and zero direct unmediated call sites.
3. **Connecting vectors to live operational weights.** Wiring the shipped JSI medium-timescale weight inference engine (below) to live `DecisionInteraction` history so revealed human preferences surface as ratifiable weight proposals, and bridging owner-authored WWWD plain-language stances into measurable axis weights.
4. **Core OS-level convergence for scoped judgment.** Moving the pure `scoped-judgment` evaluator closer to the core OS execution seam while preserving one scorer, one doctrine store, one relational decision ledger, and strict fail-closed evidence semantics (*degrade the evidence, hold the verdict*).

---

## JSI: weights that learn the job

The scoring above uses declared weights. **Job-Specific Intelligence (JSI)** is the layer that lets those weights *learn* — carefully, on three deliberately different timescales, because a job is not a static corpus: two organizations with identical doctrine can still weigh the same trade-off differently, and that revealed difference is data.

The [TAK-JSI standard](job-specific-intelligence.md) defines the qualification side — how an identified coworker is shown fit for a specific job, activity, data scope, and risk context, and revalidated when any of those change. The mathematical side is specified in [Vector Decisioning and JSI](vector-decisioning-and-jsi.md) and implemented as follows:

| Timescale | What moves | Mechanism | Status |
|---|---|---|---|
| **Slow — doctrinal** | Commandments, spine axes, and principle dimension vectors | Pull request + scope-owner ratification; versioned in the kernel | **Shipped**, and deliberately slow |
| **Medium — revealed preference** | What accumulated human rulings reveal about an org's or role's real weights | Gate instrumentation → statistical weight inference → human-ruled proposals | **Engine & review surface shipped**; wiring live decision feed and applying ruled adjustments is the next increment |
| **Fast — contextual** | Situation-level modulation (season, live demand signals, stated urgency) | Validated correlate-to-outcome pilot ("attention, not backprop") | **Designed; not yet built** (one rental-seasonality pilot scoped) |

The medium timescale is built end-to-end as a **propose-and-rule pipeline, never a silent mutation**:

1. **Instrumented gates persist the comparison that matters.** Each decision row can carry the full `scoredOptions` vector set, the engine's `recommendedOptionId`, and the human's `chosenOptionId` (validated server-side against the scored set). Agreement is captured too — dropping it would bias inference toward disagreement.
2. **Weight inference looks for consistent separations.** Grouped by profile and domain class (never pooled across groups to fake sample size), each axis is tested: how often did the human's choice separate from the engine's recommendation in the same direction, and by how much? A proposal fires only past three hard gates — at least **8 samples**, **70% directional consistency**, and **0.1 mean separation**.
3. **Proposals enter at low authority and climb by ruling.** An inferred weight adjustment enters at confidence weight **0.3** — *below* even unconfirmed human-authored material (`0.6`), enforced by a runtime assertion — and only a human ruling promotes it. Rejected proposals stay rejected; nothing is silently overwritten.

This is the platform's answer to "how do the vectors get refined as companies use it": not by opaque online learning that silently drifts, but by turning every human choice into evidence, distilling evidence into legible proposals (*"this org consistently weighs customer goodwill higher than the default in refund decisions"*), and letting a human ratify each one — with the whole chain in the ledger.

Code references:

- [`weight-inference.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/weight-inference.ts), [`weight-inference-adapter.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/weight-inference-adapter.ts), [`weight-proposal-store.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/weight-proposal-store.ts)

---

## Earning autonomy: from passive to proactive

A decision gate answers "what should be done?" A separate set of dials answers "how much may this coworker do on its own initiative?" DPF keeps four dials distinct on purpose — and one rule binds all of them, straight from the TAK-JSI standard: **proactivity is not autonomy**. A more proactive coworker speaks up sooner and more often; it never thereby gains a capability, bypasses an approval, or exceeds a regulatory ceiling.

**1. The proactivity dial (per coworker, owner-facing).** Every coworker has a proactivity level — **quiet**, **balanced**, or **assertive** — that governs how it participates:

- *Quiet* waits to be asked: wide batching windows, no follow-up nudges, in-app notifications only, and an action boundary of **advise**.
- *Balanced* participates: it follows up once, uses your preferred channel, and may **propose** actions for approval.
- *Assertive* is an active participant: tight response windows, multiple follow-ups, urgent channels, escalation to the owner — but its boundary is still **propose**. No level's default reaches pre-authorized execution.

Defaults are derived per activity family (a security incident is always handled assertively; regulated work like tax compliance is forced back to *advise*), and the owner can override per coworker from the portal's proactivity surface. Two **hard floors survive every level**: money leaving the business and anything public-facing always require human approval. Coworkers can even propose their own dial change — after at least 5 consecutive approved-unchanged proposals, a coworker may suggest moving one step up, with a fixed, honest impact statement: it *"does not grant new tools, permissions, or approval bypasses."* The owner accepts or dismisses from their inbox.

**2. The org risk posture (per organization).** Conservative / balanced / progressive — this sets the autonomy **envelope** (the ceiling and how fast autonomy may mature), not the live level. Regulated industries default to conservative, and an industry default can only raise caution, never lower it.

**3. The decision autonomy policy (per decision profile).** The arbitration switches and confidence floors described in the outcome ladder above.

**4. Trust graduation (earned, per coworker × activity × risk class).** Actual autonomy is earned through a shadow-first ladder: **shadow → propose → supervised → autopilot**. In shadow mode the coworker decides silently alongside the human and its agreement is measured; graduating one level requires observed agreement over real decisions — 20 samples at 90% agreement for the early steps, 30 at 95% for autopilot. Every shadowed decision lands in a dedicated ledger and rolls up into a per-`(coworker, activity, risk-class)` trust state. Two ceilings are absolute: irreversible, outbound, financial, and access-control actions are **capped at "propose" forever**, and jurisdiction-specific regulatory policies intersect on top of everything. And one caveat is written into the standard itself: agreement with a human is *not* proof of competence — both may share the same blind spot — which is why risk tiers and hard floors never relax on agreement statistics alone.

What runs proactively today is itself governed: roughly 35 scheduled watchers and reconcilers (task watchdogs, queue-health and regression detectors, backlog triage drains, the daily governed tee-up loop that stages the next build for approval) — each catalogued, classified, and individually kill-switchable by the operator, with a parity test that fails the build if a job runs uncatalogued.

Code references:

- [`proactivity-resolver.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/validators/src/workroom-policy/proactivity-resolver.ts), [`proactivity-change-proposal.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/proactivity/proactivity-change-proposal.ts)
- [`risk-posture.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/govern/risk-posture.ts)
- [`trust-graduation.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/autonomy/trust-graduation.ts), [`regulatory-ceiling.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/autonomy/regulatory-ceiling.ts)

---

## The decision ledger

None of the above is trustworthy unless it is reconstructable after the fact. Every gate call — `recommend`, `arbitrate`, `escalate`, *and* `defer` — writes an append-only, hash-chained `DecisionInteraction` row: profile and profile version, gate key, domain class, question, options, scored options, the engine's recommendation and the human's choice, evidence bundle, cited sources, rationale, risk tier, confidence before and after, outcome, conflict flags, and any escalation or deferral capture. Profiles are never edited in place — a change snapshots a new version, so an old interaction always resolves against the doctrine that was live when it ran.

A coworker can act faster over time, but the organization can always reconstruct:

- what question was asked, and which layer owned it
- what the options were, and how each was scored
- what guidance was consulted, and what it cost the losing options
- why the gate allowed, blocked, escalated, or deferred
- whether a human overrode the recommendation — and how that overrule lowered future autonomy
- whether the unresolved decision became improvement material

The shadow ledger and trust states described above are a second, parallel record: they are how "this coworker has earned autopilot on invoice matching but is still proposing on refunds" is a queryable fact rather than a feeling.

A decision reaches the shadow ledger only when it names the coworker that made it. `DecisionInteraction.agentId` is a foreign key onto the coworker record; it is null for decisions no coworker made, such as the hourly triage drain or an operator's review. A decision that names a coworker gets exactly one ledger row, keyed by its interaction id. The row is written at `shadow` when the decision is recorded. When `record_decision_outcome` reports what was actually done, the same row receives the actual decision, the outcome and the agreement. Agreement stays null until that report arrives, and stays null for a report of "left unresolved". The two vocabularies are mapped by one explicit table, and a value missing from it is refused rather than placed in a nearby bucket:

| Decision `domainClass` | Ledger `activityType` |
|---|---|
| `plan-readiness` | `governed_decision_plan_readiness` |
| `architecture-tradeoff` | `governed_decision_architecture_tradeoff` |
| `risk-assessment` | `governed_decision_risk_assessment` |
| `professional-practice` | `governed_decision_professional_practice` |
| `kernel-consult` | `governed_decision_kernel_consult` |

| Decision `riskTier` | Ledger `riskClass` |
|---|---|
| `low` | `internal-reversible` |
| `medium` | `internal-irreversible` |
| `high` | `outbound-or-floor` |
| `critical` | `outbound-or-floor` |

The risk mapping matches the funding gate's mapping on the three tiers both share. The ledger records evidence and authorizes nothing: no code path reads a bridged row back to raise a trust level.

### Governed-decision trust state (report only)

A scheduled job, *Decision trust measurement* (every 6 hours, with a run-now event), turns the ledger into `TrustState` rows, one per coworker × activity type × risk class. Each pass does two things, and both are idempotent:

1. It backfills the ledger through the same writer a live decision uses. Most attributed decisions were made before the bridge existed, so a coworker would otherwise be missing from the measurement. A backfilled row carries the decision's own time. A row whose decision has since been resolved is completed.
2. It recomputes every governed-decision `TrustState` from the whole ledger: `sampleCount`, `agreementCount`, `agreementRate`, `lastLedgerId` and `lastEvaluatedAt`.

Only human-resolved decisions are samples. A coworker's report on its own decision is counted separately and never pooled into the rate. A decision with no known resolution is counted as unresolved, and one the kernel abstained on is counted as having no recommendation.

A new row is created at `shadow`. An update never writes `currentLevel`, and the stored recommendation is always a fixed hold at `shadow`. No code path in this measurement raises a level or recommends raising one. Graduation is a separate decision for the accountable owner, taken against these numbers.

`report_decision_trust_state` (MCP, read-only) shows the sample count beside each rate. It withholds the rate below 10 human-resolved samples, the smallest sample the trust rules act on, and shows "insufficient samples" in its place. A coworker with attributed decisions that no trust row covers yet is listed rather than left out. Every report says what it cannot show: agreement is concordance, not correctness, and a human who rubber-stamps produces high agreement and no information.

Code references:

- [`DecisionInteraction`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/packages/db/prisma/schema.prisma), [`persistDecisionInteraction`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision-perspective/persistence.ts)
- [`decision-shadow-ledger-mapping.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision/decision-shadow-ledger-mapping.ts), [`decision-shadow-ledger-bridge.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision/decision-shadow-ledger-bridge.ts)
- [`decision-trust-state.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision/decision-trust-state.ts), [`decision-trust-state-store.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision/decision-trust-state-store.ts)

---

## The learning loop

The most important output is not the recommendation — it is the gap signal. When a gate escalates or defers, the platform has discovered that its doctrine is under-specified, conflicted, stale, or too weakly evidenced for the current class of work. Four feedback paths turn that into compounding trust:

1. **Escalation resolutions become doctrine.** A human ruling is captured as draft material and climbs the promotion ladder (`unconfirmed` → `confirmed` → `ruled`) into the owning corpus — org stances for WWWD, profession pages for WSID, kernel candidates for WWMD.
2. **Overrules cut autonomy immediately.** The 30-day overrule penalty in the confidence formula means genuine human disagreement is felt on the very next call.
3. **Revealed preference becomes weight proposals.** The JSI medium timescale distills consistent human choices into human-ruled weight adjustments.
4. **Drift is caught against golden decisions.** Canonical decisions are re-scored when the corpus changes; a corpus edit that flips one, or thins its margin, is flagged before it silently changes behavior.

That is the autonomy flywheel: coworker encounters ambiguity → gate consults the owning layer → outcome with full ledger → human resolution captured where needed → reviewed resolutions improve the corpus, the weights, and the GPP bindings → future coworkers answer the same class of question with higher confidence and less interruption. The platform does not hide uncertainty; it turns uncertainty into governable work. A new install's coworkers escalate often — honestly. A mature install's coworkers escalate rarely — demonstrably.

---

## Precedent, adjacent approaches, and what makes DPF distinct

Good architecture builds on real precedent rather than pretending nothing came before it. DPF's decision and autonomy model composes established governance and decision-science foundations — and addresses a concrete gap that current 2025–2026 agent platforms leave split across silos. (Full dated citations, incident records, and verification limits live in the [2026 Market and Thought-Leadership Landscape brief](agent-governance-market-landscape-2026.md).)

### Precedent and adjacent approaches

| Category | Nearest peers & ancestors | What they solve well | What they leave unsolved |
|---|---|---|---|
| **Deterministic tool policy engines** | **AWS Bedrock AgentCore Policy (Cedar)**, **OPA / Rego**, **Permit.io**, **OpenFGA** | Default-deny, parameter-aware `permit` / `forbid` checks at the tool gateway (`principal × action × resource × context`). Closest technical peers on enforcement — and substrates GPP bindings can compile onto. | Model *who may invoke a tool*, not *how an ambiguous decision was weighed*, *whose doctrine owned it*, or *which recorded judgment admitted a work stage's capability envelope*. |
| **Approval-fatigue classifiers** | **Anthropic Claude Code Auto Mode** | Secondary reasoning-blind AI classifier that approves or blocks tool calls in real time instead of interrupting humans on every step. | **Probabilistic** — vendor-reported 17% false-negative rate on real overeager actions and published prompt-injection bypasses — with no organization doctrine, no principle traceability, and no named owning authority. |
| **Prompt-injection containment** | **Google DeepMind CaMeL**, **Meta's *Agents Rule of Two***, Simon Willison's *Lethal Trifecta* | Architectural control/data-flow separation and co-occurrence constraints preventing untrusted input + private data + outbound action from chaining silently. | Complementary runtime safety rather than decision governance; GPP adopts Meta's Rule of Two directly ([GPP §8](gated-permissions-process.md#8-capability-co-occurrence)). |
| **Enterprise agent governance suites** | **Microsoft Entra Agent ID / Copilot Studio**, **Salesforce Agentforce Trust Layer**, **ServiceNow AI Control Tower**, **Auth0 for AI Agents**, **Credo AI**, **IBM watsonx.governance** | Agent identity and sponsors, CRM/M365 permission inheritance, DLP, out-of-band human approvals, and governance catalogs. | Fractured across silos: identity vendors own identity, cloud gateways own ACLs, governance suites catalog policies without inline tool binding. All assume dedicated enterprise IAM/security teams. |
| **Organizational & formal ancestors** | **ITIL Change Enablement** (pre-authorized *standard changes* vs. *normal changes*), **subsidiarity** (TEU Art. 5(3)), **SAW/MCDA** (1954/1981), **GRADE** evidence discounting (2008), **Ibrahim & Li** (*Overlaying Governance*, arXiv 2606.03518, 2026) | Pre-authorizing a *class* of change rather than each execution; local-scope authority; transparent multi-criteria scoring; formal scope-attenuated delegation. | Organizational norms are not machine-enforced at tool-call time; formal delegation models do not pair three non-inheriting doctrine scopes with vector scoring and versioned work-shape stages. |

### What is genuinely distinct in DPF

No commercial platform or open-source stack reviewed puts these five elements together into one operating substrate:

1. **Three non-inheriting decision scopes enforced by subsidiarity (WWMD · WWWD · WSID).** Platform/founder doctrine, an organization's own business stance, and 27 source-traced professional craft corpora remain strictly separate — refusing to let platform preferences silently dictate a customer's business decisions.
2. **Inspectable multi-vector MCDA judgment (35 axes + single-hop craft projection + contribution ledger).** Rather than opaque RAG prose or a black-box classifier, every recommendation exposes which principles voted, by how much, whether the outcome survives ±10% weight swings, and whether a commandment tripped.
3. **Binding decision rights directly to tool reach (GPP).** Connects *who decided a class of work is admissible* directly to *which exact tools and subjects become reachable* for one Workroom stage, with HMAC/`paramHash`-bound permits enforced by TAK and receipted by GAID.
4. **Confidence as a governed operating state plus revealed-preference learning.** Human overrules drop confidence immediately, coverage gaps stay honest (`defer` / `New proposition` / `decidability` ceilings), and human rulings climb back into doctrine and ratifiable weight proposals.
5. **One cohesive operating platform rather than bolted-on security middleware** — running on one canonical relational spine so context, decisions, Workrooms, and audit trails share one source of truth.

### Why this matters for real companies — from small businesses to enterprise scale

- **Small and mid-sized businesses (the most underserved market):** Every major 2026 governance product assumes a cloud security team, IAM engineers, and a sprawling enterprise SaaS estate. A trades firm, clinic, retailer, or professional-services practice will never write Cedar policies or staff an AI governance committee — yet they still need AI coworkers they can trust without babysitting every click. DPF keeps the 35-axis vector math and standards plumbing under the hood while giving owners **8 plain-language stance cards with explicit dollar ceilings (WWWD)**, **27 pre-built professional craft corpora (WSID)** so coworkers act like qualified practitioners on day one, and **hard floors** where money leaving the business and public-facing actions always come to a person.
- **Enterprises at scale:** Large organizations already experimenting with agents face a wide governance gap — Gartner projects over 40% of agentic AI projects cancelled by end of 2027 largely over inadequate risk controls. Enterprises do not have to discard AWS, Microsoft, ServiceNow, Cedar, or OPA to use these ideas: DPF's open working-draft standards (`TAK`, `GAID`, `TAK-JSI`, `GPP`) and portable `scoped-judgment` / GPP architecture define the missing **decision-rights-to-permissions layer** that composes cleanly above existing identity and gateway substrates.

*Claim discipline:* DPF claims the architecture, the shipped three-scope corpora, the 35-axis scoring engine, and the observed 6,098-decision reference ledger. It does not claim measured GPP enforcement efficacy or standards certification while focus-area bindings remain in transition from shadow mode to enforcement (see [Current boundaries](#current-boundaries) and [Market brief §7](agent-governance-market-landscape-2026.md#7-implications-for-dpfs-public-claims)).

---

## Current boundaries

Stated plainly, because trust requires knowing what is *not* built yet:

- The gate is advisory unless a caller's autonomy policy or ratified GPP binding explicitly allows arbitration for that risk tier and subject; the default policy ships with arbitration off. It is never a bypass around approval, authorization, test gates, source control, or runtime safety controls.
- GPP permit bindings currently run in **shadow mode** on two catch-all WWWD bindings; per-focus-area WSID/WWMD/WWWD bindings and individual shadow-to-enforced promotions are the active next phase.
- The JSI medium timescale is built as a propose-and-rule pipeline, and the review surface is live; wiring it to generate proposals continuously from accumulating live decisions — and to apply a ruled proposal back into a profile's weights — is the next increment. The fast (contextual) timescale is designed but not implemented.
- Owner-authored WWWD stance pages steer decisions via retrieval and evidence discounting today; expressing plain-language stances directly as structured weights on the decision axes is not yet built (see [Decision Vectors §8.2](decision-vectors.md#82-the-honest-boundary-between-the-two-layers)).
- WSID profession corpora are lexically ranked today for cold-install determinism; vector-indexing them is a planned extension as corpora grow. Growth gaps are recorded from real use either way.
- WWWD corpora start sparse on every new install by design — early escalations are the system working, not failing. The eight starter stance vectors give day-one coverage for common commercial and operational calls.
- Trust graduation ceilings are hard: outbound, irreversible, financial, and access-control actions never graduate past "propose," and regulatory ceilings intersect on top.
- Runtime commandment enforcement is related but separate: it blocks or escalates execution attempts that violate tier-1 rules regardless of what any gate recommended.

---

## Companion reading

- [Decision Vectors — the complete reference](decision-vectors.md) — every axis defined (all 16 spine, 8 profession-local, and 11 namespaced craft axes), sign conventions, sourcing classes, and status
- [Decision Vectors by Business Type](decision-vectors-by-archetype.md) — how axis emphasis, hard gates, and craft axes shift across lines of business
- [Vector Decisioning for JSI — Mathematical Foundations](vector-decisioning-and-jsi.md) — SAW/WSM, GRADE discounting, Bradley-Terry/revealed preference, and external prior art
- [Gated Permissions Process (GPP)](gated-permissions-process.md) — the binding standard pairing decision scopes with stage tool envelopes
- [Decision Perspective in Practice](../user-guide/ai-workforce/decision-perspective-in-practice.md) — step-by-step operator walkthroughs of WWMD, WWWD, and WSID
- [Trusted AI Kernel (TAK)](trusted-ai-kernel.md) · [GAID](GAID.md) · [Job-Specific Intelligence (TAK-JSI)](job-specific-intelligence.md)

The north star is unchanged: AI coworkers gain more room to act only when the decision path is more inspectable, better evidenced, and easier to override.
