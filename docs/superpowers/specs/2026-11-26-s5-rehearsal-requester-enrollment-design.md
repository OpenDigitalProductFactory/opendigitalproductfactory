---
status: draft
---

# Owner-operated inactive enrollment and retirement of the S5 rehearsal requester

Status: design for independent review, revision 4. Backlog item BI-9F7192F9, Workroom WC-4EBA473D. It depends on the S5 rehearsal provisioner (BI-1F994B73) and applies the policy on BI-588688A7.

This revision applies the coordinator's 2026-11-26 split, ruled after the third review requested changes at commit `1ca1a3b2`:
- This item delivers **inactive enrollment and retirement only**.
- Activation, the restricted session class, delegation confirmation, the issuance lock and the issuer inventory move to **BI-9F5D1052**. That item is blocked on the owner's least-privilege decision.

This item authorizes no activation, delegation, rehearsal, provider send or production change.

## Decision

Add one preview-only, owner-operated surface, `/admin/rehearsal-requester`, with two commands:

1. **Enroll.** Create exactly one synthetic requester for one setup key. Its User and Principal are created **inactive** and stay inactive throughout this item.
2. **Retire.** Make that requester terminally unusable, record why, and keep every fact.

The provisioner gets a read-only seam. Both commands fail closed and ship **inert**: they hold until every owning proof below is served. No agent operates the surface or handles the credential. **No file on the ordinary authentication or issuance path changes.**

The owner ruled on 2026-11-25: **"I create and hold it."** The owner creates the account and keeps the credential. No agent holds, mints or sees it. Separation of duties here is role separation between distinct Principals and accounts. It is not proof that two different people acted.

## Never-active invariant (what keeps this item off the auth path)

The User has `isActive: false` and the Principal has `status: "inactive"` from the enrollment commit onward. This item has no command that activates either one. Generic reactivation is guarded (see Guards). As a result, no session, token, binding or directory bind can exist for the requester. The existing checks below enforce this unchanged. Each one gets a regression test using an enrolled requester:

| Issuer | Existing refusal |
| --- | --- |
| Workforce credentials sign-in | `lib/govern/auth.ts:163`: `if (!user \|\| !user.isActive) return null` |
| Mobile login | `app/api/v1/auth/login/route.ts:56`: `!user.isActive`; `:61` also refuses a user with no group |
| Mobile refresh | `app/api/v1/auth/refresh/route.ts:53`: `!user \|\| !user.isActive` |
| LDAP bind | `lib/directory/ldap/bind.ts:63`: `principal.status !== "active"` |
| Automation sign-in | `lib/govern/automation-sign-in.ts:316`: refuses an inactive user, and any user that is neither a fixture nor the automation persona |
| OAuth consent (GET and POST) and token use | `eligibleOAuthCoworkers` → `currentOAuthHuman` → `isCurrentUserActive` (`lib/govern/current-user-context.ts:8`) returns no eligible coworker, so consent fails with `OAUTH_SETUP_REQUIRED`. Code exchange, refresh and bearer resolution re-check `currentOAuthHuman` (`lib/auth/oauth-tokens.ts:119`, `:190`) |
| Headless `client_credentials` | Requires a credentials client owned by the user. Registering one requires an active session, so none can exist |
| Customer and social sign-in | The requester has no customer contact or social link. Its only identity alias is the local `user` alias |

Any future change that could activate the requester belongs to BI-9F5D1052 and must re-establish this table there.

## Grounding

- **Parent design:** `2026-11-25-s5-rehearsal-draft-provisioner-design.md`. Relevant sections: the Enrollment prerequisite; Invoker and fence (item 3); the Requester pin row; Idempotency, rollback and non-goals.
- **Plan:** `2026-11-25-s5-rehearsal-draft-provisioner-plan.md`, items F1, F2 and V2.
- **Reused substrate,** verified at `c8270766fc9e`. Next.js 16.4.6 resolves from this worktree's root `node_modules`, matching the frozen lockfile.
  - `syncUserPrincipal(userId, tx)` (`lib/identity/principal-linking.ts:264`): transaction-only, with no side effects.
  - Canonical bcrypt `hashPassword` (`lib/govern/password.ts:5`).
  - `canonicalJson`.
  - `personRevocation` (`lib/auth/oauth-client-people.ts:52`).
  - `AuthorizationDecisionLog`, used **only as audit evidence** because it is purged after 365 days (`core-identity.prisma:428`).
  - Request handling: a Route Handler receives the undecoded `Request` (`next/dist/server/route-modules/app-route/module.js:521`), while Server Actions decode arguments first (`app-render/action-handler.js:568`).
  - The same-origin check on the OAuth authorize POST (`app/api/oauth/authorize/route.ts:178`) is the pattern copied here.
