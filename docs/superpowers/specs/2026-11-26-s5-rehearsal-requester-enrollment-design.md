---
status: draft
---

# Owner-operated enrollment of the S5 rehearsal requester

Status: design for independent review, revision 3. Backlog item BI-9F7192F9, Workroom WC-4EBA473D. It is a dependency of the S5 rehearsal provisioner (BI-1F994B73) and applies the policy on BI-588688A7. This revision follows two review rounds that requested changes: draft `5f67e417` and commit `3ecb90d4`. It authorizes no enrollment, activation, rehearsal, provider send or production change.

## Decision

Add one preview-only, owner-operated surface at `/admin/rehearsal-requester`. There the install owner:

1. Enrolls exactly one synthetic requester for one setup key. The requester is created **inactive**.
2. Activates the requester into a **restricted requester session class**, once a least-privilege profile is decided.
3. Confirms the requester's coworker delegation, after using the existing OAuth consent flow.
4. Retires the requester.

The provisioner gets a read-only seam over the resulting records. Every mutation fails closed and ships **inert**: it holds until every owning proof below is served. No agent operates the surface or handles the credential.

The owner ruled on 2026-11-25: **"I create and hold it."** The owner creates the account once, authorizes the coworker's delegation through the governed preview UI, and keeps the credential. No agent holds, mints or sees it. Separation of duties is role separation between distinct Principals and accounts, not proof that two people acted.

## Grounding

- **Parent design:** `2026-11-25-s5-rehearsal-draft-provisioner-design.md`. The relevant sections are the Enrollment prerequisite, Invoker and fence (item 3), the Requester pin row, and Idempotency, rollback and non-goals.
- **Parent plan:** `2026-11-25-s5-rehearsal-draft-provisioner-plan.md`, sections F1, F2 and V2.
- **Reused substrate**, verified at `c8270766fc9e` with Next.js 16.4.6 installed in this worktree, matching `pnpm-lock.yaml`:

| Substrate | Location | Use here |
| --- | --- | --- |
| `syncUserPrincipal(userId, tx)` | `lib/identity/principal-linking.ts:264` | Transaction-only. No mail, event or audit side effect. |
| `PrincipalAlias` | `core-identity.prisma:327` | Unique `(aliasType, aliasValue, issuer)`, indexed, not enrolled in any purge policy. It already carries several identity types, for example `service-account`, `edge_node` and `mail`. |
| Canonical bcrypt `hashPassword` | `lib/govern/password.ts:5` | Credential hashing. |
| `canonicalJson` | shared | Setup digest. |
| `personRevocation` | `lib/auth/oauth-client-people.ts:52` | Revocation stamp. |
| `AuthorizationDecisionLog` | — | Audit evidence only, because it carries `retention=365d` at `core-identity.prisma:428`. |
| OAuth consent and issuance | `/api/oauth/authorize` POST, with a same-origin check at `:178`; `exchangeOAuthCode` (`lib/auth/oauth-tokens.ts:476`); refresh (`:535`) | Delegation path. |
| Central session gates | `apps/web/proxy.ts`, `authenticateRequest` (`lib/api/auth-middleware.ts:35`) | Restricted session class. |
| Next.js 16.4.6 request handling | `decodeReply` at `app-render/action-handler.js:568`; handler dispatch at `app-route/module.js:521` | A Route Handler receives the undecoded `Request`, while Server Actions decode arguments before invocation. Re-verify against the pinned version at Red. |

- **Standards:**
  - RFC 2606 §2: `.invalid` is used as a label only.
  - NIST SP 800-63B §5.1.1.2: adaptive, salted hashing of memorized secrets.
  - RFC 6749 §10.4: refresh tokens are separate from the owner's credential.
  - OWASP CSRF guidance: same-origin verification on cookie-authenticated POSTs.
- **Rejected approaches:**
  - Generic `createUserAccount`. It runs on the default client, uses an unsalted SHA-256 hash and does a best-effort Principal sync.
  - `withGovernedUserAction`. It writes an extra audit row.
  - `endAccountAgentAccess` and `deactivatePrincipalAndCredentials` as they stand, because each opens its own `$transaction`.
  - The audit log as a lifecycle marker, because it is purged after 365 days.
  - A seeded role chosen by size.
  - Allow fixtures on the served path.
  - A Server Action as the mutation boundary.
  - Absence of a JWT claim as proof that an account is ordinary.

