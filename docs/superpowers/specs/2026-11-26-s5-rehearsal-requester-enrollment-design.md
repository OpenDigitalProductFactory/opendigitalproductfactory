---
status: draft
---

# Owner-operated inactive enrollment and retirement of the S5 rehearsal requester

**Status:** design for independent review, revision 6.

- **Backlog item:** BI-9F7192F9.
- **Workroom:** WC-4EBA473D.
- **Depends on:** the S5 rehearsal provisioner (BI-1F994B73), applying the policy on BI-588688A7.
- **Scope:** server-side inactive enrollment and retirement only.
- **Out of scope:** activation, sessions, delegation and issuance belong to BI-9F5D1052, which is blocked on the owner's least-privilege decision.
- **This revision:** addresses the fifth review of `0f9095ed` (REQUEST_CHANGES) and adopts that review's cuts. The operator UI (password form, page and `/admin` link) moves to activation readiness.

This document authorizes no activation, delegation, rehearsal, provider send or production change.

## Decision

This item delivers four server-side pieces. All of them fail closed and ship **inert**: they hold until every owning proof below is served.

- **Route.** One owner-only, preview-only endpoint: `POST /api/admin/rehearsal-requester/[command]`, with two commands:
  - **Enroll.** Create exactly one synthetic requester for one setup key. Its User and Principal are created **inactive** and stay inactive throughout this item.
  - **Retire.** Make that requester terminally unusable and keep every fact.
- **Retained record.** The enrollment record described below.
- **Guards.** The guards that keep the identity inert.
- **Read seam.** A read-only verification seam for the provisioner.

Exclusions:

- **No UI.** This item has no page and no form. A UI only becomes useful once the proofs are served and activation is decided, so the form, its page and its discovery link belong with activation readiness (see Deferred).
- **No auth or issuance changes.** No authentication or issuance file changes.
- **No agent involvement.** No agent operates the endpoint or handles the credential.

The owner ruled on 2026-11-25: **"I create and hold it."**

- The owner creates the account and keeps the credential.
- No agent holds, mints or sees it.
- Separation of duties is role separation between distinct Principals and accounts, not proof that two different people acted.

## Never-active invariant

The User has `isActive: false` and the Principal has `status: "inactive"` from the enrollment commit onward. Several things keep it that way:

- No command in this item activates either one.
- The generic lifecycle, role and reset actions are guarded.
- Workforce linking and the employee-to-Principal sync are guarded.
- The enrollment marker cannot be deleted.
- A clone cannot copy the identity without its marker.

The existing checks below refuse the requester unchanged. Each gets a regression test:

| Issuer | Existing refusal |
| --- | --- |
| Workforce credentials sign-in | `lib/govern/auth.ts:163` |
| Mobile login | `app/api/v1/auth/login/route.ts:56`, `:61` |
| Mobile refresh | `app/api/v1/auth/refresh/route.ts:53` |
| LDAP bind | `lib/directory/ldap/bind.ts:63` (`principal.status !== "active"`) |
| Automation sign-in | `lib/govern/automation-sign-in.ts:316` |
| OAuth consent (GET and POST), code exchange, refresh, bearer | `currentOAuthHuman` → `isCurrentUserActive`; `lib/auth/oauth-tokens.ts:119`, `:190` |
| Headless `client_credentials` | `app/api/oauth/token/route.ts:251` |
| Customer password and social | These resolve customer identities only, so the requester has nothing to match |
| Employee-scoped PAT helper (`lib/auth/employee-scoped-token.ts:132`) | Unreachable: the workforce link guard refuses the employee-to-User link it needs. The helper also has no production caller |

## Grounding

- **Parent:** `2026-11-25-s5-rehearsal-draft-provisioner-design.md` and its plan (F1, F2, V2).
- **Reused substrate,** verified at `c8270766fc9e`:
  - `syncUserPrincipal(userId, tx)`
  - bcrypt `hashPassword` (`lib/govern/password.ts:5`)
  - `canonicalJson`
  - `personRevocation`
  - the `RecordLifecycle` convention
  - **`findInstallOrganization`** (`packages/db/src/install-organization.ts:38`), the canonical singleton organization reader, which throws on ambiguity
  - the field-level asset registry (`apps/web/lib/govern/data/*-assets.ts`)
  - the care-evidence immutability migration, as precedent for `BEFORE UPDATE` and `BEFORE DELETE` triggers (`20260717035500_enforce_care_intake_evidence_immutability`)
  - the same-origin check on the OAuth authorize POST
  - Next.js 16.4.6: the Route Handler receives the undecoded `Request`
