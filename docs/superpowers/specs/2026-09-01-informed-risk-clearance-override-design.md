---
status: active
---

# Informed-Risk Clearance Override (break-glass) — Design

**Backlog item:** BI-4512E7D2 (umbrella)
**Related:** BI-431524DF (accurate clearance dead-end, merged PR #4938), BI-654EE2E9 (tier-aware routing)
**Date:** 2026-09-01

## Problem

The provider data-sensitivity fence correctly refuses to send a coworker's confidential work to a provider whose account carries no commercial no-training guarantee (`deriveActivationClearance` derives a personal-subscription cloud provider to `["public"]`; `endpointClearsSensitivity` then excludes it). Today the only outcomes are **hard block** or **attest a genuinely-cleared business account**. There is no path for an organization to make an *informed* decision to accept the risk and proceed anyway.

Operator framing: "There are acceptable risks in life; we need to understand and go forward." The platform must make the safe path the default and the risky path a **deliberate, informed, recorded** act — not impossible, and never the path of least resistance. Education must live at the point of decision, because a policy manual nobody reads does not inform consent ("you can lead a horse to water").

## Requirement

An operator-only **break-glass override** that lets a named provider serve a named data sensitivity **despite** its derived clearance, gated by informed consent:

- **Defaults off.** The attested-account and local-model paths remain the recommended answers.
- **Explicit and scoped.** Per provider × per sensitivity level (org-scoped), naming exactly what is allowed (which data class → which uncleared provider) and *why it is uncleared*.
- **Affirmative acknowledgment of the specific risk** at the decision point — plain language: "this sends {sensitivity} data to {provider}, whose account carries no no-training guarantee."
- **Audited.** A consent record: who accepted, when, scope, justification.
- **Visible, revocable, expiring.** Revoking restores the block; an expiry is required.
- **Never conflated with attestation.** Attestation asserts the account *is* protected; an override asserts we accept that it *is not*. The two must be distinct in the data and the UI.

## Research & Benchmarking

Three industry patterns for "proceed despite a safety control", compared:

1. **DLP override with justification (Microsoft Purview / Google Workspace DLP).** A blocking DLP rule can be configured to allow user override with a mandatory business-justification prompt; the override is logged as an incident. *Adopt:* the mandatory-justification-at-the-block and the audit-the-override shape. *Reject:* end-user (non-admin) self-override — DPF restricts this to the operator, because the risk is org-level data exposure, not a per-message call.

2. **Cloud break-glass / JIT elevation (AWS break-glass roles, Azure PIM).** Emergency access is a separate, time-bounded, heavily-audited *grant* distinct from standing permissions, with approver + expiry + review. *Adopt:* the override as a **separate record with approver, rationale, and expiry** (not a mutation of the standing grant) — this is the core architectural choice below. *Reject:* multi-party approval workflow for v1 (operator is the single accountable authority on a self-hosted install); leave an approver field for later.

3. **Healthcare emergency-override / consent directives (the codebase's own `PatientConsentDirective` / `CareConsentAttestation` with `emergencyOverrideAllowed`, and `DataPolicyException`).** A consent/exception is modeled as a first-class, time-bounded record separate from the policy it excepts. *Adopt:* mirror `DataPolicyException` (approverRef, rationale, compensatingControl, expiresAt, status, scope) — it is the house standard for "explicitly approved, time-bounded exception". *Reject:* building a parallel record type; extend the existing shape.

**Decision:** DPF adopts the break-glass-as-separate-time-bounded-record pattern (2 + 3), with mandatory justification and audit (1), operator-only, single-authority for v1.

## Design

### Core architectural choice — honor a separate signal; never widen the clearance array

`sensitivityClearance` on `ModelProvider` means *"genuinely cleared / safe"* and is written in exactly one place (`activateProvider` → `deriveActivationClearance` → `narrowClearance`, which structurally only narrows). **We do not widen it for an override.** Widening it would make the array lie about safety — the exact dishonesty BI-431524DF just removed. Instead the override is a distinct record the fence consults.

The fence (`endpointClearsSensitivity`, `pipeline-v2.ts`) already returns a boolean. It gains a second, clearly-labelled path: an endpoint clears a sensitivity if it is genuinely cleared **or** an active risk-accepted override covers `(providerId, sensitivity)`. The two reasons stay separable end-to-end for audit and copy.

### Data model — `ProviderClearanceOverride`

New model in `security-compliance.prisma`, mirroring `DataPolicyException`:

```
model ProviderClearanceOverride {
  id                  String   @id @default(cuid())
  overrideId          String
  organizationId      String
  providerId          String                    // ModelProvider.providerId
  acceptedSensitivities Json    @default("[]")   // e.g. ["confidential"] — the levels risk-accepted
  status              String   @default("active") // active | revoked | expired
  rationale           String                     // required justification
  acknowledgedRisk    String                     // the exact risk text shown at accept time (frozen)
  approverRef         String?                    // operator principal id
  acknowledgedAt      DateTime @default(now())
  expiresAt           DateTime                   // required — no indefinite override
  revokedAt           DateTime?
  revokedByRef        String?
  provenance          Json
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  organization        Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, overrideId])
  @@index([organizationId, providerId, status])
  @@index([expiresAt])
}
```

An override is **active** iff `status == "active"` and `expiresAt > now`. Audit of the *act* also writes an `AdminActivity` / `ComplianceEvidence` row (operator as `collectedBy`), so the grant appears in the existing provider-trust evidence chain but under a claim key that marks it risk-accepted, never attested-safe.

### Loader + fence integration

- The endpoint loader (`routing/loader.ts`) populates a new optional `EndpointManifest.riskAcceptedClearances: SensitivityLevel[]` from the org's active overrides for that provider. Empty for every provider by default.
- `endpointClearsSensitivity` returns true when `ep.sensitivityClearance.includes(sensitivity)` (genuinely cleared) **or** `ep.riskAcceptedClearances.includes(sensitivity)` (risk-accepted). The exclusion reason and the coworker dead-end copy remain accurate because the two arrays are distinct.
- Routing prefers a genuinely-cleared endpoint over a risk-accepted one when both exist (a soft preference in ranking), so an override never *diverts* traffic from a safe provider — it only unblocks when nothing safe qualifies.

### Operator surface

- On `platform/ai/providers/[providerId]`, a **"Accept risk / break-glass"** panel, operator-only (`requireCapability`), defaults off, visually distinct from the account-posture attestation form. It states the specific risk for the specific provider, requires a typed justification and an explicit acknowledgment checkbox, and requires an expiry.
- A list of active overrides with who/when/scope/justification/expiry and a one-click **revoke**.
- Copy makes the asymmetry explicit: attestation = "this account is contractually safe"; override = "this account is NOT verified safe and we accept the exposure."

### Increments (deliverables)

1. **Spec** (this document) + plan with backlog coverage.
2. **Spine:** `ProviderClearanceOverride` model + migration; active-override query; `EndpointManifest.riskAcceptedClearances` + loader population; `endpointClearsSensitivity` honoring it; ranking preference for genuinely-cleared; unit tests (fence honors active override; ignores expired/revoked; prefers safe; array stays honest).
3. **Grant/revoke actions + audit:** operator-only server actions to create/revoke an override, writing the consent record + evidence; unit tests incl. authorization and expiry.
4. **Operator UI:** the break-glass panel + active-override list/revoke; UX verification against the running app.

## Acceptance

- With no override, confidential coworkers behave exactly as today (hard block + accurate dead-end from BI-431524DF).
- An operator can, through an explicit acknowledgment surface stating the specific risk, authorize a named uncleared provider to serve a named sensitivity; a `ProviderClearanceOverride` + audit record is written; routing then permits it.
- An expired or revoked override does not unblock; revoking restores the block immediately.
- `ModelProvider.sensitivityClearance` is never widened by an override; the coworker's dead-end copy and the exclusion trace remain truthful about *why* a provider is or is not usable.
- The UI never presents an override as an attestation.
