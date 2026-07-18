# Where the Config-vs-Standard Line Truly Lies — deep research

- **Date:** 2026-07-08
- **Status:** research finding (follow-on to `2026-07-07-claude-inside-out-agent-harness-parity-spec.md` §5)
- **Epic:** EP-CLAUDE-INSIDE-OUT (scopes Cluster 2); cross-links EP-8DC217EB (consolidation spines)
- **Method:** deep-research harness — 5-angle search fan-out, 15-source fetch, 3-vote adversarial verification per claim (100 agents); plus a very-thorough internal codebase inventory of DPF's shipped-standard vs configurable surface.
- **Operator claim under test:** "Configuration-as-product was ServiceNow's strong suit but backfired, leading to CSDM which most customers adopt over configuring from scratch. Standards harmonization across industries keeps shrinking the config that's actually needed. Uniqueness per company persists but less and less is needed."

## 1. Verdict

The claim is **substantially confirmed with one precision upgrade**: the line is not a single boundary that moves — it is **three different lines at three layers**, converging at different speeds:

1. **Data model — converges first, and hard.** Ship it as a standard; per-company modeling is technical debt on day one.
2. **Process — converges second, at dialed depth.** Prescribe the shape; allow depth-of-standardization to vary per process objective (APQC/Kirchmer "appropriate standardization").
3. **Policy/context residue — does not converge.** Jurisdictional compliance, org & approval structure, policy thresholds, local physical/site constraints, pricing, integrations. Every vendor that "eliminated" this residue actually **relocated** it to a bounded, upgrade-safe layer. Over-standardizing it pushes users into shadow IT.

The strategic question for any platform is therefore not "how much configuration" but **where the residue lives and what enforces its boundary**.

## 2. Evidence pillars (all adversarially verified)

### 2.1 ServiceNow's own admission — configuration-as-product backfired (HIGH confidence)
ServiceNow's official CSDM 5 white paper states it verbatim: as a "highly configurable" platform **in the absence of prescriptive guidance, every customer had a bespoke data model**, which prevented ServiceNow's own product teams from delivering cross-portfolio use cases. CSDM (2017 internal collaboration, shipped 2018) reduced service definition complexity from **127 disparate classifications to 3** commonly defined service types. ServiceNow now names prior CMDB customization a failure mode ("cannot be maintained"), names technical-debt elimination a primary value of CSDM adoption, and warns that continued customization **progressively reduces product value because current and future products increasingly require CSDM-prescribed tables** — enforcement via product dependency, not mandate. CSDM remains prescriptive-plus-extensible: extensions are allowed, *conformant* extensions specifically.
> Sources: ServiceNow CSDM 5 White Paper (pp. 4–5, 50, 59); servicenow.com "What is CSDM".
> Caveat: no independent, quantified CSDM adoption-share statistic survived verification — "most customers adopt CSDM" is directionally supported by ServiceNow's product-dependency strategy but not measured publicly.

### 2.2 The same arc everywhere in enterprise software (HIGH)
- **SAP clean core:** officially acknowledges custom code = technical debt (hard to maintain, expensive to upgrade, error-prone, innovation-slowing); the strategy keeps the ERP as close to standard as possible and **relocates variance to side-by-side extensions (BTP)**; explicit guidance: "whenever possible, adopt industry best practices and use out-of-the-box features."
- **Workday:** the fully prescriptive endpoint — **prohibits code-level customization entirely**, configuration-only by construction, deliberately bounded so no modification can break an upgrade. Yale's adoption FAQ documents the counterfactual: legacy per-unit customization required re-coding on every system change. Residual cost doesn't vanish — it shifts to per-release regression-testing of configurations (days-scale, vs. multi-month legacy upgrade projects).
- **Standards bodies hit the identical lesson:** the CPMI found that adopting **ISO 20022 alone does not deliver interoperability** — implementation variability in a flexible standard erodes its benefits — so it published harmonised data requirements steering all operators to a single consistent implementation (target end-2027). **A flexible standard without prescriptive defaults reproduces per-implementer fragmentation.** This is the CSDM lesson restated by a central-bank committee.
> Sources: sap.com "What is a clean core"; erp.today; Yale Workday program FAQ; BIS/CPMI d230 (Feb 2026), d218; Bank of England (Oct 2023).

