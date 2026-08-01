# Architects forum — CADA & cloud sovereignty: deck outline + speaker notes

*Prepared 2026-06-19 for the September 2026 architects forum. Companion to the [strategy briefing](2026-09-cada-cloud-sovereignty-architects-forum.md). Every claim is referenced — see Appendix A (legislation) and Appendix B (DPF architecture). Target length ~25–30 min + Q&A; ~14 slides.*

**How to use:** each slide block below has **On slide** (what the audience sees — keep it sparse), **Say** (speaker notes), and **Refs** (drill-down citations, keyed to the appendices). The hero slide (3) is the four-tier ladder visual already produced in this work (re-exportable on request).

---

### Slide 1 — Title
- **On slide:** "Cloud & data sovereignty just became law. What it means for how we architect." · subtitle: *The EU Cloud and AI Development Act (CADA) and a sovereign-by-construction reference architecture.*
- **Say:** Two weeks before this was drafted, the Commission turned a decade of voluntary sovereignty initiatives into a binding, tiered law. The job today: understand the ladder, and show an architecture that can actually reach the top of it.
- **Refs:** A1, A2.

### Slide 2 — The shift: from politics to procurement law
- **On slide:** Timeline — GDPR (2018) → Data Act/DGA → EUCS (sovereignty stripped, 2024) → **CADA proposed 3 June 2026**. One line: *"sovereignty moved from aspiration to binding procurement + infrastructure law."*
- **Say:** EU providers' share of the European cloud fell from ~29% (2017) to ~15% (2022); the Commission frames that dependence as an autonomy risk. EUCS was meant to certify sovereignty and failed after a 5-year deadlock — CADA exists to fill exactly that gap. It's a **proposal**: Parliament/Council/trilogue ahead, realistic application 2027–2028. Architect's takeaway: don't wait for final text — GDPR taught us that late-start rework is expensive.
- **Refs:** A1, A3, A5 (EUCS/CSF backstory), A6.

### Slide 3 — HERO: the four-tier sovereignty ladder *(the four-tier ladder visual)*
- **On slide:** the ladder — L1 residency / L2 independence + SBOM / L3 EU-owned / L4 no third-country interference — with the red line between L2 and L3: *"US-owned cloud cannot cross this."*
- **Say:** The whole law reduces to one question you can apply to any "sovereign cloud" claim: **who ultimately owns the operating entity, and what law reaches them?** Data location is the floor (L1), never sufficient for the top. L3 gates on EU *ownership*; L4 on *no third-country interference possible*. The Commission estimates L4 applies to ~1% of public services — but L2/L3 will cascade widely.
- **Refs:** A2, A3 (tier criteria), A4 (the ownership argument), B1 (our architecture note encodes these as REQ-CADA-1…8).

### Slide 4 — Why hyperscaler AI is capped at L1–L2
- **On slide:** CLOUD Act §2713 + FISA 702 → reach the US parent regardless of EU datacenter. Quote: Microsoft's legal director, under oath to the French Senate (June 2025), could not guarantee French data against US authorities.
- **Say:** An EU subsidiary 100%-owned by a US parent doesn't break the chain — data location is "legally irrelevant when the provider is subject to US jurisdiction." AWS and Oracle decline to claim CLOUD Act immunity at all. So Copilot / Gemini Enterprise / Bedrock are structurally L1–L2. This is a corporate-law fact, not an engineering gap — which is *why the architecture has to be different*.
- **Refs:** A4, A7 (Microsoft under oath), A8 (Schrems III instability).

### Slide 5 — Who's in scope, and the cascade
- **On slide:** Mandatory: EU public-sector cloud procurement. Cascades: NIS2 essential entities (energy/health/transport/water), DORA-regulated finance, and **their suppliers**. Affected countries: 27 EU + 3 EEA-EFTA; everyone else = "third country."
- **Say:** Even private firms not directly named get pulled in two ways: bidding for public contracts (sovereignty terms get embedded contractually before CADA is even binding), and subcontracting to regulated entities. It interlocks with DORA, NIS2, the AI Act (high-risk from 2 Aug 2026), and GDPR adequacy. The architect's point: **applicability is region- and archetype-scoped** — CADA only bites if you operate in or sell to the EU, the same way GDPR keys off selling and PCI is global. So the first question for any regulation isn't "what tier" — it's "does this even apply to us, given where we operate/sell and what kind of business we are." Our platform gates on exactly that before it assesses.
- **Refs:** A3 (scope + cascade), B6 (affected countries as data — `eu-jurisdictions.ts`), B12 (region/archetype applicability gating — `regulation-applicability.ts`).

