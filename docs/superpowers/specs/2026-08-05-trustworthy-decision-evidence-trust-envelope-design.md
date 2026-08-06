# Trustworthy Decision Evidence — the Trust Envelope over the DPF Decision Kernel

- **Status:** proposed (research + design; no customer-data implementation in this branch)
- **Date:** 2026-08-05
- **Epic:** `EP-VERIFICATION-INTEGRITY` — **does not yet exist; must be created** (see §11). Filed interim under the closest adjacent open epic `EP-DECISION-TIER-REBALANCE`.
- **Anchor / umbrella BI:** `BI-2CDF01A3` (filed fresh; cited `BI-63811996` was **not found in the live backlog**)
- **Phase children:** `BI-EA97E5CD` (A evidence-grounding) · `BI-81CC5D8E` (B immutable record) · `BI-70FF9114` (C external verifier) · `BI-B84CD2D3` (D jurisdiction criteria) · `BI-A59CB2EA` (E candidate-eval instance)
- **Kernel decisions:** Fork A → `DI` recorded via `principle_decide` (composite 14.229, high); Fork B → near-tie recorded (composite 12.643, low) — see §7
- **Surface:** WWMD (platform-development) for the envelope architecture; the candidate-eval instance is a WSID profession decision (`evaluate_profession_decision`)
- **Author population:** external coding agent (Claude), worktree `doc/decision-trust-envelope`

## Design grounding

Every substrate claim below was verified in this worktree against `schema.prisma`,
`apps/web/lib/`, the live MCP backlog, and the specs corpus on 2026-08-05. The
verification is load-bearing: **most of the primitives this envelope needs already
exist**, and several anchors named in the tasking do not. This section is the honest
record required by `verify-substrate-before-proposing-new` and
`sweep-main-before-trusting-worktree-specs`.

### What already exists and is reused (NOT rebuilt)

| Concern | Existing substrate | File / model |
|---|---|---|
| Decision scoring (WWMD) | `principle_decide` — 20 closed axes, contribution ledger, `missingDimensions` | `apps/web/lib/mcp/packs/principle-decide-pack.ts`; registry `packages/db/src/wiki-taxonomy.ts:144` |
| Decision scoring (WSID) | `evaluate_profession_decision` — same axes, profession gate | `apps/web/lib/mcp/packs/profession-decision-pack.ts` |
| Decision scoring (WWWD) | `evaluate_org_business_decision` + `list_open_decision_reviews` | `apps/web/lib/mcp/packs/org-decision-pack.ts` |
| Recorded decision | `DecisionInteraction` (kernel path writes it via `recordKernelConsultInteraction`) | `schema.prisma:14139`; `apps/web/lib/decision/kernel-consult-ledger.ts` |
| Evidence contract (live) | `deliberation/evidence.ts` — `StructuredLocator`, grades **A/B/C/D**, `checkAdmissibility`, "citation theater" refusal | `apps/web/lib/deliberation/evidence.ts` |
| Evidence record (append-only by convention) | `ExternalEvidenceRecord` (writer `recordExternalEvidence`) | `schema.prisma:6969`; `apps/web/lib/actions/external-evidence.ts:48` |
| External re-check (separation of duties) | `verified-finding-review.ts` — independent adversarial verifier reproduces a finding before it blocks, fail-closed | `apps/web/lib/build/verified-finding-review.ts` |
| Jurisdiction → autonomy ceiling | `RegulatoryAutonomyPolicy` (industry × jurisdiction × activityClass → maxAutonomy, requiredEvidence) | `schema.prisma:7678` |
| Jurisdiction → evidence tier | `work-warrant.ts` `deriveWarrant` bumps required evidence to "compliance" | `apps/web/lib/decision/work-warrant.ts:150` |
| Autonomy trust envelope (naming precedent) | `TrustState` (agent × activity × riskClass → shadow/propose/act, `regulatoryCeiling`) + `DecisionShadowLedger` | `schema.prisma:7656`, `7617` |
| Org perspective (WWWD) | `DecisionPerspectiveProfile` / `…Version` / `PerspectiveMaterial` (evidenceGrade, direction, freshness) | `schema.prisma:14050` |
| Append-only content hash precedent | `HiveContributionLedger.payloadHash`; `WorkforceCandidateFact.sourceEnvelope` (provider/integrity/excerpt-digest) | `schema.prisma:8174`, `16288` |
| Regulation catalog | `Regulation`, `ComplianceEvidence`, `AuditFinding`, `ComplianceAuditLog`, `RegulatorySubmission` | `schema.prisma:9135…9519` |

