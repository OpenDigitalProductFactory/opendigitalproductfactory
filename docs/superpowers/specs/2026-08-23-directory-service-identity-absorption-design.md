---
status: active
---

# Directory Service — Identity Absorption Design

- **Epic:** EP-24741BBF — Absorb identity into DPF: the Directory Service
- **Workroom:** WC-94429637
- **Status:** active (see frontmatter)
- **Supersedes:** `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md` (see §6)
- **Budget:** ~80% refactor/integration, ~20% new feature — inverting the prior 80/20 feature-first convention (`docs/design/golden-triangle-design.md:654`). This document adopts the inverted allocation and any doc it touches is updated rather than carrying the old wording forward.

---

## 1. Problem Statement

DPF must **be** the directory for an installation. Most installs have no Active Directory, so an identity stack that only federates *outward* — consuming an upstream authority — leaves them with nothing.

The requirement is not new. It was specified in the 2026-04-22 spec and its plan, which scoped "an identity edge for LDAP/OIDC/SAML/SCIM". That plan carries **111 unchecked tasks, zero checked, and zero `BI-` references**. It phased directory protocols last; phases 1–2 were absorbed into other work and phase 3 was never picked up. Because its deliverables lived in Markdown checkboxes rather than live backlog items, phase 3 was never *open* in any system anyone queries.

What makes this urgent now is not the protocol. It is that **GAID and TAK already depend on an identity spine that authentication does not use.** Authorization is `Principal`-rooted; authentication is `User`-rooted. The directory cannot be authoritative for any surface while that split stands.

## 2. Current State — Verified, Not Assumed

Every claim below was checked against the tree at `cf29d511a` on 2026-08-23. **Three premises carried into this epic were wrong**, and the corrections move the work's centre of gravity.

### 2.1 What exists

| Capability | Where | State |
|---|---|---|
| Identity spine | `packages/db/prisma/schema/core-identity.prisma:174` `Principal`, `:250` `PrincipalAlias` | Live. `kind` discriminates class; `sponsorPrincipalId` is a self-relation accountability edge; `sensitivityClearance` is a typed `PrincipalSensitivity[]` |
| Typed aliases | `PrincipalAlias(aliasType, aliasValue, issuer)` unique triple | Live. Types in use: `user`, `agent`, `employee`, `gaid` |
| **GAID** | `apps/web/lib/identity/principal-linking.ts:61` `buildPrivateAgentGaid` | Live. GAID **is a `PrincipalAlias`** — `gaid:priv:dpf.internal:<slug>` |
| GAID actor envelope | `apps/web/lib/tak/gaid-actor-envelope.ts` | Live. Resolves actor → `{principalId, gaid, actorKind, actorRef}`; a coworker without a GAID **cannot act** |
| TAK authorization classes | `apps/web/lib/identity/authorization-classes.ts` | Live. Nine ordered classes (`observe`…`cross-boundary`) derived from grant keys |
| Chain of custody | `apps/web/lib/tak/chain-of-custody.ts`, `mcp-governed-execute.ts:138` | Live. Every agent action joins back to a human origin |
| Human authentication | `packages/db/prisma/schema/core-identity.prisma:8` `User.passwordHash`, `PasswordResetToken`, NextAuth session in `apps/web/lib/govern/auth.ts` | Live |
| Roles / groups | `PlatformRole`, `UserGroup`, `Team`, `TeamMembership` | Live |
| Service accounts | `apps/web/lib/identity/service-account.ts` | **Shared primitive** since Phase 1 (`BI-3181909E`). Was feature-local in `browser-drive`; that module is now a namespace-owning wrapper. An owner-less service account is refused at the module boundary. |
| DN projection | `apps/web/app/(shell)/platform/identity/directory/page.tsx` | Live but **route-local**, hardcoded `dc=dpf,dc=internal` |
| Upstream federation | `apps/web/app/(shell)/platform/identity/federation/page.tsx` | Live. `IntegrationCredential(provider: "ldap"｜"active_directory")` |
| Org PKI | Step CA — `docs/security/tool-evaluations/2026-07-20-step-ca.md` | Live. Machine trust, mTLS |

