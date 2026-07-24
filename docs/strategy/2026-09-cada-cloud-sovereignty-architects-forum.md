# CADA & cloud sovereignty — strategy briefing for the architects forum (Sept 2026)

*Prepared 2026-06-19. CADA was proposed 2026-06-03, so this post-dates the assistant's training data; all legislative detail below is from primary/secondary sources cited inline. CADA is a **proposal**, not yet binding law — see caveats at the end.*

---

## 0. TL;DR

The EU **Cloud and AI Development Act (CADA)**, published by the European Commission on **3 June 2026**, turns cloud/data sovereignty from political aspiration into **binding procurement and infrastructure law** for the first time. Its centrepiece is a **four-tier "Union assurance level" framework**. The decisive axis is **ownership of the operating entity — not where the data sits**: a US-owned provider can reach Levels 1–2 but is structurally barred from Levels 3–4 by the US CLOUD Act (18 U.S.C. § 2713) and FISA 702, regardless of EU data-centre location.

**DPF's strategic position is unusually strong, because DPF is not a cloud — it is the application/AI layer that runs *on the customer's own infrastructure*.** That means DPF *inherits* the sovereignty tier of the infrastructure it's deployed on, and three shipped DPF properties push that ceiling to the top of the ladder:

1. **Self-hosted, single-tenant, customer-owned** → data physically in the customer's EU infrastructure (Level 1 by construction).
2. **Local-only AI inference that fails loudly** (no silent cloud fallback) → directly satisfies the Level-4 "no AI-inference-data egress" test that hyperscaler AI cannot meet.
3. **Open source** (public repo, DCO) → satisfies Level-2 supply-chain transparency *and* neutralises the Level-3/4 vendor-control objection, because the customer can run, audit, and fork the code.

The product play is a **"DPF Sovereign Edition"** deployment profile: DPF on EU-native IaaS (OVHcloud / StackIT / Scaleway), **Mistral** open-weights on **vLLM** for AI, **Thales/Cosmian** EU-held keys via HYOK, confidential computing as a strengthener — with the platform's existing **audit/route-decision log** providing the compliance *evidence* CADA and the CSA control matrices demand.

---

## 1. What CADA is