### Slide 6 — The architecture that *can* reach the top
- **On slide:** Four moves: **self-host** (L1 by construction) · **open source** (L2 transparency + neutralizes L3/L4 vendor-control) · **local AI** (the L4 "no inference egress" test) · **EU-held keys + EU-native infra** (L3/L4 ownership).
- **Say:** None of these is exotic — but together they're the only combination that crosses the red line. Open source is the multiplier: it satisfies supply-chain transparency *and* removes the "a foreign vendor controls the software" objection, because the customer can run, audit, and fork. This is the general pattern any architect can apply — and it's the pattern our platform is built on.
- **Refs:** B2 (principle: *data sovereignty follows control, not location*), B3 (prefer-self-hosted), A3 (L2/L4 criteria).

### Slide 7 — Sovereign by construction (how DPF embodies it)
- **On slide:** DPF = the AI-native platform that **runs on the customer's own infrastructure** → *inherits* the tier of where it's deployed. Single-tenant, self-hosted, open source, local-only-capable inference.
- **Say:** The key architectural insight: we're not a SaaS that has to certify itself as sovereign — we're the application layer that inherits the infrastructure's tier. On EU-owned infra with local AI, a DPF install is part of an L3/L4 solution a US SaaS can never be. The local-only switch is real and load-bearing: it pins inference to local providers and **fails loudly** rather than silently reaching a cloud — that *is* the L4 no-egress control.
- **Refs:** B1, B4 (deployment contracts: single-tenant self-hosted), B5 (`local-only.ts`, `pipeline-v2.ts:136` — the residency gate + loud failure).

### Slide 8 — The evidence trail (what auditors/procurement now demand)
- **On slide:** `RouteDecisionLog` (which model/provider served each request) · `ChangeRequest` (ITIL change register) · `ToolExecution` (every tool call) · retention governance.
- **Say:** Sovereignty claims have to be *provable*, not asserted. We emit the route-decision log that proves local-only routing actually held, an immutable change register, and a full tool-execution audit — exactly the evidence the CSA control matrices (AICM/CCM, STAR for AI) and BSI C5 / SecNumCloud assessments ask for. The CADA-readiness assessment (next slide) reads these.
- **Refs:** B1 (REQ-CADA-5), A3 (CSA evidence expectations).

### Slide 9 — LIVE DEMO: "what tier is this install?"
- **On slide:** terminal output of `check-cada-readiness.ts` — three beats: **applicability** (does CADA apply?), **signal-based tier** (Level 3), and **governance control coverage** (4/8 implemented; planned = the L4 build-out).
- **Say:** This isn't a slide of aspirations — it's running on the platform today. First beat lands the region-specificity point live: with no EU nexus declared the tool says **"not applicable — out of scope"**; toggle `--operates-in eu` and it flips to an in-scope assessment. Then it reads the *real* local-only setting + the registered CADA controls: an EU-deployed install with local-only on is **Level 3**; the path to **Level 4** is exactly the three planned controls — signed SBOM, EU-held keys, an EU steward. The honest gap, surfaced automatically. *(Run the demo; have a screenshot fallback.)*
- **Refs:** B7 (`cada-readiness.ts`, `check-cada-readiness.ts`, the `assessCadaReadiness` action), B8 (governance seed), B11 (PRs), B12 (applicability gating).

### Slide 10 — The partner reference stack
- **On slide:** layered table — IaaS: OVHcloud / StackIT / Scaleway · AI: Mistral-on-vLLM · keys: Thales / Cosmian · confidential compute: Edgeless + SEV-SNP/TDX · rubric: CSF/SEAL 0–4.
- **Say:** You don't build sovereign infrastructure — you deploy onto the EU-sovereign layer and bundle the right AI + key partners. Hyperscaler "sovereign" tiers are L1–L2 only; for L3+ the relationship must shift to the EU operator (T-Systems, S3NS/Thales, Bleu, Delos). Map your own self-assessment to the Commission's CSF/SEAL — it's the rubric they actually procure against (€180M awarded under it in April 2026).
- **Refs:** A5 (CSF/SEAL), strategy briefing §5 (full provider analysis).