### 2.2 Corrections to the epic brief

**Correction 1 — a federation surface exists.** The brief stated the only `ldap` string was a keyword list in `integration-benchmarking.ts`. In fact `/platform/identity/federation` configures LDAP and Active Directory upstreams, and `/platform/identity/applications` covers SAML and SCIM-readiness. The surface points *inward* (consuming an upstream), which is the wrong direction for this epic — but it is not absent.

**Correction 2 — service accounts exist.** The brief stated there is "no service-account model of any kind" and that its first child item was "the missing primitive the rest depend on." (That child id, like the epic id, was not present in the live backlog when this design was written — the epic and its children were filed as part of this work. It is deliberately not cited here: a document must not carry an anchor the coordination plane cannot resolve.) In fact `Principal(kind: "service")` is live, and `resolveServiceAccountPrincipal()` provides deterministic find-or-create service principals on the Principal spine — *already the architecture this epic prescribes*. The defect is that it lives inside one consumer (`browser-drive`) as a local convention rather than a platform primitive. That is an AGENTS.md §8 violation (a feature-local helper as the second home of a shared concern), not a greenfield gap. Filed as `refactor`, not `feature`.

**Correction 3 — DPF already authenticates people.** `User.passwordHash` is a non-optional column and the platform runs a credential login with password reset. DPF is *already* the authentication authority for people. The gap is not "can we authenticate" but "is the directory the authority" — see §3.

### 2.3 What is genuinely absent

**A protocol listener.** Nothing binds, searches, or serves LDAP. This is the only truly net-new capability in the epic, and it is the ~20% new-feature half of the budget. Everything else is convergence.

## 3. The Central Finding: DPF Already Has Two Identity Truths

The epic's stated fear is that adopting a third-party IdP would create "a second user store beside `Principal`, breaking principal convergence and creating parallel identity truth."

**That second store already exists, and it is ours.**

```
  AUTHENTICATION ROOT                 AUTHORIZATION ROOT
  ┌───────────────────┐               ┌─────────────────────┐
  │ User              │               │ Principal           │
  │  · passwordHash   │  syncUser     │  · principalId      │
  │  · isSuperuser    │  Principal    │  · kind             │
  │  · email          │ ────────────▶ │  · sponsorPrincipal │
  │                   │   (one-way)   │  · sensitivity      │
  └───────────────────┘               └──────────┬──────────┘
          ▲                                      │
          │                                      │ PrincipalAlias
   govern/auth.ts                                │  user / agent
   NextAuth session                              │  employee / gaid
   ** never reads Principal **                   ▼
                                        GAID envelope → TAK classes
                                        → chain of custody → tool grants
```

Verified: `apps/web/lib/govern/auth.ts` contains **no reference to `Principal`**. `syncUserPrincipal` is a one-way projection from `User` into `Principal`, keyed by `PrincipalAlias(aliasType: "user")`. Authentication decides *who you are* without consulting the spine that decides *what you may do*.

Consequences visible today:

1. **The directory projects the wrong root.** `/platform/identity/directory` counts `Principal.kind` — but a bind must authenticate against `User.passwordHash`. A directory service built on the current split would authenticate against one store and answer searches from another, with a sync function between them. That is precisely the failure mode the epic forbids, reproduced internally.
2. **Authorization can outlive authentication.** A `Principal` persists whether or not the sync has run; `status` on `Principal` mirrors `User.isActive` only at sync time. Deactivation timing is a sync property, not an invariant.
3. **Non-human identities have no authentication story at all.** Agents and service accounts have `Principal` rows and GAIDs, but no `User`, so they can be *authorized* but never *authenticated*. Their trust rests entirely on the calling surface having already established context.

**This reframes the epic.** "Absorb identity" is not primarily about declining to add authentik. It is about **collapsing DPF's own two identity roots into one spine, and then putting a protocol in front of it.** Declining authentik is a consequence of that, not the goal.

## 4. Research and Benchmarking

Per AGENTS.md §7. Facts below were verified on 2026-08-23; licence claims come from the projects' own licence files, not from recollection.