## Durable identity marker (no migration)

The governed-requester marker is a `PrincipalAlias` on the requester's own human Principal, written in the enrollment transaction:

- `aliasType: "s5-rehearsal-requester"`
- `aliasValue: setupDigest`, the full 64-hex SHA-256 of `canonicalJson({ schema: "s5-rehearsal-setup.v1", rulingRef, reservationId })`
- `issuer: ""`

The unique index guarantees one requester per setup key. The marker is retained, because `PrincipalAlias` has no purge declaration, and indexed. It is created only by enrollment and never deleted. Terminal state is the Principal's `status: "inactive"` together with `User.isActive: false`, plus a second alias `aliasType: "s5-rehearsal-retired"` written by retirement with the same `aliasValue`. Both aliases survive audit purges. `isGovernedRequester(userId, tx)` resolves the user's local `user` alias to its Principal and checks for the marker. **A missing, malformed or unreadable result is an error, not "ordinary"**, so every caller fails closed.

`AuthorizationDecisionLog` rows remain as **audit evidence only**. There is one typed, transaction-bound insert per successful command:

| Command | `actionKey` | `decisionId` |
| --- | --- | --- |
| Enroll | `s5.rehearsal-requester.enroll` | `s5rr:enroll:<setupDigest>` |
| Activate | `s5.rehearsal-requester.activate` | `s5rr:activate:<setupDigest>` |
| Confirm delegation | `s5.rehearsal-requester.delegation-confirm` | `s5rr:delegation:<setupDigest>` |
| Retire | `s5.rehearsal-requester.retire` | `s5rr:retire:<setupDigest>` |

Common fields on every row:
- `actorType: "user"`, with `actorRef` and `humanContextRef` set to the owner;
- `decision: "allow"`;
- `purposeOfUse: "synthetic-rehearsal-requester"`;
- a strict versioned payload containing bounded typed refs and a closed-enum reason code only.

These keys differ from `S5_REHEARSAL_APPROVAL_ACTION`, so the approval reader cannot mistake them for approval rows. Lifecycle decisions read the alias marker and live identity state, never these rows. An expired audit row therefore changes nothing.

How the existing consumers treat the rows:
- The **security projector** and `GET /api/v1/governance/decisions` already handle them correctly: an informational allow, returned to the matching actor. They get **tests only**.
- The efficacy measure **M-4** ("refusals before effect") **excludes** `s5.rehearsal-requester.*`. These are owner administration receipts, not gate decisions, and because holds write no row, including them would bias the denominator with allows only. Tests cover the exclusion.

The email is `rehearsal-<first 16 hex of setupDigest>@s5-rehearsal.invalid`. It is a label only and is never used for lookup. A collision, or an email without a marker, holds and is never adopted.

## Fence: fail closed, inert until served

| Proof | Owner | Enroll / activate / confirm | Retire |
| --- | --- | --- | --- |
| Positive non-production installation attestation joined to the exact lease | BI-8EA98961 | required | required, joined to the enrollment's attested installation |
| Actual DB server/cluster and database identity on the write transaction's connection | BI-5C193A3F | required, same transaction | required, same transaction, equal to the enrollment's DB identity |
| Lease currency at commit | BI-60FC9291 | required | **not used**: retirement has its own readiness path with no lease input |
| Production class | resolver | refuse | refuse |

`DPF_ENVIRONMENT_CLASS`, host, Origin, a lease row or the class resolution never pass the fence alone. The process override outranks installer state (`lib/install/environment-class-contract.ts:112`).

The served adapter denies until all three owners serve their proofs. Allow fakes exist only in test files.

**Request boundary.** `POST /api/admin/rehearsal-requester/[command]` is declared `@exposure authenticated`. The `[command]` segment is one of `enroll`, `activate`, `confirm-delegation` or `retire`; the endpoint-classification baseline is unchanged. Before any body read, the handler performs these steps in order:

