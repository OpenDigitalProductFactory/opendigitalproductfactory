---
status: draft
---

# Plan: owner-operated enrollment of the S5 rehearsal requester

Backlog item BI-9F7192F9, Workroom WC-4EBA473D. Design: `docs/superpowers/specs/2026-11-26-s5-rehearsal-requester-enrollment-design.md`, revision 3. Shape: delivery-small. Every mutation ships inert behind the denying fence. Activation stays held pending the owner's least-privilege decision.

## Preconditions (hold Red until all are met)

- **P1.** The independent re-review approves the committed revision.
- **P2.** Every extra path in the files list below is cleared by the coordinator for overlap, then claimed through `claim_workroom_scope` on the normal path, never forced.
- **P3. Test impact and framework behaviour are confirmed.**
  - `find_related_tests` has resolved every changed path.
  - Next.js 16.4.6 dispatch has been re-verified from `apps/web/node_modules/next`: Route Handlers receive the undecoded `Request`, and Server Actions run `decodeReply` before invocation.
  - The API route has been confirmed outside the UX sweep once it carries `@exposure authenticated`.
- **P4. The test environment is safe.**
  - No DPF2 quiet window is open, as relayed by the coordinator.
  - `/tmp/dpf2-local-ci.lock` is absent. It is read only.
  - Tests use only throwaway PostgreSQL containers or the dev DB, with synthetic data, never `dpf-postgres-1`.

## Phases

Each phase is test-first. A Red test must fail for the stated reason before any implementation is written.

### 1. Marker and audit writer (AC-E3, AC-E8)

Build:
- The `setupDigest` canonical serialization.
- `isGovernedRequester`, which fails closed.
- The `s5-rehearsal-requester` and `s5-rehearsal-retired` alias writers.
- The typed, transaction-bound audit writer, with four action keys and deterministic `decisionId`s.
- The M-4 exclusion in `efficacy-measures-store.ts`.

Tests:
- The marker is unique per setup.
- A missing, malformed or unavailable marker is reported as an error, never as "ordinary".
- An expired audit row changes no lifecycle outcome.
- The approval reader rejects these rows.
- The projector and governance API handle the rows (tests only).
- M-4 excludes the keys.

### 2. Boundary and fence (AC-E1)

Build:
- `PreviewEnrollmentFence`, with a denying served adapter and allow fakes only in tests.
- Separate readiness paths for enrollment and retirement. The retirement path has no lease input.
- A Route Handler at `api/admin/rehearsal-requester/[command]` with `@exposure authenticated`. Before reading the body it checks, in order: production, same-origin, session class, server-owned command and setup binding, readiness, and a pre-body owner and exact-DB transaction.
- A bounded form body: at most 4 KiB, a strict schema, and at most 72 password bytes.

Tests: refusal from cross-origin, a non-owner, the wrong DB, an unbound setup, production, or an oversized or over-72-byte body. Spies on the body reader, the hasher and every mutator each record zero calls.

### 3. Owner binding (AC-E2)

Build:
- Owner resolution through the local alias, live capabilities, no automation, no handover, and the caller is not a requester.
- Ports for the custody-ruling record, the one-shot reservation and the fixture review. Their served adapters hold.

Tests: refusal from a non-owner administrator, an automation actor, a handed-over actor, a requester, and owner-typed references with no evidence.

### 4. Enrollment (AC-E3, AC-E4)

Build:
- The serializable create:
  - The User is created inactive and roleless.
  - The Principal is set inactive.
  - The password goes through the shared policy module and is bcrypt-hashed.
  - `syncUserPrincipal(userId, tx)` runs in the same transaction.
  - The marker and the audit row are written in the same transaction.

Tests:
- Exact replay makes no writes and never calls the hasher.
- A changed attempt or fixture holds.
- A forced prefix collision holds.
- An orphan email holds.
- A malformed record holds.
- A conflict is re-observed.
- Atomic rollback when the alias or audit write fails.
- The created User and Principal remain inactive.

### 5. Retirement and the issuance lock (AC-E7)

Build:
- Extract transaction-scoped helpers:
  - `account-agent-access.ts`: revocation, reusing `personRevocation`.
  - `authentication.ts`: spine deactivation.