### 4.1 authentik

- **Licence: MIT, with a carve-out.** The repository `LICENSE` states MIT, and explicitly: "All content that resides under the `authentik/enterprise/` directory of this repository, if that directory exists, is licensed under the license defined in `authentik/enterprise/LICENSE`." Website content is CC BY-SA 4.0. **The epic's MIT claim is confirmed.** The Enterprise licence forbids copying, merging, publishing, distributing or selling without a subscription, so that directory is off-limits for absorption — not merely unused.
- Provides OAuth2/OIDC, SAML, LDAP and SCIM in one platform; its LDAP provider serves users and groups from authentik's own database.
- **Pricing, corrected.** The epic asserted that non-human identity accounts are Enterprise-only at $5/user/month. **That is false:** the pricing page states "No cost for service accounts." Enterprise is $5/user/month (annual) plus $0.02/external user/month for *human* seats; Enterprise Plus starts at $20k/year. The LDAP provider carries no Enterprise restriction either. **Adoption is therefore cheaper and more capable than the epic assumed**, and the decision must not rest on a cost argument that does not hold.
- **The LDAP provider is an outpost — a separate container written in Go.** DPF's runtime is TypeScript, so authentik's protocol implementation is not liftable source. What is absorbable is design: object-class mapping, attribute naming, and bind/search semantics.
- **Fit:** as a *runtime*, poor — it is a separate Python/Django service with its own user store, which is the appendage this epic forbids. As a *source of absorbable design*, good: object-class mapping and protocol handling are worth studying, MIT-licensed, and attributable.

### 4.2 Keycloak

- Apache 2.0, Red Hat-backed, the most widely deployed open-source IdP; strong OIDC/SAML.
- Its LDAP capability is oriented toward *federating from* an external directory rather than *being* one.
- **Fit:** poor for this epic. Adopting it is the same appendage problem with a heavier runtime, and it does not deliver the "DPF is the directory" outcome.

### 4.3 389 Directory Server / OpenLDAP

- Mature, standards-complete LDAP servers; the reference implementations for actually *serving* the protocol.
- Both are separate C daemons with their own on-disk data. Using either means DPF's identity truth lives in a second database — the exact failure this epic exists to prevent — plus an operational burden on every install.
- **Fit:** rejected as a runtime. Valuable as the **schema and semantics reference** (object classes, matching rules, DN conventions) that our projection must conform to.

### 4.4 Protocol library availability — a decisive constraint

The question "what do we build the listener on?" turns out to constrain the whole decision:

- **`ldapjs` — MIT, but archived on 2024-05-14 and formally decommissioned.** The maintainer's notice states the project was taken on "when it was languishing without any maintenance" and recommends implementing in Go instead. As of 2026 it is read-only and flagged as not actively maintained.
- **`ldapts`** is maintained and TypeScript-first, but it is a **client**, not a server.
- There is **no maintained Node/TypeScript LDAP *server* library.**

**This is the strongest argument in the entire decision, and it was not anticipated by the epic.** For the runtime DPF actually runs on, "adopt a maintained LDAP server component" is not an available option. Every adoptable server is a separate process in another language. So the choice is not *absorb vs. adopt* — it is *absorb vs. run a second identity process*, and the second option is forbidden by the epic's governing constraint on independent grounds.

### 4.5 What DPF adopts and rejects

| | Decision |
|---|---|
| **Adopt** | LDAP **schema semantics** from the 389-DS/OpenLDAP tradition — standard object classes (`inetOrgPerson`, `groupOfNames`), DN conventions, matching rules. Standards conformance is the point of serving a protocol at all. |
| **Absorb** | Protocol encode/decode and server scaffolding, informed by `ldapjs` (MIT) and authentik's provider (MIT core). Carry attribution for anything derived. |
| **Reject** | Running authentik, Keycloak, 389-DS, or OpenLDAP as a service on any install. |
| **Reject** | Provisioning DPF principals *outward* into a third-party store via SCIM — the 2026-04-22 stance. |

## 5. The Absorb-vs-Adopt Decision

