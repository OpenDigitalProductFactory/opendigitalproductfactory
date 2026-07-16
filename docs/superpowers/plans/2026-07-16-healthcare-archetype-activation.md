# Medical and Dental Archetype Activation Plan

> **Backlog item:** `BI-HEALTHCARE-002`
>
> **Epic:** `EP-HEALTHCARE-PRACTICE`
>
> **Parent design:** `docs/superpowers/specs/2026-07-15-healthcare-dental-practice-archetypes-design.md`

## Outcome

Activate small ambulatory medical and dental practices through the existing
`healthcare-wellness` archetype substrate. Both leaves must describe a
patient-and-payer, encounter-based, episode-of-care operating model; keep
patient-facing records in strict customer scope; use healthcare-specific role
vocabulary and onboarding context; and resolve to a care-practice workspace
home without introducing a second healthcare registry.

## Delivery

1. Add failing registry tests for the `medical-practice` leaf and the shared
   medical/dental activation contract.
2. Preserve the existing activation-profile schema, but make its already-typed
   capability override scope, transaction-context, isolation, and surface fields
   survive runtime normalization.
3. Add one shared care-practice activation profile and apply it to
   `medical-practice` and `dental-practice`.
4. Give the two leaves patient/practitioner/front-desk vocabulary, appropriate
   service templates, safe intake fields, and appointment scheduling defaults.
5. Add exact medical/dental workspace-home resolution and specific onboarding
   context while retaining the category profile for other wellness businesses.
6. Run affected registry, onboarding, vocabulary, workspace, and risk-posture
   tests; run web typecheck and the governed shared-sandbox production gate.

## Safety constraints

- Public booking forms collect logistics and broad visit reasons only. They do
  not solicit diagnosis narratives, test results, insurance identifiers, or
  other clinical record content.
- `estateSeparation` is `strict`, patient projection is separate, and all
  patient-account/billing capability overrides use `strict-customer-scope`.
- Appointment and episode-of-care context are explicit; billing remains
  prepared/manual rather than autonomously prescribed.
- The existing conservative `healthcare-wellness` risk default remains the
  trust posture source of truth.

## Verification

- Registry tests prove both leaves, axes, isolation, capability contexts, and
  vocabulary.
- Workspace tests prove exact care-practice selection.
- Onboarding tests prove medical and dental specialization.
- Risk tests continue to prove conservative healthcare defaults.
- Web typecheck and production build pass.

## UX fit review - care-practice activation

- **Decision:** fits-with-guardrails
- **Owning area:** Workspace for staff attention; Storefront for business
  configuration; the external patient experience remains under `/portal`.
- **Route family:** existing `/workspace`, `/storefront`, and `/portal` families.
  This slice adds no route, navigation item, tab, dashboard, or component family.
- **Primary persona:** receptionist/scheduler who needs today's patients,
  appointment exceptions, and care-team handoffs without learning platform
  terminology.
- **Navigation layer touched:** none. Exact archetype resolution changes the
  content selected by the existing workspace-home registry.
- **Reuse/convergence:** reuses the workspace-home profile, booking form,
  archetype vocabulary, and onboarding profile contracts.
- **Source truth:** `StorefrontConfig.archetypeId` selects the leaf;
  `StorefrontArchetype` activation/vocabulary seed data selects the profile;
  current workspace cards remain bound to customer-account, work-item,
  calendar-event, and signal read models.
- **Empty/failure behavior:** the existing workspace-home resolver retains its
  unconfigured mode and `needs-data` empty-state contract. This slice does not
  render synthetic clinical values when care-specific data is unavailable.
- **AI boundary:** profile selection and cards send no prompt. The front-desk
  coworker label is vocabulary only; future actions remain subject to the
  platform's preview and confirmation boundary.
- **Required guardrails:** do not expose diagnosis/test-result free text in the
  public booking form; do not claim clinical encounter widgets until their
  canonical read models land; do not add a healthcare dashboard alongside
  `/workspace`.
- **Evidence before merge:** registry and resolver tests, both leaf profiles in
  the setup surface, desktop/narrow workspace verification, and an honest
  missing-data state.

## Architecture review (advisory)

The slice is aligned with the parent capability-overlay decision and DPF's
single-source-of-truth rules.

- The existing `healthcare-wellness` category, activation-profile axes,
  capability registry, workspace resolver, risk posture, vocabulary, and
  onboarding registries are extended rather than duplicated.
- Runtime normalization now preserves the optional capability override fields
  already declared by `CapabilityOverride`; no new configuration schema or
  enum is introduced.
- `patient-and-payer`, `encounter-based`, and `episode-of-care` remain canonical
  axes. Patient engagement projection and billing are explicitly
  `strict-customer-scope` for appointment and episode-of-care contexts.
- `multi-channel` is used instead of `onsite-plus-portal`: the latter is the
  canonical signal for a mobile worker travelling to a customer site and would
  incorrectly activate field dispatch for an office-based clinic.
- `PatientProfile` remains the canonical clinical identity extension from
  `BI-HEALTHCARE-004`; this slice uses the existing customer-account capability
  only as the engagement/projection seam and does not create a competing
  patient record model.
- No architecture decision requires escalation. Later encounter, results,
  payer, credentialing, and jurisdiction models remain in their filed backlog
  slices rather than being improvised in this activation PR.