- Behaviour of the existing exports is unchanged, and their tests still pass.
- The per-requester advisory transaction lock, taken in retirement and in the authorize consent POST, code exchange and refresh. The marker is read first; ordinary users take no lock.
- A check that the Principal owns exactly one account, before deactivation.
- Terminal readback.
- Guards in `updateUserLifecycle`, `addUserPlatformRole`, `adminResetUserPassword`, `adminIssuePasswordReset`, `completePasswordReset` and `requestPasswordReset`, which keeps its neutral response.

Tests:
- Both commit orders against real PostgreSQL in a throwaway container.
- Retirement with no lease.
- A repeat call writes nothing.
- A Principal with multiple accounts holds.
- An old reset token is refused.
- An expired audit row changes nothing.

### 6. Restricted session and activation hold (AC-E5, AC-E4)

Build:
- The `identityClass` stamp at workforce sign-in, failing closed against the marker.
- The `jwt` callback classifies any unclassified legacy token once, ends the session if it cannot, and re-reads the User and Principal for requester tokens.
- The mobile login refuses requesters.
- `proxy.ts` and `authenticateRequest` deny requester sessions except on authorize consent and sign-out.
- The activation command holds with `least_privilege_profile_undecided`.

Tests:
- A valid claimless cookie across upgrade.
- Rollback is documented and requires retirement first.
- Requester sessions get 403 on `/api/v1/workspace/activity`, on `/api/v1/work-queue/[itemId]/complete` and on portal pages.
- An inactive Principal ends the session.

### 7. Delegation confirmation (AC-E6)

Build:
- Fenced, idempotent pinning of the exact consent binding.
- Issuance and bearer resolution for requesters require a live pin.

Tests:
- A missing, replaced, revoked, over-scoped or wrong-agent binding holds.
- An agent without `work_room_write` holds.
- No delegation or token is created.
- An unconfirmed binding cannot reach S5 work.

### 8. Read seam (AC-E8)

Build: `readS5RehearsalEnrollment`.

Tests:
- The projection excludes `passwordHash`, tokens and their hashes, and session fields.
- No mutator is called.
- An expired audit row is reported as `audit-expired`.

### 9. UI (AC-E9)

Build:
- The `/admin/rehearsal-requester` page and panel, using the shared form and status primitives and `var(--dpf-*)` tokens only.
- On `/admin`, one owner-only link that replaces existing words.
- A ratified purpose contract with its index entry.
- Regenerate route-manifest, route-shells, route-audience, page-purpose and doc-index, and update the eligible-route count.

Tests:
- The link and the form are hidden unless both the owner and the fence verify.
- The hold state shows no password field.
- Production returns `notFound()`.

## Gates and evidence (before handoff)

- **Tests:** focused unit, component and route tests. The PostgreSQL race tests run only in throwaway containers.
- **Typecheck:** the web package typecheck runs only when no DPF2 window is open and the lock is absent.
- **Guards:**
  - `pnpm run check:prose-lint:test`
  - `pnpm run check:prose-lint`
  - `node scripts/check-style-drift.mjs`
  - the endpoint-classification check, with the baseline unchanged
- **Budgets:**
  - `/admin`: at most 226 arrival words, a net delta of at most 0, and no `page.tsx` ratchet growth.
  - The new route meets the absolute shell budgets.
  - `governance/decisions/route.ts` ratchet (textMass 4) is unchanged; that file gets tests only.
- **UX-fit:** `docs/ux-fit/2026-11-26-rehearsal-requester.ux-fit.json`, as a sweep measurement.
- **Docs impact:**
  - Update `docs/user-guide/admin/index.md`.
  - For `docs/strategy/2026-09-us-dependency-inventory-and-sovereign-channel.md`, record a not-affected disposition unless the `govern/auth.ts` change alters what that doc describes.
- **Derived artifacts:** regenerate only where their inputs change:
  - doc-index
  - doc-impact
  - route-manifest
  - route-audience
  - route-shells
  - page-purpose
  - architecture-counts
  - doc-diagrams