**Decision: absorb. DPF owns the directory implementation in its own source, over its own spine.**

The argument, in order of weight:

1. **Adoption cannot deliver the outcome.** The requirement is that DPF *be* the directory. An adopted IdP with its own user store makes DPF a *source* that provisions into someone else's directory. The install still depends on a second identity system; we would have moved the dependency, not removed it.
2. **A second store re-creates the problem we already have.** §3 shows DPF is already paying the cost of two identity roots internally. Adding a third — with a network hop and a sync protocol between them — compounds a defect we are trying to retire.
3. **There is no adoptable in-process option.** §4.4: no maintained Node LDAP server exists. Adoption necessarily means a separate process.
4. **Data residency.** To be useful, authentik must hold a copy of the install's workforce identities — the 2026-04-22 design provisions them outward via SCIM. That is a second copy of personal data with its own retention, backup and breach surface.
5. **Licence permits absorption cleanly.** authentik core is MIT (verified); `ldapjs` is MIT (verified). Attribution is required and cheap. The Enterprise tier is off-limits and nothing from it is used.

**What this argument deliberately does not claim.** An earlier draft argued that
adoption would mean paying per-seat for non-human identity, capability DPF already
owns. **That was wrong** — service accounts are free in authentik, and so is the
LDAP provider. Adoption is cheaper and more capable than the epic assumed, and it
would deliver working LDAP far sooner than building one. The case for absorbing
does not depend on authentik being expensive or weak, and is not improved by
pretending it is. It rests on points 1–4 above, which are architectural and hold
regardless of price. The full reasoning and correction are on record in the tool
evaluation (§15).

### 5.1 The honest cost

Absorption is not free, and this design does not pretend otherwise:

- **We take on a protocol maintenance tail.** LDAP is old, quirky, and security-sensitive. Owning an implementation means owning its CVEs. The upstream we would absorb from is itself unmaintained — that is *why* absorbing is viable, and also why nobody will fix it for us.
- **Standards conformance is on us.** A non-conformant directory that "works with our tests" but not with real clients is worse than none. §9 makes a real client the acceptance bar.
- **Scope discipline is essential.** LDAP first. SAML, OIDC and SCIM are each their own surface and their own decision; absorbing all four at once is how the 2026-04-22 plan reached 111 tasks and shipped zero.

These costs are accepted because the alternative — a second identity truth on every install — is a structural defect rather than a maintenance cost.

## 6. Stance Reversal

This design **reverses a ratified decision.** The 2026-04-22 spec states at line 383: "DPF should incorporate **authentik** as the identity edge runtime", and at line 674 that DPF should provision workforce users, groups, service accounts and agent principals *into* authentik through SCIM.

That decision was reached with **no tool evaluation on record**. authentik is named across ten documents in this repository and `docs/security/tool-evaluations/` has never contained an entry for it.

The reversal is recorded, not silent, following the precedent of the payroll absorption stance reversal (`c21a81f47`). Two live specs disagreeing about identity would be parallel truth at doctrine altitude — the same defect this epic addresses at data altitude. `BI-5167932D` retires the old stance across all ten documents; `BI-27E462BA` supplies the evaluation this reversal must cite, so that the new decision is not made the same way the old one was.

## 7. Core Architecture — One Spine, Three Classes

### 7.1 Principle

`Principal` is the single identity root. A human employee, an AI coworker, and a service account are **three shapes of one spine**, not three subsystems. Every consumer — session, MCP bearer token, LDAP bind, federation peer — resolves through one path to a `Principal`, and authority is derived from that `Principal` alone.

```
                        ┌──────────────────────────────┐
                        │          Principal           │
                        │  kind: human | agent |       │
                        │        service | ...         │
                        │  sponsorPrincipalId ─────────┼──┐ accountability
                        │  sensitivityClearance[]      │  │ (self-relation)
                        └──────────────┬───────────────┘ ◀┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │ PrincipalAlias (aliasType, value, issuer)
                    │   user · employee · agent · gaid · svc · dn
                    └──────────────────┬──────────────────┘
                                       │
        ┌──────────────┬───────────────┼───────────────┬──────────────┐
        ▼              ▼               ▼               ▼              ▼
   session auth   MCP bearer      LDAP bind      federation      GAID actor
   (govern/auth)   token          (new)          peer            envelope
        │              │               │               │              │
        └──────────────┴───────────────┴───────────────┴──────────────┘
                                       │
                                       ▼
                    effective-auth-context  →  authorization-classes
                    (population, clearance)     (observe…cross-boundary)
                                       │
                                       ▼
                          grants ∩ role capabilities  →  TAK gate
```