### The four gaps this envelope closes (verified absent)

1. **A score carries no evidence.** Each `principle_decide` option feature is a bare
   `0..1` magnitude. `evidence_density` / `evidence_confidence` are themselves just
   numbers, not links. The kernel-consult ledger writes `sources: []` and
   `evidenceBundle: {}` — the `DecisionInteraction.sources` / `.evidenceBundle` fields
   **exist but are left empty on the kernel path**. (Confirmed in `kernel-consult-ledger.ts`.)
2. **The record is mutable and self-anchored.** `DecisionInteraction`,
   `DecisionShadowLedger`, `HiveContributionLedger` all carry `updatedAt`. Grep for
   `prevHash|chainHash|merkle|hashChain|entryHash` across schema + code = **zero hits**.
   "Append-only" is a documentation convention enforced by write-path discipline, not structure.
3. **Jurisdiction does not select axes or weights.** `RegulatoryAutonomyPolicy` caps
   *autonomy level*; `work-warrant.ts` bumps the *evidence tier*. Neither changes **which
   axes apply or how they are weighted**. There is no jurisdiction → axis/weight map.
4. **No external re-check of decision evidence.** `verified-finding-review.ts` re-checks
   Build-Studio review findings, not decision-kernel evidence; `EvidenceBundle`/`EvidenceSource`
   are schema-defined but **orphan (zero writers)**; live evidence goes to `ExternalEvidenceRecord`
   with no automated re-verification against the cited source.

### Anchors named in the tasking that DO NOT EXIST (verified)

`EP-VERIFICATION-INTEGRITY`, `BI-63811996`, `EP-53A259C6` (cited WWWD overlay),
`EP-MULTICOUNTRY-HR`, `BI-25CCF1A4 / BI-47CF0AA5 / BI-D88DFEEA / BI-E1427A3E / BI-DF87F8D2`
(cited decision-tier BIs), `BI-F3AEBF68` (cited native ATS), and
`docs/superpowers/specs/2026-08-05-greenhouse-ats-absorption-design.md` — none exist in
the live backlog or on disk. The real decision-vector epic is **`EP-DECISION-TIER-REBALANCE`**
(open; real children `BI-8614E08A`, `BI-8AC099F4`). The real WWWD surface is the
`DecisionPerspectiveProfile` substrate under **`EP-0AF96937`**. Treat every cited id as
**aspirational**; this design binds to verified substrate only.

---

## 1. Problem & Goal

A recorded kernel decision today is a defensible *number* but not a defensible *artifact*.
The composite is reproducible, but a reviewer cannot ask "why is this option's
`governance_compliance` a 0.9?" and get a cited source; cannot confirm the record was not
edited after the fact; cannot see which jurisdiction's rules selected the axes; and cannot
have the evidence independently re-checked against reality.

**Goal:** make a recorded kernel decision an **audit-grade, defensible artifact** along four
axes, as a *reusable envelope* over the existing kernel — usable by every WWMD / WSID / WWWD
decision — with **fair AI candidate evaluation** as the first high-stakes instance.

The envelope is deliberately **not** a new decision engine. It is a binding, immutability, and
verification layer that wraps `principle_decide` / `evaluate_profession_decision` /
`evaluate_org_business_decision` without changing their scoring math. This honors
`architecture-over-shortcuts` and `single-source-of-truth`: one kernel, one ledger, one
evidence contract — extended, not forked.

