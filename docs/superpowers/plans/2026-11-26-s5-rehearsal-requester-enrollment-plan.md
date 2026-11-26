---
status: draft
---

# Plan: owner-operated inactive enrollment and retirement of the S5 rehearsal requester

Backlog item BI-9F7192F9, Workroom WC-4EBA473D. Design: `docs/superpowers/specs/2026-11-26-s5-rehearsal-requester-enrollment-design.md`, revision 4. Shape: delivery-small.

Both commands ship inert behind the denying fence, and the requester is never active. BI-9F5D1052 owns activation, delegation, sessions and issuance, and is blocked on the owner's least-privilege decision.

## Preconditions (hold Red until all are met)

- **P1. Design approved.** The independent re-review approves this revision.
- **P2. Migration approved.**
  - The coordinator approves the proposed `S5RehearsalRequesterEnrollment` model and its migration.
  - Then the data-model stewardship runbook applies: the `@dpf` tag is written before the migration, the retention declaration is checked, and the data-impact note is added.
  - If the migration is refused, this item holds.
- **P3. Scope claimed.** The coordinator confirms the platform-wide `canonical-transition-active` scope hold has cleared. The reduced extra paths below are cleared for overlap, then claimed through `claim_workroom_scope`, never forced.
- **P4. Pre-Red checks.**
  - `find_related_tests` is resolved for every changed path.
  - Next.js 16.4.6 dispatch is re-verified.
  - The API route's exclusion from the UX sweep under `@exposure authenticated` is confirmed.
- **P5. Safe test environment.**
  - No DPF2 quiet window is open and `/tmp/dpf2-local-ci.lock` is absent. The lock is only read, never modified.
  - Tests use throwaway PostgreSQL containers or the dev DB with synthetic data, never `dpf-postgres-1`.

## Phases

Each phase starts with a Red test that fails for the stated reason.

1. **Retained record (AC-E3).**
   - Build: the Prisma model and enum, the migration, the `@dpf` tag, `setupDigest` canonicalization, and `isGovernedRequester`, which is a single unique-index read.
   - Tests:
     - The setup digest is unique.
     - Immutable fact columns cannot be changed through the enrollment module.
     - User and Principal deletion is restricted.
     - A read error is reported as an error, never as "not governed".
2. **Audit writer (AC-E7).**
   - Build: a typed insert for the two action keys with deterministic `decisionId`s, and the M-4 exclusion in `efficacy-measures-store.ts`.
   - Tests:
     - The approval reader rejects these rows.
     - The projector and the governance API handle them (tests only).
     - M-4 excludes them.
3. **Boundary and fence (AC-E1).**
   - Build:
     - The `PreviewEnrollmentFence` port. Its served adapter denies.
     - Separate readiness checks for enroll and retire. Retirement takes no lease input.
     - The `[command]` Route Handler, marked `@exposure authenticated`, which runs production, origin, session, binding, readiness and the pre-body owner/DB checks, then a bounded body read.
   - Tests:
     - Every pre-body refusal records zero calls to the body reader, the hasher and every mutator.
     - An invalid or oversized body, or a password over 72 bytes, is read but records zero hasher and write calls.
4. **Owner binding (AC-E2).**
   - Build: owner resolution, plus ports for the ruling record, the reservation and the fixture review. Their served adapters hold.
   - Tests: refusals for a non-owner administrator, an automation actor, a handed-over actor, a requester, and refs with no evidence behind them.
5. **Enrollment (AC-E3, AC-E4).**
   - Build: a serializable create. The User and Principal are created inactive with no role, the password is checked against the shared policy and hashed with bcrypt, and `syncUserPrincipal(userId, tx)`, the record and the audit row are all written in that transaction.
   - Tests:
     - An exact replay makes no writes and never calls the hasher.
     - A changed attempt or fixture holds.
     - A forced prefix collision holds.
     - An orphan email holds.
     - A conflict is re-observed.
     - The transaction rolls back atomically.
     - An enrollment whose audit rows were purged still replays correctly.
