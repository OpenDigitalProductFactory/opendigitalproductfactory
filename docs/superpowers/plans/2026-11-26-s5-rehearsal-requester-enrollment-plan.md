---
status: draft
---

# Plan: owner-operated enrollment of the S5 rehearsal requester

Backlog item BI-9F7192F9, Workroom WC-4EBA473D. Design: `docs/superpowers/specs/2026-11-26-s5-rehearsal-requester-enrollment-design.md`. Shape: delivery-small. Every mutation ships inert behind the denying fence.

## Preconditions (hold Red until all are met)

- P1. The independent re-review approves the committed design and this plan.
- P2. The coordinator clears overlap for the extra files listed below, and they are claimed through `claim_workroom_scope`.
- P3. `find_related_tests` is resolved for every changed path. The Next.js route-handler and server-action request-decoding behavior is confirmed from `apps/web/node_modules/next/dist/docs/`, as `apps/web/AGENTS.md` requires.
- P4. Tests use only the dev DB or throwaway PostgreSQL containers with synthetic data, never `dpf-postgres-1`. No package-wide typecheck runs while `/tmp/dpf2-local-ci.lock` exists. The lock is read only.

## Phases

Each phase runs tests first. The tests must fail for the stated reason before any implementation is written.

1. **Boundary and fence (AC-E1).**
   - Port: `PreviewEnrollmentFence`. The served adapter denies; it is an allow fake in tests only.
   - Route Handler: production refusal and the fence readiness check run before any body is read.
   - Tests:
     - The body reader, the bcrypt hasher and every mutator are spied, and each is called zero times on refusal.
     - The process-override class alone never passes.
     - Retirement waives only the lease proof.
2. **Owner and record binding (AC-E2).**
   - Owner resolution in the transaction: active human Principal through the local alias, live `manage_users` and `manage_platform`, no automation and no handover.
   - Ports for the custody-ruling owner, the one-shot reservation (BI-588688A7) and the fixture-review receipt. The served adapters hold.
   - Refusal tests:
     - A non-owner administrator.
     - An automation actor.
     - A handed-over actor.
     - Owner-typed refs without owner evidence.
3. **Receipt and enrollment (AC-E3, AC-E5).**
   - The canonical setup digest.
   - The typed transaction-bound receipt writer, with three action keys and deterministic `decisionId`s.
   - The serializable enroll transaction: no role, bcrypt via `lib/govern/password.ts`, and `syncUserPrincipal(userId, tx)`.
   - Tests:
     - Exact replay performs no writes and makes no hasher call.
     - A changed attempt or fixture holds.
     - A forced 16-hex prefix collision holds.
     - An orphan email holds.
     - A malformed receipt holds.
     - A concurrent conflict is re-observed.
     - Rollback is atomic when the alias or receipt write fails.
     - The rationale is allowlisted only.
     - The S5 approval reader rejects these rows.
     - The security projector, the governance decisions API and the efficacy metrics handle the new keys.
4. **Delegation confirmation (AC-E4).**
   - A fenced, idempotent confirmation of the exact consent binding.
   - Tests:
     - A missing, replaced, revoked, over-scoped or wrong-agent binding holds.
     - An agent without `work_room_write` holds.
     - The confirmation creates no delegation or token.
     - With the least-privilege profile undecided, the result is the hold `least_privilege_profile_undecided`.
5. **Retirement (AC-E6).**
   - Extract transaction-scoped token revocation from `endAccountAgentAccess`, reusing `personRevocation`.
   - Extract transaction-scoped spine deactivation from `deactivatePrincipalAndCredentials`.
   - The atomic retire transaction, with terminal readback.
   - The `rehearsalRequester` JWT claim and its activity re-check.
   - Refusals in the generic lifecycle, reset and recovery actions.
   - Tests:
     - Retirement works without a live lease.
     - A repeat writes nothing.
     - The session ends.
     - The token and refresh paths fail after retirement.
     - Reset and reactivation refuse.
     - The existing behaviour of `endAccountAgentAccess` and `deactivatePrincipalAndCredentials` is unchanged; their current tests still pass.
6. **Read seam (AC-E7).**
   - `readS5RehearsalEnrollment`.
   - Tests:
     - The projection never includes `passwordHash`, token, hash or session fields.
     - A mutator spy records zero calls.
     - Missing, replaced or revoked bindings are reported.
