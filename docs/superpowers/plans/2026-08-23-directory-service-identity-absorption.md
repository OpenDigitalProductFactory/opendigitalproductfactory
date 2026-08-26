---
status: active
---

# Directory Service Identity Absorption — Implementation Plan

- **Umbrella item:** BI-C7362CA5 (xlarge, decomposed)
- **Epic:** EP-24741BBF
- **Design:** `docs/superpowers/specs/2026-08-23-directory-service-identity-absorption-design.md`
- **Workroom:** WC-94429637 (design) · WC-D43197FD (branch binding)

> **Deferred work lives in backlog items, not in this file.** Every independently
> shippable deliverable below is a live `BI-*` with a coverage receipt. This plan
> describes sequence and risk; it is not a task store. The predecessor plan
> (`2026-04-22-enterprise-auth-directory-federation.md`) failed precisely by
> holding 111 unchecked boxes that no queryable system tracked.

---

## Sequencing rationale

The dependency spine is **evidence → primitive → contract → surface**, with the
authentication-root change deliberately late because it is the highest-blast-radius
step and benefits from the projection contract already existing.

```
  Phase 0 ─────────────────────────────┐
  evaluation (BI-27E462BA)             │
                                       ├──▶ Phase 2 ──┬──▶ Phase 3
  Phase 1 ─────────────────────────────┘   projection │    LDAP listener
  service-account primitive                (BI-DCE49BA9)   (BI-F7317D65)
  (BI-3181909E)                                       │
                                                      └──▶ Phase 4
  Phase 0 ────────────────────────────▶ Phase 5            auth root
                                        supersession       (BI-CEACBD0D)
                                        (BI-5167932D)
```

Phases 0 and 1 are independent and may run concurrently. Phase 5 needs only the
evaluation, so it can run alongside 2–4 rather than waiting for the program to finish.

## Phase 0 — Evidence before decision (`BI-27E462BA`)

Produce `docs/security/tool-evaluations/2026-08-23-authentik.md` via the
`tool-evaluation` skill, following the step-ca convention.

Already verified in the design and to be carried in with citations: authentik's
`LICENSE` is MIT with an explicit `authentik/enterprise/` carve-out; `ldapjs` is
MIT but archived 2024-05-14 and decommissioned; `ldapts` is client-only. The
evaluation must confirm these against source rather than restating them, and
resolve **open question 4** — vendor absorbed protocol code with notice, or
reimplement from RFC 4511 using `ldapjs` as reference only.

**Gate:** nothing in later phases may cite the absorb decision until this exists.
Reversing an unevaluated decision with another unevaluated decision repeats the
original error.

## Phase 1 — The service-account primitive (`BI-3181909E`)

Convergence work, no new substrate.

Move service-account identity out of `apps/web/lib/browser-drive/identity.ts`
into `apps/web/lib/identity/`, preserving the deterministic id grammar so existing
rows resolve unchanged. Bind `sponsorPrincipalId` as required-on-create for
`kind="service"` at the module boundary — not in UI validation — so an owner-less
service account is refusable. Repoint `browser-drive` at the shared primitive with
no behaviour change. Repair any existing orphan.

**Risk:** the deterministic grammar (`browser-svc:<site>:<account>`) is load-bearing
for existing rows. A regression test pins it before the move.

**Verification:** unit tests for refusal and grammar stability; a query returning
zero owner-less service principals.

### Delivered (`BI-3181909E`)

`apps/web/lib/identity/service-account.ts` is the shared primitive.
`buildServiceAccountPrincipalId(namespace, segments)` owns the grammar;
`resolveServiceAccountPrincipal()` mints only against a resolved accountable owner
and refuses otherwise; `findOwnerlessServiceAccounts()` is the invariant guard.
`browser-drive/identity.ts` keeps only its namespace (`browser-svc`) and issuer.

Two decisions worth carrying forward:

- **Repair-forward over one-shot backfill.** An account predating the rule gains
  its sponsor the next time it is touched, so the invariant converges rather than
  depending on a migration being exhaustive. The guard query is what proves it.
- **The id grammar is pinned by test, not by convention.** Browser-session
  integration ids embed the whole `browser-svc:<site>:<account>` string, so a
  change orphans existing credentials and bindings. `drive.ts` consumes only the
  id builder and was deliberately left untouched.

**Follow-up, not done here:** `findOwnerlessServiceAccounts()` exists but nothing
runs it on a cadence. Wiring it into a steward sweep so an orphan surfaces without
someone asking is a separate concern — an invariant nobody evaluates is not yet a
guard.

## Phase 2 — The projection contract (`BI-DCE49BA9`)

Extract the DN projection from `apps/web/app/(shell)/platform/identity/directory/page.tsx`
into a shared, tested module. Derive base DN from `Organization`, replacing the
hardcoded `dc=dpf,dc=internal`. Define object classes for all three classes, groups
from `PlatformRole`/`Team`/`EmployeeProfile`, and the **allowlist** of published
attributes with the withhold list from design §8.4. Add the `dn` alias type to
`PrincipalAlias`. Fingerprint the projection. Repoint the admin page at the module.
Record the absorb-vs-adopt decision.

**Risk:** the withhold list is a security control. Getting it wrong leaks the
delegation graph or clearance levels. Allowlist semantics mean a new `Principal`
column is invisible until deliberately published — the failure mode is omission,
not disclosure, which is the correct direction.

**Migration:** adding a `dn` alias type is data, not schema — `PrincipalAlias`
already carries an open `aliasType`. No migration expected; if one proves necessary
it must apply cleanly against any existing data state.

**Verification:** unit tests proving a human, an agent and a service account each
project correctly; a test proving no write path exists back through the projection;
a test per withheld attribute.

## Phase 3 — The protocol surface (`BI-F7317D65`)

The only net-new capability. Bind, search, group membership. Read-only. TLS from
the org PKI (Step CA), no self-signed fallback. Search results filtered by the
binding principal's clearance and the §8.4 allowlist.

Resolve **open question 1** — shared secret or mTLS-only for service-account binds.

**Risk — highest in the program.** We take on a protocol maintenance tail with no
maintained upstream. Mitigations: scope to read-only bind/search only; make a real
client the acceptance bar; treat unauthenticated enumeration as a release blocker.

**Verification is runtime-bound.** `ldapsearch` binds over TLS against the running
app and returns correct results for all three classes. Structural verification does
not count. Runs against the canonical runtime or the shared lease sandbox — never a
hand-built local server.

## Phase 4 — The authentication root (`BI-CEACBD0D`)

The convergence that makes the directory authoritative. `govern/auth.ts` resolves
the session to a `Principal` at login. `User` is reframed as the credential
side-table for humans, following the `EdgeNode`/`FederationLink` pattern already
documented in `core-identity.prisma`. Deactivation becomes transactional across
principal and credentials. Non-human classes gain a real authentication path.
Local-vs-upstream precedence is defined and a conflict surfaces rather than
silently resolving.