---

## 2. The four axes

### Axis 1 — Evidence-grounded (a score with no cited evidence does not count)

**Contract.** Every dimension score an option carries must cite ≥1 `EvidenceSource` whose
`locator` resolves to a concrete artifact (a resume line, a spec line, a DB row, a tool
output). A score with no admissible cited evidence is treated exactly like a
**`missingDimension`** — it is dropped from the numerator, not counted as a neutral or a zero
that silently helps or hurts. This makes "unevidenced assertion" *structurally* worthless in
the composite rather than merely discouraged.

**Reuse, not rebuild.**
- The evidence contract already exists: `deliberation/evidence.ts` defines `StructuredLocator`
  (a discriminated union that refuses loose URL strings as "citation theater"), evidence grades
  **A/B/C/D**, and `checkAdmissibility` (Grade D = model memory is barred from a final
  rationale; source-sensitive claims require A or B). The envelope **lifts this contract out of
  Build-Studio scope** and makes it the kernel's evidence gate.
- The persistence target already exists and is empty: `DecisionInteraction.sources` and
  `.evidenceBundle`. The envelope writes per-dimension citations there instead of `[]` / `{}`.
- `principle_decide` gains an **optional-but-enforced-in-context** `evidence` map alongside
  `features`: `{ optionId → { dimensionKey → EvidenceRef[] } }`. When the calling
  `activityClass` is flagged high-stakes by `RegulatoryAutonomyPolicy.requiredEvidence`, a
  `features[dim]` present **without** a resolvable `evidence[optionId][dim]` is rejected the same
  way an unknown dimension key is rejected today (fail-fast, per `make-silent-failures-observable`).

**Why not a bolt-on evidence field on the option?** Because `governance-approves-evidence-not-provenance`
requires the gate to read evidence *quality*, never producer identity. Binding to the graded
`StructuredLocator` contract gives quality (grade + locator + freshness); a free-text field would
reintroduce citation theater.

### Axis 2 — Jurisdiction / locale-aware (context is itself a criterion)

**Contract.** Country / state / industry / activity are **selection inputs** that determine
*which axes apply and how they are weighted*, not merely gates on autonomy. Two identical
candidate profiles evaluated under NYC LL144 vs. an unregulated jurisdiction must produce
**different, each-defensible** vectors — because the applicable law is different, and the record
must show which rule set governed.

**Reuse, not rebuild.**
- `RegulatoryAutonomyPolicy` already keys on `(industry, jurisdiction, jurisdictionBasis,
  activityClass)` and carries `requiredEvidence`. The envelope adds a sibling projection —
  a **jurisdiction criteria profile** — that maps the same key tuple to `{ requiredAxes[],
  forbiddenAxes[], weightOverlay, monitoringOnlyAxes[] }`. This is an *extension of an existing
  policy row*, not a new authority: the autonomy ceiling and the axis profile share one
  jurisdiction key so they can never disagree about which regime applies.
- `DecisionPerspectiveProfile` already models org/WWWD stance with `scope` (a Json selector) and
  `PerspectiveMaterial` (direction, domains, evidenceGrade). Jurisdiction packs are authored as
  perspective materials scoped by locale, so the WWWD org overlay and the jurisdiction overlay
  compose through one resolver rather than two.
- The resolver order is explicit and recorded on the decision: **statute (jurisdiction pack) →
  org WWWD overlay → profession WSID baseline → platform kernel**. The record stores the resolved
  `jurisdictionBasis` and the pack version, so an auditor sees exactly which regime selected the axes.

This is not demographic gating. Selecting *axes and weights* by jurisdiction is a
job-relatedness / applicable-law statement; it never reads a protected characteristic (see Axis-1
guardrails and §6).

### Axis 3 — Immutable / tamper-evident (the load-bearing defense)