### 1.1 Origin, status, timeline
- **Published 3 June 2026** by the European Commission as part of a broader digital-sovereignty package (alongside chip/energy measures). ([European Commission — CADA policy page](https://digital-strategy.ec.europa.eu/en/policies/cloud-and-ai-development-act); [Covington — "in depth"](https://www.insideglobaltech.com/2026/06/11/the-eu-cloud-and-ai-development-act-in-depth/))
- It is a **proposed Regulation**. Next it goes to the European Parliament and Council, then **trilogue** — which for complex digital files historically takes **12–36 months**, so realistic application is **2027–2028**. ([CSA research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-cloud-ai-development-act-cada-complianc/))
- Motivation: EU-based providers' share of the European cloud market fell from **~29% (2017) to ~15% (2022)**; the Commission frames this dependence as a digital-autonomy risk. ([Global Policy Watch](https://www.globalpolicywatch.com/2026/06/the-eu-cloud-and-ai-development-act-in-depth/))

### 1.2 Two pillars
**Pillar A — capacity / infrastructure.** Triple EU data-centre capacity within **5–7 years**; "acceleration zones" with a **maximum 12-month permitting timeline**; Commission may designate **strategic projects** for funding; target of sufficient EU capacity by **2035**. ([Covington](https://www.insideglobaltech.com/2026/06/11/the-eu-cloud-and-ai-development-act-in-depth/))

**Pillar B — the cloud sovereignty framework + procurement** (the part that matters for us).

### 1.3 The four Union assurance levels
Criteria across the levels: control over the service, control over the supply chain, treatment of data, infrastructure location, and cybersecurity. ([Covington](https://www.insideglobaltech.com/2026/06/11/the-eu-cloud-and-ai-development-act-in-depth/); [WSGR](https://www.wsgr.com/en/insights/european-commission-publishes-proposal-for-act-to-reduce-reliance-on-foreign-cloud-and-ai.html))

| Level | Core test | Key obligations (Covington analysis) |
|---|---|---|
| **L1** (baseline) | Data processed/stored on **EU infrastructure** | Infrastructure, assets, customer data in the EU; third-country-controlled providers must guarantee **non-disclosure of unexploited vulnerabilities** to third-country authorities. |
| **L2** (critical sectors) | **Independence from third countries** + supply-chain transparency | All **personnel, infrastructure, assets in the EU**; EU cloud certification (EUCS) compliance; measures preventing third-country data access and sanctions/trade-control exposure; full **SBOM**; **source-code audits** for third-country components; legal/technical/organisational **separation from non-EU subsidiaries**. |
| **L3** (ownership) | Provider **owned and controlled in the EU** | Derogation only where the Commission recognises a third country meets conditions: holds a **GDPR adequacy decision**, cannot compel service degradation, and keeps its market open to EU providers. |
| **L4** (defence / national security) | **No third-country interference possible** (no derogations) | Provider cannot be controlled by a third country; **European cybersecurity certificate at "high"**; provider retains **effective control over all software components**; demonstrates **no third-country entity holds effective control over software design, development, maintenance, or evolution**. |

The Commission's own framing: L4 is expected to apply to roughly **1% of public services**. The four tiers map naturally onto the Commission's **Cloud Sovereignty Framework (CSF)** rubric — 8 SOV objectives, **SEAL score 0–4** (SEAL-4 = full immunity to non-EU law) — under which the EU **awarded €180M to four providers in April 2026**. Build any DPF self-assessment around CSF/SEAL. ([EC — Sovereign Cloud Framework explained](https://commission.europa.eu/news-and-media/news/sovereign-cloud-framework-explained-2026-06-01_en); [STORDIS on CSF/SEAL](https://stordis.com/cloud-sovereignty-framework/))

### 1.4 Scope — who is bound, and the compliance cascade
- **Mandatory for public-sector cloud procurement** (with narrow exceptions); public bodies select the required assurance level by **risk assessment**. ([Covington](https://www.insideglobaltech.com/2026/06/11/the-eu-cloud-and-ai-development-act-in-depth/))
- **NIS2 "essential entities"** in critical sectors (energy, healthcare, transport, water, plus national security / law enforcement / defence) may conduct similar assessments; **private sector** pulled in via **future secondary/sectoral legislation**. ([Covington](https://www.insideglobaltech.com/2026/06/11/the-eu-cloud-and-ai-development-act-in-depth/))
- **Public procurement** adds "Union added-value" criteria (EU-developed tech, EU innovation/manufacturing) — **ancillary, max 15 of 120 points** — a thumb on the scale, not decisive.
- **The cascade (why private firms can't ignore it):** sovereignty requirements get **contractually embedded through procurement before CADA is even binding**, and flow **bottom-up** — *an enterprise cannot claim Level 3 if its infrastructure provider is only Level 1.* Firms bidding for EU public contracts, or subcontracting to regulated entities, inherit the obligations. ([CSA research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-cloud-ai-development-act-cada-complianc/))

### 1.5 How CADA interlocks with the rest of the EU stack
- **DORA** (financial services, in force 17 Jan 2025): concentration-risk, exit strategy, ICT-provider audit rights — already produces CADA-relevant evidence.
- **NIS2** (Oct 2024): supply-chain security risk assessments map directly to CADA's transparency criteria.
- **EU AI Act** (high-risk provisions from **2 Aug 2026**): Art. 9 risk management now treats **infrastructure jurisdiction / extraterritorial-access risk** as compliance evidence.
- **GDPR**: a third country's adequacy decision is a precondition for any L3 derogation.
- **EUCS** (ENISA cloud certification): never finalised — its sovereignty/"high+" requirement was **removed in March 2024** after a five-year deadlock. **CADA exists precisely to fill that gap** — useful "why now" backstory.
- The transatlantic backdrop is unstable: the EU-US Data Privacy Framework is under CJEU challenge ("Schrems III") and FISA 702 was up for renewal. ([Stanford Law](https://law.stanford.edu/publications/no-151-schrems-iii-the-future-of-transatlantic-privacy-law-after-latombe-v-commission/))

### 1.6 The load-bearing argument (the one-liner for the forum)
> CLOUD Act § 2713 compels a US provider to disclose data in its worldwide "possession, custody, or control"; a 100%-US-owned EU subsidiary does **not** break that chain. FISA 702 authorises bulk surveillance of non-US persons via directives providers can't publicly challenge. So **data location in Europe is "legally irrelevant when the provider is subject to US jurisdiction."** Microsoft's legal director conceded under oath to the French Senate (June 2025) that it cannot guarantee French data against US authorities; AWS and Oracle decline to claim CLOUD Act immunity at all. **CADA's teeth: it makes corporate ownership — not data location — the gate at Levels 3–4.**

---

## 2. Why DPF is well-positioned (the strategic thesis)

**DPF is not a cloud provider; it is the AI-native operations platform that runs on the customer's chosen infrastructure.** This is the whole game:

- A SaaS competitor *is* a third-country provider and is stuck at its own corporate ceiling (US-owned SaaS = L1–L2 at best).
- DPF, being self-hosted, **inherits the assurance level of the infrastructure the customer runs it on** — so DPF on OVHcloud SecNumCloud can be part of an L3/L4 solution that a US SaaS can never be.

Three shipped properties make this real rather than aspirational (file references are to the session worktree; the root clone is behind on several):

1. **Single-tenant, self-hosted, customer-owned.** "DPF is single-tenant by design… no shared SaaS instance." Postgres/Neo4j/Qdrant run on the customer's own Docker host or their own cloud account. ([deployment-contracts spec](../superpowers/specs/2026-05-09-deployment-contracts.md); `docker-compose.yml`; [prefer-self-hosted-infrastructure principle](../founder-kernel/wiki/principles/prefer-self-hosted-infrastructure.md)) → **L1 by construction on EU infra.**
2. **Local-only AI inference, no silent fallback.** A platform switch pins every inference to `residencyPolicy: "local_only"`; routing *excludes* every non-local provider and **fails loudly** rather than reaching a cloud endpoint. ([`apps/web/lib/inference/local-only.ts`](apps/web/lib/inference/local-only.ts); [`apps/web/lib/routing/pipeline-v2.ts:136`](apps/web/lib/routing/pipeline-v2.ts:136); [`request-contract.ts:54`](apps/web/lib/routing/request-contract.ts:54)) → **the L4 "no AI-inference-data egress" test, which hyperscaler AI structurally fails.**
3. **Open source.** Public repo + DCO sign-off. → **L2 supply-chain transparency + neutralises the L3/L4 vendor-control objection** ("open source is the sovereignty multiplier" — the customer can run, audit, and fork regardless of vendor jurisdiction).

Supporting capabilities already shipped:
- **Jurisdiction model** — `BusinessContext` captures `operatesIn / sellsTo / employsIn / dataResidency` (data-residency keyed off where data subjects are). ([`packages/db/prisma/schema.prisma` ~2906-2922](packages/db/prisma/schema.prisma); [`api/business-context/setup/route.ts`](apps/web/app/api/business-context/setup/route.ts))
- **EU regulatory knowledge** — jurisdiction-tagged GDPR / EU AI Act corpus, a full **DORA seed**, compliance CRUD, and an LLM **regulatory monitor**. ([`docs/professions/legal-compliance/wiki/`](docs/professions/legal-compliance/wiki/); [`packages/db/scripts/seed-dora-regulation.ts`](packages/db/scripts/seed-dora-regulation.ts); [`apps/web/lib/actions/compliance.ts`](apps/web/lib/actions/compliance.ts))
- **Conduit, not broker** — customers bring their own credentials (encrypted per-org); raw third-party payloads stay external. No DPF-as-third-country-broker exposure. ([native-cohesion-over-interfacing](../professions/data-architect/wiki/native-cohesion-over-interfacing.md))
- **One data model** on the customer's own Postgres — no data scattered across third-country SaaS. ([one-data-model](../professions/data-architect/wiki/one-data-model.md))
- **The evidence layer** — `RouteDecisionLog` records *which model/provider served each request* (proves local-only held); `ChangeRequest`/`registerChange()` give an ITIL change register; `ToolExecution` audits every tool call; retention governance holds regulated data on industry floors. This is exactly the **audit/assurance evidence** the CSA matrices (AICM, CCM, STAR for AI) and BSI C5 / SecNumCloud expect. ([RouteDecisionLog in `routed-inference.ts`](apps/web/lib/routing/routed-inference.ts); [`apps/web/lib/change-management/register-change.ts`](apps/web/lib/change-management/register-change.ts))

---

## 3. What CADA specifics DPF helps accommodate (tier-by-tier)

| CADA obligation | DPF answer | Status |
|---|---|---|
| **L1** — data on EU infrastructure | Self-host on EU-region infra; region-pinning; one data model on customer Postgres | Shipped (deployment) |
| **L1/L2** — keep AI processing in-jurisdiction | `local_only` residency policy; routing fails loudly, no silent cloud fallback | Shipped |
| **L2** — software supply-chain transparency / SBOM | Open-source codebase + DCO; **needs a first-class signed SBOM + provenance artifact** | Partial — build-out |
| **L2** — source-code auditability of third-country components | Open source = customer can audit/fork | Shipped (inherent) |
| **L2/L3** — model where data subjects reside | `BusinessContext.dataResidency` + jurisdiction-aware corpus | Shipped (extend to capture target assurance level) |
| **L3** — EU-owned-and-controlled operating entity | DPF is software, not the operator; the *customer* operates it on EU-owned IaaS → control rests with the EU customer + EU infra partner | Inherited from deployment |
| **L4** — no AI-inference-data egress | Local-only inference is the literal implementation | Shipped — **standout differentiator** |
| **L4** — no third-country control over software evolution | Open source + right to fork; **needs EU steward/support partner + reproducible builds** to fully close | Partial — governance gap (see §6) |
| **All** — audit / assurance evidence | `RouteDecisionLog`, `ChangeRequest`, `ToolExecution`, retention governance | Shipped |
| **DORA / NIS2 / AI Act overlap** | DORA seed, compliance CRUD, regulatory monitor, EU AI Act corpus | Shipped |

---

## 4. What to market (positioning)

**Headline:** *"Sovereign by construction."* DPF is the AI-native operations platform that runs **entirely on your own EU infrastructure**, with **AI that never leaves the box**, and a **cryptographic audit trail that proves it** — so you can climb to CADA Level 3–4 where hyperscaler AI structurally cannot.

**Target segments (highest CADA exposure first):**
- **EU public sector** (direct procurement mandate) and anyone **bidding for EU public contracts** (the cascade).
- **Financial services** (DORA) and **healthcare / energy / critical infrastructure** (NIS2) → L2 minimum.
- **Defence / national-security-adjacent** → L4.

**The wedge vs. hyperscaler AI (Copilot / Gemini Enterprise / Bedrock):** those are pinned at L1–L2 by US ownership and the CLOUD Act. *"Get the AI productivity without surrendering sovereignty."* DPF + Mistral-on-vLLM + EU-native infra reaches L3–L4.

**Lead-gen motion:** a **"CADA-readiness assessment"** — map a prospect's current cloud/AI estate to the four tiers (exactly what the CSA says every enterprise must do *now*). It's consultative, it's the natural top of funnel, and it surfaces the gaps DPF closes.

---

## 5. Partner strategy — the "CADA-ready" reference stack

DPF doesn't need to build sovereign infrastructure; it needs to **deploy cleanly onto the EU-sovereign layer and bundle the sovereign AI + key partners**. Recommended stack by layer:

| Layer | Primary partner(s) | Plausible tier |
|---|---|---|
| **IaaS deploy target** | **OVHcloud** (FR, SecNumCloud trajectory), **StackIT/Schwarz Digits** (DE, cleanest ownership), **Scaleway** (FR) | L3, → L4 on SecNumCloud |
| **Virtualisation / stack** | Proxmox or SUSE Rancher; OpenStack/SCS substrate | L2–L4 |
| **AI model + inference** | **Mistral Large 3** (open weights) on **vLLM**, self-hosted — slots straight into DPF's local OpenAI-compatible inference | L3, → L4 on SecNumCloud |
| **GPU substrate** | OVHcloud / Scaleway / **OUTSCALE** (SecNumCloud) | L3–L4 (NVIDIA dependency disclosed) |
| **Keys / encryption** | **Thales** (CipherTrust/Luna) or **Cosmian/Eviden**, via HYOK / external key store | L2–L4 strengthener |
| **Confidential computing** | **Edgeless Systems** (Contrast/Privatemode); SEV-SNP/TDX + NVIDIA CC | L2–L4 strengthener |
| **Collaboration halo** | **Nextcloud** (proven EU-gov "replace M365" brand) | L2–L4 |
| **Compliance rubric** | Align self-assessment to **CSF SOV-1…8 / SEAL 0–4** | maps to CADA |

**Hyperscaler "sovereign" offerings (AWS European Sovereign Cloud, Oracle EU Sovereign Cloud, Microsoft Sovereign Public Cloud, Google Data Boundary): treat as L1–L2 substrate only.** For L3+, the relationship must shift to the **EU operator** (Google-via-T-Systems, S3NS/Thales, Bleu/Capgemini-Orange, Delos/SAP). **Exclude from the top tiers:** non-EU providers (Exoscale/Switzerland, Canonical/UK) and US-owned anchors (VMware-Broadcom, Red Hat-IBM, Entrust). Offer customers a **migration path off VMware/Broadcom** (toward Proxmox/OpenStack) as a tailwind — the partner-channel collapse and 800–1,500% price hikes are pushing EU customers to move.

**Top partnership priorities to pursue:** (1) **OVHcloud** and/or **StackIT** as reference IaaS; (2) **Mistral** as the sovereign-AI model partner; (3) **Thales** for EU-held keys.

*(Full provider-by-provider analysis with ownership and sourcing is in the partner-landscape research that accompanies this briefing.)*

---

## 6. Honest caveats / open questions (don't overclaim)

- **CADA is a proposal.** Tier criteria can shift in trilogue; the sovereignty framework is "one of the central political battlegrounds." Nothing is "CADA-certified" yet.
- **The DPF-vendor jurisdiction question.** For the strictest L4 test — "no third-country entity holds effective control over software design, development, maintenance, or evolution" — a US-domiciled DPF maintainer is a theoretical concern. **Mitigations (governance, not engineering):** open source + customer's right to fork/self-operate; an **EU support/steward entity**; **reproducible builds**; a **published, signed SBOM**. Decide and document the posture before claiming L4.
- **SBOM + attestation pack** is the main engineering build-out for L2.
- **Silicon:** essentially everything runs on NVIDIA (US) GPUs, including Mistral's own DC and EuroHPC. **Disclose it** (L2 transparency) rather than chase hardware sovereignty no EU player can deliver at frontier scale.
- **Confidential computing strengthens but does not substitute for EU ownership** — jurisdiction follows the corporate entity. Market it as an L1/L2 strengthener and partial-L3 mitigation, not an L4 guarantee.

---

## 7. The plan to accommodate impacted organisations (phased)

- **Phase 0 — position (now → Sept forum).** This briefing + the four-tier visual + a sovereignty self-assessment aligned to CSF/SEAL + the reference architecture. Stand up the "CADA-readiness assessment" as a consultative offer.
- **Phase 1 — "DPF Sovereign Edition" deployment profile.** EU-native IaaS deploy target(s); **Mistral-on-vLLM** as the default sovereign model; **region-pinning enforcement**; **HYOK** key integration; **SBOM + attestation/evidence pack**; a **sovereignty-posture dashboard** that maps the running install to a CSF/SEAL level. Extend `BusinessContext` to capture the **target assurance level** and enforce it (the `local_only` switch + `dataResidency` are the substrate to build on).
- **Phase 2 — attest + partner.** Pursue proxy attestations (**BSI C5 / SecNumCloud-aligned**); formalise the IaaS partnership(s), the **Mistral** model partnership, and the **Thales** key partnership; establish the EU steward/support entity that closes the L4 governance gap.

---

## 8. Suggested forum flow (architects audience)
1. **The shift** — sovereignty moved from politics to procurement *law* (CADA, 3 June 2026).
2. **The ladder** — the four tiers, and the one question that decides every tier: *who ultimately owns the operating entity, and what law reaches them?*
3. **Why hyperscaler AI can't cross the line** — CLOUD Act / FISA; Microsoft under oath.
4. **The architecture that can** — self-host + open source + local AI + EU keys + EU-native infra.
5. **How DPF embodies it** — sovereign by construction, plus the evidence trail.
6. **The reference partner stack.**
7. **Call to action** — the CADA-readiness assessment.

---

## 9. Key sources
- [European Commission — Cloud and AI Development Act (policy)](https://digital-strategy.ec.europa.eu/en/policies/cloud-and-ai-development-act) · [Proposal text](https://digital-strategy.ec.europa.eu/en/library/proposal-cloud-and-ai-development-act-cada)
- [Covington / Inside Global Tech — "The EU Cloud and AI Development Act in Depth"](https://www.insideglobaltech.com/2026/06/11/the-eu-cloud-and-ai-development-act-in-depth/)
- [Cloud Security Alliance — CADA enterprise-compliance research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-cloud-ai-development-act-cada-complianc/)
- [Wilson Sonsini — Commission proposes Act to reduce reliance on foreign cloud and AI](https://www.wsgr.com/en/insights/european-commission-publishes-proposal-for-act-to-reduce-reliance-on-foreign-cloud-and-ai.html)
- [EC — Sovereign Cloud Framework explained (CSF/SEAL)](https://commission.europa.eu/news-and-media/news/sovereign-cloud-framework-explained-2026-06-01_en) · [STORDIS — CSF/SEAL detail](https://stordis.com/cloud-sovereignty-framework/)
- [Jones Day — proposed sovereignty framework / compliance tiers](https://www.jonesday.com/en/insights/2026/06/european-commissions-proposed-cloud-sovereignty-framework-creates-new-compliance-tiers-for-software-providers)
- [Global Policy Watch — EU tech sovereignty package](https://www.globalpolicywatch.com/2026/06/eu-tech-sovereignty-package/) · [Raconteur — what sovereign cloud means in law](https://www.raconteur.net/global-business/eu-cloud-and-ai-development-act-what-sovereign-cloud-means-in-new-laws)
- [Stanford Law — Schrems III / DPF challenge](https://law.stanford.edu/publications/no-151-schrems-iii-the-future-of-transatlantic-privacy-law-after-latombe-v-commission/)

*(DPF capability claims are cited inline to worktree source paths; the accompanying partner-landscape research carries the full provider sourcing.)*