- **Standards:**
  - RFC 2606 §2: `.invalid` is used as a label only.
  - NIST SP 800-63B §5.1.1.2: salted, adaptive password hashing.
  - OWASP CSRF guidance: same-origin verification.
  - PostgreSQL 16 application-level consistency: fresh reads after an explicit row lock.
- **Rejected:**
  - Generic `createUserAccount`, because it uses an unsalted SHA-256 hash and a best-effort sync.
  - `withGovernedUserAction`, because it writes an extra audit row.
  - The audit log or a `PrincipalAlias` digest as the retained record of enrollment facts. The digest proves only the setup key, and the log is purged.
  - JSON enrollment facts stored in an alias value. The data-model stewardship runbook forbids JSON as a primary query source.
  - A hashed advisory lock. It is replaced by an exact row lock.
  - A Server Action boundary.
  - Allow fixtures on the served path.
  - Any change on the authentication or issuance path. That work is BI-9F5D1052.

## Retained record (migration required, flagged to the coordinator)

No existing retained, typed substrate can carry the immutable enrollment facts: setup, attempt, fixture, installation and DB identity. They must survive audit purge, and they are queried and verified by the provisioner and by retirement, so the stewardship runbook requires typed columns. This design therefore proposes **one new model**. **No schema path is claimed and no migration is written until the coordinator approves.**

```prisma
/// Immutable owner-enrolled synthetic requester for one S5 rehearsal setup (BI-9F7192F9).
/// @dpf lifecycle=business-record retention=domain sensitivity=restricted categories=security-audit,identity owner=platform-owner steward=data-steward
model S5RehearsalRequesterEnrollment {
  id                    String    @id @default(cuid())
  setupDigest           String    @unique // sha256(canonicalJson({schema:"s5-rehearsal-setup.v1", rulingRef, reservationId}))
  rulingRef             String
  reservationId         String
  attemptRef            String
  fixtureRef            String
  installationRef       String
  leaseRef              String
  dbIdentityRef         String
  userId                String    @unique
  principalId           String    @unique
  enrolledByPrincipalId String
  enrolledAt            DateTime  @default(now())
  retiredAt             DateTime?
  retiredByPrincipalId  String?
  retireReason          S5RehearsalRequesterRetireReason?
  user                  User      @relation(fields: [userId], references: [id], onDelete: Restrict)
  principal             Principal @relation(fields: [principalId], references: [id], onDelete: Restrict)
  @@index([retiredAt])
}

enum S5RehearsalRequesterRetireReason { rehearsal_complete quarantine_after_failure setup_superseded operator_cleanup }
```

- **Immutable fact columns.** Every column from `setupDigest` through `enrolledAt` is written once, in the enrollment transaction. Application code never updates them.
- **Terminal columns.** `retiredAt`, `retiredByPrincipalId` and `retireReason` go from null to a value exactly once, in the retirement transaction. They are never cleared.
- **Delete protection.** `onDelete: Restrict` on both User and Principal stops either being deleted while the record exists. This closes the `PrincipalAlias` cascade concern, and retirement never deletes anything.
- **Lifecycle and retention.** The record follows the platform's lifecycle-tag rules, and its retention is domain-scoped, not purged.
- **Marker.** The record is the **single durable marker** of a governed requester: `isGovernedRequester(userId)` is one unique-index read. The `PrincipalAlias` marker from revision 3 is dropped as redundant. Identity stays on the existing local `user` alias, which satisfies Principal convergence: this is a fact record, not a parallel identity table.
- **If the coordinator rejects a migration:** this item cannot satisfy the requirement that enrollment facts survive audit purge, and it should hold. An alias-encoded fact tuple is rejected above.

## Audit evidence

There is one typed, transaction-bound `AuthorizationDecisionLog` insert per successful command:

| Command | `actionKey` | `decisionId` |
| --- | --- | --- |
| Enroll | `s5.rehearsal-requester.enroll` | `s5rr:enroll:<setupDigest>` |
| Retire | `s5.rehearsal-requester.retire` | `s5rr:retire:<setupDigest>` |

Every row has these fields:
- `actorType: "user"`;
- `actorRef` and `humanContextRef` set to the owner;
- `decision: "allow"`;
- `purposeOfUse: "synthetic-rehearsal-requester"`;
- a strict, versioned payload of bounded refs and a closed reason code.

No lifecycle decision ever reads these rows, so an expired row changes nothing.

How existing consumers are affected:
- **S5 approval reader:** it matches its own action key, so it rejects these rows.
- **Security projector and the governance decisions API:** no change, tests only.
- **M-4:** excludes `s5.rehearsal-requester.*`. These are owner administration receipts, and holds write no rows, so including them would count allows only.

## Fence: fail closed, inert until served