**Contract.** Recorded criteria + evidence + weights + ledger are append-only, and any
alteration after the fact is **detectable**, including alteration attempted by an AI agent *or*
by a platform operator with database access. This is the mechanism the whole envelope leans on:
if the record can be quietly rewritten, none of the other three axes can be trusted.

Fork B (§7) scored **B1 append-only+hash-chain ≈ B2 signed-ledger** as a near-tie (margin 0.006,
low confidence), with **B3 external-notarization** penalized on `operational_independence` (the
all-local doctrine). A near-tie at low confidence is a signal to **synthesize a tier, not pick a
winner** — the honest resolution is layered defense keyed to the trust boundary each layer defends:

| Layer | Mechanism | Defends against | When |
|---|---|---|---|
| **Always-on** | Append-only + `prevHash` chain over `{criteria, evidence-digests, weights, composite}`, reusing the `payloadHash` precedent | AI agents and lower-privilege actors; accidental edit | Every recorded decision |
| **High-risk default** | Detached signature over each chain entry by a key held **outside** the runtime agent's and operator's DB-write authority (local softHSM acceptable; `envelopeSignature` precedent) | A platform operator who can write the DB but not hold the key | `RegulatoryAutonomyPolicy` flags `activityClass` high-risk (hiring, credit, health) |
| **Regulated opt-in** | Periodic anchoring of the chain head to an external transparency log / RFC3161 timestamp authority | A malicious operator who *also* holds the signing key; proves existence-at-time | Install opts in (EU-AI-Act high-risk deployers, public-sector) |

Pure B1 alone cannot satisfy "the operator cannot circumvent" — an operator with full DB write can
recompute the whole chain. Signing (B2) raises the bar to key custody; external anchoring (B3) is the
only layer that survives a fully-compromised operator, at the cost of the external dependency DPF
doctrine resists — hence opt-in, not default. The tiering keeps the all-local default intact while
making the strong guarantees reachable where the law requires them.

### Axis 4 — Externally verifiable (a machine auditor re-checks the evidence)

**Contract.** An external-verifier pattern re-reads each cited `EvidenceSource.locator` against
its **real source** and confirms the excerpt still supports the score — the way a human auditor asks
"show me where the résumé says that" and checks. A citation that no longer resolves, or whose source
no longer contains the excerpt, **degrades the score to unevidenced** (Axis 1) and flags the decision
for review.

**Reuse, not rebuild.** `verified-finding-review.ts` is the exact precedent: an *independent
fresh-context* verifier reproduces a claim before it is allowed to have effect, fail-closed. The
envelope applies the same separation-of-duties to decision evidence: a verifier with **no access to
the original scorer's reasoning** re-resolves each locator, compares the live excerpt to the recorded
excerpt (freshness via `EvidenceSource.retrievedAt`), and writes a verdict record. Verifier identity is
an audit field, never a gate input (`governance-approves-evidence-not-provenance`). Re-checks run at
record time (block on high-risk) and on a cadence (drift detection), each re-check itself appended to
the immutable chain.

---

## 3. How the envelope composes over one decision

```
             ┌─────────────────────────── jurisdiction key (industry,country,state,activityClass)
             ▼
   [Axis 2] resolve applicable regime → requiredAxes / weightOverlay / monitoringOnlyAxes / requiredEvidence
             │            (RegulatoryAutonomyPolicy + jurisdiction criteria profile + WWWD overlay)
             ▼
   [Axis 1] score options on the resolved axes → each features[dim] MUST cite EvidenceSource(s)
             │            (principle_decide/evaluate_profession_decision + deliberation/evidence.ts grades)
             ▼   unevidenced score → treated as missingDimension (does not count)
   kernel composite + contribution ledger  (unchanged math)
             ▼
   [Axis 3] append {criteria, evidence-digests, weights, composite} to hash-chain
             │            (+ sign if high-risk; + external-anchor if opted-in)
             ▼
   [Axis 4] independent verifier re-resolves each locator vs real source → verdict appended to chain
             ▼
   recorded decision = audit-grade artifact (the bias-audit / defensibility record)
```

