---
status: draft
---

# Owner-operated inactive enrollment and retirement of the S5 rehearsal requester

Status: design for independent review, revision 5.
- **Backlog item:** BI-9F7192F9. **Workroom:** WC-4EBA473D.
- **Dependency:** the S5 rehearsal provisioner (BI-1F994B73), applying the policy on BI-588688A7.
- **Scope:** inactive enrollment and retirement only. Activation, sessions, delegation and issuance belong to BI-9F5D1052, which is blocked on the owner's least-privilege decision.
- **This revision** addresses the fourth review of `339d6ca5` (REQUEST_CHANGES). The coordinator has approved the retained model in principle.

This document authorizes no activation, delegation, rehearsal, provider send or production change.

## Decision

Add one preview-only surface, `/admin/rehearsal-requester`, operated by the owner. It has two commands:

1. **Enroll.** Create exactly one synthetic requester for one setup key. Its User and Principal are created **inactive** and stay inactive throughout this item.
2. **Retire.** Make that requester terminally unusable and keep every fact.

The provisioner gets a read-only seam. Both commands fail closed and ship **inert**: they hold until every owning proof below is served. No agent operates the surface or handles the credential. **No authentication or issuance file changes.**

**Custody ruling.** The owner ruled on 2026-11-25: **"I create and hold it."**
- The owner creates the account and keeps the credential.
- No agent holds, mints or sees it.
- Separation of duties is role separation between distinct Principals and accounts, not proof of two different people.

## Never-active invariant

**State.** From the enrollment commit onward:
- the User has `isActive: false`;
- the Principal has `status: "inactive"`.

**How it stays inactive.**
- No command in this item activates either one.
- The generic lifecycle, role and reset actions are guarded.
- The two identity-linking paths that could activate the Principal are guarded (see Guards).

**Issuer refusals.** The existing checks below refuse the requester unchanged. Each gets a regression test using an enrolled requester:

| Issuer | Existing refusal |
| --- | --- |
| Workforce credentials sign-in | `lib/govern/auth.ts:163`: `!user \|\| !user.isActive` |
| Mobile login | `app/api/v1/auth/login/route.ts:56` (`!user.isActive`) and `:61` (no group) |
| Mobile refresh | `app/api/v1/auth/refresh/route.ts:53` |
| LDAP bind | `lib/directory/ldap/bind.ts:63`: `principal.status !== "active"` |
| Automation sign-in | `lib/govern/automation-sign-in.ts:316` |
| OAuth consent (GET/POST), code exchange, refresh, bearer | `currentOAuthHuman` → `isCurrentUserActive` (`lib/govern/current-user-context.ts:8`); `lib/auth/oauth-tokens.ts:119`, `:190` |
| Headless OAuth (`client_credentials`) | `app/api/oauth/token/route.ts:251` rejects an inactive owner. Registering a client also requires an active session. |
| Customer password and social sign-in | These resolve customer identities. The requester has only its local `user` alias, so neither path can reach it. |
| Employee-scoped PAT helper (`lib/auth/employee-scoped-token.ts:132`) | Reachable only through an employee-to-User link. That link is refused by the workforce guard. The helper has no production caller. |

## Grounding

- **Parent design:** `2026-11-25-s5-rehearsal-draft-provisioner-design.md`, sections Enrollment prerequisite, Invoker and fence (3), Requester pin row, and Idempotency and rollback.
- **Parent plan:** `2026-11-25-s5-rehearsal-draft-provisioner-plan.md`, items F1, F2 and V2.
- **Reused substrate,** verified at `c8270766fc9e`:
  - `syncUserPrincipal(userId, tx)` (`lib/identity/principal-linking.ts:264`).
  - bcrypt `hashPassword` (`lib/govern/password.ts:5`).
  - `canonicalJson`.
  - `personRevocation` (`lib/auth/oauth-client-people.ts:52`).
  - The `RecordLifecycle` convention (`resource-scheduling.prisma:25`, stewardship runbook §Record lifecycle).
  - `Organization.topAccountablePrincipalId`, as resolved by `packages/db/src/install-work-owner.ts:75`.
  - The field-level asset registry (`apps/web/lib/govern/data/*-assets.ts`).
  - The same-origin check on the OAuth authorize POST (`app/api/oauth/authorize/route.ts:178`).
  - **Next.js 16.4.6**, from this worktree's root `node_modules`, pinned in the lockfile. Its Route Handler receives the undecoded `Request`.
- **Standards:**
  - RFC 2606 §2.
  - NIST SP 800-63B §5.1.1.2.
  - The OWASP CSRF guidance.
  - PostgreSQL 16 explicit locking and application-level consistency.