1. **Production refusal.**
2. **Same-origin verification.** The `Origin`/`Host` match follows the OAuth authorize POST.
3. **Session presence** and a non-requester session class.
4. **Server-owned binding.** The command comes from the path segment. The setup key, `{ rulingRef, reservationId }`, comes from the one-shot owner's read-only seam for the current reservation, never from the body.
5. **The command's readiness path.** Retirement's path has no lease input.
6. **A pre-body serializable transaction** that verifies, without writing:
   - the owner Principal against the ruling record;
   - live capabilities, automation fields and handover state;
   - the exact-DB identity;
   - for retirement, the enrollment marker and the DB identity bound at enrollment.

Only then is a **bounded** body read:
- at most 4 KiB;
- `application/x-www-form-urlencoded` only;
- a strict schema;
- for enrollment, the password, at most 72 UTF-8 bytes;
- for retirement, a closed-enum reason code.

The write transaction re-verifies everything. Tests assert that when the handler refuses, the body reader, the hasher and every mutator are called zero times.

## Owner and record binding

Inside the fenced transaction, the actor must meet every one of these conditions:

- **Session resolution.** The session resolves to an active human Principal through its local `user` alias.
- **Live capabilities.** It holds `manage_users` and `manage_platform`, read from the database rather than the session claims.
- **Account state.** It has no automation fields and no `workHandedOverAt`.
- **Not a requester.** It is not itself a governed requester.
- **Ruling owner.** Its Principal equals the Principal that a governed owner-ruling record of the custody ruling attributes to the owner.

The reservation, attempt and fixture refs are verified read-only against their owning records: the one-shot owner (BI-588688A7) and the fixture-review receipt. Nothing is acquired. If any evidence is missing, the request holds.

**Missing authority, flagged.** No governed owner-ruling record of "I create and hold it" exists yet. The coordinator will capture it through owner-ruling capture without re-asking the owner. No reservation or fixture-review adapter is served yet.

## Enrollment

Enrollment runs in one serializable transaction:

1. Run the fence and owner checks.
2. Look up the marker by `setupDigest`.
3. If the marker exists:
   - Validate strictly. The setup, attempt, fixture, user, Principal and alias must agree with the enroll audit row while that row is retained, and with the marker and live state always.
   - An exact match returns the prior outcome and writes nothing. It never reads, compares, rehashes or changes the password.
   - If the requester is retired, return the terminal status `retired`.
   - A changed attempt or fixture, or a malformed record, holds.
4. If the email exists without a marker, hold.
5. Otherwise, run the shared password policy and the 72-byte check, then hash with bcrypt.
6. Create the User as nonsuperuser with no automation fields, **no role** and `isActive: false`.
7. Run `syncUserPrincipal(userId, tx)` and set the Principal's status to `inactive`.
8. Write the marker alias and the enroll audit row, then commit.

A unique conflict or serialization abort is re-observed in a fresh fenced transaction: an exact match counts as a replay, anything else holds. Any failure rolls back User, Principal, aliases and audit row together.

The password exists only in the owner's bounded POST body. It is never logged, echoed or returned.

## Least privilege, the restricted session and activation (held)

The requester stays **inactive**. Both the User and the Principal are inactive until a least-privilege profile is decided.

- **No seeded role is narrow enough:**
  - `HR-200` adds finance and CRM powers.
  - `HR-300` adds architecture writes.
  - `HR-000` can manage the platform.
- **No governed writer exists for the narrow alternative.** `eligibleOAuthCoworkers` (`lib/auth/oauth-identity-binding.ts:21`) only reads `oauthPurpose: "delegation"` bindings, and nothing writes them.
- **A roleless active user is still a workforce user, so it is not safe:**
  - Workforce sign-in returns `type: "admin"` without requiring a group (`lib/govern/auth.ts:155`).
  - `/api/v1/workspace/activity` exposes backlog titles after authentication alone.
  - `/api/v1/work-queue/[itemId]/complete` updates WorkItems after authentication alone.

Activation is a separate fenced command. It holds with `least_privilege_profile_undecided` until the owner decides. **Open question for the owner, carried by the coordinator:** add a narrow governed delegation-binding writer, or add a dedicated minimal role. The answer must never fall back to a broader role or superuser.

