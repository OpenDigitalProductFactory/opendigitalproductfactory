---
status: draft
---

# Owner-operated enrollment of the S5 rehearsal requester

Status: design for independent review. Backlog item BI-9F7192F9, Workroom WC-4EBA473D. It is a dependency of the S5 rehearsal provisioner (BI-1F994B73), and it applies the policy on BI-588688A7. It revises draft `5f67e417` after an independent review requested changes. It authorizes no enrollment, rehearsal, provider send or production change.

## Decision

Add one preview-only, owner-operated surface at `/admin/rehearsal-requester`. There the install owner does three things:

1. Enrolls exactly one synthetic requester for one setup key.
2. Confirms that requester's coworker delegation, after using the existing OAuth consent flow.
3. Retires the requester.

The provisioner gets a read-only seam over the resulting records. Every mutation fails closed and ships **inert**: it holds until every owning proof below is served. No schema migration is added, and no agent operates the surface or handles the credential.

The owner ruled on 2026-11-25: **"I create and hold it."** The owner creates the account once, authorizes the coworker's delegation through the governed preview UI, and keeps the credential. No agent holds, mints or sees it. Separation of duties is role separation between distinct Principals and accounts, not proof that two people acted.

## Grounding

- Parent design: `2026-11-25-s5-rehearsal-draft-provisioner-design.md`, specifically:
  - the Enrollment prerequisite;
  - Invoker and fence (item 3: enrollment uses the same fence);
  - the Requester pin row;
  - Idempotency, rollback and non-goals.
- Plan: `2026-11-25-s5-rehearsal-draft-provisioner-plan.md`, F1, F2 and V2.
- Reused substrate, verified at `c8270766fc9e`:
  - `syncUserPrincipal(userId, tx)` (`lib/identity/principal-linking.ts:264`). It uses only the transaction's delegates and has no mail, event or audit side effect.
  - Canonical bcrypt `hashPassword` (`lib/govern/password.ts:5`).
  - The `passwordPolicyErrors` rules (`lib/actions/users.ts:48`).
  - `canonicalJson` (`packages/integration-shared/src/canonical-json.ts`).
  - `personRevocation` (`lib/auth/oauth-client-people.ts:52`).
  - `AuthorizationDecisionLog` with its unique `decisionId` (`core-identity.prisma:429`).
  - The OAuth consent path, unchanged:
    - `/api/oauth/authorize` creates the binding through `createOAuthConsentBinding`.
    - Code exchange and token use re-check `currentOAuthHuman` (`lib/auth/oauth-tokens.ts:119`, `:190`).
- Standards: RFC 2606 §2 reserves `.invalid`, which is used as a label only. NIST SP 800-63B §5.1.1.2 calls for salted, adaptive hashing of memorized secrets, which is why the bcrypt helper is used. OAuth 2.0 (RFC 6749 §10.4) keeps refresh tokens separate from the resource owner's credentials.
- Rejected:
  - Generic `createUserAccount`. It runs on the default client, uses an unsalted SHA-256 hash, and syncs the Principal best-effort outside the write.
  - `withGovernedUserAction`. It writes a separate audit row after its callback.
  - `endAccountAgentAccess` as-is. It opens its own `$transaction` and leaves bindings and sessions alone.
  - A seeded role chosen by "size". See the least-privilege section.
  - Injectable allow fixtures on the served path.

## Fence: fail closed, inert until served

Both enrollment and retirement refuse unless every proof holds. The process override outranks installer state in `resolveEnvironmentClassPrecedence` (`lib/install/environment-class-contract.ts:112`). So `DPF_ENVIRONMENT_CLASS`, the host, the Origin, a lease row or the class resolution can never pass the fence alone.

| Proof | Owner | Enrollment and delegation confirmation | Retirement |
| --- | --- | --- | --- |
| Positive non-production installation attestation joined to the exact lease | BI-8EA98961 | required | required, joined to the enrollment receipt's attested installation |
| Actual DB server or cluster and database identity on the write transaction's connection | BI-5C193A3F | required, same transaction | required, same transaction, equal to the receipt's DB identity |
| Lease currency at commit, fenced against remote teardown or replacement | BI-60FC9291 | required at commit | **waived**: retirement must work after the lease ends |
| Production class | resolver | refuse | refuse |