6. **Never-active invariant (AC-E4).**
   - These are regression tests only; no production change. An enrolled requester is refused by:
     - workforce sign-in;
     - mobile login and refresh;
     - LDAP bind;
     - automation sign-in;
     - OAuth consent (GET and POST);
     - code exchange, refresh and bearer resolution.
   - Each test lives in this item's own test files. Tests run each issuer's existing exported logic against seeded synthetic data; no issuer file is edited.
7. **Retirement (AC-E5).**
   - Build:
     - Extract a transaction-scoped revocation helper from `account-agent-access.ts`. The existing export's behaviour is unchanged and its tests pass.
     - The Read Committed retire transaction: an exact row lock (`FOR UPDATE`), fresh reads, the exactly-one-account check, defensive revocation, terminal fields and the audit row.
     - A terminal readback in a fresh transaction.
   - Tests:
     - Retirement works with no current reservation, no lease, and purged audit rows.
     - Repeat and concurrent retirements are idempotent (throwaway PostgreSQL).
     - A Principal with more than one account holds.
     - Nothing is deleted.
8. **Guards (AC-E6).**
   - Build: the `isGovernedRequester` refusal in `updateUserLifecycle`, `addUserPlatformRole`, `adminResetUserPassword`, `adminIssuePasswordReset`, `completePasswordReset` and `requestPasswordReset`.
   - Tests:
     - Each guarded action refuses.
     - An old reset token is refused.
     - `requestPasswordReset` keeps its neutral response, including on a read error.
9. **Read seam (AC-E7).**
   - Build: `readS5RehearsalEnrollment`.
   - Tests:
     - The projection excludes `passwordHash`, tokens, token hashes and session fields.
     - No mutator is called.
     - `audit-expired` is reported.
     - The provisioner sees an inactive requester and holds.
10. **UI (AC-E8).**
    - Build:
      - The `/admin/rehearsal-requester` page and panel: an enroll form and a retained-requester list with a retire action. They use shared primitives and `var(--dpf-*)` tokens.
      - On `/admin`, one owner-only link that replaces existing words.
      - The purpose contract and its index entry.
      - Regenerated route-manifest, route-shells, route-audience, page-purpose and doc-index, and an updated eligible-route count.
    - Tests:
      - Nothing renders unless the owner and the fence both verify.
      - The hold state has no password field.
      - Production returns `notFound()`.

## Gates and evidence (before handoff)

- Focused unit, component and route tests.
- PostgreSQL concurrency tests, in throwaway containers only.
- The web package typecheck, run only when no DPF2 window is open and the lock is absent.
- Guards:
  - `pnpm run check:prose-lint:test`
  - `pnpm run check:prose-lint`
  - `node scripts/check-style-drift.mjs`
  - endpoint classification, with the baseline unchanged
  - the schema and metadata-tag checks for the new model
- Page budgets:
  - `/admin` stays at most 226 arrival words, with a net delta of at most 0.
  - The `page.tsx` ratchet does not grow.
  - The new route meets the absolute shell budgets.
  - The governance decisions ratchet is unchanged.
- UX-fit evidence: `docs/ux-fit/2026-11-26-rehearsal-requester.ux-fit.json` (sweep measurement).
- Docs impact:
  - Update `docs/user-guide/admin/index.md`.
  - `govern/auth.ts` no longer changes, so the 2026-09 dependency-inventory doc should drop out of impact. Confirm that at Red.
- Derived artifacts: regenerate only those whose inputs change, including architecture-counts for the new model and route.
- Commits: a `Design-Grounding-Decision:` trailer and DCO sign-off on every commit.
- The coordinator's go is required before `pregate:preflight`, `pregate`, any push or `pnpm land`. An independent review on a different model runs before each gate.

## Files

### Already claimed and still used

