# Onboarding Intake & Derivation — Design Spec

**Date:** 2026-06-20
**Status:** Draft (founder `/goal` research → design)
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Scope:** Widen what the initial deployment/onboarding flow captures so downstream decisions get easier and fewer individual questions are asked later — without making the human type everything. Cover (a) deriving what can be derived (risk tolerance from industry), (b) ingesting from documents and connected systems (QuickBooks), (c) capturing sensitive baseline (bank, employees) quickly, and (d) assuring the user their information is safe.

**Proposed epic:** `EP-ONBOARDING-INTAKE` (new — relates to `EP-INSTALL-HARDENING-2026-05-23`, `EP-ARCH-8D4F2A`, `EP-SBO`, `EP-LICENSING`).

**Dependencies / prior art read for this design:**
- `docs/superpowers/specs/2026-04-11-business-setup-unification-design.md` (the "Business Context First" flow; Approach C conversational onboarding was deferred there)
- `docs/superpowers/specs/2026-05-16-small-business-os-parity-quickbooks-anchor-design.md` (QuickBooks read-only + readiness descriptor + import-staging + ADRs)
- `docs/superpowers/plans/2026-06-16-profession-corpus-archetype-region-axis.md` (the canonical capture-once-derive-many exemplar)
- `apps/web/lib/onboarding/archetype-business-context.ts` (`INDUSTRY_PROFILES` / `ARCHETYPE_PROFILES` → `suggestMission()` / `seedOrgWwwdCorpus()`)
- `apps/web/lib/operate/retention/industry-floors.ts` (`INDUSTRY_RETENTION_FLOORS` — the industry-derived-floor pattern this design reuses for risk)
- `docs/architecture/2026-06-19-cada-cloud-sovereignty-architecture-note.md` + `packages/db/src/sovereignty-assessment.ts` (the safety substrate the trust panel surfaces)
- Founder feedback memories: derive-timezone-from-location (MUST), autopilot trust-dial maturation, consult-scopes-before-asking-human, do-the-work-don't-task-the-operator.

---

## 1. Problem Statement

The platform runs a business. The richer its picture of *this* business at the moment of deployment, the more downstream choices it can make for the operator instead of interrupting them with a question later. Today's onboarding captures a thin slice and leaves most of the picture to be filled in piecemeal, screen by screen, over the following weeks.

The founder's framing, restated as design constraints:

1. **Capture more up front, but don't make the human enter everything.** The aperture should widen by *deriving* and *ingesting*, not by adding form fields.
2. **Derive what is derivable.** Risk tolerance, for one, can be substantially derived from industry. A dental practice and a crypto exchange should not start at the same autonomy setting.
3. **Capture sensitive baseline fast.** Bank account and employees should be enterable in seconds — or pulled from a system that already has them.
4. **Ingest from documents and systems.** A formation document, a prior-year tax return, or a connected QuickBooks already hold most of what we ask for. Read them.
5. **Assure the user it is safe.** Capturing bank, payroll, and financial documents only works if the operator trusts where that data lives. The assurance must be *legible at the moment of capture*, and it must be *true*.
6. **Leverage the up-front detail so fewer individual questions are needed later.** Every later question that *could* have been answered by onboarding capture is a defect in the intake design.

This is not a request to build an onboarding wizard from scratch — one exists (§2). It is a request to change the **economics of intake**: shift the burden from the operator's keyboard to the platform's derivation and ingestion engines, and make the safety promise a first-class surface rather than fine print.

### 1.1 The reframe: onboarding *is* seeding every governed scope

DPF already governs business behaviour through layered scopes — Organization identity, `BusinessContext` strategy, the org **WWWD** doctrine corpus, compliance scope, capability activation, tax/license profile, the people/finance baseline. Onboarding is the single moment where all of those are born. So the design principle is not "collect more fields" but:

> **Every question the platform asks the operator *after* onboarding is a question whose answer could have been derived, ingested, or confirmed once at onboarding.** Intake's job is to drive that later-question count toward zero.