The record is a *superset* of today's `DecisionInteraction`: same row, with `sources` /
`evidenceBundle` populated, a `chainEntryHash` + `prevHash`, an optional `signature`, and linked
verifier verdicts. Nothing about the scoring changes; the trust properties are added around it.

---

## 4. Data-model deltas (extensions, minimal, enum-typed)

Per `strongly-typed-string-enums` and `single-source-of-truth`. No new decision engine; no parallel ledger.

1. **Populate existing fields.** `DecisionInteraction.sources` (EvidenceRef[]),
   `.evidenceBundle` (per-dimension citation map). No schema change — writer change in
   `kernel-consult-ledger.ts`.
2. **Hash-chain columns** on the decision record: `chainEntryHash`, `prevHash`,
   `chainId` (per agent×activityClass stream), `sealedAt`. Append-only enforced by a write guard +
   an invariant test (no `updatedAt` mutation once `sealedAt` set).
3. **`DecisionSignature`** (optional 1:1): `entryHash`, `algorithm`, `keyRef`, `signature`,
   `signedAt`. Written only for high-risk `activityClass`.
4. **`DecisionAnchor`** (optional): `chainId`, `headHash`, `externalRef`, `anchoredAt`,
   `authority`. Written only when an install opts in.
5. **Jurisdiction criteria projection** on `RegulatoryAutonomyPolicy` (or a sibling
   `JurisdictionCriteriaProfile` keyed by the same tuple): `requiredAxes[]`, `forbiddenAxes[]`,
   `weightOverlay Json`, `monitoringOnlyAxes[]`.
6. **`EvidenceReVerification`** (reuse `verified-finding-review` shape): `entryHash`,
   `evidenceRef`, `resolved Boolean`, `excerptMatch Boolean`, `verifierRunId`, `checkedAt`.
7. **Wire the orphan `EvidenceBundle`/`EvidenceSource`** as the citation store OR consolidate onto
   `ExternalEvidenceRecord` — open question §10 (they are currently writer-less; do not add a third home).

---

## 5. Reusability — every decision surface inherits the envelope

The envelope binds at the three kernel pack handlers, so WWMD, WSID, and WWWD decisions all gain it
without per-surface code:

- **WWMD** (`principle_decide`) — platform-development decisions (this very spec's forks).
- **WSID** (`evaluate_profession_decision`) — profession decisions, including candidate evaluation (§6).
- **WWWD** (`evaluate_org_business_decision`) — customer business decisions, jurisdiction overlay from the org's own perspective profile.

The jurisdiction resolver and evidence gate live in `apps/web/lib/decision/` (shared), not in any one
pack. This is the `mcp-is-the-coordination-plane` shape: the trust properties are a property of the
recorded decision, independent of which surface produced it — the keystone
`governance-approves-evidence-not-provenance`.

---

## 6. Instance One — fair candidate evaluation (a WSID HR coworker)

The first high-stakes instance: an HR coworker that **ranks / recommends** candidates against
job-relevant, evidence-grounded axes, where **the immutable ledger IS the bias-audit artifact**.
This is a WSID profession decision — it routes through `evaluate_profession_decision`, wrapped by the
envelope. It is a **recommendation, never an autonomous verdict**.

### 6.1 Regulatory grounding (the axes exist to satisfy these)

- **NYC Local Law 144** — automated employment decision tools require a **bias audit** (impact ratios
  by protected class) within the last year and candidate notice. → The chain-sealed decision record,
  aggregated, *is* the bias-audit evidence; the monitoring-only rail (6.3) produces the impact ratios.
- **Title VII / EEOC adverse-impact + the four-fifths rule + Uniform Guidelines job-relatedness (§14)** —
  a selection rate for any group < 80% of the top group's rate is presumptive adverse impact, rebuttable
  by **job-relatedness**. → Fork A's **A3 hybrid**: axes derive from a formal job analysis (defensibility
  baseline), never learned from historical outcomes (which would re-encode past adverse impact).