- `apps/web/lib/identity/s5-rehearsal-enrollment.server{,.test}.ts` and `apps/web/lib/actions/s5-rehearsal-enrollment.ts` (read-side helpers)
- `apps/web/components/admin/S5RehearsalEnrollmentPanel{,.test}.tsx`, `apps/web/app/(shell)/admin/page.tsx` and `apps/web/app/(shell)/admin/rehearsal-requester/page.tsx`
- `apps/web/lib/actions/users.ts` (guards) and `apps/web/lib/auth/account-agent-access{,.test}.ts` (the transaction-scoped revocation extraction)
- `apps/web/lib/gpp/efficacy/efficacy-measures-store.ts`
- `apps/web/lib/security/internal-projector.ts` and `apps/web/app/api/v1/governance/decisions/route.ts` (tests only; the source files are not edited)
- `docs/user-guide/admin/index.md`, the UX-fit JSON, this spec and plan, and the six generated route and doc files

### Claimed but now unused

These will be released, or left untouched, at handoff:

- `apps/web/app/api/admin/rehearsal-requester/route{,.test}.ts`, superseded by `[command]`
- `apps/web/lib/identity/authentication{,.test}.ts`, because spine deactivation is no longer extracted
- `apps/web/lib/govern/auth{,.test}.ts`, which now belongs to BI-9F5D1052

### Extra paths to claim once the hold clears and overlap is confirmed

Previously cleared:
- `apps/web/app/api/admin/rehearsal-requester/[command]/route.ts` and `route.test.ts`
- `apps/web/lib/ux-budget/ux-budget.test.ts`
- `apps/web/lib/identity/password-policy.ts` (new)
- `apps/web/lib/ux-budget/purpose-contracts/rehearsal-requester.ts` (new) and `purpose-contracts/index.ts`
- `apps/web/lib/actions/users.test.ts`
- `apps/web/lib/gpp/efficacy/efficacy-measures.test.ts`
- `apps/web/lib/security/internal-projector.test.ts` (new)
- `apps/web/app/api/v1/governance/decisions/route.test.ts` (new)
- `docs/architecture/architecture-counts.generated.md`, only if its inputs change

New, needing a coordinator decision and an overlap check:
- The schema file that holds the new model. The proposed home is the identity file, `packages/db/prisma/schema/core-identity.prisma`.
- A new migration directory, `packages/db/prisma/migrations/<timestamp>_s5_rehearsal_requester_enrollment/migration.sql`.
- Any retention or metadata registry the schema checks require for the new `@dpf` tag. This is confirmed at P2.

### Dropped from this item (now BI-9F5D1052)

- `apps/web/proxy.ts`, `proxy.test.ts`
- `apps/web/lib/api/auth-middleware{,.test}.ts`
- `apps/web/app/api/oauth/authorize/route{,.test}.ts`
- `apps/web/lib/auth/oauth-tokens.ts`, `oauth-tokens.requester-lock.test.ts`
- `apps/web/app/api/v1/auth/login/route.ts`
- `apps/web/lib/govern/auth-cookie-isolation.test.ts`

### Excluded (owned elsewhere)

- `apps/web/lib/nonprod/preview-runtime-fence.ts` and `apps/web/lib/nonprod/environment-lease-provenance.ts`
- `apps/web/lib/workroom-runtime/s5-rehearsal-*`
- every authentication and issuance file listed in the design's ownership section

## Coverage

Every deliverable above maps to BI-9F7192F9. The delivered code holds until these dependencies land:

| Dependency | Owner |
| --- | --- |
| Installation attestation | BI-8EA98961 |
| DB identity | BI-5C193A3F |
| Lease currency for enrollment | BI-60FC9291 |
| One-shot reservation and fixture-review owners | BI-588688A7 |
| Governed custody-ruling record | Coordinator, via owner-ruling capture |
| Migration approval | Coordinator |

Activation, delegation, sessions and issuance belong to **BI-9F5D1052**, which is blocked on the owner's least-privilege decision.