- **Commits:** a `Design-Grounding-Decision:` trailer and a DCO `Signed-off-by` on every commit.
- **Coordinator go:** needed before `pregate:preflight`, `pregate`, any push or `pnpm land`. An independent review on a different model runs before each gate.

## Files

### Claimed (29)

- The core, actions, panel and tests:
  - `lib/identity/s5-rehearsal-enrollment.server{,.test}.ts`
  - `lib/actions/s5-rehearsal-enrollment.ts`
  - `components/admin/S5RehearsalEnrollmentPanel{,.test}.tsx`
- Admin pages and the route:
  - `app/(shell)/admin/page.tsx`
  - `app/(shell)/admin/rehearsal-requester/page.tsx`
  - `app/api/admin/rehearsal-requester/route{,.test}.ts`. This becomes `[command]/route{,.test}.ts`, a new path that needs a re-claim.
- Shared identity, auth and audit code:
  - `lib/actions/users.ts`
  - `lib/auth/account-agent-access{,.test}.ts`
  - `lib/identity/authentication{,.test}.ts`
  - `lib/govern/auth{,.test}.ts`
  - `lib/gpp/efficacy/efficacy-measures-store.ts`
  - `lib/security/internal-projector.ts`, tests only
  - `app/api/v1/governance/decisions/route.ts`, tests only
- Docs and UX evidence:
  - `docs/user-guide/admin/index.md`
  - the UX-fit JSON
  - this spec and plan
- The six generated route and doc files.

### Extra paths not yet claimed (coordinator clears overlap first)

Within families already cleared:
- `apps/web/app/api/admin/rehearsal-requester/[command]/route.ts` and `route.test.ts`, replacing the claimed flat route path.
- `apps/web/lib/ux-budget/ux-budget.test.ts`, for the eligible-route count.
- `docs/architecture/architecture-counts.generated.md` and the doc-diagram outputs, only if their inputs change.
- `docs/strategy/2026-09-us-dependency-inventory-and-sovereign-channel.md`, only if the disposition is "updated".

Outside the cleared families, to report before claiming:
- **Shared modules:**
  - `apps/web/lib/identity/password-policy.ts`, a new shared, non-"use server" policy module.
  - `apps/web/lib/ux-budget/purpose-contracts/rehearsal-requester.ts`, new.
  - `apps/web/lib/ux-budget/purpose-contracts/index.ts`.
- **Issuance and session paths:**
  - `apps/web/app/api/oauth/authorize/route.ts` and `route.test.ts`: the consent lock and requester-session allowance.
  - `apps/web/lib/auth/oauth-tokens.ts` and a new `oauth-tokens.requester-lock.test.ts`: the exchange and refresh lock and the pin requirement.
  - `apps/web/app/api/v1/auth/login/route.ts`: refuse requesters.
  - `apps/web/proxy.ts` and `proxy.test.ts`: requester route denial.
  - `apps/web/lib/api/auth-middleware.ts` and a new `auth-middleware.test.ts`: requester API denial.
- **Tests on existing files:**
  - `apps/web/lib/actions/users.test.ts`: lifecycle, role, reset and recovery guards.
  - `apps/web/lib/gpp/efficacy/efficacy-measures.test.ts`: M-4 exclusion.
  - New `apps/web/lib/security/internal-projector.test.ts` and `apps/web/app/api/v1/governance/decisions/route.test.ts`: audit consumers.
  - `apps/web/lib/govern/auth-cookie-isolation.test.ts`, if session-class tests belong there.

### Excluded (owned elsewhere)

- `apps/web/lib/nonprod/preview-runtime-fence.ts`
- `apps/web/lib/nonprod/environment-lease-provenance.ts`
- `apps/web/lib/workroom-runtime/s5-rehearsal-*`

## Coverage

Every deliverable maps to BI-9F7192F9. The delivered code holds until the following land; this item depends on them but does not deliver them:

| Dependency | Owner |
| --- | --- |
| Installation attestation | BI-8EA98961 |
| DB identity | BI-5C193A3F |
| Lease currency | BI-60FC9291 |
| One-shot reservation and fixture-review owners | BI-588688A7 |
| Governed record of the custody ruling | Coordinator, through owner-ruling capture |
| Least-privilege profile decision | Owner |