- **EU AI Act** — employment/recruitment AI is **high-risk (Annex III)**: risk management, logging,
  human oversight, transparency. → Axes 3 (immutable logging) + 4 (verification) + human-in-the-loop.
- **Colorado AI Act (SB 205)** — duty of care against algorithmic discrimination for consequential
  decisions incl. employment; impact assessments. → Jurisdiction pack (Axis 2) selects the Colorado
  obligations; the sealed record is the impact-assessment substrate.
- **Illinois AIVIA (AI Video Interview Act)** — consent + limited sharing for AI-analyzed video
  interviews. → `customer_consent_state` axis + evidence gating on any interview-derived signal.

### 6.2 The vector is job-relatedness only

Axes are authored from a job analysis per requisition (A3 baseline), each scored **only** with cited
evidence (Axis 1) — e.g. a `skill_match` score must cite the résumé line and the requisition line it
matches. No axis may be a protected characteristic, and **proxy detection** runs against the axis set
(e.g. "graduation year" as an age proxy, "distance from office" as a race/income proxy) before a vector
is admissible. A flagged proxy blocks the axis, citing the finding.

### 6.3 Guardrails (hard rules)

1. **Protected characteristics are excluded from the vector**, and a proxy detector scans for
   indirect encodings. Excluded set is jurisdiction-resolved (Axis 2), because "protected" differs by
   locale.
2. **Demographics live on a separate MONITORING-ONLY rail** — collected (where lawful and consented)
   *solely* to compute LL144/four-fifths impact ratios, **never** read as a scoring input. The rail is a
   different store with a different grant; the scoring path has no read access to it. This is the single
   most important structural guardrail: the thing you must measure for a bias audit is the thing you must
   never let touch the score.
3. **Human-in-the-loop** — the coworker produces a ranked recommendation with per-candidate evidence and
   the contribution ledger; a human makes the decision. Enforced by `RegulatoryAutonomyPolicy`
   (`humanControlRequired = true`, `maxAutonomyLevel = propose`) for `activityClass = hiring`.
4. **Recommendation, not verdict** — the output is advisory; the record captures that a human ratified
   or overrode it (the `DecisionShadowLedger` observed-vs-actual pattern already models this).

### 6.4 Substrate reality for the instance

There is **no ATS / applicant / requisition / candidate-ranking model today** (verified: zero hits for
`Applicant`, `Requisition`, four-fifths, LL144, bias audit). `WorkforceCandidateFact` is post-hire
signal extraction, not hiring. The cited Greenhouse absorption design (§6/§9) and native-ATS
`BI-F3AEBF68` **do not exist**. Therefore Instance One's applicant substrate is a **future absorption
target**, and this spec scopes only the *decision-trust* layer that a future ATS would plug into — the
evidence-grounded, jurisdiction-aware, immutable, externally-verified evaluation record. Building the ATS
itself is out of scope here and is called out as a dependency (§9 Phase E, §10).

---

## 7. Kernel decision record (the two forks)

Both forks were generated via `dpf-brainstorming` and scored via `dpf-decision-via-kernel`
(`principle_decide`, `callingPopulation: external_coding_agent`, `ringScope: [universal-ring]`,
`callingSurface: kernel-architecture-design`). Signal was `structuredCoverage: strong`,
`insufficientSignal: false` for both. No commandment-conflict flag fired.

### Fork A — how axes are chosen & validated

- **Options:** A1 hand-authored job-analysis · A2 learned-from-rulings · A3 hybrid (immutable
  hand-authored baseline + human-ratified, adverse-impact-checked advisory learning; protected-proxy
  axes never learned in).
- **Result:** **A3 recommended — composite 14.229, margin 3.220, confidence high.**
  (A1 11.008, A2 6.044.)
- **Top contributors:** DCO/commit discipline, Ship Real Functionality, Research and Use Standards,
  Structural-verification-is-not-functional, Never-Assume-Verify.