### Slide 11 — Beyond the platform: governing the whole estate
- **On slide:** the bigger play — assess/plan/manage sovereignty across discovered infrastructure, edge nodes, and the external apps a company runs *outside* the platform. Epic `EP-ESTATE-SOVEREIGNTY`.
- **Say:** CADA's obligation isn't limited to one platform — it spans the estate. The same scoring primitive that grades this install can grade every host, edge node, and third-party SaaS a company depends on, and file the gaps as tracked work. That's the roadmap: turn the readiness assessment into estate-wide posture management.
- **Refs:** B9 (estate-sovereignty design spec), B10 (the scoring primitive that generalizes).

### Slide 12 — Honest caveats (credibility with this audience)
- **On slide:** CADA is a *proposal* (tiers may shift in trilogue) · nothing is "CADA-certified" yet · confidential computing ≠ a substitute for EU ownership · the NVIDIA-GPU supply chain is an industry-wide caveat — disclose, don't overclaim.
- **Say:** Architects will test for overclaiming, so name the limits first. We map to proxies that exist today (BSI C5, SecNumCloud, CSF/SEAL), and we're explicit that our own L4 story needs a governance step (EU steward + signed SBOM) we haven't shipped yet — the readiness tool says so itself. Credibility comes from showing the gaps.
- **Refs:** A2 (proposal status), strategy briefing §6 (caveats), B1 (planned vs green in the arch note).

### Slide 13 — Call to action
- **On slide:** "Start with a CADA-readiness assessment." Three steps: map your estate to the four tiers → identify the ownership cap → place sovereignty-sensitive workloads accordingly.
- **Say:** Whatever stack you run, the first move is the assessment the CSA says every enterprise should do now: which of your providers can reach which tier, and where does foreign ownership cap you? We can run that assessment — and for AI workloads, offer an architecture that reaches L3/L4 where hyperscaler AI can't.
- **Refs:** A3 (CSA readiness guidance), B7 (our assessment).

### Slide 14 — Appendix pointer / Q&A
- **On slide:** "References: legislation + architecture" · contact / repo pointers.
- **Say:** Everything in this talk is sourced — primary legislation and our shipped, verified architecture. Happy to go deep on any tier, the routing internals, or the estate roadmap.

---

## Appendix A — Legislation references

