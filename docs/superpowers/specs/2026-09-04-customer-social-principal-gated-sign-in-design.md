---
status: review-ready
---

# Principal-gated customer and social sign-in design

**Backlog:** BI-E22C3D75  
**Epic:** EP-413F2602  
**Umbrella:** `docs/superpowers/specs/2026-08-30-security-authentication-hardening-successors-design.md` §8

## Problem and boundary

Workforce password login verifies its credential and then calls `authorizePrincipalForSession`; customer password and Google/Apple paths currently return a `CustomerContact`-rooted session without the same Principal decision. Signup also creates the account/contact first and runs `syncCustomerPrincipal` as best-effort afterward. The defect is authorization-before-identity asymmetry at the session boundary, not a missing identity model.

DPF keeps one Principal spine. `CustomerContact` remains the customer-domain credential/profile holder and account-scoping record, `SocialIdentity` remains the provider assertion link, and `PrincipalAlias` binds those records to the authority root. This design adds no identity table or session authorization cache.

## Research and benchmarking

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability) makes issuer plus `sub` the stable end-user identifier and warns that claims such as email must not be used as unique identifiers. DPF adopts provider plus provider-account id as the social identity key and rejects email-only identity selection.
- [Keycloak identity brokering](https://www.keycloak.org/docs/latest/server_admin/#_identity_broker) links an external provider identity to a local realm identity before issuing the application-facing token and supports explicit first-login/linking flows. DPF adopts that local-identity-before-session ordering, while rejecting Keycloak as a second identity or authorization system because Principal already owns that role.
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) requires session management to bind authentication to access control. DPF applies that binding at the Auth.js issuance boundary: a verified credential or assertion remains insufficient until the Principal authority decision passes.

## Objectives

**OBJ-PRI-001:** Resolve or materialize the canonical Principal and alias before customer password or social session issuance.

**OBJ-PRI-002:** Apply active, conflict, tenant/account, and authentication-authority checks consistently across password, social, linking, onboarding, and deactivation flows.

**OBJ-PRI-003:** Preserve customer/contact domain semantics while eliminating authorization-before-identity asymmetry.

## Design

- Introduce one population-aware, credential-neutral sign-in authorization seam. Password comparison and provider assertion validation remain at their existing boundaries; the seam then resolves or materializes exactly one Principal, checks active/contact/account/conflict state, and returns the canonical Principal id with the existing customer scope projection or a stable refusal.
- Resolve customer and partner contacts through their canonical `customer_contact` or `partner_contact` alias. Materialization delegates to the existing shared linker; it never creates a second identity path.
- Key social identities by provider plus immutable provider subject. A verified email may enter the existing guarded linking flow, but cannot select an identity by itself. Ambiguous or conflicting aliases refuse rather than choose.
- Create onboarding contact, Principal, aliases, and social link in one transaction before any session or continuation capable of becoming a session is issued.
- Make credential-holder and Principal deactivation one transaction/invariant. Effective auth continues loading by canonical Principal identity and derives customer/account scope from the contact relationship.
- Repair existing populated installs with a forward-only, idempotent, set-based migration. Preserve an existing unambiguous Principal; refuse ambiguous email convergence. The repeatable invariant check pages or aggregates rather than loading an unbounded contact inventory.

## Data architecture, scale, and blast radius

The normalized homes remain `Principal` for authority, `PrincipalAlias` for identity bindings, `CustomerContact` for customer scope/profile/credential state, `SocialIdentity` for provider subject linkage, and effective-auth context for request authorization. No denormalized authority state is copied into JWT claims beyond the canonical Principal identifier needed to reload current authority.

Sign-in performs indexed point lookups by contact id or provider identity and then by alias. The only whole-population work is the one-time set-based migration and a bounded invariant report. Higher-volume identity reconciliation remains owned by EP-24741BBF.

The blast radius is limited to the shared identity authentication/linker modules, customer and social Auth.js callbacks, customer/social onboarding and linking actions, session projection, customer-contact lifecycle writes that can create a session-capable credential, and one additive forward migration. Workforce credential verification, role/capability policy, LDAP, PKI, and social-provider secret custody do not change.

## Acceptance contract

| Acceptance | Objective | Statement |
|---|---|---|
| AC-PRI-001 | OBJ-PRI-001 | No customer password or social session is issued before an active canonical Principal authorizes it. |
| AC-PRI-002 | OBJ-PRI-002 | Inactive, unresolved, and conflicted principals fail consistently across all sign-in/link paths. |
| AC-PRI-003 | OBJ-PRI-002 | Onboarding and deactivation cannot leave a session-capable split state. |
| AC-PRI-004 | OBJ-PRI-003 | Existing customer account/contact scoping is preserved and derived from the Principal-rooted context. |

## Failure and rollback

Missing or ambiguous aliases, an inactive contact/account/Principal, and authority conflict fail closed with stable internal refusal codes and generic user-facing authentication failure. Rollback removes the issuance gate while leaving additive Principal and alias rows intact; ambiguous identities must be repaired before the gate is re-enabled. A rollback must not reactivate a Principal or restore a stale session.