**Risk — highest blast radius.** `User` carries roughly 70 relations. Resolve
**open question 2** with its own review before touching the schema: keep `User` as
a side-table (the design's position) rather than folding it, so the relation graph
is preserved and the change is additive.

**Non-goal:** the authorization model is untouched. This changes who attests
identity, not what a role may do.

**Verification:** an install with zero upstream authorities authenticates a human
end-to-end against the running portal; an install with an upstream still works with
tested precedence; no auth check weakened anywhere; seeded personas at real
privilege levels.

## Phase 5 — Retire the superseded stance (`BI-5167932D`)

Audit all 111 tasks in the 2026-04-22 plan and record a disposition for each:
delivered elsewhere, live and migrating here, or obsolete. File live deliverables as
real backlog items. Mark spec and plan superseded with the reversal reasoning, per
the `c21a81f47` precedent. Update the other nine documents naming authentik so none
implies the adopt stance. Update the stated 80/20 allocation wherever touched.

**Verification:** `scripts/check-plan-backlog-coverage.mjs` passes; no document
implies DPF adopts authentik as a runtime service; every one of the 111 tasks has a
recorded disposition.

## Cross-cutting verification

Per the change-impact contract for this branch and AGENTS.md §4:

- Unit tests for affected files per phase.
- `pnpm --filter web build` for any phase touching runtime code (2, 3, 4).
- UX verification on the running app for phases 3 and 4.
- Migration applies cleanly against any existing data state, if any phase adds one.
- `pnpm run pregate:preflight` before push; `pnpm run pregate` for runtime-code
  pushes; `pnpm pr:health` before merge.

## Explicitly out of scope

SAML, OIDC, SCIM, and LDAP write operations. Each is its own surface and its own
decision. Attempting all four at once is how the predecessor plan reached 111 tasks
and shipped nothing.

## Backlog coverage

Decision: `decomposed`. Umbrella: `BI-C7362CA5`. Every independently shippable
deliverable maps to a live backlog item — none is stored as a checkbox.

| Phase | Deliverable | Independently shippable | BI | Depends on |
|---|---|---|---|---|
| 0 | authentik tool evaluation on record | yes | `BI-27E462BA` | — |
| 1 | Service-account primitive, owner-less refusable | yes | `BI-3181909E` | — |
| 2 | Projection contract: DN, object classes, groups, withhold allowlist | yes | `BI-DCE49BA9` | 0, 1 |
| 3 | LDAP listener over org-PKI TLS | yes | `BI-F7317D65` | 2 |
| 4 | Principal becomes the authentication root | yes | `BI-CEACBD0D` | 2 |
| 5 | Supersede the 2026-04-22 plan across 10 documents | yes | `BI-5167932D` | 0 |

**Governed coverage receipt: blocked by `BI-72F368BC`.**

`record_plan_backlog_coverage` (v2) was submitted for this plan from workroom
WC-D43197FD on branch `feat/directory-service-absorption-identity-model-desi`
and refused:

| # | Error | State at submission |
|---|---|---|
| 1 | `plan-artifact-invalid` — "No live workroom for this subject is bound to OpenDigitalProductFactory/opendigitalproductfactory" | workroom created via `create_workroom` + `plan_workroom_worktree`, which leave `repositoryFullName` null |
| 2 | `plan-artifact-invalid` — "…has no recorded head" | branch claimed via `claim_backlog_item_for_work`; capsule bound to the repo but `headSha` unset |
| 3 | `traceability-incomplete` — "BacklogItem BI-C7362CA5 has no initiative scope baseline" | `headSha` synced to `58126dce0` via `adopt_worktree`; plan blob `77e1faf42f` pushed and confirmed on the remote |

Failure 3 is the live blocker and is not surface-specific: per `BI-72F368BC`,
**zero `initiative_scope_baseline` activities exist install-wide**, and the only
writer (`approveInitiativeBaseline`, reachable through `record_initiative_design_review`
gate `spec-approval`) hard-codes `requiresIndependentReviewer: true`. This install
has one human principal, so the author can never be independent of the reviewer and
the baseline can never be written — by any surface, Build Studio included.

Failures 1 and 2 were self-inflicted sequencing and are recorded because the
ordering is not obvious: a workroom must be **repository-bound and head-synced**
before a receipt is attempted, and `create_workroom` alone does neither.

> **Note for whoever fixes `BI-72F368BC`:** the `traceability-incomplete` error text
> instructs the caller to "cite BI-B9403248 for the blocked receipt", but
> `BI-B9403248` was closed 2026-08-21 by PR #4422. The live blocker is
> `BI-72F368BC`. The message should be repointed when the gate is fixed.

Restore the governed receipt on this plan when `BI-72F368BC` ships.