- **Rejected:**
  - **Generic `createUserAccount`:** unsalted SHA-256 hashing, and a best-effort Principal sync.
  - **`withGovernedUserAction`:** it writes an extra audit row.
  - **The audit log, a `PrincipalAlias` digest or `ExternalEvidenceRecord` as the retained fact record:**
    - The log is purged after 365 days.
    - An alias is an identity key.
    - `ExternalEvidenceRecord` holds untyped details and cascades with its actor.
  - **A `retiredAt` column:** forbidden by the lifecycle convention.
  - **Bare `*Id` evidence columns.**
  - **A hashed advisory lock.**
  - **Server Actions as the mutation boundary.**
  - **Allow fixtures on the served path.**
  - **Any authentication or issuance edit:** that work belongs to BI-9F5D1052.
  - **Falling back to the oldest superuser as owner.**

## Retained record (migration approved in principle)

No existing typed, retained substrate fits. The coordinator approved a new model in principle on 2026-11-26. **No schema path is claimed until the coordinator relays that the self-upgrade drain has cleared.**

```prisma
/// Owner-enrolled synthetic requester for one S5 rehearsal setup (BI-9F7192F9). Facts are immutable;
/// the only transition is active -> retired, written once. Retained per installation and database.
/// @dpf lifecycle=business-record retention=domain sensitivity=restricted categories=security-audit,identity owner=platform-owner steward=data-steward
model S5RehearsalRequesterEnrollment {
  id                    String          @id @default(cuid())
  setupDigest           String          @unique // full sha256(canonicalJson({schema:"s5-rehearsal-setup.v1", rulingRef, reservationRef}))
  // Retained evidence references: deliberately NOT foreign keys (owned by other systems or installations).
  rulingRef             String
  reservationRef        String
  attemptRef            String
  fixtureRef            String
  installationRef       String
  leaseRef              String
  dbIdentityRef         String
  // Local subjects and actors: real foreign keys.
  userId                String          @unique
  principalId           String          @unique
  enrolledByPrincipalId String
  enrolledAt            DateTime        @default(now())
  // Record lifecycle convention. Terminal fields are all-or-none.
  lifecycle             RecordLifecycle @default(active)
  lifecycleAt           DateTime?
  retirementReason      S5RehearsalRequesterRetirementReason?
  retiredByPrincipalId  String?
  user                  User      @relation(fields: [userId], references: [id], onDelete: Restrict)
  principal             Principal @relation("S5RehearsalRequesterSubject", fields: [principalId], references: [id], onDelete: Restrict)
  enrolledByPrincipal   Principal @relation("S5RehearsalRequesterEnrolledBy", fields: [enrolledByPrincipalId], references: [id], onDelete: Restrict)
  retiredByPrincipal    Principal? @relation("S5RehearsalRequesterRetiredBy", fields: [retiredByPrincipalId], references: [id], onDelete: Restrict)
  @@index([enrolledByPrincipalId])
  @@index([retiredByPrincipalId])
  @@index([lifecycle])
}

enum S5RehearsalRequesterRetirementReason { rehearsal_complete quarantine_after_failure setup_superseded operator_cleanup }
```

### Model details

- **Back-relations.** The model adds back-relations on `User` (one) and on `Principal` (three named relations).
- **Foreign-key indexes.** The two unique subject keys already provide their FK indexes. The two actor FKs get explicit indexes, which satisfies the FK-index ratchet.
- **Database constraints.** The migration adds two raw-SQL constraints:
  - **A CHECK, "all-or-none":** either `lifecycle = 'active'` and all three of `lifecycleAt`, `retirementReason` and `retiredByPrincipalId` are null, or `lifecycle = 'retired'` and all three are non-null. No other lifecycle value is allowed.
  - **A BEFORE UPDATE trigger:** it rejects any change to a fact column, and any transition other than `active → retired`.
- **Application write rule.** The application writes the transition once, at the command boundary, with `WHERE lifecycle = 'active'`.
- **Single marker.** This record is the only durable marker of a governed requester. `isGovernedRequester(userId)` is a single read on the unique index. Identity stays on the existing local `user` alias, which satisfies Principal convergence.

### Stewardship deliverables (data-model stewardship runbook)