7. **UI (AC-E8).**
   - The `/admin/rehearsal-requester` route and panel, built from the shared form and status primitives with `var(--dpf-*)` tokens only.
   - On `/admin`, one owner-only link replaces existing words.
   - The hold state shows reason codes and no password field.
   - Production returns `notFound()`.
   - Component tests:
     - The link and the form are hidden unless the owner and the fence both verify.

## Gates and evidence (before handoff)

- **Focused unit and component tests** for all changed paths. Run the web package typecheck only when the DPF2 lock is absent.
- **Guards:**
  - `pnpm run check:prose-lint:test`
  - `pnpm run check:prose-lint`
  - `node scripts/check-style-drift.mjs`
- **The `/admin` arrival budget is measured:** at most 226 words, a net delta of at most 0, and no `page.tsx` prose-ratchet growth.
- **UX-fit evidence:** `docs/ux-fit/<date>-rehearsal-requester.ux-fit.json` (sweep-measurement).
- **Docs Impact:** update `docs/user-guide/admin/index.md`.
- **Derived artifacts** regenerate and are checked: doc-index, doc-impact, route-manifest, route-audience, route-shells and page-purpose.
- **Commit trailers:** `Design-Grounding-Decision:` and DCO `Signed-off-by` on every commit.
- **The coordinator's explicit go is needed** before any `pnpm run pregate:preflight`, `pnpm run pregate`, push or `pnpm land`. An independent review on a different model happens before each gate.

## Files

Already claimed:
- `apps/web/lib/identity/s5-rehearsal-enrollment.server.ts` and `.test.ts`. These hold the core, the ports, the receipt writer and the read seam.
- `apps/web/lib/actions/s5-rehearsal-enrollment.ts`. Only read-side server helpers live here; all mutations go through the Route Handler.
- `apps/web/components/admin/S5RehearsalEnrollmentPanel.tsx` and `.test.tsx`.
- `apps/web/app/(shell)/admin/page.tsx`: the single owner-only link.
- `apps/web/lib/actions/users.ts`: export the policy only, plus the governed-requester refusals in lifecycle, reset and recovery.
- This design and plan.

Extra files (**not yet claimed**; the coordinator checks overlap first):
- `apps/web/app/(shell)/admin/rehearsal-requester/page.tsx` (new route).
- `apps/web/app/api/admin/rehearsal-requester/route.ts` and `route.test.ts` (request-boundary mutations).
- `apps/web/lib/auth/account-agent-access.ts` and its test (transaction-scoped revocation extraction).
- `apps/web/lib/identity/authentication.ts` and its test (transaction-scoped spine deactivation extraction).
- `apps/web/lib/govern/auth.ts` and its test (the `rehearsalRequester` claim and activity re-check).
- Possibly:
  - `apps/web/lib/gpp/efficacy/efficacy-measures-store.ts`, if the metrics must exclude the new keys.
  - `apps/web/lib/security/internal-projector.ts` and `apps/web/app/api/v1/governance/decisions/route.ts`, for tests only unless a defect is found.
- `docs/user-guide/admin/index.md`.
- `docs/ux-fit/<date>-rehearsal-requester.ux-fit.json`.
- Generated artifacts:
  - `apps/web/lib/docs/doc-index.generated.json`
  - `apps/web/lib/docs/doc-impact.generated.json`
  - `apps/web/lib/ea/route-manifest.json`
  - `apps/web/lib/navigation/route-audience.generated.json`
  - `apps/web/lib/ux-budget/route-shells.generated.json`
  - `apps/web/lib/ux-budget/route-purpose.generated.json`

Excluded and owned elsewhere:
- `apps/web/lib/nonprod/preview-runtime-fence.ts` and `apps/web/lib/nonprod/environment-lease-provenance.ts` belong to the lease writer.
- `apps/web/lib/workroom-runtime/s5-rehearsal-*` belongs to the S5 producer and owner-read writer.

## Coverage

Every deliverable above maps to BI-9F7192F9. The served proofs it depends on, but does not deliver, are:

- BI-8EA98961: installation attestation.
- BI-5C193A3F: DB identity.
- BI-60FC9291: lease currency.
- BI-588688A7: the one-shot reservation, the fixture-review owner, and a governed record of the custody ruling.
- An owner decision on the least-privilege profile.

Until those land, the delivered code holds.
