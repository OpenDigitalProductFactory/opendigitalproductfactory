# Healthcare patient authority implementation plan

**Backlog item:** BI-HEALTHCARE-004

**Epic:** EP-HEALTHCARE-PRACTICE
**Design inputs:** `2026-07-15-healthcare-canonical-data-authority-design.md` and `2026-07-15-healthcare-privacy-security-safety-threat-model.md`

## Objective

Add the first executable healthcare identity boundary without creating a second person master:

- `Principal` and `PrincipalAlias` remain universal identity authority.
- An organization-scoped `PatientProfile` records the patient role and non-demographic care preferences.
- Effective-dated patient-to-human authority records express guardian, caregiver, household, emergency-contact, responsible-party, and proxy relationships.
- Versioned consent and privacy-restriction directives constrain purposes, operations, and record categories.
- Existing `AuthorizationDecisionLog` records which patient authority and consent records were evaluated.
- A pure, deny-by-default decision contract makes cross-tenant, wrong-subject, expired/revoked proxy, identity-review, merge, minor, staff-override, and emergency-access behavior testable before routes exist.

## Substrate verification

| Concern | Existing authority | Decision |
|---|---|---|
| Universal identity | `Principal`, `PrincipalAlias`, MDM merge/unmerge services | Extend; never duplicate demographics |
| Organization | `Organization` | Parent scope for patient roles and authority |
| Generic resource/agent authority | `AuthorityBinding` | Reuse for AI/resource grants; do not overload it as the patient legal relationship record |
| Authorization evidence | `AuthorizationDecisionLog` | Extend with patient subject, purpose, authority, and consent references |
| Compliance audit | `ComplianceAuditLog` | Reuse for administrative entity changes; no healthcare-only audit log |
| Voice consent | `VoiceConsentRecord` | Remains voice-specific and is not reused as general healthcare consent |

No existing `PatientProfile`, guardian/proxy authority, or general patient consent/restriction substrate exists on `origin/main`.

## Phase 1 — Domain contract and red tests

Files:

- `packages/db/src/healthcare-patient-authority.ts`
- `packages/db/src/healthcare-patient-authority.test.ts`
- `packages/db/src/healthcare-patient-authority-model.test.ts`
- `packages/db/src/index.ts`
- `packages/db/package.json`

Deliver:

- Closed string vocabularies for patient lifecycle, relationship type, authority status, directive type/status/decision, operations, and decision reason codes.
- A deterministic `evaluatePatientAuthority` function with no database or UI dependency.
- Explicit emergency-access contract: human-only, declared reason, patient-specific, unexpired, minimum requested operation; it is never inferred from staff role.

Verification:

- Observe the new tests fail before implementation.
- Targeted Vitest passes after implementation.
- Tests cover every BI-004 negative case and prove self-access is not treated as proxy authority.

## Phase 2 — Fleet-safe schema expansion

Files:

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260716220000_add_healthcare_patient_authority/migration.sql`
- generated Prisma client

Deliver:

- `PatientProfile` as an organization-scoped 1:1 role extension of `Principal`.
- `PatientAuthority` for typed, evidenced, effective-dated human relationships.
- `PatientConsentDirective` for versioned permits/restrictions.
- Optional healthcare context references on `AuthorizationDecisionLog`.
- Composite organization-consistent foreign keys from authority/directive rows to `PatientProfile`.
- Retention-safe `RESTRICT`/`SET NULL` deletion behavior; no cascade from `Principal` or `Organization` into retained patient authority.
- RLS policies that fail closed when organization context is absent.

Migration safety:

- This is an expand-only migration creating empty tables and nullable columns on an existing audit table.
- No existing row is tightened or backfilled.
- All new constrained data enters through the new contract.

Verification:

- `prisma validate` and client generation pass.
- Model-delegate tests pass.
- Migration safety guard accepts the in-file data-safety attestation.
- Apply the migration against a disposable/canonical governed Postgres target, not by mutating the root install ad hoc.

## Phase 3 — Repository boundary and evidence writer

Files:

- `apps/web/lib/healthcare/patient-authority-repository.ts`
- `apps/web/lib/healthcare/patient-authority-repository.test.ts`

Deliver:

- A transaction-scoped helper that sets validated organization and patient context with `set_config(..., true)`.
- Read helpers return only active, effective authority and directive records for one organization and patient.
- Decision logging writes `AuthorizationDecisionLog` with organization, patient subject, purpose, matched authority/directive, policy/version rationale, and allow/deny result.
- No route directly queries the new Prisma delegates.

Verification:

- Mocked repository tests assert one transaction, local context establishment before reads, tenant/patient predicates on every query, and immutable decision-log creation.
- Negative tests prove absent context and cross-tenant inputs fail before queries.

## Phase 4 — EA allocation and durable documentation

Files:

- `packages/db/src/data-model-mirror-config.ts` only if the generic mirror requires explicit registration.
- The canonical healthcare design, if implementation details materially clarify it.

Deliver:

- Confirm the generic Prisma-to-EA mirror discovers all new models and relations.
- Record repository/RLS/decision-contract allocation and verification cases.

Verification:

- Existing data-model mirror tests pass.
- Architecture review confirms Principal convergence, single-source-of-truth, tenant consistency, retention, and audit reuse.

## Risks and rollback

- **Risk: parallel identity.** Mitigation: no name, birth date, email, phone, or address fields exist on `PatientProfile`; those stay on canonical identity/contact sources.
- **Risk: proxy overreach.** Mitigation: operation, purpose, record-category, effective-period, status, organization, and subject are all mandatory decision inputs.
- **Risk: deleting retained authority evidence.** Mitigation: `RESTRICT` relationships and revocation/supersession instead of deletion.
- **Risk: RLS connection leakage.** Mitigation: transaction-local `set_config` only, fail-closed policies, and connection-reuse verification before runtime launch.
- **Risk: jurisdiction-specific minor rules becoming hardcoded.** Mitigation: this slice denies when authority is insufficient; jurisdiction evaluation supplies the effective authority/directive inputs later.
- **Rollback:** application code can stop using the new repository without affecting existing flows. The expand-only tables remain inert. A later cleanup migration may remove unused substrate only after confirming no patient rows or decision-log references exist.

## Definition of done

1. No duplicate patient/person demographics authority exists.
2. Every patient role is unique per organization and Principal.
3. Every proxy decision is scoped to organization, patient, purpose, operation, category, and time.
4. Minor, duplicate/identity-review, cross-tenant, revoked/expired proxy, merged profile, staff override, and emergency-access tests pass.
5. Staff-assisted and self-service recovery are represented as explicit decision outcomes/obligations, not silent override.
6. Authorization evidence names who acted, the patient subject, purpose, authority/directive versions consulted, and the result.
7. Prisma, migration, domain, repository, and EA checks pass with evidence recorded against BI-HEALTHCARE-004.