Activation also requires every one of these to be in place and tested first:

- **Restricted session class.** Every issuer classifies the account against the durable marker, and a missing or unreadable marker fails closed.
  - Workforce sign-in stamps `identityClass: "rehearsal-requester"` or `"ordinary"` from that lookup and refuses sign-in if the lookup fails.
  - The mobile `/api/v1/auth/login` already requires a group, and it also refuses requester accounts.
  - The `jwt` callback treats a token **without** `identityClass`, for example from an older issuer, as unclassified. It runs the marker lookup once, ends the session if the lookup is missing or fails, and otherwise stamps the result.
  - For `rehearsal-requester` tokens, every callback re-reads `User.isActive` and the Principal's `status`, and ends the session when either is inactive.
- **Route denial.** `proxy.ts` and `authenticateRequest` deny requester sessions on every route except the OAuth authorize consent GET and POST and sign-out. Ordinary portal pages and `/api/v1/*` return 403.
- **No S5 work from an unconfirmed binding.** OAuth issuance and bearer resolution for a requester require a `delegation-confirm` audit row and its pinned binding to be live and unchanged. The read seam reports this, and the provisioner holds without it.

**Rollback rule.** A build older than this enforcement ignores `identityClass`. So before rolling back below the enforcing version, the owner must retire every governed requester, and activation records the enforcing build revision. Tests cover a valid claimless cookie through upgrade (classified, or ended on lookup failure) and a stamped cookie read after rollback. The rollback case is documented as requiring retirement first.

## Delegation confirmation (second pin)

After activation, the owner signs in as the requester and consents to the coworker's client through the unchanged authorize flow. In `/admin/rehearsal-requester`, the owner confirms the exact binding, fenced and idempotent. It must satisfy all of the following:

- `oauthPurpose: "consent"` and `status: "active"`;
- `oauthUserId` is the requester;
- the client and resource match;
- the `appliedAgent` is active, not archived, and holds `work_room_write`;
- the scopes are within the bounded set.

Confirmation writes the `delegation-confirm` audit row and creates no binding or token. A different, revoked or over-scoped binding holds.

## Retirement and the issuance race

Retirement and every requester-reachable issuance path take the **same per-requester transaction lock**: `pg_advisory_xact_lock(hashtextextended('s5rr:' || userId, 0))`. They take it after confirming the immutable marker and before reading state. The issuance paths are:

- consent at `/api/oauth/authorize` POST (`:304`);
- `exchangeOAuthCode` (`lib/auth/oauth-tokens.ts:476`);
- refresh (`:535`).

Under the lock, each issuance path re-reads `User.isActive`, the Principal's `status` and the binding status, and refuses if any is inactive. Ordinary users are unaffected: the marker check is one indexed alias read, and no lock is taken for them. Tests cover both commit orders, issuance-first and retirement-first, using real PostgreSQL in a throwaway container.

Retirement holds the lock and runs in one serializable transaction:

1. Bind to the marker and to any `delegation-confirm` pin.
2. Verify that the Principal owns **only** this synthetic `user` alias, with no other `user`, `customer_contact` or `partner_contact` aliases. Otherwise hold, because the spine helper disables every linked credential.
3. Revoke every `AuthorityBinding` with `oauthUserId` equal to the requester.
4. Revoke access and refresh tokens. This uses a transaction-scoped helper extracted from `endAccountAgentAccess`, reusing `personRevocation`.
5. Deactivate the spine with a transaction-scoped body extracted from `deactivatePrincipalAndCredentials`. Both existing functions keep their behaviour by delegating to the new helpers.
6. Write the `s5-rehearsal-retired` alias and the retire audit row.
7. Read back the terminal state: zero live bindings, zero live tokens, the User and Principal inactive, and both aliases present.

A repeat returns the terminal status and writes nothing. A lease that has ended never blocks retirement. A receipt alone never counts as proof of cleanup; only the terminal readback does.

**Generic paths are guarded** by `isGovernedRequester`, which fails closed. They return `governed_rehearsal_requester`:
- `updateUserLifecycle`
- `addUserPlatformRole`
- `adminResetUserPassword`
- `adminIssuePasswordReset`
- `completePasswordReset`, which also refuses a previously issued token
- `requestPasswordReset`