### 7.2 The three classes

| | Human employee | Agent identity | Service account |
|---|---|---|---|
| `Principal.kind` | `human` | `agent` | `service` |
| Identifying alias | `user`, `employee` | `agent`, `gaid` | `svc` |
| Authenticates via | password / session, LDAP bind | calling-surface context + GAID | secret or mTLS, LDAP bind |
| Accountable owner | manager via `EmployeeProfile` | sponsor (human origin) | **sponsor — required** |
| Published in directory | `ou=people` | `ou=agents` | `ou=services` |
| Authority derived from | role capabilities | grants ∩ role capabilities | grants ∩ sponsor's ceiling |

**Peer, not equal.** All three resolve through one path and appear in one tree. That does not mean identical authority: a service account's ceiling is bounded by its sponsor's, and an agent cannot act without a GAID (already enforced in `gaid-actor-envelope.ts`).

### 7.3 Convergence of the two roots

This is the ~80% of the work. Sequenced so nothing breaks:

1. **`Principal` becomes the authoritative subject of authentication.** `govern/auth.ts` resolves the session to a `Principal` at login, rather than leaving that to a downstream sync. `User` remains the **credential holder** for humans — it is not deleted — but it stops being an independent identity root.
2. **`User` is reframed as a credential side-table**, in the same relationship `EdgeNode` and `FederationLink` already have to `Principal` (both are documented in the schema as side tables keyed by principal, explicitly to avoid a parallel identity table). This is an established pattern in this codebase, not a new one.
3. **Deactivation becomes an invariant, not a sync outcome.** Disabling a `Principal` disables every credential and every alias bound to it, in one transaction.
4. **Non-human classes gain a real authentication path** — service accounts by secret or mTLS from the org PKI, so that "authorized but never authenticated" ceases to be a category.

**Non-goal:** changing what any role may do. This changes *who attests identity*, not the authorization model. Grants, capabilities and TAK classes are untouched.

## 8. Directory Projection Contract

### 8.1 Derived, never writable

The tree is a **projection of `Principal`**, computed and fingerprinted. There is no write path back through it. LDAP writes (`add`/`modify`/`del`) are **not** implemented in this epic; the directory is authoritative *because* it is derived from the spine, not because it is a second place to edit identity.

### 8.2 DN scheme

Base DN derives from `Organization` — the canonical platform identity model per AGENTS.md §8 — not from a hardcoded constant. The current `const BASE_DN = "dc=dpf,dc=internal"` in a route component is replaced.

```
dc=<org slug>,dc=<org tld>              ← derived from Organization
├── ou=people      → Principal(kind=human),   objectClass inetOrgPerson
├── ou=agents      → Principal(kind=agent),   objectClass inetOrgPerson + dpfAgent
├── ou=services    → Principal(kind=service), objectClass inetOrgPerson + dpfServiceAccount
└── ou=groups      → PlatformRole + Team,     objectClass groupOfNames
```

Standard object classes carry standard attributes so ordinary clients work unmodified. DPF-specific facts ride on auxiliary classes (`dpfAgent`, `dpfServiceAccount`) rather than overloading standard attributes.

A `dn` alias type is added to `PrincipalAlias` so a principal's DN is stable, resolvable in both directions, and survives a display-name change.

### 8.3 Groups

Derived from existing substrate — `PlatformRole` (via `UserGroup`) and `Team` (via `TeamMembership`) — plus the employee hierarchy from `EmployeeProfile`. **No group store is introduced.**

### 8.4 What is deliberately NOT published

An exclusion list is a security control, not an omission. Withheld by default:

| Withheld | Why |
|---|---|
| `passwordHash` and every credential | Never leaves the credential boundary under any bind |
| `sensitivityClearance` | Reveals what a principal may reach; useful to an attacker for target selection |
| `sponsorPrincipalId` chains | Exposes the delegation graph and the human origin behind an agent |
| `AuthorityBinding`, tool grants | Authorization is not directory data — see §10 |
| Non-`public` `PrincipalSensitivity` attributes | Default-deny, matching the existing enum |
| Inactive and retired principals | Absent from the tree, not present-and-flagged |

Publication is **allowlist, not blocklist**: an attribute appears only if explicitly listed. A new column on `Principal` is invisible to the directory until someone decides otherwise. This directly serves the "absence is invisible to every gate" failure class — the allowlist makes addition the deliberate act.

### 8.5 Fingerprinting

The projection carries a content fingerprint so consumers detect change without diffing the tree, and so a stale projection is detectable rather than silently served.

## 9. LDAP Protocol Surface

Scope for this epic: **bind, search, group membership. Over TLS. Read-only.**

- **TLS from the existing org PKI (Step CA).** No second CA, no self-signed fallback — a test asserts the chain.
- **Bind** for all three classes; a service account binds as a first-class peer of a human.
- **Search authorization is mandatory.** What a bind identity may see is filtered by §8.4 and by the binding principal's own clearance. An anonymous or low-privilege bind must not enumerate the tree. A directory that answers every search identically is an information-disclosure surface.
- **Explicitly out of scope:** SAML, OIDC, SCIM, and LDAP write operations. Each is its own surface and its own decision. Attempting all four at once is how the predecessor plan reached 111 tasks and shipped nothing. The exclusions are recorded rather than silent: SCIM as `BI-2C44C3EF`, OIDC as `BI-88363C2C`.

**Acceptance is a real client.** `ldapsearch` binds over TLS and returns correct results for a human, an agent, and a service account, against the running app. Structural verification does not count here — this is a protocol, and only a real client proves conformance.

### 9.1 Serving it — the difference between built and running

`BI-A91004A7` found the gap this section now closes: Phase 3 delivered the protocol, and no install served it. `createLdapServer` was exported and never invoked outside tests. The epic's own verification did not catch it, because all 78 unit tests and all six real-`ldapsearch` runs **start the listener themselves** — a functional test that provisions its own runtime proves the code works, not that the product does.

So the acceptance above is amended: a real client, against the **running install**, on a listener the test did not start.

The serving contract:

- **Off by default, on by explicit choice.** `DPF_LDAP_ENABLED` gates it. An install does not begin serving an identity protocol because it was upgraded.
- **Three states, never silence.** The listener is `disabled`, `listening`, or `refused`, and the operator surface (`/platform/identity/directory`) renders all three. A directory that was turned on and failed must not read the same as one nobody asked for — that equivalence is exactly how a dark capability survives.
- **Refusal never downgrades.** Absent org-PKI key, cert or CA, the listener refuses to start. There is no self-signed fallback, because a directory that quietly downgrades its transport is invisible to every client that trusts it.
- **The tree is built before the port is bound.** If no `Organization` exists there is no base DN, and the listener refuses rather than binding a directory with nothing to publish — a startup misconfiguration must not become a per-client mystery.
- **It reuses the portal's own issued identity.** The organization CA already issues `authority.crt` / `authority.key` / `root_ca.crt` into `DPF_PKI_DIR` (default `$HOME/.dpf/pki`), which sits inside `DPF_STATE_DIR` — already mounted read-only into the portal. No second certificate, no second mount, no second CA.
- **Loopback by default.** The published port binds `127.0.0.1` unless `DPF_LDAP_BIND_ADDRESS` says otherwise, matching the `step-ca` overlay: a directory other hosts can bind to is a deliberate choice.
- **A listener that cannot start does not take the portal with it.** It is reported, loudly, and every other surface keeps serving.

Operator procedure: [serving the directory](../../install/serve-the-directory.md).