- the `@dpf` tag, written before the migration;
- field-level asset registration in a new `apps/web/lib/govern/data/s5-rehearsal-requester-assets.ts`, wired into `assets.ts`;
- a data-impact manifest, `docs/data-impact/2026-11-26-s5-rehearsal-requester-enrollment.data-impact.json`. It records a new empty table, no existing rows touched, and additive back-relations only;
- migration-safety evidence: additive only, no backfill, no lock on existing tables beyond the FK references, and a reversible down note;
- the model-count change. `scripts/platform-substrate-baseline.json` `prismaModelCount` (649) is **non-increasing**, so adding one model needs an approved baseline change from its owner (portfolio-management). This is flagged to the coordinator.

### Restrict, teardown and portability contract

- **Delete behaviour.** `onDelete: Restrict` refuses deletion of a linked User or Principal, and of the enrolling or retiring Principal. Unrelated Users and Principals delete normally. The migrated-schema tests cover both cases.
- **Test teardown.** Fixtures close their disposable database or drop their schema. They never delete an enrolled User or Principal first.
- **Portability.** Enrollment and retirement evidence is retained **only on the original installation and database**. It is not portable across a clone or reset: the sanitized clone uses `TRUNCATE … CASCADE` (`packages/db/src/sanitized-clone.ts:149`), which does not preserve it. A clone or reset starts with no governed requester.
- **Parent spec.** The parent provisioner design's statement "no migration" (`2026-11-25-s5-rehearsal-draft-provisioner-design.md:17`) is reconciled in this change by a doc edit that points to this record.

## Audit evidence

Each successful command writes one typed, transaction-bound `AuthorizationDecisionLog` row:

| Command | `actionKey` | `decisionId` |
| --- | --- | --- |
| Enroll | `s5.rehearsal-requester.enroll` | `s5rr:enroll:<setupDigest>` |
| Retire | `s5.rehearsal-requester.retire` | `s5rr:retire:<setupDigest>` |

The rows are audit evidence only. No lifecycle decision reads them.

- The **approval reader** rejects them.
- The **projector** and the **governance API** are unchanged, with tests only.
- **M-4** excludes `s5.rehearsal-requester.*`.

## Owner binding (held; the served adapter denies)

A chat statement or membership of `manage_platform` does not identify the custody owner. The design requires all of the following.

1. **Candidate.** Pick exactly one active local human Principal:
   - **First choice:** the install's recorded accountable Principal, `Organization.topAccountablePrincipalId` (as resolved in `install-work-owner.ts:75`).
   - **Otherwise,** if no mapping is recorded: the **sole** active human holding live `manage_platform`.
   - **Hold** on zero, multiple or mismatched candidates. **Never** fall back to the oldest superuser.
2. **Owner-confirmed governed receipt.** The owner confirms the exact custody text and its revision in a fresh governed review or proposal. That record captures the authenticated resolver and binds it to the candidate's local Principal and to this installation. The abstained decision `DI-7895859F4446` is not reused.
3. **Live checks on the acting session.** The session resolves through the local `user` alias to that same Principal, and:
   - it holds live `manage_users` and `manage_platform`, read from the database;
   - it has no automation fields;
   - it has no `workHandedOverAt`;
   - it is not itself a governed requester.

Until the receipt exists and an adapter serves it, the owner port denies. The coordinator is pursuing the governed capture with the owner separately.

For enrollment, the reservation, attempt and fixture are also verified read-only against the one-shot owner (BI-588688A7) and the fixture-review receipt. If that evidence is missing, enrollment holds.

## Fence: fail closed, inert until served

| Proof | Owner | Enroll | Retire |
| --- | --- | --- | --- |
| Positive non-production attestation of this installation | BI-8EA98961 | required, joined to the exact current lease | required as a **lease-independent** attestation of the installation identity, equal to the record's `installationRef` |
| Actual DB server/cluster and database identity on the write transaction's connection | BI-5C193A3F | required, same transaction | required, same transaction, equal to the record's `dbIdentityRef`; lease-independent |
| Lease currency at commit | BI-60FC9291 | required | not used |
| Production class | resolver | refuse | refuse |

**Lease-independent attestation.** Retirement must work after the lease has ended. It therefore needs the installation and DB proofs that BI-8EA98961 and BI-5C193A3F serve **for the running installation and its connection**, without a lease join. This is a stated requirement on those owners. Until they serve such a proof, retirement holds.

The process override outranks installer state (`lib/install/environment-class-contract.ts:112`), so no class value, host, Origin or lease row passes the fence alone. The served adapter denies.

### Request boundary

The endpoint is `POST /api/admin/rehearsal-requester/[command]`, with `[command]` ∈ {`enroll`, `retire`}. It is declared `@exposure authenticated`, and the endpoint baseline is unchanged.