`requestPasswordReset` keeps its neutral public response and silently issues nothing for a requester. Tests cover an expired audit row and an old reset token.

## Read-only verification seam

`readS5RehearsalEnrollment({ rulingRef, reservationId }, tx)` is server-only and uses explicit projections. It returns:

- the marker and the retired alias;
- the audit rows while they are retained, reported as `audit-expired` once purged;
- User facts: `isActive`, `isSuperuser`, automation fields, `workHandedOverAt` and group roleIds;
- the Principal's status and aliases;
- the pinned binding ref with its live status, scopes and agent;
- unrevoked token counts.

It never returns `passwordHash`, tokens or their hashes, or session material, and it calls no mutator.

## UI

The UI follows the theme-aware styling runbook.

- **`/admin` keeps its frozen budget.** One owner-only link to `/admin/rehearsal-requester` replaces existing words, so `/admin` keeps 226 arrival words, a net delta of at most 0, and no `page.tsx` prose-ratchet growth. The link renders only on non-production for the verified owner.
- **The new route** is fenced independently. It uses the shared form and status primitives and `var(--dpf-*)` tokens only.
- **Hold states** show reason codes with no password field. Production returns `notFound()`.
- **Route registration.** The route needs a ratified purpose contract (`lib/ux-budget/purpose-contracts`) and its index entry, plus the four regenerated route companions and the updated eligible-route count. It must meet the absolute shell word, control and field budgets, the `data-dpf-lead` band and the owner-first next-action marker.
- **Ratchets.** The API route is not a page: it is declared `@exposure authenticated` and is outside the UX sweep. Verify that at Red. The prose-lint ratchet on `governance/decisions/route.ts` (textMass 4) must not grow, and that file gets tests only.

## Ownership boundaries

These files are excluded and owned elsewhere:
- `lib/nonprod/preview-runtime-fence.ts` and `lib/nonprod/environment-lease-provenance.ts` belong to the lease writer.
- `lib/workroom-runtime/s5-rehearsal-*` belongs to the S5 producer and owner-read writer.

## Acceptance

- **AC-E1 Fence and boundary.**
  - Production, cross-origin, non-owner, wrong-DB and unbound-setup requests refuse before the body is read, with zero calls to the body reader, the hasher or any mutator.
  - The body is bounded and limited to 72 password bytes.
  - Retirement uses its own readiness path, with no lease input.
  - The served adapter holds.
- **AC-E2 Owner binding.**
  - A non-owner administrator, an automation actor, a handed-over actor or a requester refuses.
  - Missing ruling, reservation or fixture evidence holds.
- **AC-E3 Marker and replay.**
  - The alias marker is durable and unique per setup.
  - An exact replay writes nothing and leaves the password untouched.
  - A collision, an orphan email or a malformed record holds.
  - A conflict is re-observed.
  - An expired audit row changes nothing.
- **AC-E4 Inactive until decided.**
  - The User and Principal stay inactive.
  - Activation holds.
  - No role, broad role or superuser is assigned.
- **AC-E5 Restricted session.**
  - Every issuer fails closed against the marker.
  - A claimless legacy cookie is classified or ended.
  - The Principal is checked as well as the User.
  - Requester sessions are denied ordinary routes.
- **AC-E6 Delegation.**
  - The exact binding is pinned.
  - Missing, replaced, revoked or over-scoped bindings hold.
  - An unconfirmed binding cannot be used for S5 work.
- **AC-E7 Retirement.**
  - It is atomic, locked against issuance in both commit orders, terminal, idempotent and works with no lease.
  - It holds if the Principal has more than one account.
  - All generic paths refuse, and the reset response stays neutral.
- **AC-E8 Seam and audit.**
  - The seam carries no bearer material and calls no mutator.
  - The projector and governance API are tested.
  - M-4 exclusion is tested.
- **AC-E9 UI.** The `/admin` budget holds, the new route's budgets and purpose contract pass, the hold state is truthful, tokens only are used, and UX-fit is measured.
