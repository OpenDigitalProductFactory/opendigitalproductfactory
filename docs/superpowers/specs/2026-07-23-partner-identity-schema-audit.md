# Partner identity — schema audit and decision

Date: 2026-07-23
Backlog: BI-DE47EC0B (EP-PARTNER-CHANNEL Phase 2)
Driver: BI-53D48861 — local-MSP sell-to/sell-through channel model
Kernel decision: `DI-CD377B58CA99` (principle_decide, external_coding_agent)

## 1. The question the BI posed

> Schema-audit the partner-org account: reuse `CustomerAccount` with an
> `accountKind` discriminator vs a thin `PartnerAccount` carrying
> tier/agreement/margin/deal-registration. **NO parallel partner identity table.**

## 2. What the substrate already says

- `Principal` + `PrincipalAlias` is the convergence spine. `EdgeNode` and
  `FederationLink` are **side tables keyed to a Principal**, not parallel
  identity models (AGENTS §11, 2026-05-09 addendum). The pattern is settled.
- `Principal.kind` and `PrincipalAlias.aliasType` are plain `String` columns —
  adding a `partner` kind and a `partner_contact` alias needs **no migration**.
- `CustomerAccount` already owns the entire commercial spine: invoices, quotes,
  sales orders, subscriptions, opportunities, engagements, activities, sites,
  configuration items, edge nodes, service tickets, MDM dedup fields and merge
  tombstones. A partner needs *these same facts* — partners are invoiced, hold
  subscriptions, and generate deals.
- `PartnerProgramProfile` (Phase 0, BI-DE3FA72C) is a **derived archetype type**
  in `packages/storefront-templates`, not persistence. Nothing was persisted yet.

## 3. Decision

**Reuse `CustomerAccount` as the canonical party row; mark partnership with a
thin `PartnerProgramEnrollment` side table.**

Kernel scoring (composite 9.24 vs 3.15, margin 6.09, confidence high, no
commandment conflict) was led by *Ground New Work In Existing Platform* and
*Architecture Over Shortcuts*. A parallel `PartnerAccount` would fork the
commercial spine and force two rows to be kept in sync for the common case.

### 3.1 Refinement: no exclusive `accountKind` discriminator

The BI offered `accountKind` as the discriminator. The audit rejects that
refinement for a concrete reason: **a local MSP is routinely BOTH a customer
(it buys and runs its own install) and a partner (it resells and operates
installs for local customers).** A single-valued discriminator forces a false
choice and would misreport the flagship channel case.

Instead, **the presence of a live `PartnerProgramEnrollment` IS the partnership
flag** — additive, not exclusive, and exactly how `EdgeNode`/`FederationLink`
mark a Principal's role today.

### 3.2 Principal kind is derived, never asserted

`Principal.kind` is single-valued, so it needs a deterministic rule:

```
kind = partner   if the contact's account has an enrolment that is
                 not `ended` and has no `endedAt`
     = customer  otherwise
```

Exposed as `principalKindForContact()` and enforced inside
`syncPartnerPrincipal()`, which **rejects** a contact whose account has no live
enrolment rather than silently promoting them. This removes the flapping risk of
two callers disagreeing about the same principal's kind.

The `partner_contact` alias sits alongside the shared lowercase `email` alias,
so a person already known as a customer contact **converges onto the same
Principal** and is re-kinded — one identity, never two.

## 4. What shipped in this slice

| Artifact | Purpose |
|---|---|
| `PartnerProgramEnrollment` model + migration `20260723010000_partner_program_enrollment` | partner-only commercial terms (tier, territory, agreement ref, margin, deal-registration flag); 1:1 side table, cascade-deleted with the account |
| `CustomerAccount.partnerEnrollment` relation | the party row stays canonical |
| `syncPartnerPrincipal()` | partner contact → `Principal(kind="partner")` + `partner_contact`/`email` aliases |
| `principalKindForContact()` | the single derivation rule |
| `partner-principal.test.ts` | 16 assertions incl. re-kinding an existing principal, refusing non-enrolled contacts, and ended-enrolment handling |
| `2026-07-23-partner-program-enrollment.data-impact.json` | margin/tier/agreementRef governed as confidential commercial terms |

Migration is **purely additive** — a new empty table plus one FK. No backfill; no
existing account becomes a partner until explicitly enrolled.

## 5. Deliberately deferred

- **Tier semantics and margin policy** — fields exist, meaning stays
  *prepared-not-prescribed* until real local-partner deals shape it (BI-C47A568C).
- **Territory exclusivity** — `territory` is a soft designation, not a grant.
- **Partner login / `/partners` shell** — BI-00E69FBA (next in sequence; it
  consumes the `partner` principal kind this slice establishes).
- **Enrolment admin UX** — no operator surface yet; enrolments are data-level
  until the partner portal lands.