**Outcome, measured 2026-08-29 on the canonical runtime.** The amended acceptance
above is met: the running install serves LDAPS on 636 from the organization CA.
Portal log `[ldap] Serving the directory over LDAPS on port 636`; `:::636` bound
in-container; TLS chain verified to the org root (`Verify return code: 0`, issuer
`DPF Organization CA Intermediate CA`); and a real OpenLDAP client received the
bind verifier's own diagnostic, confirming request decode, verifier dispatch,
response encode and client parse end to end. Verified again after a subsequent
self-upgrade, so the capability is carried by configuration rather than by a
hand-held container.

Two things this deliberately does **not** claim. A successful bind returning
published entries was not demonstrated — that needs a credential for a production
principal, and minting one (a client certificate whose CN is a real `principalId`
would do it) manufactures an authentication credential for a real identity, which
is not a verification step. And the disabled case was verified before enabling:
with `DPF_LDAP_ENABLED=0` nothing was bound in-container and a real client could
not connect, so the published port is inert until an operator turns it on.

## 10. Authorization Stays Where It Is

**The directory publishes identity. It does not publish authority.**

Authorization continues to resolve exactly as it does today: `effective-auth-context` → `authorization-classes` → grants ∩ role capabilities → the TAK gate. An LDAP bind establishes *who* a caller is; it grants nothing by itself.

This matters for the reason Mark named — GAID and TAK govern authentication and authorization to every surface and resource — and the way to serve that is *not* to teach the directory about authority. It is to make every surface resolve to the same `Principal`, so that one authority model applies no matter how the caller arrived. Coworker capability filtering is already single-source per AGENTS.md §6; a second authority path expressed as LDAP groups would break that and is rejected.

Consequently: LDAP groups project **organizational** structure (roles, teams, hierarchy). They are not an authorization API, and no code may derive permission from group membership alone.

## 11. Security and Trust Boundaries

- **Credentials never enter the projection** (§8.4), enforced by allowlist.
- **Never weaken auth to make a test pass** — seeded personas at real privilege levels; a blocked check is a finding, not an obstacle.
- **Fail closed.** A bind that cannot be resolved to an active `Principal` is refused. A projection that cannot be verified fresh is not served.
- **An owner-less service account is refusable** — enforced at the module boundary, not in UI validation, with a test proving the refusal and a query proving zero existing orphans.
- **Deactivation is transactional** (§7.3) — disabling a principal disables every bound credential at once.
- **Absorbed source carries its attribution.** MIT notices for anything derived from `ldapjs` or authentik core; nothing from `authentik/enterprise/` is used or consulted.

## 12. Implementation Phases

Each phase is a live backlog item. **No deliverable in this design exists only as a checkbox** — that failure is the reason this epic exists.

| Phase | BI | Deliverable | Depends on |
|---|---|---|---|
| 0 | `BI-27E462BA` | authentik tool evaluation on record | — |
| 1 | `BI-3181909E` | Service accounts as a platform primitive, owner-less refusable | — |
| 2 | `BI-DCE49BA9` | Projection module: DN scheme, object classes, groups, withhold list; absorb decision recorded | 0, 1 |
| 3 | `BI-F7317D65` | LDAP listener: bind, search, groups, over org-PKI TLS | 2 |
| 4 | `BI-CEACBD0D` | Principal becomes the authentication root; install as auth authority | 2 |
| 5 | `BI-5167932D` | Audit 111 tasks, migrate live deliverables, mark 2026-04-22 superseded | 0 |
| 6 | `BI-A91004A7` | Serve it: runtime entrypoint, config, operator surface, org-PKI wiring (§9.1) | 3 |

Phases 1 and 4 are the ~80% convergence. Phase 3 is the ~20% new feature. Phase 6 was not in the original plan; it exists because Phase 3 shipped a listener nobody could reach, and "no deliverable exists only as a checkbox" has to mean running, not merged.