- **Standards:**
  - RFC 2606 §2
  - NIST SP 800-63B §5.1.1.2
  - OWASP CSRF guidance
  - PostgreSQL 16 explicit locking
- **Rejected:**
  - generic `createUserAccount`
  - `withGovernedUserAction`
  - the audit log, an alias, or `ExternalEvidenceRecord` as the retained record
  - `retiredAt`, and bare `*Id` evidence columns
  - Server Actions
  - allow fixtures on the served path
  - any authentication or issuance edit
  - `install-work-owner`'s resolver for the owner: it can pick a portfolio owner first and ends in a superuser fallback
  - an oldest-superuser fallback
  - a standalone lifecycle index: every specified lookup uses a unique key
  - shipping the operator UI in this item

## Retained record (migration approved in principle)

```prisma
/// Owner-enrolled synthetic requester for one S5 rehearsal setup (BI-9F7192F9). Facts are immutable; the only
/// transition is active -> retired, written once; rows cannot be deleted. Retained per installation and database.
/// @dpf lifecycle=business-record retention=domain sensitivity=restricted categories=security-audit,identity owner=platform-owner steward=data-steward
model S5RehearsalRequesterEnrollment {
  id                    String          @id @default(cuid())
  setupDigest           String          @unique // full sha256(canonicalJson({schema:"s5-rehearsal-setup.v1", rulingRef, reservationRef}))
  rulingRef             String          // retained evidence references, deliberately not FKs
  reservationRef        String
  attemptRef            String
  fixtureRef            String
  installationRef       String
  leaseRef              String
  dbIdentityRef         String
  userId                String          @unique
  principalId           String          @unique
  enrolledByPrincipalId String
  enrolledAt            DateTime        @default(now())
  lifecycle             RecordLifecycle @default(active)
  lifecycleAt           DateTime?
  retirementReason      S5RehearsalRequesterRetirementReason?
  retiredByPrincipalId  String?
  user                  User       @relation(fields: [userId], references: [id], onDelete: Restrict)
  principal             Principal  @relation("S5RehearsalRequesterSubject", fields: [principalId], references: [id], onDelete: Restrict)
  enrolledByPrincipal   Principal  @relation("S5RehearsalRequesterEnrolledBy", fields: [enrolledByPrincipalId], references: [id], onDelete: Restrict)
  retiredByPrincipal    Principal? @relation("S5RehearsalRequesterRetiredBy", fields: [retiredByPrincipalId], references: [id], onDelete: Restrict)
  @@index([enrolledByPrincipalId])
  @@index([retiredByPrincipalId])
}

enum S5RehearsalRequesterRetirementReason { rehearsal_complete quarantine_after_failure setup_superseded operator_cleanup }
```

### Schema details

- **Back-relations:** one on `User`, three on `Principal`.
- **FK indexes:** the unique subject keys cover their own FK indexes. The two actor FKs get explicit indexes.
- **No other index:** there is no standalone `lifecycle` index.

### Migration guards (raw SQL, following the care-evidence precedent)

1. **CHECK (all-or-none):** either `lifecycle='active'` and all three terminal fields are null, or `lifecycle='retired'` and all three are non-null. No other value is allowed.
2. **`BEFORE UPDATE` trigger:** rejects any change to a fact column, and any transition other than `active → retired`.
3. **`BEFORE DELETE` trigger:** raises `S5RehearsalRequesterEnrollment is retained and cannot be deleted`. This keeps the sole guard marker in place for as long as its identity survives.

### Single durable marker

The record is the single durable marker of a governed requester. `isGovernedRequester(userId)` is one unique-index read, and it fails closed on error.

### Stewardship deliverables

- the `@dpf` tag
- asset registration (`apps/web/lib/govern/data/s5-rehearsal-requester-assets.ts`, wired in `assets.ts`)
- a data-impact manifest (`docs/data-impact/2026-11-26-s5-rehearsal-requester-enrollment.data-impact.json`)
- migration-safety notes: additive, no backfill, reversible down note
- the `prismaModelCount` raise (see the plan, P2)

### Restrict, delete, clone and portability contract

- **Deletes:**
  - A linked User, Principal, enroller or retirer cannot be deleted. Unrelated rows delete normally.
  - The enrollment row itself cannot be deleted.
  - Test fixtures tear down by dropping their schema or database.