### 2.3 Direction of travel called in 2005 (MEDIUM)
Davenport's HBR thesis ("The Coming Commoditization of Processes") held that per-company process uniqueness was historically near-universal and predicted commoditization into standardized, comparable, externally sourceable units. Twenty years of CSDM, clean core, Workday, APQC PCF, and ISO 20022 harmonization are consistent with that trajectory. (Framing, not measurement — no quantitative study of shrinking per-company uniqueness survived verification.)

### 2.4 The irreducible residue is real and *required* (HIGH)
APQC/Kirchmer's "appropriate process standardization" (also peer-reviewed, Springer 2023) explicitly accommodates **context-driven variants that "cannot be avoided"**: geography-specific legal requirements, product/channel variety, target markets. Standardization depth should be **dialed per objective, not fixed**. Over-standardization backfires concretely: forcing sites into processes that conflict with local regulation, union rules, or physical constraints **pushes users into shadow IT** (corroborated by peer-reviewed ERP-misfit literature and multi-case shadow-systems studies). SAP's own concession completes the picture: deviations arise from industry compliance and local regulation, and belong in the extension layer — **the residue is relocated, never eliminated**.
> Sources: APQC/Kirchmer whitepaper + Springer chapter; erp.today; Strong & Volkoff ERP-misfit literature.

### 2.5 The agent-native frontier — articulated, executing, unproven (MEDIUM)
Nadella (BG2, Dec 2024) predicted SaaS apps "probably" collapse in the agent era — "essentially CRUD databases with a bunch of business logic," with the logic migrating to agents. Oracle scaled from ~50 to **1,000+ task-specific Fusion agents** (Mar 2026) — vendor-side absorption of workflow execution customers previously configured or staffed. But: counts are vendor-supplied, Gartner cautions against the glitter, and **no verified outcome evidence yet shows agents absorbing the irreducible residue** (approval hierarchies, thresholds, jurisdictional rules) at runtime. The direction is where the largest vendors point; the proof is unwritten — which makes it an open lane, not a validated pattern to copy.

## 3. The line, precisely

**Minimum irreducible configuration surface** (everything else can ship standard):

| Residue class | Examples | Converges? |
|---|---|---|
| Jurisdictional / regulatory variants | which regs apply, local filing rules, data residency | No — varies by geography/industry forever |
| Org & approval structure | who approves what, delegation, hierarchies | No — mirrors each company's actual org |
| Policy thresholds | risk posture, spend limits, SLAs chosen, autonomy envelopes | No — these ARE the company's choices |
| Local physical/site constraints | plant layouts, union rules, service territories | No |
| Pricing & commercial terms | price books, discounting policy | No |
| Integrations & identity of record | which external systems, which side wins | No — environmental, not preferential |
| Branding/content | names, logos, tone, mission | No (content, cheap) |

Everything above that line — data model, process shapes, service classifications, document families, capability taxonomies, compliance catalogs, chart-of-accounts structures — has converged or is converging, and the winning vendors ship it **opinionated with conformant extension points**, enforced by product dependency (ServiceNow), architecture (Workday), or governance tooling (SAP).

## 4. Mapping to DPF (internal inventory, 2026-07-07)

DPF already sits on the winning side of each layer — **it was born where ServiceNow spent 15 years retrofitting to reach**:

- **Layer 1 shipped-standard:** 95 industry archetypes across 21 families as of the 2026-07-18 source catalog sweep; 112-page founder kernel; built-in compliance catalog with a *generic applicability evaluator* (new regulation = data seed, not code); COA fragments per ledger model; ~21 coworker roles; APQC-style capability tree; build-process right-sizing matrix; device-fingerprint catalog. A fresh install boots populated where ServiceNow ships blank tables.
- **Layer 2 process-at-dialed-depth:** the right-sizing matrix *is* Kirchmer's "depth dialed per objective," encoded as policy. Verticals are data overlays on shared models (FieldDispatchProfile + ComplianceOverlayKey), not per-vertical canvases.
- **Layer 3 residue:** capability toggles, archetype composition, compliance-scope flags, risk posture — and, distinctively, **the residue's policy/stance component lives as agent-retrieved prose** (org-overlay WikiPages, mission Block-0, WWWD corpus) rather than config schema. DPF is running the experiment §2.5 says is unproven — with an advantage no incumbent has: **decisions taken from that corpus are ledgered** (`DecisionInteraction`), so DPF can *measure* whether agent-absorbed residue works rather than assert it.

**Founder doctrine (2026-07-07, ratifying the two "blank-canvas" surfaces):** the Business Model Builder and Reference Data CRUD are architect-tier surfaces by design. Flexibility is legitimate **when it is part of the overall structure, guidelines, and end-to-end purpose-built flows that eliminate failures and expedite outcomes** — i.e., the config line is *persona-tiered* (architect / operator / end-user), not binary. ServiceNow's failure was not architect flexibility; it was handing the architect surface to everyone with no conformance boundary. The research supplies the enforcement pattern DPF should keep: **conformant-extension validation at authoring time** (wiki-lint, EA mirror, architecture-parity steward = DPF's CSDM-conformance analog), never upgrade-time discovery.

## 5. Implications for EP-CLAUDE-INSIDE-OUT Cluster 2

1. **Scope every "builder" BI as a governed escape hatch inside shipped defaults, not a designer-first surface.** BI-D80D16C4 (workflows): ship standard flows per archetype; the builder edits *variants of* them, agent-drafted, human-ratified, conformance-linted. BI-5032C62F (catalog/forms): request types ship per archetype; the builder extends conformantly. BI-6804292F (data extension): CSDM-lesson applies hardest here — extensions validate against the EA mirror at authoring time or they become the 127 classifications.
2. **Build residue engines, not modeling engines.** BI-55D2A0E5 (approvals), BI-78414B9D (SLA), BI-997503EC (notifications) parameterize exactly the irreducible rows in §3's table. They deserve first-class engines *because* they never converge.
3. **Sequence on EP-8DC217EB spines** (recorded on the BIs 2026-07-07): approvals/SLA/ITSM on BET-1 WorkUnit + BET-2 authorization + BET-12 findings plane; CI graph on BET-13 identity convergence; hook plane over BET-2. Building residue engines over pre-consolidation families would recreate the fragmentation the research warns about.
4. **Instrument the agent-absorption experiment.** The one unproven claim (§2.5) is DPF's core bet. Add outcome measurement to the WWWD/decision-ledger loop: rate of stance-retrieval per decision, override rate, escalation rate — so DPF produces the outcome evidence the industry lacks.
5. **Keep enforcement-by-product-dependency in view.** ServiceNow's most effective lever was making new value depend on the standard model. DPF's analog: new coworker capabilities should *require* the shipped archetype/capability substrate, making conformance the path of least resistance.

## 6. Known unknowns

- **CSDM adoption share is not publicly quantified** — "most customers adopt it" stands on ServiceNow's product-dependency strategy and practitioner direction, not a measured statistic.
- **No measured evidence yet that agents absorb the residue at runtime** — vendor trajectories (Oracle 50→1,000+ agents) are execution signals, not outcomes; agent-washing critiques apply.
- Davenport's commoditization baseline is authoritative framing, not empirical measurement.

## 7. Sources

ServiceNow CSDM 5 White Paper + what-is-csdm product page · SAP "What is a clean core" · erp.today (clean-core mandate) · Yale Workday Configuration-vs-Customization FAQ · BIS/CPMI d230 (Feb 2026) + d218 + Bank of England (Oct 2023) · Davenport, HBR June 2005 · APQC/Kirchmer "Appropriate Process Standardization" + Springer (2023) · Strong & Volkoff ERP-misfit literature · Windows Central / BG2 (Nadella, Dec 2024) · ComputerWeekly + Oracle PR (Mar 2026) · The Register · Cloud Wars.