| Proof | Owner | Enroll | Retire |
| --- | --- | --- | --- |
| Positive non-production installation attestation joined to the exact lease | BI-8EA98961 | required | required; must equal the record's `installationRef` |
| Actual DB server/cluster and database identity on the write transaction's connection | BI-5C193A3F | required, same transaction | required, same transaction; must equal the record's `dbIdentityRef` |
| Lease currency at commit | BI-60FC9291 | required | **not used**: retirement has its own readiness path with no lease input |
| Production class | resolver | refuse | refuse |

The process override outranks installer state (`lib/install/environment-class-contract.ts:112`). So no class value, host, Origin or lease row can pass the fence on its own. The served adapter denies, and allow fakes live only in tests.

### Request boundary

`POST /api/admin/rehearsal-requester/[command]` handles `[command]` ∈ {`enroll`, `retire`}. It is declared `@exposure authenticated`, and the endpoint-classification baseline is unchanged.

Before any body read, the handler runs these checks in order:
1. Refuse production.
2. Verify same origin.
3. Require a session.
4. Bind the command from the path segment. Bind the setup from server-owned context:
   - **Enroll:** the one-shot owner's read seam for the current reservation.
   - **Retire:** the owner selects the requester by `setupDigest` from the retained records. This lookup does not depend on the current reservation or the fixture review.
5. Check that command's readiness.
6. Run a pre-body read-only transaction that verifies the owner and the exact DB, and for retirement the record's installation and DB identity.

Only after that is a **bounded** body read:
- at most 4 KiB, `application/x-www-form-urlencoded`, strict schema;
- enroll: a password of at most 72 UTF-8 bytes;
- retire: a closed-enum `retireReason`.

Tests:
- Every pre-body refusal (production, cross-origin, no session, non-owner, wrong DB, unbound setup, readiness): the body reader, the hasher and every mutator are each called **zero** times.
- An invalid, oversized or over-length body: the body is read, but the hasher and every write are called **zero** times.

## Owner and record binding

Inside the transaction, the actor must meet all of these:
- the session resolves to an active human Principal through the local `user` alias;
- live `manage_users` and `manage_platform`, read from the database;
- no automation fields and no `workHandedOverAt`;
- not a governed requester;
- the actor's Principal equals the owner named by the governed owner-ruling record of the custody ruling.

For enrollment, the reservation, attempt and fixture are also verified read-only against their owners: the one-shot owner (BI-588688A7) and the fixture-review receipt. Nothing is acquired. Missing evidence holds.

**Missing authority, flagged.** No governed ruling record exists yet; the coordinator will capture one. No reservation or fixture-review adapter is served.

## Enrollment

Enrollment runs as one serializable transaction:

1. Run the fence and the owner checks.
2. Look up the record by `setupDigest`.
3. If a record exists:
   - An exact match on every immutable fact, with the live User, Principal and alias consistent and the User and Principal inactive, returns the prior outcome. **It makes no writes and never reads, compares, rehashes or changes the password.**
   - A retired record returns the terminal status `retired`.
   - A changed attempt or fixture, or any other mismatch, holds.
4. If the email exists without a record, hold.
5. Check the shared password policy and the 72-byte limit, then hash with bcrypt.
6. Create the User inactive: nonsuperuser, no automation fields, no role.
7. Run `syncUserPrincipal(userId, tx)` and set the Principal to `inactive`.
8. Write the record and the enroll audit row, then commit.

A unique conflict or a serialization abort is re-observed in a fresh fenced transaction. An exact match is treated as a replay; anything else holds. Any failure rolls everything back together.

The email is `rehearsal-<first 16 hex of setupDigest>@s5-rehearsal.invalid`. It is a label only and is never used for lookup.

## Retirement

Retirement runs in one **Read Committed** transaction. The requester's account is never active, so nothing in this item can race it with issuance.

1. `SELECT … FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1 FOR UPDATE`. This exact row lock serializes concurrent retirements and replays. Every later read in the transaction is a fresh post-lock read.
2. If `retiredAt` is already set, verify the terminal state and return `retired` without writing.
3. Verify the Principal owns **only** this `user` alias, with no other user, customer or partner alias. Otherwise hold.
4. Defensively revoke any `AuthorityBinding` whose `oauthUserId` is the requester, plus its access and refresh tokens. This uses a transaction-scoped helper extracted from `endAccountAgentAccess` that reuses `personRevocation`; the existing export keeps its behaviour by delegating to it. The never-active invariant means the expected counts are zero, and the receipt records any non-zero count.
5. Assert, or re-set for this exact User and Principal only, `isActive: false` and `status: "inactive"`.
6. Set the record's terminal fields and write the retire audit row.
7. After commit, run a **fresh transaction** that reads back the terminal state:
   - zero live bindings and tokens;
   - User and Principal inactive;
   - `retiredAt` set.
   Only this readback counts as cleanup proof.

