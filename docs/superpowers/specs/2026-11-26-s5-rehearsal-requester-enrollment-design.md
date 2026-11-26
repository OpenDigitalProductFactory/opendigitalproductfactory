---
status: draft
---

# Owner-operated inactive enrollment and retirement of the S5 rehearsal requester

**Status:** design for independent review, revision 9 (converged). It applies the coordinator's final rulings on the eighth review of `b6b1818a`. Each ruling has a named Red test (`R-…`).

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
- **Clone:** `packages/db/src/sanitized-clone.ts` skips `restricted` tables (`:92`) and reloads every other eligible table (`:331`), so on its own it would copy a requester's `User` without the marker. Its destination reset (`runWithDestinationCleanup`, `sanitized-clone-cleanup.ts:5`) runs **before** the existing source-check callback. It also truncates, and `TRUNCATE` does not fire `BEFORE DELETE`. The canonical preview is `dev-postgres`, cloned from production (`docker-compose.yml:800`). That preview is where a requester would live.

  The clone contract **keeps the clone's existing ordering and snapshot handling unchanged**. It adds one destination fence and one source count.

  1. **Destination fence: one lock for every clone entry point.**
     - The fence is a session-level advisory lock in the **destination** database, on the fixed, documented key `hashtextextended('dpf:s5-rehearsal-requester:destination-fence', 0)`.
     - It is held on a dedicated, pinned destination connection from **before** the destination preflight, through reset, copy and failure cleanup. It is released only at the end.
     - Every supported clone entry point takes it:
       - the direct `dev-init` path (`docker-compose.yml:800`, which runs `sanitized-clone.ts`);
       - the cleanup wrapper path (`runSourceCheckedClone` → `runWithDestinationCleanup`, `sanitized-clone-cleanup.ts:9`).
     - **Fence loss.** If the fence connection is lost, the clone supervisor stops with `fence_lost`. It does **not** run failure cleanup, because cleanup would truncate without the fence. It then shuts down its own writers:
       1. At start, the supervisor records the backend PIDs of **its own** destination writers: the binary `COPY` subprocess connection and each batch-writer connection.
       2. On `fence_lost`, it calls `pg_terminate_backend` **only** on those recorded PIDs. It never touches any other session.
       3. It confirms through `pg_stat_activity` that none of those PIDs remains.
       4. It exits non-zero.

       **Precondition:** a failed dev-init can never reach the portal start operation (`scripts/lib/dev-preview-runtime.mjs:325`). Enrollment is served only by that portal, so the half-written destination stays unavailable to enrollment.

       **Recovery** is a fresh fenced run, which begins with the normal reset.

       **Test `R-FENCE-LOSS`:** drop the fence during a real destination write. Afterwards, no recorded writer backend survives, no other session is terminated, the exit is non-zero, and a fresh run recovers.
     - **Enrollment and retirement take the fence exactly once.** They take the same key as a transaction-scoped shared try-lock (`pg_try_advisory_xact_lock_shared`) as the **first statement of one request-scoped transaction**. They hold it through the pre-body checks, the bounded body read (inside that transaction's pre-write phase) and the write. If they can't get it, they return `clone_in_progress` before any body read or hash.

       **Test `R-ONE-FENCE`:** a clone that arrives between the pre-body checks and the body read is held off until the request completes. A request that arrives while a clone holds the fence returns `clone_in_progress` with zero body reads.
  2. **Destination preflight, under the fence and before reset.** Read the destination's enrollment rows:
     - An **active** requester refuses. The operator retires it first.
     - **Only retired** rows refuse unless the operator passes `--discard-retired-rehearsal-evidence`, which records that the per-DB evidence is being discarded. There is no implicit discard.
     - No rows, or no table, means proceed.

     A refusal happens before `runWithDestinationCleanup`, so it leaves every destination row intact.
  3. **Source count, inside the existing copy snapshot.**
     - The count runs at the point the existing `REPEATABLE READ READ ONLY` snapshot is first used (`sanitized-clone.ts:295`).
     - It counts `S5RehearsalRequesterEnrollment` rows. If `to_regclass` finds no table, the count is zero, so a source from before this migration still clones.
     - A count above zero aborts the clone through the existing failure cleanup. That loses nothing protected: under the fence, the destination was already proven to hold no requester, apart from an explicitly discarded retired-only one.
     - A production source always counts zero, because enrollment refuses on production, so ordinary previews are unaffected.

  **Out of scope.** The clone's existing copy-consistency window is a pre-existing property of the clone, not something this item changes. Today the binary `COPY` and per-table counts use connections other than the snapshot. This item neither widens nor narrows that window.

  Tests:
  - A destination preflight refusal leaves the destination rows intact.
  - A destination with an active requester is protected.
  - A destination with only retired requesters needs the explicit disposition.
  - **Race through the direct `dev-init` path:**
    - an enrollment attempted while the clone holds the fence gets `clone_in_progress` and makes no write;
    - a clone that starts while an enrollment transaction holds the shared lock waits, then its preflight sees the committed requester and refuses.
  - A requester-bearing source aborts, and leaves no requester in the destination.
  - A pre-migration source still clones.
  - A production-sourced ordinary preview is unaffected.
  - A lost fence connection stops the clone without running cleanup.
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
3. **Live checks on the acting session, read coherently.** After the per-setup lock, **one SQL statement** reads everything below together, in one snapshot:
   - the singleton organization count and its `topAccountablePrincipalId`;
   - the candidate Principal's kind and status, and its local `user` alias;
   - the acting User's activity, automation and handover fields;
   - the acting User's role keys, projected as `UserGroup.platformRoleId → PlatformRole.roleId`. They are mapped through the static `PERMISSIONS` table, with **no superuser bypass**;
   - for the unset-owner fallback, the **cardinality and IDs** of active human Principals whose role keys grant `manage_platform`;
   - the actor, bound through its **exact** local `user` alias (`aliasType: "user"`, `aliasValue: userId`, `issuer: ""`);
   - the governed-requester marker.

   The decision is a pure evaluation of that single row set, so it can never combine owner and grant facts from different moments. It requires all of the following:
   - the same Principal as the candidate;
   - live `manage_users` and `manage_platform`, read from the database **through the actor's platform-role grants**. `can()` returns true for every superuser (`lib/govern/permissions.ts:136`), so it is not used on its own. A superuser with no role does not qualify;
   - no automation fields;
   - no `workHandedOverAt`;
   - not a governed requester.

**Test `R-OWNER-COHERENT`:** the unset-owner fallback with zero, one and two candidates is decided from the same single statement. A superuser holding no qualifying role key never qualifies.

**Tests** (each case holds or refuses):
- the owner mapping changes between what used to be separate candidate and grant reads (an `organization-accountable-owner.ts:47` write interleaved with the evaluation). The decision uses only one coherent row set, and never accepts a combination that was never true at one moment
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
- superuser with no role

## Fence (fail closed; inert until served)

| Proof | Owner | Enroll | Retire |
| --- | --- | --- | --- |
| Positive non-production installation attestation | BI-8EA98961 | required, joined to the exact current lease | required, **lease-independent**, equal to the record's `installationRef` |
| Actual DB server/cluster and database identity on the write connection | BI-5C193A3F | required, same transaction | required, same transaction, **lease-independent**, equal to `dbIdentityRef` |
| Lease currency at commit, fenced against teardown and replacement (including a clone reset) | BI-60FC9291 | required | not used |
| Exact one-shot reservation revision fenced against release or replacement **through commit** | BI-588688A7 (one-shot owner) | required | not used |
| Production class | resolver | refuse | refuse |

- No class value, host, Origin or lease row passes on its own. The process override outranks installer state (`environment-class-contract.ts:112`).
- The served adapter denies.
- **The reservation fence is a named dependency.** The local lock does not stop the one-shot owner from releasing or replacing the reservation while a hash is in progress. Enrollment therefore requires BI-588688A7's owner to fence the exact `reservationRevision` against release and replacement until the enrollment transaction commits. That means a commit-time predicate or lock, evaluated in the same transaction. No existing proof guarantees this today, so enrollment holds until it is served. Test: release the reservation after the last successful comparison; the enrollment must not commit.

## Request boundary

`POST /api/admin/rehearsal-requester/[command]`, with `[command]` being `enroll` or `retire`. It is marked `@exposure authenticated`, and the endpoint baseline is unchanged.

**Server-issued setup context.** Every request carries an opaque `setupContext` in the query string. The server issues it from the owner's read-only seam:
- **Enroll:** the one-shot owner's reservation `{rulingRef, reservationRef, reservationRevision, attemptRef, fixtureRef}`. The server **derives** `setupDigest` from the verified refs. A digest supplied by the caller is never accepted.
- **Retire:** the retained record's `setupDigest`.

The context only names the setup the owner reviewed. It carries no authority. Authority comes from the owner checks and from comparing the context with live evidence, so it needs no signature and no new key material. It is never taken from the body.

The locator is deliberately not proof of session continuity or of which tab rendered it. Another valid session of the same owner can replay it, and that is by design. A forged or replayed locator grants nothing to a different Principal or install.

**Before any body read**, in this order:

1. Refuse in production.
2. Require **positive, exact** same-origin evidence:
   - If an `Origin` header is **present**, it must equal the canonical portal origin. A present `null` or foreign `Origin` refuses **even if** `Sec-Fetch-Site` is `same-origin`.
   - If `Origin` is absent, `Sec-Fetch-Site` must be `same-origin`.
   - If both are absent, refuse.

   This is stricter than the OAuth authorize POST precedent, which allows both headers to be absent.
3. Require a session.
4. Bind the command from the path.
5. Parse the `setupContext` from the query under a strict schema. A malformed context holds.
6. **Compare the context with current owner evidence.**
   - **Enroll:** the one-shot owner's current reservation must equal the context exactly (revision, attempt, fixture). If it has been released or replaced, **hold with no body read and no write**. The retained-record seam still shows any earlier result.
   - **Retire:** a retained record must exist for the digest. Retirement does not depend on the reservation.
7. Check the command's readiness.
8. Run the pre-body owner and exact-DB read-only transaction.
9. **Enroll pre-parse replay.** If a record already exists for the digest, run the **shared read-only verification**, `verifyRequesterState`. Retirement's fresh readback uses the same function. It runs in a single `REPEATABLE READ READ ONLY` transaction, so all its reads share one snapshot and it cannot assemble a pass from different states. It checks:
   - the record's refs match the target;
   - the User and the Principal are inactive;
   - the Principal's only alias is the exact local `user` alias for that User;
   - there are zero live bindings, tokens and owned clients;
   - for retired records, the full terminal tuple is present.

   Then:
   - A retired record that verifies returns `retired`.
   - An active record whose facts equal the context and that verifies returns the prior outcome.
   - A record that fails verification holds with `requester_state_unverified`, whether it is active or retired. It never returns `retired`.
   - In every case, no body is read.

**Only then** is the body read:
- at most 4 KiB, `application/x-www-form-urlencoded`, strict schema;
- enroll: a password of at most 72 UTF-8 bytes;
- retire: a closed-enum `retirementReason`.

**Tests:**
- release, replacement, identity drift, replay of a retired setup (verified and alias-drifted), a malformed or stale context, a missing or `null` or foreign origin, and every other pre-body refusal: zero calls to the body reader, the hasher and every mutator;
- invalid bodies: the body is read, then zero hasher calls and zero writes.

## Enrollment and the no-hash guarantee

Under `Serializable`, a transaction's snapshot is taken by its first statement, which here is the lock call itself. That snapshot is taken **before** an advisory lock is granted, so a waiter could still miss the winner's committed row. Enrollment therefore runs in **Read Committed**, where every statement after the lock sees the latest committed state. Checks on proofs owned elsewhere use those owners' commit-time fences rather than a snapshot.

1. **Claim the exact create attempt before hashing.**
   - First take the destination fence as a shared try-lock; if it isn't available, return `clone_in_progress`.
   - Run the interactive Prisma transaction with `timeout: 15_000` and `maxWait: 5_000`. The timeout deliberately exceeds the 5 s lock wait, so a waiter near the deadline can still replay.
   - Set `SET LOCAL lock_timeout = '5s'`, then take `pg_advisory_xact_lock(hashtextextended('s5rr-enroll:' || setupDigest, 0))`. The `setupDigest` here is the one the server derived.
   - If the lock wait times out, return `enroll_busy` and hold. No hash.
   - A 64-bit key collision only serializes two different enrollments. Identity lookups use the full digest, so a collision never merges them.
   - If the one-shot owner later serves an exclusive per-setup boundary, that boundary replaces this lock.
2. **Fresh reads after the lock.** Each of these is a separate statement:
   - re-run the owner checks;
   - re-compare the context with the one-shot owner's current reservation;
   - re-read the record by digest.
3. **Proofs owned elsewhere are fenced, not snapshotted.** Every one of the following must be served for the exact reservation revision and must hold through commit. If any is unavailable, hold before hashing.
   - the one-shot reservation-revision fence (BI-588688A7);
   - lease currency fenced against teardown and replacement (BI-60FC9291);
   - installation attestation (BI-8EA98961);
   - the same-connection DB identity (BI-5C193A3F).
4. **If the record now exists**, take the replay or hold path in Request boundary step 9. No hash.
5. **If the email exists without a record**, hold. No hash.
6. **Hash once.** Apply the password policy and the 72-byte check, then run the single bcrypt hash.
7. **Create the User inactive:** nonsuperuser, no automation fields, no role.
8. Run `syncUserPrincipal(userId, tx)`, then set the Principal inactive.
9. Write the record and the audit row, then commit. The unique digest still backstops any race at the database level.

**Outcomes**

- **No hash:** `replay`, `retired` and `hold` (including `enroll_busy` and `requester_state_unverified`) never reach the hash.
- **Success:** `created` is the only successful outcome that hashes.
- **Hashed:**
  - `create_failed`: a failure after the hash and **before** commit was attempted, such as a constraint, a trigger or a statement error. The rollback is confirmed. The response is a generic code, and the log records the code only. Neither ever contains the password, the hash or the body.
  - `create_unverified`: the commit was sent but its acknowledgement was lost, for example on a connection error. The request **does not claim rollback**. It reports `create_unverified`, together with the server-derived `setupDigest`, for recovery.

**Lost-acknowledgement recovery: read only, never creates.**

`GET /api/admin/rehearsal-requester/status?setupDigest=<digest>` is the recovery path.
- **Gated like retirement:**
  - production refusal;
  - positive same-origin evidence;
  - owner binding;
  - the lease-independent installation and DB proofs.
- **Keyed only by the digest:** it does not depend on the current reservation, so it still works after the reservation is released or replaced.
- **Waits for the original transaction.** On a pinned connection it:
  1. takes the per-setup lock as a **session-level** advisory lock (`pg_advisory_lock`), **before** `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;
  2. holds that lock through the read;
  3. releases it (`pg_advisory_unlock`) after `COMMIT`.

  The original enrollment holds its transaction-scoped lock until it ends, so the snapshot is taken only after that transaction has finished.

  **Test `R-STATUS-WAIT`:** GET is shown waiting (via `pg_locks`) before the enroll commit, then reports `committed`.
- **Reports one of:**
  - `committed`, with the `verifyRequesterState` result;
  - `not_committed`, if no record exists once the lock has been acquired.
- **Never writes:** it never creates, never accepts a body and never calls a mutator. After `not_committed`, a new enrollment still has to pass the full boundary, including the current reservation comparison. Stale evidence can never create.

**Password promise.** After bounded parsing, the password is used only in step 6 of the transaction that owns the create. It is never compared, never stored except as the new bcrypt hash, and never logged or echoed. It never appears in a response, a receipt or telemetry.

**Tests**

- Request B is **already waiting** on the lock before A commits. Assert this through `pg_locks` or a barrier. Expect exactly one hash and one create. B returns `replay` with zero hasher calls.
- A lock-wait timeout returns `enroll_busy` with zero hasher calls.
- The reservation is released after the last comparison. Expect no commit.
- A forced failure after the hash gives `create_failed`, with no secret in the logs or the response.
- A simulated lost commit acknowledgement gives `create_unverified`. The reservation is then released **between** the lost acknowledgement and the recovery. The status path still reports `committed` with its verification, and a new enroll POST holds on the reservation check without creating anything.
- The transaction timeout exceeds the lock wait, so a waiter that gets the lock near 5 s still completes as `replay`.
- Spies on the hasher, the logger and the response body.

The email address is `rehearsal-<first 16 hex>@s5-rehearsal.invalid`. It is a label only.

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
8. **Fresh readback** in a new transaction runs the shared `verifyRequesterState` (also used by enroll replay). It verifies:
   - `setupDigest`, `userId` and `principalId` equal the targeted refs;
   - the exact single local `user` alias;
   - zero live bindings, tokens and owned clients;
   - the User and Principal are inactive;
   - the full terminal tuple is present.

   Return `retired` **only** if all of that passes. Otherwise:
   - after a commit in this request, return `committed_unverified` with reason `requester_state_unverified`, meaning retirement committed but verification failed;
   - on a repeat, hold with reason `requester_state_unverified`.

   A retry re-observes the record and never rewrites it.

**Tests:**
- alias drift injected **between the commit and the fresh readback** returns `committed_unverified` (`requester_state_unverified`), not `retired`;
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

## Parent reconciliation

This delivery's docs phase amends **both** parent documents:
- `2026-11-25-s5-rehearsal-draft-provisioner-design.md`: the "no migration" line (`:17`), and the enrollment and delegation ownership (`:15`–`:21`);
- `2026-11-25-s5-rehearsal-draft-provisioner-plan.md`: the F1 and F2 references at `:13`, which still assign the UI and delegation to BI-9F7192F9.

After the edit, BI-9F7192F9 owns server-side inactive enrollment and retirement. BI-9F5D1052 owns activation, the operator UI, delegation confirmation, sessions and issuance.

**The parent's F1 stays held until this edit lands.**

## Ownership boundaries

These are excluded from this item:

- **Owned by the lease writer:** `lib/nonprod/preview-runtime-fence.ts` and `lib/nonprod/environment-lease-provenance.ts`.
- **Owned by the S5 producer and owner-read writer:** `lib/workroom-runtime/s5-rehearsal-*`.
- **Owned by BI-9F5D1052:** every authentication and issuance file, namely `proxy.ts`, `lib/api/auth-middleware.ts`, `lib/govern/auth.ts`, `app/api/oauth/*`, `lib/auth/oauth-tokens.ts`, `lib/auth/employee-scoped-token.ts`, `app/api/v1/auth/*`, `lib/directory/ldap/*` and `app/api/automation/*`.

## Objectives and acceptance

This section restates the Decision and Never-active invariant text above, and the acceptance criteria AC-E1 to AC-E8 unchanged, in the marked form that spec-approval parses. It adds no requirement.

- **OBJ-RR-ENROLL:** The owner alone, preview-only, can enroll exactly one synthetic requester for one setup key through one owner-only endpoint; every piece fails closed and ships inert until every owning proof is served.
- **OBJ-RR-NEVER-ACTIVE:** The User has `isActive: false` and the Principal has `status: "inactive"` from the enrollment commit onward; no command in this item activates either one, and every issuer, generic action, workforce link and employee sync refuses the requester.
- **OBJ-RR-RECORD:** The retained enrollment record is the single durable marker: it cannot be deleted, and a clone cannot copy the identity without its marker.
- **OBJ-RR-RETIRE:** Retirement makes that requester terminally unusable and keeps every fact.
- **OBJ-RR-SEAM:** The provisioner gets only a read-only verification seam; no agent operates the endpoint or handles the credential.

| Acceptance | Objective | Evidence |
| --- | --- | --- |
| AC-E1 | OBJ-RR-ENROLL | Boundary. The server-issued context is compared with current owner evidence before the body is read, and the digest is derived on the server. Positive exact same-origin evidence is required. A missing, `null` or foreign origin refuses. Release, replacement, identity drift, a retired replay (verified or drifted) and every origin refusal all leave zero reader, hasher and mutator calls. Invalid bodies are read, with zero hasher calls and zero writes. Retirement uses lease-independent proofs. The served adapter holds. |
| AC-E2 | OBJ-RR-ENROLL | Owner binding. Owner resolution uses the canonical singleton reader, and its predicates are evaluated from one coherent statement after the lock. Ambiguous or invalid mappings hold. There is no superuser fallback, and a superuser with no role does not qualify through `can()`. The missing, wrong-Principal and wrong-install receipt cases hold. The adapter is gated on BI-C7100183. |
| AC-E3 | OBJ-RR-RECORD, OBJ-RR-NEVER-ACTIVE | Record. The digest is unique. The update and delete triggers and the all-or-none CHECK hold. There is no lifecycle index. Restrict behaves as specified. Every clone entry point, including direct `dev-init`, holds the destination fence from the preflight through cleanup. Enrollment and retirement use the shared try-lock. The destination preflight runs before reset, so a refusal leaves the destination intact. The source count runs inside the existing copy snapshot at its first use, and a non-zero count aborts through the existing cleanup. A requester-bearing source refuses. A pre-migration source still clones, and ordinary production-sourced previews are unaffected. A destination with an active requester is protected. One with only retired requesters needs the explicit discard disposition. |
| AC-E4 | OBJ-RR-ENROLL | Enrollment. The create runs in Read Committed, with the lock taken before any hash and the lock wait bounded (`enroll_busy`). Reads after the lock are fresh. When request B is already waiting before A commits, exactly one hash happens. The one-shot reservation revision is fenced through commit. A release after the last comparison cannot commit. A post-hash failure is rolled back, returns `create_failed`, and leaks nothing. A lost commit acknowledgement returns `create_unverified`. The read-only status path recovers it by digest even after the reservation is released, and never creates. The Prisma transaction timeout exceeds the lock wait. A clone in progress gives `clone_in_progress`. Replay, retired and hold never hash. Enroll returns `retired` only after the shared verification. Drift, collision, an orphan email and a mismatch all hold. |
| AC-E5 | OBJ-RR-NEVER-ACTIVE | Never active. Every issuer in the table refuses, including the headless, customer and social cases. The workforce and employee-sync paths refuse, both before and after retirement. |
| AC-E6 | OBJ-RR-RETIRE | Retirement. The under-lock checks run before any branch. The fresh readback verifies the refs and the exact alias. It returns `retired` only when the shared verification passes, and `committed_unverified` re-observes. It works without a reservation or lease, after audit purge and after drift. |
| AC-E7 | OBJ-RR-NEVER-ACTIVE | Guards. Lifecycle, role, reset (including old tokens), workforce, employee sync and clone all refuse. The reset request response stays neutral. |
| AC-E8 | OBJ-RR-SEAM | Seam and audit. The seam carries no bearer material and calls no mutator. The projector and governance API are tested. M-4 excludes the rows. |
