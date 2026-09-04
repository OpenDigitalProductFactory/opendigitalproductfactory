---
status: draft
---

# Field-Service Employee Data — Privacy, Consent & Automation-Interjection (Governance Gate)

**Date:** 2026-08-06
**Status:** Draft — requirements-definition gate for operator review; corpus content staged for the org governance/compliance coworker
**Epic:** EP-MOBILE-IOS-APP (employee half)
**Depends on / gates:** the field-service spine BIs — BI-66A7D4A4 (offline feed), BI-05EDC704 (agent brain), BI-F438934C (vision/OCR), BI-97C69412 (dynamic-form capture) — and the context resolver BI-4AC5F583.
**Origin:** Operator direction 2026-08-06 — "privacy considerations… is it OK to have the mobile app share location for an employee? Does it need to be gated on/off when 'on the job'? …ground our features so our own governance and compliance AI coworker will know about, and gate as part of the requirements definition for these types of concerns."

## 1. The process change (the point of this doc)

**Privacy/compliance requirements are a gate, not an afterthought.** Every field-service spine BI must pass a **Privacy & Compliance Requirements review** — owned by the **the org governance & compliance coworker**, grounded in the **organization's WWWD corpus** (org-overlay `stance`/`principle` pages) — **before build**. This dogfoods the platform's own governance surface: the corpus below is the doctrine the coworker gates against.

This gate runs in **requirements definition**, upstream of the plan's build phases. A field-service BI is not "ready to build" until its data-handling requirements are recorded here and ratified by the coworker.

## 2. What data these features touch (the risk surface)

| Data | Where it enters | Sensitivity |
|---|---|---|
| **Employee live location** | `LocationField`, geo check-in, "on my way", dispatch proximity | **High** — employee monitoring; jurisdiction-sensitive |
| **Job/site photos** (vision/OCR) | camera capture → evidence → AI processing | Medium — may contain people, plates, interiors, PII |
| **Customer / resident detail** | job detail, HOA resident/unit records | Medium–High — third-party PII |
| **Voice notes** | (planned) audio field | Medium — may capture bystanders |
| **Automation-derived inferences** | coworker drafts, predictions | Medium — decisions made *about* people |

## 3. The legal reality (why location is the sharp edge)

- **No single US rule.** Several states restrict GPS tracking of employees/personal devices and treat precise location as *sensitive personal information* (CCPA/CPRA and successors); notice — and sometimes consent — is required; **off-duty tracking is the high-risk zone.**
- **EU/UK GDPR.** Employee monitoring needs a **lawful basis** — typically *legitimate interest*, **not consent** (employment consent is deemed coerced) — plus transparency, **necessity & proportionality**, data minimization, and a **DPIA** for systematic location monitoring.
- **Cross-cutting principles** (apply everywhere): purpose limitation, data minimization, transparency, retention limits, access control, and a right to see/delete.

Implication: the platform must not ship a single global "share location" default. It must ship a **posture** that is defensible across jurisdictions and lets the org's compliance coworker tighten it per locale.

## 4. Default posture (operator-confirmed 2026-08-06; coworker to ratify legal specifics)

> **Operator rulings 2026-08-06:** P1 granularity = **coarse** (on-duty-only); P4 boundary = **propose-for-weighty, silent-only-for-trivial**. The *legal* specifics (basis per jurisdiction, DPIA triggers) route to the governance/compliance coworker + corpus, not operator gut.

**P1 — Coarse, on-duty-only, foreground-only, purpose-limited location.**
Location is **coarse-grained** and shared **only while the employee is clocked-in AND on an active dispatch/WorkItem**, **foreground-only** (no background tracking), and used **only** for dispatch/on-site-proof/"on my way." Coarse satisfies the purpose with far less privacy risk. This is the data-minimization answer and maps directly onto the **context resolver (BI-4AC5F583)**: `on-the-job → location active; off-shift → location off`. Off-the-clock location is **never** collected.