- **Clone:** `packages/db/src/sanitized-clone.ts` skips `restricted` tables (`:92`) and reloads every other eligible table (`:331`). It would therefore copy the requester's `User` without its marker. The clone **refuses a source that contains any `S5RehearsalRequesterEnrollment` row**, failing closed before any table copy. The synthetic identity is never cloned piecemeal. Excluding it as a unit was rejected: the identity spans User, Principal, alias and audit rows, so refusing is simpler and safer.
- **Portability:** evidence is retained only on the original installation and database. It is not portable across a clone or reset. A reset or a fresh database has no governed requester.
- **Parent spec reconciliation:** this change edits the parent provisioner design (`2026-11-25-s5-rehearsal-draft-provisioner-design.md`) in two places:
  - its "no migration" statement (`:17`) points to this record;
  - its enrollment and delegation ownership paragraph (`:15`–`:21`) records the split. BI-9F7192F9 owns inactive enrollment and retirement. BI-9F5D1052 owns activation, delegation confirmation, sessions and issuance.

## Audit evidence

Each successful command writes one typed, transaction-bound `AuthorizationDecisionLog` row:

| Command | `actionKey` | `decisionId` |
| --- | --- | --- |
| enroll | `s5.rehearsal-requester.enroll` | `s5rr:enroll:<setupDigest>` |
| retire | `s5.rehearsal-requester.retire` | `s5rr:retire:<setupDigest>` |

- These rows are audit only. Lifecycle never reads them.
- The S5 approval reader rejects them.
- The security projector and the governance API are covered by tests only.
- M-4 excludes them.

## Owner binding (held; the served adapter denies; gated on BI-C7100183)

1. **Candidate.**
   - Read the singleton organization with `findInstallOrganization` and take its `topAccountablePrincipalId`.
   - That Principal must resolve to an active local human through the local `user` alias.
   - If there is no organization, `findInstallOrganization` reports ambiguity, or the mapping is set but invalid (missing, inactive, not human, no local user), hold.
   - Only when the mapping is **unset** on a single valid organization does the candidate become the **sole** active human with live `manage_platform`. Zero or several such humans means hold.
   - There is never an oldest-superuser fallback.
2. **Owner-confirmed governed receipt.**
   - The owner confirms the exact custody text and its revision in a fresh governed review.
   - That review binds the authenticated resolver to the candidate's local Principal and to this installation.
   - The abstained decision `DI-7895859F4446` is not reused.
   - **BI-C7100183** gates the served adapter for this receipt. Until it lands, the owner port denies.
3. **Live checks on the acting session:**
   - the same Principal as the candidate;
   - live `manage_users` and `manage_platform`, read from the database;
   - no automation fields;
   - no `workHandedOverAt`;
   - not a governed requester.

**Tests** (each case holds or refuses):
- missing receipt
- receipt naming the wrong Principal
- receipt for the wrong install
- ambiguous organization
- invalid mapping
- several sole-human candidates
- non-owner administrator
- automation actor
- handed-over actor
- requester actor

## Fence (fail closed; inert until served)

| Proof | Owner | Enroll | Retire |
| --- | --- | --- | --- |
| Positive non-production installation attestation | BI-8EA98961 | required, joined to the exact current lease | required, **lease-independent**, equal to the record's `installationRef` |
| Actual DB server/cluster and database identity on the write connection | BI-5C193A3F | required, same transaction | required, same transaction, **lease-independent**, equal to `dbIdentityRef` |
| Lease currency at commit | BI-60FC9291 | required | not used |
| Production class | resolver | refuse | refuse |

- No class value, host, Origin or lease row passes on its own. The process override outranks installer state (`environment-class-contract.ts:112`).
- The served adapter denies.

## Request boundary

`POST /api/admin/rehearsal-requester/[command]`, with `[command]` being `enroll` or `retire`. It is marked `@exposure authenticated`, and the endpoint baseline is unchanged.

**Server-issued setup context.** Every request carries an opaque `setupContext` in the query string. The server issues it from the owner's read-only seam:
- **Enroll:** the one-shot owner's reservation `{rulingRef, reservationRef, reservationRevision, attemptRef, fixtureRef}`, plus its `setupDigest`.
- **Retire:** the retained record's `setupDigest`.

The context only names the setup the owner reviewed. It carries no authority. Authority comes from the owner checks and from comparing the context with live evidence, so it needs no signature and no new key material. It is never taken from the body.

**Before any body read**, in this order:

1. Refuse in production.
2. Check same origin.
3. Require a session.
4. Bind the command from the path.
5. Parse the `setupContext` from the query under a strict schema. A malformed context holds.
6. **Compare the context with current owner evidence.**
   - **Enroll:** the one-shot owner's current reservation must equal the context exactly (revision, attempt, fixture). If it has been released or replaced, **hold with no body read and no write**. The retained-record seam still shows any earlier result.
   - **Retire:** a retained record must exist for the digest. Retirement does not depend on the reservation.