- **The served adapter denies.** `PreviewEnrollmentFence` is wired privately on the server. The served implementation returns `hold: preview_enrollment_fence_unavailable` until all three owners serve their proofs. Allow-capable fakes live only in test files, and nothing imports them from production modules.
- **Refusal happens at the request boundary.** Mutations go through a Route Handler, `POST /api/admin/rehearsal-requester`, not a Server Action, because a Server Action receives already-decoded arguments. The handler runs these checks in order:
  1. production refusal;
  2. session presence;
  3. the fence's readiness check.
  All three run before `request.formData()` or `request.json()`. Tests assert that on refusal the body reader, the password hasher and every mutator are never called. The fence is re-verified inside the write transaction.
- **The page shows the hold.** `/admin/rehearsal-requester` renders the form only when owner binding and fence readiness both verify. Otherwise it shows a read-only hold state with reason codes and no password field. Production returns `notFound()`.

## Owner and record binding

In the fenced serializable transaction, the actor must satisfy every check below:

- **Session and alias.** The session resolves to an active human `Principal` through its unique local `user` alias.
- **Capabilities.** The actor currently holds `manage_users` and `manage_platform`. Both are re-read from the database, not taken from session claims.
- **Account state.** The actor has no automation fields set and no `workHandedOverAt`.
- **Ruling owner.** The actor's Principal equals the Principal named by the **owning record of the custody ruling**.
- **Setup refs.** The reservation (`rulingRef`, `reservationId`), attempt ref and fixture ref are verified read-only against their owning records: the one-shot owner (BI-588688A7) and the fixture-review receipt. Nothing is acquired.

If any evidence is missing, the operation holds. Owner-typed refs are never proof.

**Missing authority (flagged).** On the live item, the custody ruling is recorded as prose on BI-9F7192F9 and BI-588688A7. No governed ruling record attributes it to a Principal that a read seam can resolve. No served reservation or fixture-review adapter exists either. Until both owners serve them, the owner-binding check holds. The ruling itself is not re-asked. Recording it through the governed owner-ruling path is a coordinator action.

## Records (no migration)

**Setup digest.** `setupDigest = sha256(canonicalJson({ schema: "s5-rehearsal-setup.v1", rulingRef, reservationId }))`, the full 64-hex value.

**Email.**
- Format: `rehearsal-<first 16 hex>@s5-rehearsal.invalid`. This is a label only.
- The unique `User.email` constraint prevents a second account. It is never used for lookup.
- A prefix collision with a different setup holds. An email with no matching receipt holds and is never adopted.

**Receipt writer.** One typed, transaction-bound writer, `writeRehearsalReceipt(tx, …)`, inserts one `AuthorizationDecisionLog` row per successful command. It sets these fields:

- `decisionId`: the deterministic value from the table below. The writer never generates random IDs.
- `actorType: "user"`, `actorRef` and `humanContextRef` set to the owner's userId.
- `decision: "allow"`.
- `purposeOfUse: "synthetic-rehearsal-requester"`.
- `objectRef`: the synthetic userId.
- `rationale`: a strict, versioned payload of bounded typed refs and reason codes only. It never holds free text, a password, a hash, a token or personal data.

| Command | `actionKey` | `decisionId` | Payload adds |
| --- | --- | --- | --- |
| Enroll | `s5.rehearsal-requester.enroll` | `s5rr:enroll:<setupDigest>` | rulingRef, reservationId, attemptRef, fixtureRef, userId, principalId, aliasValue, email, installation, lease and DB identity refs, owner Principal |
| Confirm delegation | `s5.rehearsal-requester.delegation-confirm` | `s5rr:delegation:<setupDigest>` | authorityBindingId, bindingId, coworker agentId, oauth client id, resource, sorted allow scopes |
| Retire | `s5.rehearsal-requester.retire` | `s5rr:retire:<setupDigest>` | reason code from a closed enum, revoked binding/token/refresh counts, user and Principal terminal state, DB identity ref |