This is the onboarding expression of the kernel principles **`do-the-work-don't-task-the-operator`** and **`never-ask-the-user-to-run-commands`**, and of the founder MUST **derive-timezone-from-location** (don't ask what you can derive from what you already captured).

---

## 2. Current-State Analysis

### 2.1 What onboarding captures today

The live flow is a 9-step overlay (`apps/web/lib/actions/setup-constants.ts`) rendered over real portal pages, guided by the onboarding COO coworker (`apps/web/components/setup/SetupOverlay.tsx`):

| # | Step | Captured | How |
|---|------|----------|-----|
| 1 | account-bootstrap (`/setup`) | Org name, owner email, password | **3 typed fields** (`AccountBootstrapForm.tsx`) |
| 2 | ai-providers | (provider detection) | informational |
| 3 | branding (`/admin/branding`) | logo, palette, **+ derived** company name / industry / description / contact / archetype / currency / country / timezone | **LIVE brand extraction** (website URL, brand-doc upload, or codebase) → `SetupContext.suggested*` |
| 4 | business-context (`/storefront/settings/business`) | description, mission, targetMarket, companySize, geographicScope, **operatesIn / sellsTo / employsIn / dataResidency**, handlesCardPayments, contact | mostly optional, progressive disclosure, **pre-filled** from step 3 (`BusinessContextForm.tsx`) |
| 5 | operating-hours | schedule + timezone | timezone **derived from location** (`timezone-from-location.ts`) |
| 6 | storefront | archetype selection + per-archetype capability questions | wizard (`SetupWizard.tsx`); **hard-blocks** step advance until `StorefrontConfig` exists |
| 7 | platform-development | contribution mode | selection |
| 8 | build-studio | — | tour |
| 9 | workspace | — | tour |

**What's already good** (and what this design builds on rather than replaces):
- **Brand extraction is live** and already derives ~13 fields from a URL/doc/codebase (`apps/web/lib/brand/extraction/`), surfaced with an `AutoFillHint` confirm affordance.
- **The capture-once-derive-many pattern is proven** — the jurisdiction-basis axis (`operatesIn`/`sellsTo`/`employsIn`/`dataResidency`) is four questions that fan out to ≥10 downstream systems (corpus filtering, compliance gating, capability activation, retention floors, localisation). This is the template (§4).
- **`finalizeSetupCompletion()`** already seeds the org WWWD corpus, company-mission prompt, portfolio decomposition, and archetype-derived market offer at the end of setup.

### 2.2 What it does *not* capture — the gaps this design fills

| Gap | Today | Consequence |
|-----|-------|-------------|
| **Risk posture / autonomy appetite** | **No org-wide home anywhere.** `riskAppetite`/`riskTolerance`/`riskPosture` appear in zero files. Risk is fragmented across `AgentGovernanceProfile` (per-agent), `DelegationGrant` (per-delegation), `DeliberationRun` (per-run), `DecisionPerspectiveProfile.autonomyPolicy` (per-perspective). | Every agent starts at a one-size default; the operator cannot say "I'm a regulated clinic, be conservative" once. The autopilot trust dial has no industry-informed starting position. |
| **Accounting/finance baseline** | QuickBooks read is **live but not wired into onboarding**; bank accounts and employees are manual, entered later under Finance/HR. | The operator re-types company legal name, tax id, bank metadata, and staff that QuickBooks/ADP already hold. |
| **Document ingestion at setup** | File parsers (CSV/XLSX/PDF/DOCX) are **live** (`apps/web/lib/shared/file-parsers.ts`) but only wired to brand docs. | Formation docs, EIN letters, prior-year returns, employee rosters are not an intake lane. |
| **Legible safety surface** | Strong safety substrate exists (§6) but onboarding doesn't *show* it at the point of sensitive capture. | The operator is asked for bank/payroll data with no in-context assurance — the exact moment trust is needed. |
| **Later-question elimination** | Capabilities, compliance obligations, retention, partner program, locales, tax external-system are all asked/derived *later*. | Death by a thousand prompts; the up-front detail isn't leveraged. |

---

## 3. Research & Benchmarking (per AGENTS.md §10)

Studied data models and intake flows, not just feature lists.

### 3.1 Open-source

| Project | Intake data model | Pattern worth adopting |
|---------|-------------------|------------------------|
| **Odoo (Community)** | Industry "packs": selecting an industry installs apps + a **chart-of-accounts template + tax + config defaults** for that vertical. | *Industry → derived configuration bundle.* The single highest-leverage derivation. DPF's archetype already does some of this; extend it to finance/risk. |
| **ERPNext / Frappe** | Setup wizard writes a `Company` doctype that seeds a country/industry chart of accounts, fiscal year, and tax templates in one step. | *One setup record fans out into many seeded doctypes.* Mirrors `finalizeSetupCompletion()` — extend the fan-out. |
| **Medusa v2** | `Store` (identity) + `Region` (tax/currency/fulfilment context) + `SalesChannel`. Region carries the operational derivations. | *Thin identity + rich derived operational context.* Validates keeping `Organization` thin and `BusinessContext` rich. |
| **Cal.com** | Onboarding derives availability/timezone from the connected calendar instead of asking. | *Connect-to-derive over ask.* Backs the ingestion lanes (§5). |

### 3.2 Commercial

| Product | Intake data model | Pattern worth adopting |
|---------|-------------------|------------------------|
| **Rippling** | One **employee record** is the spine; it fans out into payroll, device, benefits, and access provisioning. Enter a hire once → many systems configured. | *Capture-once-fan-out entity spine.* Apply to the employee/finance baseline. |
| **Gusto** | Payroll onboarding **derives state tax accounts** from work location and **imports the employee roster** rather than re-keying. | *Derive statutory accounts from location; import the roster.* |
| **QuickBooks setup** | Industry selection seeds a **chart-of-accounts template**; bank connection (Plaid) pulls accounts + transactions. | *Industry → CoA; connect → accounts.* |
| **Vanta / Drata** | Compliance posture is **derived from connected systems** (cloud, HR, identity) — controls auto-populate from what the connectors see, operator confirms. | *Connect → derive posture → confirm.* This is exactly the model for risk/compliance capture (§4.1, §6). |
| **Stripe Atlas** | Captures formation **once** (entity, EIN, founders, bank) and fans it out to incorporation, tax, and banking. | *Capture the formation packet once.* Backs the document lane (§5.3). |

### 3.3 Patterns adopted
- **Industry-pack derivation** (Odoo/ERPNext/QuickBooks): industry/archetype → a *bundle* of derived defaults (now including **risk posture**, §4.1).
- **Connect-to-derive** (Vanta/Drata/Gusto/Cal.com/Plaid): a connected system derives posture/baseline; the operator confirms, never re-keys.
- **Capture-once-fan-out spine** (Rippling/Stripe Atlas): one record → many configured systems.
- **Confidence + confirm** (the live `AutoFillHint`): every derived/ingested value carries a confidence and is shown for confirmation — never silently trusted.

### 3.4 Patterns rejected
- **Mandatory heavy forms** (classic ERP setup): rejected — violates progressive disclosure (AGENTS.md §12) and the #2004 raw-token-input lesson.
- **Silent auto-import** (some PSA tools import everything on connect): rejected — violates the QuickBooks anchor's *integrate-before-replace* / *approval-governed* ADRs and `never-fabricate`. Ingest → **stage** → confirm → commit.
- **Cloud-default data handling** (most SaaS onboarding): rejected — DPF is sovereign-by-construction; data stays local by default (§6).
- **Pure-conversational onboarding** as the *only* path (the deferred Approach C): rejected as sole mechanism (AI-reliability dependent) but **revived as an optional accelerator over the deterministic form** (§7.3).

### 3.5 Anti-patterns identified
- **Asking the same thing twice** (the setup-unification bug): the intake spine (§4) is the single source so nothing is asked twice.
- **Retail-lens vocabulary** for non-retail businesses (HOA/clinic/nonprofit): inherited from the vocabulary work; intake speaks the archetype's language.
- **Requiring a technical input a layman can't answer** (the #2004 token field): risk/autonomy is captured as a 3-way plain-language posture, never a numeric knob.

---

## 4. The core mechanism: Derive → Ingest → Confirm → Ask

A single **Business Profile** is the canonical intake spine. It is *not a new model* — it is an orchestration over existing canonical models (`Organization`, `BusinessContext`, `OrganizationTaxProfile`, `OrganizationLicenseProfile`, `OrganizationCapabilityActivation`, `BankAccount`, `EmployeeProfile`, `IntegrationCredential`). Every field on the spine is populated by the **first** mode that can supply it, in strict priority:

1. **Derive** — compute it from what we already know (industry/archetype, location, jurisdiction axis). Zero operator effort.
2. **Ingest** — read it from a connected system or uploaded document. One connect/upload, then confirm.
3. **Confirm** — show the derived/ingested value with its confidence and provenance; the operator accepts or edits. (The live `AutoFillHint` pattern, generalised.)
4. **Ask** — only when no derivation or source exists. This is the irreducible minimum, kept to 3–5 plain choices per step.

The operator's keyboard is the **last** resort, not the first. The aperture widens by moving fields up the Derive/Ingest ladder, not by adding Ask fields.

### 4.1 Derive: industry/archetype → a defaults bundle

The platform already derives a lot from `archetype.category` (profession corpus, WWWD business profile, capability applicability, retention floors, partner program, billing patterns, vocabulary). This design adds **risk posture** to that bundle and treats the whole bundle as one derivation surface seeded at `finalizeSetupCompletion()`.

The exemplar to mirror is `INDUSTRY_RETENTION_FLOORS` (`apps/web/lib/operate/retention/industry-floors.ts`): industry sets a **conservative floor**; the operator may be *more* conservative but the derived default is the safe starting point. Risk posture works identically (§5.1 below — note: the headline gap; covered in depth in §5.1).

### 4.2 The jurisdiction axis is the proof this works

`operatesIn`/`sellsTo`/`employsIn`/`dataResidency` (4 questions, progressive disclosure, already captured) fan out to corpus filtering, compliance obligation gating, capability activation, retention floors, and localisation — **fail-open** (an undeclared dimension simply doesn't filter, so partial capture never breaks anything). This design generalises that contract to every intake field: **derive a safe default, let partial capture degrade gracefully, never block on completeness.**

---

## 5. Risk posture — the new home (headline gap)

### 5.1 Why it's the centrepiece

It is the single most-requested derivation ("risk tolerance, based on industry, can somewhat be derived") and the single biggest substrate gap (no org-wide home exists). It is also the one with the richest set of *waiting consumers*: the autopilot trust dial, `AgentGovernanceProfile.autonomyLevel`/`hitlPolicy`, self-upgrade maintenance-window width, capability auto-activation vs propose, outbound-send confirmation strictness, and edge-node deploy default.

### 5.2 Data-model decision (kernel-consulted)

**Decision: store one typed headline knob on `BusinessContext`; derive the envelope.** `principle_decide` (WWMD surface, `external_coding_agent`) was consulted across three options — extend `BusinessContext`, a new `OrganizationGovernanceProfile`, or reuse `DecisionPerspectiveProfile.autonomyPolicy` Json — and flagged **no commandment conflict** (advisory, low-margin, leaning extend-`BusinessContext`). The substantive grounds:

- **`BusinessContext` is the canonical 1:1 per-org business-profile model** (AGENTS.md §11 data-model stewardship), already seeded at onboarding and already feeding the org WWWD corpus. Risk posture is the *structured companion to the prose `howWeDecide` WWWD stance* (which already says "keep humans in final authority over consequential calls").
- A new `OrganizationGovernanceProfile` would be a **parallel home for org doctrine** — violates `single-source-of-truth`.
- A Json blob on `DecisionPerspectiveProfile` violates `strongly-typed-string-enums` and buries the org default inside a per-perspective structure.

**Shape (one stored knob + derived envelope, mirroring `resolvePortfolioDecomposition` / `resolveTimezoneFromLocation`):**

```
BusinessContext.riskPosture            : "conservative" | "balanced" | "progressive"   // the headline dial
BusinessContext.riskPostureSource      : "industry-default" | "operator"               // provenance
BusinessContext.riskPostureCapturedAt  : DateTime?
```

The *envelope* (HITL default, self-upgrade window width, autonomous-spend hint, outbound-confirmation strictness, edge-deploy default) is **not stored** — it is resolved at read time by a pure `resolveRiskEnvelope(posture, industry, archetype)`, so there is exactly one knob to keep in sync (single-source-of-truth) and the mapping can evolve without a migration.

### 5.3 Industry → derived posture default (the `INDUSTRY_RETENTION_FLOORS` mirror)

| Industry / archetype class | Derived default | Rationale |
|----------------------------|-----------------|-----------|
| banking-financial-services, healthcare-wellness, public-sector, legal | **conservative** | Regulated; consequential errors are costly/irreversible. HITL-first on consequential calls, narrow self-upgrade window, low autonomous-spend hint, outbound always-confirm, edge-deploy default OFF. |
| accounting, insurance, property/HOA (handles others' money/data) | **conservative→balanced** | Fiduciary but lower acuity than clinical/financial. |
| retail-goods, food-hospitality, beauty-personal-care, fitness-recreation, education | **balanced** | Standard SMB risk; moderate autonomy, standard windows. |
| solo/micro storefront, low-regulation services | **progressive** *(default ceiling, still HITL-first to start)* | Speed matters; few irreversible actions. Higher autonomy *ceiling*, reached faster. |

`handlesCardPayments = true` nudges one step more conservative regardless of industry (PCI exposure).

### 5.4 Onboarding does NOT set the live autonomy level — it sets the envelope

This is the precise, non-contradictory framing that reconciles with the founder's **autopilot trust-dial maturation** doctrine (autonomy is a confidence-calibrated dial that *matures with evidence*: decide → evidence → outcome → tune; build loops start **HITL-first / safe-by-construction**).

> Onboarding-derived risk posture sets the **risk envelope** — the autonomy *ceiling* and the *maturation rate* — **not** the live autonomy level. The trust dial still starts low and earns its way up via evidence. `conservative` = lower ceiling + slower maturation + more decisions that never leave HITL; `progressive` = higher ceiling reached faster. The operator can re-set the posture anytime; overrides and gone-awry cases tune it (the work-loop applied to decisions).

So risk capture is **seeding the WWWD `howWeDecide` doctrine in a machine-readable form**, consistent with `consult-scopes-before-asking-human` (the posture is org-scope doctrine, not a cold human question).

### 5.5 Consumers (capture once, derive many)

| Consumer | Reads the envelope to… |
|----------|------------------------|
| Autopilot trust dial | set initial dial position + maturation rate |
| `AgentGovernanceProfile` seed | default `autonomyLevel` / `hitlPolicy` / `maxDelegationRiskBand` for new coworkers |
| Self-upgrade scheduler | choose maintenance-window width / aggressiveness |
| Capability activation | auto-activate `recommended` vs merely propose them |
| Outbound-send gate | confirmation strictness (always / first-time / trusted) |
| Edge-node deploy | default opt-in OFF for conservative postures |

---

## 6. Trust & Safety surface (the assurance ask)

Capturing bank/payroll/financial documents only works if the operator can *see*, at the moment of capture, that it is safe — and the claim must be true. DPF's safety posture is genuinely strong, so the design makes it a **first-class in-context panel**, not fine print.

### 6.1 What onboarding can say truthfully *today* (verified in code)

| Assurance | Backed by |
|-----------|-----------|
| "This runs on **your** server — your books, bank details, and staff records stay in your Postgres on this machine." | self-hosted Docker Compose; local Postgres/Neo4j (`docker-compose.yml`) |
| "AI runs **locally**; your data is not sent to a cloud model. If a local model isn't available the request **fails** rather than reaching out." | `residencyPolicy: "local_only"` hard-filter, fail-loud, test-covered (`apps/web/lib/routing/pipeline-v2.ts`) |
| "Credentials you connect (QuickBooks, bank) are **encrypted at rest** (AES-256-GCM) and never logged." | `apps/web/lib/govern/credential-crypto.ts` + production boot guard `assertCredentialEncryptionKeyIsSet()` |
| "Personal data (SSNs, account numbers, DOB) is **redacted** from logs." | `packages/integration-shared/src/redact.ts` |
| "Nothing is sent **outside** without your explicit approval." | outbound-send kernel veto (`runtime-kernel-commandments.md`) |
| "Connected systems are a **conduit** — we call their API on your behalf with your encrypted credentials; we don't copy your data to anyone else." | customer-owned-credentials ADR (QuickBooks anchor); conduit posture (ADP plan) |
| "Your install scores **CADA Level X** for data sovereignty." | live `assessAssuranceLevel()` / `computeInstallCadaReadiness()` (`packages/db/src/`) |

### 6.2 Honest gaps — surfaced, not hidden

- **Database-at-rest encryption** is host-level today. The trust panel turns this into a **captured fact + one recommendation**: "Is this machine's disk encrypted (BitLocker/LUKS)?" → confirming it *raises the CADA score* and removes the only soft spot in the local-storage story. (Disk-encryption-confirmed becomes an input to `buildInstallSovereigntyInput`.)
- **Signed SBOM / EU-steward posture** are CADA Level 2/4 roadmap; the panel shows them as "in progress," never as done.

### 6.3 Disposition-backed, per-field

Each sensitive field's storage location and egress posture is shown from the **sovereignty/disposition** substrate (`classifyDisposition`, `sovereignty-assessment.ts`) — so "where does this live / can it leave" is answered from the same engine that governs estate sovereignty, not a hand-written reassurance.

---

## 7. Ingestion lanes (capture the baseline fast)

All three lanes build on **live** substrate, always **stage → confirm → commit** (never silent import), and always end on the spine (§4).

### 7.1 Brand / identity lane — **LIVE, extend**
Website URL / brand doc / logo → company name, industry, description, contact, palette, **archetype suggestion** (`apps/web/lib/brand/extraction/`). Extend: feed the suggested industry into the archetype → **risk-posture** derivation chain so a derived posture is ready before the operator reaches step 4.

### 7.2 Accounting lane (QuickBooks anchor) — **LIVE read, wire into onboarding**
QuickBooks read-only is live for 9 entity families (company, customers, invoices, vendors, bills, expenses, payments, accounts, reports) with a governed **readiness descriptor** state machine and **customer-owned encrypted credentials** (`apps/web/lib/integrate/quickbooks/`). Add an optional onboarding **"Connect your books"** step that, on connect, **pre-fills** (operator confirms): `Organization.legalName` + tax id, `OrganizationTaxProfile.externalSystem = "quickbooks"` + home country/region, `BankAccount` metadata (name/bank/type/currency — **not** balances), and customer/vendor/**employee-from-payroll** counts. It surfaces the readiness descriptor and offers to *stage* an import — it never auto-imports the ledger (integrate-before-replace ADR). This directly answers "bank account info and employees entered quickly" and "ingesting from systems like QuickBooks."

### 7.3 Document lane — **LIVE parsers, new mapping**
Upload formation doc / EIN letter / prior-year return / **employee-roster CSV** / bank statement → live file parsers (`apps/web/lib/shared/file-parsers.ts`) extract → a mapping step proposes spine fields (legal name, EIN, registered address, officers, bank metadata, roster rows) with confidence → operator confirms. The **bulk employee CSV import** already spec'd (BI-INT-F23BC6) is wired here as the roster path (Rippling-style: one roster → many `EmployeeProfile` records). The Stripe-Atlas-style **formation packet** becomes a single upload that fans out across `Organization`, `OrganizationLicenseProfile`, and `OrganizationTaxProfile`.

### 7.4 Optional conversational accelerator (revived Approach C)
The deterministic form stays the backbone (and the fallback). The onboarding COO can optionally **drive intake conversationally** — "tell me about your business" → it derives/ingests/pre-fills and routes every value through the same **confirm** gate. Not the sole path (AI-reliability), but a faster lane over the same spine for operators who prefer it.

---

## 8. Downstream-question-elimination ledger (the payoff)

Each row is a question the operator faces *later* today that intake pre-answers (derive/ingest/confirm) — the leverage the founder asked for:

| Later question | Today's home | Pre-answered by |
|----------------|--------------|-----------------|
| "What compliance regulations apply?" | Compliance admin | `operatesIn`+`sellsTo`+`employsIn`+industry → auto-gated obligations |
| "Do you handle card payments?" | PCI module | `handlesCardPayments` (already captured; surfaced) |
| "Which capabilities should we enable?" | Admin toggles | `deriveCapabilityApplicability()` → auto-activate `recommended` per **risk posture** |
| "What are your retention requirements?" | Lifecycle admin | `industry` → `INDUSTRY_RETENTION_FLOORS` (propose + confirm) |
| "How autonomous should agents be / who approves big changes?" | scattered / never | **risk posture** → trust-dial envelope (§5) |
| "Do you need a partner program?" | Partner config | `primaryConsumer`/`platform` axis → derive, prompt only if applicable |
| "What languages/locales?" | Coworker config | `employsIn`/`sellsTo` → suggest locales |
| "What's your tax system / accounts?" | Tax setup | QuickBooks connect → `externalSystem`, accounts, region |
| "Who are your staff?" | HR onboarding | roster CSV / QuickBooks payroll → `EmployeeProfile` baseline |
| "What are your bank accounts?" | Finance setup | QuickBooks / statement upload → `BankAccount` metadata |
| "Is your data safe / where does it live?" | (asked of support) | the trust panel (§6), disposition-backed |

---

## 9. Data Model Stewardship (per AGENTS.md §11)

**Reuse (no schema change):** `Organization`, `OrganizationTaxProfile` (already has `externalSystem`), `OrganizationLicenseProfile`, `OrganizationCapabilityActivation`, `BankAccount`, `EmployeeProfile`/`Department`/`Position`, `IntegrationCredential`, `PlatformSetupProgress`, `StorefrontArchetype.activationProfile`.

**Extend (additive, on the canonical model):** `BusinessContext.riskPosture` + `riskPostureSource` + `riskPostureCapturedAt` (§5.2). Strongly-typed enum per AGENTS.md §3.

**New pure functions (no new tables):** `resolveRiskEnvelope(posture, industry, archetype)` (read-time, mirrors retention floors); intake-mapping helpers for the document lane.

**No new identity-bearing entity** (principal-convergence is satisfied: nothing here is a new principal). **The Business Profile "spine" is an orchestration/IA, not a table.**

---

## 10. UX / IA (keep it light)

- **Progressive disclosure holds** (AGENTS.md §12): the *Ask* surface stays 3–5 plain choices per step. Width comes from Derive/Ingest, which add **zero** required fields.
- **Risk posture** is one plain 3-way choice ("How should your AI workforce balance speed vs. caution?"), pre-selected to the industry default, with a one-line explanation of what each setting changes — **never a numeric knob** (the #2004 lesson). This change is UI-impacting and will carry a **`UX-Fit-Decision:`** attestation and run `dpf-ux-fit-review` at build time (AGENTS.md §12).
- **Ingestion lanes are optional accelerators** — skippable; onboarding never blocks on a connect/upload.
- **The trust panel** appears contextually the first time a sensitive lane is opened (bank/payroll/documents), not as a wall of text up front.
- **Confirm, don't trust**: every derived/ingested value shows provenance + confidence (the live `AutoFillHint`), editable inline.

---

## 11. Phased Implementation Plan

Each phase is independently shippable and maps to a BI under `EP-ONBOARDING-INTAKE`. Sequenced so the headline gap and the safety surface land first.

| Phase | Title | Scope | Extends |
|-------|-------|-------|---------|
| **P0** | **Risk posture home + industry default** | `BusinessContext.riskPosture` (+source/capturedAt) migration; `resolveRiskEnvelope()`; industry-default derivation; seed at `finalizeSetupCompletion()`; one plain choice in step 4 pre-set to the derived default. *No consumers wired yet — inert, observable.* | — |
| **P1** | **Risk envelope → consumers** | Wire the envelope into trust-dial initial position, `AgentGovernanceProfile` seed defaults, self-upgrade window width, capability auto-activate threshold, outbound strictness, edge-deploy default. | autopilot trust dial |
| **P2** | **Trust & safety panel** | In-context panel at sensitive capture; disposition/sovereignty-backed per-field; disk-encryption capture → CADA input; live CADA-level readout. | `sovereignty-assessment` / CADA |
| **P3** | **Accounting lane onboarding wiring** | Optional "Connect your books" step; readiness-descriptor surface; confirm-gated pre-fill of legal name/tax/bank-metadata/roster-counts; stage-not-import. | `EP-SBO` (QuickBooks anchor) |
| **P4** | **Document lane** | Formation/EIN/return/roster-CSV/statement upload → parse → map → confirm → fan out. Wire bulk-roster import (BI-INT-F23BC6). | file-parsers; bulk-import spec |
| **P5** | **Intake orchestration + conversational accelerator** | Formalise the Derive→Ingest→Confirm→Ask spine as a unified intake controller; optional COO conversational lane over the same confirm gate. | setup-unification |

**P0 is the recommended first "go"** — smallest self-contained slice that fills the biggest gap, ships inert (dark) so it's safe, and unblocks every other phase.

---

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Risk posture mis-derived for an edge-case business | Medium | Low | It's an *editable default*; the trust dial still starts HITL-first and matures on evidence (§5.4). |
| Operator over-trusts an ingested value | Medium | Medium | Confirm gate is mandatory; provenance + confidence shown; never silent import (ADRs). |
| Safety panel overclaims | Low | High | §6 is verified-in-code; gaps (DB-at-rest, SBOM) shown as roadmap, never as done. |
| Onboarding feels longer | Medium | Low | Ingestion lanes are optional; *Ask* surface unchanged; width is derived, not typed. |
| Scope creep into a finance/HR rebuild | Medium | Medium | Lanes only *pre-fill the baseline + stage*; full finance/HR stays in their own surfaces (integrate-before-replace). |

---

## 13. What this does NOT include

- A new onboarding wizard (the 9-step flow stays; this changes intake economics, not the shell).
- A new identity/governance table (risk posture extends `BusinessContext`).
- Full QuickBooks/ledger import or write-back (governed separately under `EP-SBO`; onboarding only reads + stages).
- Replacing the deterministic form with conversation (conversation is an optional accelerator).
- Live DB-at-rest encryption (roadmap; surfaced honestly via host-disk capture).
- Changing the autopilot trust-dial mechanics (this *seeds* it; the dial's maturation logic is its own work).

---

## 14. Open decisions for the founder

1. **Epic shape:** new `EP-ONBOARDING-INTAKE` (recommended) vs. fold into `EP-INSTALL-HARDENING`? (Recommend new — this is strategic intake design, not cold-install reliability.)
2. **Risk-posture vocabulary:** `conservative / balanced / progressive` — acceptable plain-language labels, or prefer `cautious / standard / fast`?
3. **P0 first "go"?** Confirm risk-posture-home (dark/inert) as the first implementation layer.
4. **Accounting lane priority:** is QuickBooks-connect-at-onboarding wanted now (P3), or deferred until the QB import-staging slices land under `EP-SBO`?
