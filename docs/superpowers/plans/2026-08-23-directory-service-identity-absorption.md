# Directory Service Identity Absorption — Implementation Plan

- **Umbrella BI:** `BI-C7362CA5`
- **Epic:** EP-24741BBF
- **Design:** `docs/superpowers/specs/2026-08-23-directory-service-identity-absorption-design.md`
- **Workroom:** WC-94429637

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