7. Check the command's readiness.
8. Run the pre-body owner and exact-DB read-only transaction.
9. **Enroll pre-parse replay.** If a record already exists for the digest:
   - If `lifecycle='retired'`, return `retired`.
   - If it is active, return the prior outcome only when its facts equal the context and the **live identity verifies**:
     - the User is inactive;
     - the Principal is inactive;
     - the Principal's only alias is the exact local `user` alias for that User.
   - Any other state holds.
   - In every case, no body is read.

**Only then** is the body read:
- at most 4 KiB, `application/x-www-form-urlencoded`, strict schema;
- enroll: a password of at most 72 UTF-8 bytes;
- retire: a closed-enum `retirementReason`.

**Tests:**
- release, replacement, identity drift, replay of a retired setup, a malformed or stale context, and every other pre-body refusal: zero calls to the body reader, the hasher and every mutator;
- invalid bodies: the body is read, then zero hasher calls and zero writes.

## Enrollment and the no-hash guarantee

Enrollment runs in one serializable transaction:

1. **Claim the exact create attempt before hashing.**
   - Take `pg_advisory_xact_lock(hashtextextended('s5rr-enroll:' || setupDigest, 0))`.
   - If the one-shot owner later serves an exclusive per-setup reservation boundary, use that instead.
   - A 64-bit key collision only serializes two different enrollments, which are rare and owner-operated. It never merges them.
2. Under the lock, re-run the fence, the owner checks and the context comparison against fresh reads.
3. Re-read the record by digest:
   - **Found** (a concurrent winner committed): treat it as the pre-parse replay or hold case. **No hash.**
   - **Absent:** this transaction owns the create.
4. If the email exists without a record, hold. **No hash.**
5. Apply the password policy and the 72-byte check, then run the **single** bcrypt hash.
6. Create the User inactive: nonsuperuser, no automation fields, no role.
7. Run `syncUserPrincipal(userId, tx)` and set the Principal inactive.
8. Write the record and the audit row, then commit.

**Outcomes:**

- `created`, `replay`, `retired` and `hold`.
  - `replay`, `retired` and `hold` never reach the hash step.
- **`create_failed`:** anything that fails *after* the hash, such as a constraint, a trigger, a serialization abort or a commit error.
  - It rolls everything back.
  - It is returned as a generic code with no detail.
  - The error is logged by code only, never with the password, the hash or the request body.
  - A retry starts again from step 1.

**Password promise.** After bounded parsing, the password is used only in step 5 of a transaction that owns the create. It is never compared, stored except as the new bcrypt hash, logged, echoed, or placed in a response, receipt or telemetry.

**Tests:**
- two overlapping requests against an empty setup: exactly one hash and one create, and the other request gets `replay` with zero hasher calls;
- a forced failure after the hash: rollback, `create_failed`, and no secret in logs or the response;
- spies on the hasher, the logger and the response body.

The email is `rehearsal-<first 16 hex>@s5-rehearsal.invalid`. It is a label only.

## Retirement

Retirement runs in one **Read Committed** transaction:

1. Lock the record: `SELECT … FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1 FOR UPDATE`. Every read after this is fresh.
2. **Under the lock, before any branch:**
   - re-check actor authority;
   - check that DB identity equals `dbIdentityRef`;
   - check that the installation attestation equals `installationRef`;
   - check that the Principal's only alias is the exact local `user` alias for this User.

   If any check fails, hold. This applies to first attempts and repeats alike.
3. **Already retired:** go to step 8 without writing.
4. Revoke any `AuthorityBinding` whose `oauthUserId` is the requester. This is a separate statement.
5. Revoke tokens and owned credentials clients through the transaction-scoped helper extracted from `endAccountAgentAccess`. That export's behaviour is unchanged.
6. Assert or re-set inactive on this exact User and this exact Principal.
7. Write the terminal tuple once, with `WHERE lifecycle='active'`, plus the audit row. Commit.
8. **Fresh readback** in a new transaction verifies:
   - `setupDigest`, `userId` and `principalId` equal the targeted refs;
   - the exact single local `user` alias;
   - zero live bindings, tokens and owned clients;
   - the User and Principal are inactive;
   - the full terminal tuple is present.

   Return `retired` **only** if all of that passes. Otherwise:
   - after a commit in this request, return `committed_unverified`;
   - on a repeat, hold, naming the failed check.

   A retry re-observes the record and never rewrites it.