- **A1** — [European Commission · Cloud and AI Development Act (policy)](https://digital-strategy.ec.europa.eu/en/policies/cloud-and-ai-development-act)
- **A2** — [European Commission · Proposal for the CADA (library)](https://digital-strategy.ec.europa.eu/en/library/proposal-cloud-and-ai-development-act-cada)
- **A3** — [Covington / Inside Global Tech · "The EU Cloud and AI Development Act in Depth"](https://www.insideglobaltech.com/2026/06/11/the-eu-cloud-and-ai-development-act-in-depth/) (scope, four levels, obligations, cascade) · [Cloud Security Alliance · CADA enterprise-compliance note](https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-cloud-ai-development-act-cada-complianc/) (readiness, evidence, controls)
- **A4** — [Jones Day · proposed sovereignty framework / compliance tiers](https://www.jonesday.com/en/insights/2026/06/european-commissions-proposed-cloud-sovereignty-framework-creates-new-compliance-tiers-for-software-providers) · [Wilson Sonsini · Commission proposes Act to reduce reliance on foreign cloud and AI](https://www.wsgr.com/en/insights/european-commission-publishes-proposal-for-act-to-reduce-reliance-on-foreign-cloud-and-ai.html)
- **A5** — [EC · Sovereign Cloud Framework explained (CSF / SEAL 0–4)](https://commission.europa.eu/news-and-media/news/sovereign-cloud-framework-explained-2026-06-01_en)
- **A6** — [Global Policy Watch · The EU Cloud and AI Development Act in depth](https://www.globalpolicywatch.com/2026/06/the-eu-cloud-and-ai-development-act-in-depth/) (market-share, package context)
- **A7** — [The Register · Microsoft sovereignty / cannot guarantee data vs US authorities](https://www.theregister.com/2025/11/07/microsoft_announces_strengthening_of_sovereignty/)
- **A8** — [Stanford Law · Schrems III and the future of transatlantic privacy](https://law.stanford.edu/publications/no-151-schrems-iii-the-future-of-transatlantic-privacy-law-after-latombe-v-commission/) · [Raconteur · what sovereign cloud means in new laws](https://www.raconteur.net/global-business/eu-cloud-and-ai-development-act-what-sovereign-cloud-means-in-new-laws)
- Related frameworks: **DORA** (Reg. 2022/2554, in force 2025-01-17), **NIS2** (Oct 2024), **EU AI Act** (high-risk from 2026-08-02), **GDPR** adequacy.

## Appendix B — DPF architecture references

- **B1** — Architecture note: [`docs/architecture/2026-06-19-cada-cloud-sovereignty-architecture-note.md`](../architecture/2026-06-19-cada-cloud-sovereignty-architecture-note.md) — REQ-CADA-1…8, CON-CADA-1, allocations, verification cases.
- **B2** — Principle: [`data-sovereignty-follows-control`](../founder-kernel/wiki/principles/data-sovereignty-follows-control.md).
- **B3** — Principle: [`prefer-self-hosted-infrastructure`](../founder-kernel/wiki/principles/prefer-self-hosted-infrastructure.md).
- **B4** — Deployment doctrine: [`docs/superpowers/specs/2026-05-09-deployment-contracts.md`](../superpowers/specs/2026-05-09-deployment-contracts.md) (single-tenant, self-hosted; `docker-compose.yml`).
- **B5** — Local-only inference gate: [`apps/web/lib/inference/local-only.ts`](../../apps/web/lib/inference/local-only.ts), [`apps/web/lib/routing/pipeline-v2.ts:136`](../../apps/web/lib/routing/pipeline-v2.ts) — the residency filter that fails loudly.
- **B6** — Affected-countries reference: [`packages/db/src/eu-jurisdictions.ts`](../../packages/db/src/eu-jurisdictions.ts) (27 EU + 3 EEA, `isThirdCountryForCada`).
- **B7** — Readiness assessment: [`packages/db/src/cada-readiness.ts`](../../packages/db/src/cada-readiness.ts), operator script [`packages/db/scripts/check-cada-readiness.ts`](../../packages/db/scripts/check-cada-readiness.ts), action [`apps/web/lib/actions/sovereignty.ts`](../../apps/web/lib/actions/sovereignty.ts).
- **B8** — Scoring primitive: [`packages/db/src/sovereignty-assessment.ts`](../../packages/db/src/sovereignty-assessment.ts) (CON-CADA-1; third-country operator capped at L2).
- **B8b** — Governance registration: [`packages/db/scripts/seed-cada-regulation.ts`](../../packages/db/scripts/seed-cada-regulation.ts) + corpus page [`docs/professions/legal-compliance/wiki/eu-cada-cloud-sovereignty.md`](../professions/legal-compliance/wiki/eu-cada-cloud-sovereignty.md).
- **B9** — Estate roadmap: [`docs/superpowers/specs/2026-06-19-estate-sovereignty-governance-design.md`](../superpowers/specs/2026-06-19-estate-sovereignty-governance-design.md) (epic `EP-ESTATE-SOVEREIGNTY`).
- **B10** — Strategy briefing (partner stack, marketing, full analysis): [`docs/strategy/2026-09-cada-cloud-sovereignty-architects-forum.md`](2026-09-cada-cloud-sovereignty-architects-forum.md).
- **B11** — Shipped + CI-verified: PRs [#2080](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2080), [#2084](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2084), [#2089](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2089), [#2095](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/2095).
- **B12** — Region/archetype applicability gating: [`packages/db/src/regulation-applicability.ts`](../../packages/db/src/regulation-applicability.ts) — `regulationApplies` reuses `PROFESSION_JURISDICTION_BASES`; CADA assessed only on an EU operating/selling nexus. Generalizes to GDPR (selling), DORA (operating + archetype), PCI-DSS (global).

## Appendix C — Live demo script

1. On the install host: `cd packages/db && npx tsx scripts/check-cada-readiness.ts --operator DE --data-in-eea`
2. Talking point as it prints: real `local-only=ON` is read from `PlatformConfig`; the EU-declared scenario lands at **Level 3**; **governance controls 4/8 implemented**, the 3 planned being the Level-4 build-out.
3. Fallback if offline: screenshot of the above output (capture beforehand).
4. Optional contrast: `--operator US` → capped at **Level 2** with the ownership-cap message — drives home the red line on the hero slide.