The three action keys differ from `S5_REHEARSAL_APPROVAL_ACTION`. The approval reader therefore cannot mistake these rows for approval evidence, because it matches its own key and `purposeOfUse`. The security projector, `GET /api/v1/governance/decisions` and the efficacy decision metrics read these rows as ordinary audit data. Their payloads are safe to disclose. Tests check that the metrics either exclude the `s5.rehearsal-requester.*` keys or count them correctly.

## Enrollment

Enrollment runs in one serializable transaction, after the boundary refusal:

1. Run the fence and the owner/record binding checks.
2. Read the existing enrollment receipt by `decisionId`.
3. If a receipt exists:
   - Validate it strictly. The setup tuple, attempt, fixture, namespace, user, alias, active Principal and non-retired state must all agree.
   - On an exact match, return the prior outcome and write nothing. A replay never reads, compares, rehashes or changes the password.
   - A retired receipt returns the terminal status `retired`.
   - A changed attempt or fixture, or a malformed receipt, holds.
4. If the email exists without a receipt, hold.
5. Otherwise, apply the password policy only, then hash with the canonical bcrypt helper.
6. Create the User. It is nonsuperuser, has no automation fields, and gets the least-privilege profile described below.
7. Run `syncUserPrincipal(userId, tx)`.
8. Write the receipt.
9. Commit.
10. Handle conflicts. A unique-constraint conflict or serialization abort ends the transaction. A fresh fenced transaction then re-observes the committed receipt: an exact match is a replay, anything else holds. Any failure rolls back the User, Principal and alias together.

The password travels in only one place: the owner's browser POST body to the boundary handler. It is never logged, echoed, returned or stored except as the bcrypt hash.

## Delegation (second immutable receipt)

The coworker binding does not exist when enrollment commits. The owner signs in to the preview as the synthetic user and consents to the coworker's client through the unchanged `/api/oauth/authorize` flow. Back in `/admin/rehearsal-requester`, the owner then confirms the exact binding. This step runs under the same fence and owner binding, and it is idempotent. It verifies:

- `oauthPurpose: "consent"` and `status: "active"`;
- `oauthUserId` equals the synthetic user;
- `oauthClientId` and `resourceRef` match;
- `appliedAgent` is active, not archived, and carries `work_room_write`;
- the allow scopes are within the bounded set needed for the Workroom.

It then writes the `delegation-confirm` receipt. The confirmation creates no binding, delegation or token. A different binding for the same setup holds. The first receipt stays immutable.

## Least privilege: activation is held, with an open question for the owner

The two candidate paths are:

- **Seeded role.** No seeded role is minimal for this purpose:
  - `HR-200` adds finance and CRM powers.
  - `HR-300` adds architecture and tool-evaluation writes.
  - `HR-000` can manage the platform.
  - `eligibleOAuthCoworkers` (`lib/auth/oauth-identity-binding.ts:21`) admits approved external coworkers only through `view_platform`.
- **Exact delegation.** The alternative is an exact `oauthPurpose: "delegation"` binding for this user, client and resource. No governed writer for such bindings exists today; the eligibility query only reads them.

So enrollment creates the User with **no platform role**. Delegation confirmation and activation **hold**, with `least_privilege_profile_undecided`, until an explicit least-privilege decision is made.

- **The decision must allow:** consenting to the exact coworker, client, resource and scopes, and end-to-end Workroom request authority for that coworker.
- **The decision must prove inability to:** administer users, approve the rehearsal, or hold `manage_platform`.
- **Never** fall back to a broader seeded role or superuser.
- **Open question for the owner:** should a narrow governed delegation-binding writer be added, or a dedicated minimal role? The coordinator takes this to the owner.

## Retirement

Retirement is owner-only and fenced as above, with the lease waived. It runs in one serializable transaction:

1. Bind to the enrollment receipt, and to the delegation receipt if one exists.
2. Revoke every `AuthorityBinding` with `oauthUserId` equal to the synthetic user.
3. Revoke access and refresh tokens with the `personRevocation` stamp. This uses a new transaction-scoped helper extracted from `endAccountAgentAccess`; that function keeps its behavior by calling the helper.
4. Deactivate the identity spine: the Principal's status becomes `inactive` and `User.isActive` becomes `false`. This uses a transaction-scoped body extracted from `deactivatePrincipalAndCredentials` (`lib/identity/authentication.ts:268`). That function opens its own `$transaction` today, and it keeps its behavior by delegating to the new body.
5. Write the `retire` receipt.
6. Read the terminal state back before returning.