**Tests:**
- populated defensive revocation;
- concurrent and repeated retirement;
- no reservation, no lease, purged audit rows, attempt or fixture drift;
- on a `committed_unverified` retry:
  - the actor lost authority, so the request refuses;
  - the alias drifted, so the request holds and does not return `retired`.

## Guards (keep the inactive identity inert)

`isGovernedRequester` fails closed. Every guard returns `governed_rehearsal_requester`.

- **User administration and reset (`lib/actions/users.ts`):**
  - `updateUserLifecycle`
  - `addUserPlatformRole`
  - `adminResetUserPassword`
  - `adminIssuePasswordReset`
  - `completePasswordReset`, which also refuses old tokens
  - `requestPasswordReset`, which keeps its neutral response and issues nothing
- **Workforce (`lib/actions/workforce.ts`):** profile create and relink.
- **Principal linking (`lib/identity/principal-linking.ts`):** `syncEmployeePrincipal`.
- **Clone (`packages/db/src/sanitized-clone.ts`):** refuses a source that contains a requester.

Every guard is tested before and after retirement. None of these is an issuer.

## Read-only verification seam

`readS5RehearsalEnrollment({ rulingRef, reservationRef }, tx)` is server-only and returns explicit projections:

- the record;
- the audit rows, or `audit-expired`;
- User facts;
- the Principal's status and all its aliases;
- bindings, plus counts of unrevoked tokens and owned clients.

It never returns a password hash, a token or session material, and it calls no mutator. In this item the provisioner sees an inactive requester and **holds**.

## Deferred to activation readiness

These are deferred to BI-9F5D1052, or to a readiness item it names:

- the operator UI: the `/admin/rehearsal-requester` page, the password form, the retained-requester list and retire control, and the `/admin` discovery link;
- that UI's purpose contract, its `ux-budget` registration and UX-fit evidence;
- the Admin user-guide update.

Until then the endpoint is reachable only by an authenticated owner request carrying a server-issued `setupContext`. While the proofs are unserved, every such request holds.

## Ownership boundaries

These are excluded from this item:

- **Owned by the lease writer:** `lib/nonprod/preview-runtime-fence.ts` and `lib/nonprod/environment-lease-provenance.ts`.
- **Owned by the S5 producer and owner-read writer:** `lib/workroom-runtime/s5-rehearsal-*`.
- **Owned by BI-9F5D1052:** every authentication and issuance file, namely `proxy.ts`, `lib/api/auth-middleware.ts`, `lib/govern/auth.ts`, `app/api/oauth/*`, `lib/auth/oauth-tokens.ts`, `lib/auth/employee-scoped-token.ts`, `app/api/v1/auth/*`, `lib/directory/ldap/*` and `app/api/automation/*`.

## Acceptance

- **AC-E1. Boundary.**
  - The server-issued context is compared with current owner evidence before the body is read. Release, replacement, identity drift and a retired replay all leave zero reader, hasher and mutator calls.
  - Invalid bodies are read, with zero hasher calls and zero writes.
  - Retirement uses lease-independent proofs.
  - The served adapter holds.
- **AC-E2. Owner binding.**
  - Owner resolution uses the canonical singleton reader.
  - Ambiguous or invalid mappings hold.
  - There is no superuser fallback.
  - The missing, wrong-Principal and wrong-install receipt cases hold.
  - The adapter is gated on BI-C7100183.
- **AC-E3. Record.**
  - The digest is unique.
  - The update and delete triggers and the all-or-none CHECK hold.
  - There is no lifecycle index.
  - Restrict behaves as specified.
  - The clone refuses a requester-bearing source.
- **AC-E4. Enrollment.**
  - The create is serialized before hashing.
  - Overlapping requests produce exactly one hash.
  - A failure after hashing is rolled back, returns `create_failed`, and leaks nothing.
  - Replay, retired and hold never hash.
  - Drift, collision, an orphan email and a mismatch all hold.
- **AC-E5. Never active.** Every issuer in the table refuses, including the headless, customer and social cases. The workforce and employee-sync paths refuse, both before and after retirement.
- **AC-E6. Retirement.**
  - The under-lock checks run before any branch.
  - The fresh readback verifies the refs and the exact alias.
  - It returns `retired` only on full verification, and `committed_unverified` re-observes.
  - It works without a reservation or lease, after audit purge and after drift.
- **AC-E7. Guards.** Lifecycle, role, reset (including old tokens), workforce, employee sync and clone all refuse. The reset request response stays neutral.
- **AC-E8. Seam and audit.** The seam carries no bearer material and calls no mutator. The projector and governance API are tested. M-4 excludes the rows.