**Before any body read:**
1. Refuse in production.
2. Verify same-origin.
3. Require a session.
4. Bind the command from the path.
5. **Pin the setup from server-owned context:**
   - **Enroll:** from the one-shot owner's current-reservation seam.
   - **Retire:** the `setupDigest` from the path query, which must match a retained record. This does not depend on the current reservation or fixture review.
6. Check that command's readiness.
7. Run a pre-body read-only transaction that verifies the owner and the exact DB (for retirement, against the record's installation and DB refs).
8. **For enroll only:** if a record already exists for the pinned digest and matches the current reservation's attempt and fixture exactly, return the prior outcome **without reading the body**. This is the pre-parse replay.

**Body read.** Only then is the body read, bounded to:
- at most 4 KiB;
- `application/x-www-form-urlencoded`;
- a strict schema;
- for enroll, a password of at most 72 UTF-8 bytes;
- for retire, a closed-enum `retirementReason`.

**Write transaction.** It re-checks actor authority and DB identity.

**Tests:**
- **Pre-body refusals and pre-parse replay:** zero calls to the body reader, the hasher or any mutator.
- **Invalid bodies:** the body is read, but there are zero calls to the hasher and zero writes.

## Enrollment

Enrollment runs in one serializable transaction, after a pre-parse replay check has found nothing:

1. Run the fence and owner checks.
2. Look up the record by `setupDigest`. Handle what you find:
   - **Exact match** (found concurrently): return the prior outcome.
   - **Retired record:** return `retired`.
   - **Drifted attempt or fixture, or any other mismatch:** hold.
3. If the email already exists without a record, hold.
4. Apply the shared password policy and the 72-byte check, then hash with bcrypt.
5. Create the User inactive: nonsuperuser, no automation fields, no role.
6. Run `syncUserPrincipal(userId, tx)`, then set the Principal to `inactive`.
7. Write the record and the audit row, then commit.

A unique-key conflict or a serialization abort is re-observed in a fresh fenced transaction.

**Password promise.** Once the bounded body is parsed:
- the password is used only for the policy check and the single bcrypt hash of a new User;
- on replay, retired, hold or any error, it is **never compared, hashed, stored, logged or echoed**;
- it never appears in a response, a receipt or telemetry.

**Email.** The address is `rehearsal-<first 16 hex>@s5-rehearsal.invalid`. It is a label only.

## Retirement

Retirement runs in one **Read Committed** transaction:

1. **Lock.** `SELECT … FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1 FOR UPDATE`. Every later read in the transaction is a fresh read after the lock.
2. **Already retired.** If `lifecycle = 'retired'`, skip to the fresh readback (step 8) and return `retired` without writing.
3. **Re-check under the lock:**
   - actor authority;
   - DB identity, equal to `dbIdentityRef`;
   - the Principal holds **exactly one** alias: the local `user` alias for this User, and no alias of any other type. Otherwise hold.
4. **Revoke bindings directly.** Revoke every `AuthorityBinding` whose `oauthUserId` is this requester and that is not already revoked. This is a separate statement, not part of the shared helper.
5. **Revoke tokens and owned clients.** Revoke access tokens, refresh tokens and owned credentials clients through a transaction-scoped helper extracted from `endAccountAgentAccess`. The helper reuses `personRevocation`, and the existing export's behaviour stays **unchanged**. Under the never-active invariant, the expected counts in steps 4 and 5 are zero. The audit row records any non-zero count.
6. **Deactivate this account only.** Assert, or re-set, `isActive: false` on this exact User and `status: "inactive"` on this exact Principal.
7. **Write the terminal state.** Write the terminal tuple `lifecycle = 'retired'`, `lifecycleAt`, `retirementReason` and `retiredByPrincipalId` with `WHERE lifecycle = 'active'`, then write the audit row and commit.
8. **Fresh readback,** in a new transaction. It must find:
   - zero live bindings;
   - zero live access or refresh tokens;
   - zero live owned credentials clients;
   - the User and the Principal both inactive;
   - the full terminal tuple present.

   If the readback fails after commit, the response is **`committed_unverified`**. A retry re-observes the state and never rewrites it.

Retirement works with no current reservation, with no lease, after audit rows have been purged, and after the current attempt or fixture has drifted. It deletes nothing.

## Guards (keep the inactive identity inert)

`isGovernedRequester` fails closed on a read error. Each guarded path returns `governed_rehearsal_requester`:

- **User actions** (`lib/actions/users.ts`):
  - `updateUserLifecycle`
  - `addUserPlatformRole`
  - `adminResetUserPassword`
  - `adminIssuePasswordReset`
  - `completePasswordReset`, which also refuses old tokens
  - `requestPasswordReset`, which keeps its neutral response, issues nothing, and stays neutral on a read error
- **Workforce linking** (`lib/actions/workforce.ts`): employee profile create and relink refuse to link a governed requester's User (`ensureUserLinkIsAvailable`, `:168`, and the create path at `:208`).
- **Employee-to-Principal sync** (`lib/identity/principal-linking.ts`, `syncEmployeePrincipal` at `:239`): if the resolved Principal belongs to a governed requester, the sync refuses. It cannot set the status to active or add an `employee` alias. `syncUserPrincipal`, the enrollment path, is unaffected.

The guards are tested **before and after retirement**. None of these files is an issuer.

## Read-only verification seam

`readS5RehearsalEnrollment({ rulingRef, reservationRef }, tx)` is server-only and returns explicit projections:

- the record;
- the audit rows, or `audit-expired` once they have been purged;
- User facts;
- the Principal's status and all of its aliases;
- bindings, plus counts of unrevoked tokens and owned clients.

It never returns `passwordHash`, a token, a token hash or session material, and it calls no mutator. In this item, the provisioner sees an inactive requester and **holds**.

## UI

The UI follows the theme-aware styling runbook.

- **`/admin`.** One owner-only link replaces existing words. The page stays at ≤226 arrival words, with net Δ ≤ 0 and no `page.tsx` ratchet growth.
- **`/admin/rehearsal-requester`:**
  - It is independently fenced.
  - It uses the shared form and status primitives and `var(--dpf-*)` tokens.
  - It shows an enroll form and a list of retained requesters with a retire control.
  - Hold states show reason codes and no password field.
  - Production returns `notFound()`.
  - It needs a ratified purpose contract with its index entry, regenerated route companions, an updated eligible-route count, and the absolute shell budgets.
- **API route.** It is `@exposure authenticated` and outside the UX sweep; check this at Red.

## Ownership boundaries

These paths are excluded and owned elsewhere:
- **The lease writer:** `lib/nonprod/preview-runtime-fence.ts` and `lib/nonprod/environment-lease-provenance.ts`.
- **The S5 producer and owner-read writer:** `lib/workroom-runtime/s5-rehearsal-*`.
- **BI-9F5D1052:** every authentication and issuance file: `proxy.ts`, `lib/api/auth-middleware.ts`, `lib/govern/auth.ts`, `app/api/oauth/*`, `lib/auth/oauth-tokens.ts`, `lib/auth/employee-scoped-token.ts`, `app/api/v1/auth/*`, `lib/directory/ldap/*` and `app/api/automation/*`.

## Acceptance

### AC-E1 Fence and boundary
- Pre-body refusals and pre-parse replay leave the body reader, hasher and mutators at zero calls.
- Invalid bodies leave the hasher and writes at zero calls.
- Retirement depends on no lease, and uses lease-independent installation and DB proofs.
- The served adapter holds.

### AC-E2 Owner binding
- The accountable-Principal candidate is used first, then the sole eligible `manage_platform` human.
- Zero, multiple or mismatched candidates hold, and there is no oldest-superuser fallback.
- The owner-confirmed receipt is required.
- Non-owner, automation, handed-over and requester actors refuse.

### AC-E3 Retained record and replay
**Schema conformance:**
- unique digest, immutable facts enforced by the trigger, and the all-or-none CHECK;
- lifecycle convention, `*Ref` naming and indexed FKs;
- Restrict refuses linked deletes, and unrelated deletes succeed.

**Replay and holds:**
- Exact replay writes nothing and touches no password.
- Drift, prefix collision, orphan email or mismatch holds.
- Purged audit rows change nothing.

### AC-E4 Never active
- The User and Principal stay inactive.
- Every issuer listed in the invariant table refuses, including the headless, customer and social negatives.
- Workforce linking and the employee sync refuse, both before and after retirement.

### AC-E5 Retirement
- An exact row lock is taken, followed by fresh reads.
- The exact single alias is checked.
- Defensive revocation works when bindings, tokens and clients are present.
- The terminal tuple is written once.
- Fresh readback checks every live artifact.
- A failed readback after commit returns `committed_unverified`, and the next attempt re-observes.
- Retirement succeeds with no reservation or lease, with purged audit rows, and after drift.

### AC-E6 Guards
- The lifecycle, role, reset (including old tokens), workforce and employee-sync paths all refuse.
- The reset request response stays neutral.

### AC-E7 Seam and audit
- No bearer material and no mutator.
- Projector and API tests.
- M-4 exclusion.

### AC-E8 UI
- Budgets, the purpose contract, truthful hold states, tokens, and UX-fit.