A repeat call verifies the terminal state and writes nothing.

**Sessions.** Browser JWT sessions do not re-read account activity (`lib/govern/auth.ts:314`).
- At sign-in, a receipt-bound requester gets a `rehearsalRequester` JWT claim.
- For tokens that carry the claim, the `jwt` callback re-reads `isActive` on every call and ends the session when the account is inactive. No other account pays for a database read.

**In-flight OAuth.** Code exchange and token use already re-check `currentOAuthHuman`. A consent transaction racing retirement is serialized against it, and the binding revocation happens in the retirement transaction itself.

**Reactivation.** The generic lifecycle, reset and recovery actions (`lib/actions/users.ts` `updateUserLifecycle`, `requestPasswordReset`, `adminIssuePasswordReset` and `adminResetUserPassword`) refuse any user that has an enrollment receipt. They return `governed_rehearsal_requester`. Only this surface manages the account, so custody can never be bypassed by a reset link or by reactivation.

Rollback never deletes the User, the Principal or any receipt.

## Read-only verification seam

`readS5RehearsalEnrollment({ rulingRef, reservationId }, tx)` is server-only and uses explicit field projections. It returns:

- the strictly parsed enrollment, delegation and retirement receipts;
- current User facts: isActive, isSuperuser, automation fields, workHandedOverAt and group roleIds;
- the Principal and local `user` alias status;
- the pinned binding ref and that binding's live status, scopes and agent;
- counts of unrevoked access and refresh tokens.

It never selects `passwordHash`, token values or hashes, or session material, and it calls no mutator. The provisioner independently matches these facts against the live reservation. Under BI-1F994B73, a missing, replaced or revoked binding holds.

## UI

The UI follows the theme-aware styling runbook.

- **The `/admin` arrival page stays within budget.** One owner-only link to `/admin/rehearsal-requester` replaces existing words, keeping the 226-word arrival budget, a net word delta of at most 0, and no prose-lint ratchet increase on `page.tsx`. The link renders only when the class is non-production and the viewer is the verified owner.
- **The new route is fenced independently** of `/admin`.
- **Theme and shared components.** Only shared form and status primitives and `var(--dpf-*)` tokens are used, with no hex literals.
- **Ref fields.** They are prefilled from governed evidence when the owner adapters serve it. Otherwise they stay held.

## Ownership boundaries

These are explicitly excluded: `lib/nonprod/preview-runtime-fence.ts`, which can stop containers, and `lib/nonprod/environment-lease-provenance.ts`. Both belong to the lease writer. `lib/workroom-runtime/s5-rehearsal-*` belongs to the S5 producer and owner-read writer. The fence is a port that their served proofs will implement, and the provisioner consumes the read seam.

## Acceptance

- **AC-E1. Fence.**
  - Production, unattested or wrong-DB requests refuse before the body is read, with zero hasher or mutator calls.
  - Retirement refuses without preview and exact-DB proof, but needs no live lease.
  - The served adapter holds.
- **AC-E2. Owner binding.**
  - A non-owner administrator, an automation actor or a handed-over actor refuses.
  - Missing ruling, reservation or fixture evidence holds.
  - Owner-typed refs alone never pass.
- **AC-E3. Replay and receipt.**
  - Exact replay writes nothing and never touches the password.
  - A changed attempt or fixture, a prefix collision, an orphan email or a malformed receipt holds.
  - A concurrent conflict is re-observed.
  - Receipts are typed and safe to disclose.
- **AC-E4. Delegation.** The exact binding is pinned. A missing, replaced, revoked or over-scoped binding holds. No delegation is created.
- **AC-E5. Least privilege.** No role is assigned. Activation holds until the decision. There is no superuser or broad-role fallback.
- **AC-E6. Retirement.**
  - It is atomic and terminal, and a repeat is idempotent.
  - Sessions end and tokens fail.
  - Generic reset and reactivation refuse.
  - Evidence is kept.
- **AC-E7. Seam.** No bearer material is returned and no mutator is called.
- **AC-E8. UI.** The `/admin` budget holds, the hold state is truthful, theme tokens are used, and UX-fit is measured.