- **Reading:** the kernel ranks the pure-learned approach (A2) **last** — its historical-bias risk
  surfaces as low `governance_compliance` / `public_safety`. A3's separation of an *immutable
  defensibility baseline* from *gated optimization* wins decisively. **Proceed with A3.**

### Fork B — the immutability mechanism

- **Options:** B1 append-only+hash-chain (all-local) · B2 signed ledger · B3 external notarization.
- **Result:** **near-tie — B1 12.643, B2 12.638 (margin 0.006, confidence LOW), B3 11.876.**
- **Top contributors:** Research and Use Standards, Ship Real Functionality,
  Worktree-source-not-runtime, Never-Assume-Verify. B3 is dragged down by `operational_independence`
  (external dependency vs the all-local doctrine).
- **Reading (per skill contract for low margin):** a 0.006 margin at low confidence is **noise** — the
  kernel is explicitly saying *do not pick one*. The defensible synthesis is the **tiered composition in
  Axis 3**: B1 always-on, B2 high-risk default, B3 regulated opt-in. **Surface to operator for
  ratification of the tier boundaries** (§10 Q1); do not claim the kernel chose B1.

---

## 8. Research & Benchmarking (required by AGENTS.md §7)

**Tamper-evidence / external verifiability (Axis 3 & 4).**
- **Sigstore Rekor + Google Trillian** — append-only Merkle transparency logs with inclusion/consistency
  proofs. *Adopt the pattern* (Merkle chain + head anchoring) for B1/B3; *reject the hard dependency* on
  the public Rekor instance by default (all-local doctrine) — allow a self-hosted Trillian-style log or
  RFC3161 TSA as the opt-in B3 authority.
- **in-toto / SLSA provenance attestations** — signed statements binding an artifact to how it was
  produced. *Adopt* the attestation shape for the signed decision entry (B2); the decision record is an
  attestation "this composite was produced from these criteria + evidence".
- **C2PA content credentials** — tamper-evident provenance manifests with a hash-chained claim. *Adopt*
  the manifest-of-assertions framing for the per-dimension evidence bundle; *reject* the media-specific
  binding.
- **RFC 3161 timestamping** — standard trusted-timestamp for existence-at-time. *Adopt* as one allowed B3
  anchor authority.

**Bias audit / adverse impact (Instance One).**
- **IBM AI Fairness 360**, **Microsoft Fairlearn**, **DSaPP Aequitas** — open-source fairness toolkits
  computing disparate-impact / four-fifths ratios. *Adopt* Aequitas-style disparate-impact metrics on the
  **monitoring-only rail** (6.3) to produce LL144 impact ratios; *reject* their mitigation transforms that
  reweight by protected class (that would put protected class back into the scoring path — precisely what
  guardrail 6.3.2 forbids).

**Decision records.**
- **ADR (Architecture Decision Records)** and **RFC 2119** language — *adopt* the "record the decision +
  its rationale + alternatives" discipline; the contribution ledger already exceeds ADR granularity.

**Net:** DPF adopts the transparency-log/attestation *patterns* and the disparate-impact *metrics*,
implemented locally, and rejects the external-service dependencies and the reweight-by-protected-class
mitigations. No external network dependency is introduced on the default path.

---

## 9. Phased decomposition → child BIs (under EP-VERIFICATION-INTEGRITY)

Each phase is one child BI (filed via `dpf-file-backlog-item`, §11). Ordering reflects dependency:
evidence-grounding is the floor; immutability protects it; verification checks it; jurisdiction selects
what is scored; the candidate instance exercises all four.

- **Phase A — Evidence-grounding binding (Axis 1).** Lift `deliberation/evidence.ts` grades +
  `StructuredLocator` to the kernel packs; add the `evidence` map to `principle_decide` /
  `evaluate_profession_decision`; populate `DecisionInteraction.sources`/`.evidenceBundle`; enforce
  "unevidenced score = missingDimension" for high-risk `activityClass`. *Foundational; blocks the rest.*