**P2 — Transparent, revocable, jurisdiction-aware consent/notice.**
The employee sees a clear indicator when location is active, a plain-language notice at onboarding, and can see what is collected and for how long. The **consent vs legitimate-interest basis is selected per jurisdiction by the compliance coworker**, not hardcoded.

**P3 — Purpose limitation — no covert productivity surveillance.**
Location and evidence exist for job execution and proof, not silent monitoring. Any secondary use is a new requirement that re-enters this gate.

**P4 — Automation-interjection boundary (propose, don't act, for anything with legal/privacy weight).**
- *Silent-OK:* stamp an arrival geotag on an active job, attach a captured photo to its evidence.
- *Propose-and-confirm:* draft an invoice from photos, notify a customer, generate an inspection report, share anything outward.
- *Never autonomous:* continuous background location, sharing location off-shift, sending PII outward without explicit go.
This inherits the platform's existing **proposal/approval gate** (AgentActionProposal) — the coworker proposes; the human confirms.

**P5 — Retention, access, minimization for photos/PII.**
Evidence photos and customer/resident PII are access-scoped (dispatcher/owner, not org-wide), retention-bounded, and vision/OCR keeps the **derived structured data**, discarding raw imagery when the derivation is the purpose.

## 5. WWWD corpus stances to encode (staged for the governance coworker)

These become org-overlay `stance`/`principle` pages in the org WWWD corpus, so the governance/compliance coworker gates future field features against the org's *own* doctrine:

1. **`stance: employee-location-on-duty-only`** — location is collected only on-the-job (clocked-in + active dispatch), foreground-only; off-shift never. *Rationale + the jurisdictional why.*
2. **`stance: location-lawful-basis-by-jurisdiction`** — basis (legitimate-interest vs consent) and notice are resolved per locale by the compliance coworker; no global default.
3. **`principle: purpose-limitation-no-covert-monitoring`** — field data serves job execution/proof, not surveillance.
4. **`principle: automation-proposes-human-confirms-for-legal-weight`** — the propose/act/never boundary of §4-P4.
5. **`stance: evidence-pii-minimization-and-retention`** — access-scope, retention bounds, derived-over-raw for imagery.
6. **`stance: customer-resident-data-consent`** (HOA-relevant) — third-party PII capture requires a lawful basis and disclosure.

## 6. How the gate runs (per spine BI)

1. BI author drafts a **Privacy & Compliance Requirements** section (data touched · posture applied · jurisdiction notes).
2. The **governance/compliance coworker** reviews it against the WWWD corpus (§5) and either ratifies or returns requirements (e.g., "add a DPIA for continuous proximity," "gate location behind on-duty state").
3. Only then does the BI proceed to build. The context resolver (BI-4AC5F583) is the enforcement point for on-duty gating; the proposal gate enforces §4-P4.

## 7. Live-instance follow-through (blocked pending access)

To make this real in the org install, the §5 stances must be **recorded into the org WWWD corpus via the portal UX** (Decision Governance / wiki) or the governed MCP tools, and the governance/compliance coworker pointed at them. Currently blocked on: (a) portal requires an authenticated Employee/Admin session — operator must sign in; (b) the dpf MCP surface is disconnected this session. Once either is restored, walk the coworker through ingesting §5 and set this gate as a required step in the field-service requirements flow.

## 8. Open questions for the operator

- **Jurisdiction scope now** — which locales does the org/Dale's-HVAC operate in first (sets the initial consent/notice posture)?
- **Location granularity** — precise vs coarse for dispatch/on-my-way? (Coarse may satisfy the purpose with far less risk.)
- **Retention windows** — how long is job location / evidence kept for proof/dispute?
- **Who sees location** — dispatcher only, or owner/admin too?
- **Is "propose, don't act" the right default** for the automation boundary, or should trusted low-risk actions (arrival geotag) be silent-OK as proposed in §4-P4?