Retirement works with no current reservation, no lease and purged audit rows. It never deletes the User, the Principal or the record.

## Guards (keep the inactive account inert)

`isGovernedRequester` is one unique-index read on the record. On a read error the guarded action refuses. For `requestPasswordReset`, a read error is answered with the neutral public response and nothing is issued.

The guarded actions return `governed_rehearsal_requester`:
- `updateUserLifecycle` (blocks reactivation)
- `addUserPlatformRole`
- `adminResetUserPassword`
- `adminIssuePasswordReset`
- `completePasswordReset`, which also refuses a previously issued token
- `requestPasswordReset`, which keeps its neutral response and silently issues nothing

These are admin and reset actions in `lib/actions/users.ts`. They are not authentication issuers.

## Read-only verification seam

`readS5RehearsalEnrollment({ rulingRef, reservationId }, tx)` is server-only and uses explicit projections. It returns:
- the retained record;
- the audit rows while they are retained, otherwise `audit-expired`;
- User facts: `isActive`, `isSuperuser`, automation fields, `workHandedOverAt`, group roleIds;
- the Principal's status and aliases;
- any bindings and unrevoked token counts, which are expected to be zero.

It never returns `passwordHash`, tokens or their hashes, or session material, and it calls no mutator. Under this item the provisioner sees an inactive requester and **holds**. Activation and delegation belong to BI-9F5D1052.

## UI

The UI follows the theme-aware styling runbook.

- **`/admin`:** one owner-only link to `/admin/rehearsal-requester` replaces existing words, so `/admin` stays within 226 arrival words, a net delta of at most 0, and no `page.tsx` ratchet growth. The link renders only on non-production for the verified owner.
- **New route:**
  - It is independently fenced and uses shared form and status primitives with `var(--dpf-*)` tokens only.
  - It shows the enroll form, plus a list of retained requesters with a retire control.
  - Hold states show reason codes and no password field. Production returns `notFound()`.
  - It needs a ratified purpose contract with an index entry, the regenerated route companions, and the updated eligible-route count.
  - It must meet the absolute shell budgets, the `data-dpf-lead` band and the owner-first next-action marker.
- **API route:** declared `@exposure authenticated` and outside the UX sweep; this is checked at Red.
- **`governance/decisions/route.ts`:** its prose ratchet (textMass 4) is unchanged, with tests only.

## Ownership boundaries

These are excluded and owned elsewhere:
- The lease writer owns `lib/nonprod/preview-runtime-fence.ts` and `lib/nonprod/environment-lease-provenance.ts`.
- The S5 producer and owner-read writer own `lib/workroom-runtime/s5-rehearsal-*`.
- BI-9F5D1052 owns every authentication and issuance file: `proxy.ts`, `lib/api/auth-middleware.ts`, `lib/govern/auth.ts`, `app/api/oauth/*`, `lib/auth/oauth-tokens.ts`, `app/api/v1/auth/*`, `lib/directory/ldap/*` and `app/api/automation/*`.

## Acceptance

- **AC-E1, fence and boundary.**
  - Pre-body refusals leave the reader, the hasher and every mutator at zero calls.
  - An invalid body is read, but the hasher and writes stay at zero.
  - Retirement has no lease input.
  - The served adapter holds.
- **AC-E2, owner binding.**
  - These actors refuse: a non-owner administrator, an automation actor, a handed-over actor, and a requester.
  - Missing ruling, reservation or fixture evidence holds.
- **AC-E3, retained record and replay.**
  - The record is unique per setup and its facts are immutable.
  - Exact replay makes no writes and never touches the password.
  - Each of these holds: a changed attempt or fixture, a prefix collision, an orphan email, a mismatch.
  - A conflict is re-observed.
  - Purged audit rows change nothing.
- **AC-E4, never active.**
  - The User and Principal stay inactive.
  - Every issuer in the invariant table refuses an enrolled requester, with a regression test for each.
- **AC-E5, retirement.**
  - Retirement holds an exact row lock and uses fresh reads.
  - It is idempotent and terminal, verified from a fresh transaction.
  - It works with no current reservation and with audit rows purged.
  - A Principal with more than one account holds.
  - User and Principal deletion is restricted.
- **AC-E6, guards.**
  - Reactivation, role assignment, admin reset, reset issue, reset completion (including an old token) and reset request all refuse.
  - The reset response stays neutral.
- **AC-E7, seam and audit.**
  - The seam returns no bearer material and calls no mutator.
  - Projector and governance API tests pass.
  - M-4 excludes these rows.
- **AC-E8, UI.**
  - The `/admin` word budget holds.
  - The new route's budgets and purpose contract pass.
  - Hold states are truthful.
  - Only `var(--dpf-*)` tokens are used.
  - UX-fit is measured.