- **Phase B — Immutable decision record (Axis 3, B1 tier).** Hash-chain columns + append-only write
  guard + invariant test; seal `{criteria, evidence-digests, weights, composite}`. *Depends on A.*
- **Phase C — External verifier (Axis 4).** `EvidenceReVerification` reusing the
  `verified-finding-review` separation-of-duties pattern; re-resolve locators, compare excerpts,
  append verdict to the chain; block on high-risk. *Depends on A, B.*
- **Phase D — Jurisdiction criteria selection (Axis 2).** Jurisdiction criteria projection on the
  `RegulatoryAutonomyPolicy` tuple; resolver order statute → WWWD → WSID → kernel; record the resolved
  basis + pack version. *Depends on A.*
- **Phase E — Fair candidate-evaluation instance (Instance One).** Wire an HR coworker candidate-eval
  through `evaluate_profession_decision` + envelope; job-analysis axes (Fork A / A3); proxy detector;
  monitoring-only demographic rail; LL144/four-fifths aggregation over the sealed records; human-in-the-loop
  autonomy policy. *Depends on A–D; also depends on a future applicant/ATS substrate (out of scope here — §10 Q4).*
- **Phase B2/B3 (deferred sub-items of Phase B).** Signing tier + external-anchor tier, gated on operator
  ratification of the tier boundaries (§10 Q1).

Plus **Phase 0 — create `EP-VERIFICATION-INTEGRITY` epic + umbrella BI** (needs `create_epic`, not exposed
to this session's token — §11).

---

## 10. Open questions for operator ratification

1. **Fork B tier boundaries (low-confidence kernel result).** Ratify: B1 always-on, B2 default for which
   `activityClass` set (hiring/credit/health?), B3 opt-in for which install profiles? The kernel
   explicitly deferred this (margin 0.006).
2. **Evidence store consolidation.** Wire the orphan `EvidenceBundle`/`EvidenceSource` as the citation
   store, or consolidate on `ExternalEvidenceRecord`? Do not create a third home.
3. **Signing key custody.** Local softHSM by default vs. requiring external KMS for the B2 tier — affects
   the `operational_independence` posture the kernel weighted heavily.
4. **ATS dependency for Instance One.** Instance One needs an applicant/requisition substrate that does not
   exist. Build a native ATS (the cited `BI-F3AEBF68` / Greenhouse absorption — both absent), or scope
   Instance One to an evidence-grounded evaluation over an *external* ATS's candidate records first?
5. **ID reconciliation** (§11) — approve creating `EP-VERIFICATION-INTEGRITY` + a fresh umbrella BI to
   stand in for the non-existent `BI-63811996`.

---

## 11. ID reconciliation & backlog mechanics

- `EP-VERIFICATION-INTEGRITY` and `BI-63811996` **do not exist**; this session's MCP token exposes
  `create_backlog_item` and `link_backlog_item_to_epic` but **not `create_epic`**. Therefore: the child
  BIs are filed now with the epic named in their body and this spec linked; **creating the epic and the
  umbrella anchor BI requires either `create_epic` access or an operator action**, tracked as Phase 0.
- Child BIs take auto-assigned ids; this spec's frontmatter is updated with the real ids once filed
  (§ Anchor BI). All cited-but-absent ids from the tasking are recorded in "Design grounding" as
  aspirational so the record is not silently reconciled.

---

## 12. Doctrine honored

`verify-substrate-before-proposing-new` (§Design grounding), `single-source-of-truth` (one kernel/one
ledger, extended), `architecture-over-shortcuts` (envelope not fork), `governance-approves-evidence-not-provenance`
(evidence quality gates; identity is an audit field), `research-and-use-standards` (§8),
`make-silent-failures-observable` (unevidenced score fails fast), `strongly-typed-string-enums` (§4),
`decisions-belong-to-their-scope` (WWMD envelope vs WSID instance vs WWWD overlay kept distinct).