## 13. Design Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Absorb, do not adopt | §5. Adoption cannot deliver "DPF is the directory"; no in-process option exists |
| D2 | `Principal` becomes the single identity root; `User` becomes a credential side-table | §3. Follows the established `EdgeNode`/`FederationLink` side-table pattern |
| D3 | Projection is derived, fingerprinted, read-only | Prevents a second writable identity truth |
| D4 | Attribute publication is allowlist, not blocklist | A new column is invisible until deliberately published |
| D5 | LDAP only; SAML/OIDC/SCIM deferred | Scope discipline; the predecessor plan died of breadth |
| D6 | Groups are organizational, never an authorization API | Keeps capability filtering single-source per §6 |
| D7 | Base DN derives from `Organization` | AGENTS.md §8 canonical identity model |
| D8 | Read-only directory; no LDAP writes | Authority comes from being derived, not from being editable |

## 14a. Open questions resolved by the Phase 2-4 build

**Q1 — service-account bind credential: RESOLVED as mTLS only.** A client
certificate whose subject CN names the same principal binds any class; a
password binds humans only. Agents and service accounts deliberately have no
password, because minting one would be a second credential store and would
re-create the "authorized but never authenticated" gap the epic closes. The
certificate comes from the org PKI already in place.

**Q4 — absorbed protocol provenance: RESOLVED as reimplemented, not vendored.**
The BER codec and LDAP message layer were written against RFC 4511. No authentik
or `ldapjs` source was copied, so **no attribution obligation was incurred** —
the evaluation's condition to carry an MIT notice does not apply because nothing
was derived. The evaluation's other conditions still bind: nothing under
`authentik/enterprise/` was read, the listener is read-only, bind caching cannot
outlive revocation (there is no bind cache at all), and search requires
authorization with bounded results.

**Q2 — the fate of `User`: DEFERRED, and deliberately not forced.** `Principal`
is now the authentication root in behaviour: `govern/auth.ts` consults the spine
and an inactive principal cannot log in. `User` remains the credential holder.
The schema change that would formally demote it to a side table was **not**
needed to make the spine authoritative, and doing it in the same change as three
new capabilities would have coupled the highest-blast-radius migration in the
epic to everything else. It stays open.

**Q3 — multi-organization installs: still deferred.** The base DN derives from
the first `Organization`; a second one would need a decision this build did not
need to make.

## 14. Open Questions

1. **Which credential scheme for service-account binds** — shared secret, or mTLS from the org PKI only? mTLS is stronger and reuses existing substrate, but not every client that needs to bind can present a client certificate. Resolve in `BI-F7317D65`.
2. **Does `User` survive as a table, or fold into `Principal` with a credential side-table?** D2 says side-table; the migration shape needs its own review given `User` carries ~70 relations. This is the highest-risk mechanical change in the epic. Filed as `BI-D070FC77`, deliberately alone: a migration touching ~70 relations cannot be reverted as one clean concern if it rides along with anything else.
3. **Multi-organization installs** — one tree per `Organization`, or one tree with organizational branches? Deferred until a live install needs it; noted so it is not silently assumed away. Filed as `BI-FAF6A01E`, which names the exact assumption site: `buildDirectoryProjection` takes the first `Organization` by `createdAt`.
4. **Absorbed protocol code provenance** — vendored with notice, or reimplemented from the RFC with `ldapjs` as reference only? Legal answer is either; the maintenance answer differs. Resolve in `BI-27E462BA`.

## 15. Relationship to Existing Work

- **Supersedes** the 2026-04-22 enterprise-auth spec and plan (§6).
- **Depends on, is not consumed by,** PR #4474 (installation identity and agent stance) and PR #4555 (zero-touch same-organization federation enrolment). Those solved **machine** trust — install-to-install, certificate-based. This epic solves **human, agent and service** identity. A development companion and its production peer sharing one identity scope without copying credentials is this epic's job; PKI does not deliver it.
- **Evidence:** `docs/security/tool-evaluations/2026-08-23-authentik.md` (`BI-27E462BA`) — the evaluation this reversal cites. It rejects adoption as a runtime and conditionally approves bounded source absorption, and corrects three claims that circulated in DPF documents, including the pricing claim struck from §4.1 and §5 above.
- **Consumed by** TAK/GAID governance (EP-1C37C089) and coworker authority (EP-31815F97), both of which already assume the spine this design makes authoritative.
