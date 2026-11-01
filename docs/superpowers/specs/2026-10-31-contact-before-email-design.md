# Capture a known contact before an email is available

Status: proposed; BI-9D3928A5, Workroom WC-014C5FF3. No runtime change or
acceptance is claimed. Source investigation uses main
`adbea8f20f601e8e7d49693a1043c521b6d6c60d`.

## Problem and existing ownership

An owner knows a prospect's or partner's name and relationship before knowing
their email. Today both Add contact and `create_customer_contact` reject that
person. Account notes preserve prose but cannot provide contact identity,
relationships or an add-email-later operation.

Reuse `CustomerContact`, `ContactAccountRole`, the account timeline, the MDM
write-time gate and the existing customer contact API/actions/tool. This extends
[the MDM design](2026-07-04-mdm-write-time-dedup-and-lifecycle-design.md), whose
email-identity assumptions must be amended with the implementation. It does not
replace Principal convergence or create another person model. The live item
belongs to structured contact epic EP-2005CE3B.

Current evidence:

- `packages/db/prisma/schema/crm-commerce.prisma`: required unique email,
  stable contact id, optional name/phone/source, credential and merge fields.
- `apps/web/lib/actions/customer-contacts.ts`: required email, email-only exact
  lookup, unused `notes` input, best-effort timeline; update supports phone/title
  but cannot add email. A duplicate selected by id currently has no account check.
- `apps/web/lib/mdm/dedup-gate.ts`: names already match within an account and
  optional phone/email have shared normalization. Candidate labels/details still
  assume non-null email. Reuse this gate; absence must never match absence.
- `apps/web/lib/mcp/packs/crm-contacts-pack.ts` and
  `apps/web/components/customer/AddContactButton.tsx`: require email; neither
  exposes provenance or an add-email-later operation.
- `apps/web/app/api/v1/customer/contacts/route.ts`: separate contact creation
  path requiring the same compatibility audit. A source search finds 65 TS/TSX
  files referencing the contact model; a form-only edit cannot qualify this work.

## Research and alternatives

Primary sources inspected 2026-10-31:

| Source | Observed pattern | DPF adoption and boundary |
| --- | --- | --- |
| [vCard RFC6350 section6.4.2](https://www.rfc-editor.org/rfc/rfc6350.html#section-6.4.2) | EMAIL has cardinality `*`, allowing a contact with no email property. | Adopt the distinction between a person and an optional communication address. This does not make a record an authenticated user or authorize sending. |
| [Odoo19 partner model](https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/models/res_partner.py) | `res.partner.email` is a non-required character field; partner identity is a separate record. | Keep the existing DPF contact id when an address is added. Do not import Odoo's entire partner abstraction or remove DPF's existing uniqueness protection. |
| [Frappe contact schema](https://github.com/frappe/frappe/blob/develop/frappe/contacts/doctype/contact/contact.json) | Contact has its own record, optional email child table and optional linked user. | Keep contact capture separate from portal account activation. Reuse DPF's present single email field; multi-address tables and user provisioning are outside this repair. |

Options: (A) keep required email and notes-only capture fails the stated outcome;
(B) placeholder email corrupts identity and risks misdelivery; (C) a second
provisional-person table duplicates identity and requires a later merge;
(D) allow null email on the existing contact while keeping strict channel and
identity boundaries meets the outcome with the existing substrate. Choose D.
No new authentication capability, external integration or access is needed.

## Intended contract

**OBJ-CONTACT:** Save a real named account-linked contact and provenance without
inventing an address; retain the same id and history when email is added.

**OBJ-SAFE:** Missing email never creates a sendable recipient, portal credential
or automatic identity merge; existing addressed contacts remain compatible.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-CAPTURE | OBJ-CONTACT | UI, coworker tool and API save a named contact without email, linked to the correct account with relationship/provenance visible after reload. |
| AC-CHANNEL | OBJ-SAFE | Contact reads say Email not added; email, invitation and email-login paths reject an absent address under their existing permissions. No fabricated address, empty recipient or null identity lookup is possible. |
| AC-ADD | OBJ-CONTACT, OBJ-SAFE | The owner adds a valid available email to the same contact id; account linkage, activities, role history and other fields are preserved and change provenance is recorded. |
| AC-DUPLICATE | OBJ-CONTACT, OBJ-SAFE | Same-account name/phone candidates prompt an explicit same/different-person choice; blank emails never match; a conflicting real email cannot overwrite or silently merge another identity. Cross-account records are not disclosed or adopted without the existing relationship authority. |
| AC-COMPAT | OBJ-SAFE | Existing contacts, sign-in, invites, imports, merges, notifications and API clients retain their addressed-contact behavior; migration preserves all rows and unique non-null email protection. |
| AC-AUTHORITY | OBJ-SAFE | Anonymous callers, customer/partner portal callers and employees without operate_customer cannot create, select duplicates or add email through direct actions, REST or coworker tools. Authorized employee operations remain within the target account and never return cross-account duplicate details. |
| AC-PRINCIPAL | OBJ-CONTACT, OBJ-SAFE | A no-email contact has only stable contact-id aliases and an inactive Principal; adding an email cannot adopt or re-kind another customer, partner or workforce Principal. Contact, primary account role, provenance and alias writes commit together or roll back. |

Store unknown email as SQL NULL, not an empty string. Preserve the current
non-null unique constraint semantics for known addresses; normalize and validate
addresses through existing owning validators. Do not introduce a verification
status that falsely asserts ownership of an address supplied by an employee.

Keep `CustomerContact.id` and all foreign keys. Capture source/provenance using
existing `source` plus a contact-linked account Activity, including the supplied
relationship context. Contact creation and required provenance must commit
atomically; a swallowed timeline error is not sufficient acceptance. Do not hide
required identity state in optional JSON or account notes alone.

### Server authority and account association

The present create/update actions have no authorization preamble; REST only
authenticates, and the coworker handler ignores its user argument. They are not
safe boundaries to inherit. Reuse the shared server-action capability guard for
`operate_customer`, REST's returned capabilities/effective auth context, and the
governed coworker grant/capability intersection. Derive actor identity from those
authenticated contexts, never caller-supplied account authority or a boolean.

This CRM mutation is for an authorized employee acting on an existing account;
customer/partner portal identities cannot use it to create or change another
person. Enforce the actor's effective population/capability and target account
association before duplicate reads as well as writes. The selected contact must
belong to the target account or already have a valid authorized account role;
an email found on an unrelated account is a non-disclosing conflict. A missing
or unresolvable actor fails closed. Keep a shared authenticated domain operation
for UI/API/tool adapters rather than wrapping a service-only coworker call in a
browser-cookie requirement. No new capability or broadened access is introduced.

Create the primary `ContactAccountRole` in the same transaction as the contact
and required provenance for every entry point, matching the current REST
invariant. A no-email create requires a meaningful name. Existing REST email-only
creation remains valid when a usable email is supplied.

### Principal identity and adding email

Extend existing customer/partner Principal synchronization for absent email:
resolve or create by stable `customer_contact`/`partner_contact` id aliases only,
use the real contact name for display, omit an email alias entirely, and keep
the no-email Principal inactive. Neither an empty alias nor a shared null lookup
is permitted. This preserves the single existing Principal model without making
the record a portal user or issuing a credential/session.

The new add-email operation is strictly null-to-valid-email on the same contact
id. Existing addressed or credentialed contacts retain their established
address-change workflow; this operation cannot replace/clear their address.
Inside the same contact/role/provenance transaction, first resolve the existing
id-bound Principal. Before adding the normalized email alias, check all existing
Principal alias owners, not only CustomerContact.email. If it belongs to any
different Principal, return a non-disclosing identity conflict and roll back;
do not call the broad email-first upsert that could adopt/re-kind an employee or
another customer/partner. An alias already on the same Principal is compatible.
Unique database constraints are the concurrency backstop, and conflicts roll
back all contact/provenance/alias changes. Customer and partner sync must use
the same rules for this transition. General Principal merges remain in their
existing separately authorized workflow. Name equality never merges identity.

Storing email grants no credential or new role. Any later session eligibility
continues to require the existing account lifecycle and credential checks.

UI: Email (optional), helper text You can add it later, and a visible Email not
added state with an Add email action on the existing contact. Omit mailto/send
controls without a usable address. Duplicate results offer both a scoped
same-person selection and a different-person confirmation; the existing UI's
different-person-only button is insufficient. The coworker reports saved contact id,
account and missing-email state and offers the next useful capture step without
inventing a recipient or demanding mailbox access.

## Migration and verification sequence

1. Before product edits, enumerate nullable-email consumers, account-scope/auth
   boundaries, Principal synchronization and canonical validators; resolve current workroom sensitivity and
   obtain whatever data/architecture/UX gates its actual admission requires.
2. Write failing behavior tests for no-email create, provenance persistence,
   add-email to the same id, name-only duplicates, conflicting email/concurrent
   updates, anonymous/direct-action/API/tool mutation refusal, customer/partner
   cross-account refusal, missing employee capability, customer/partner/workforce
   alias collisions, transaction rollback and absent-recipient/login refusal.
3. Make the existing schema email nullable while retaining unique non-null email.
   Generate/apply the forward migration through the governed test target. It
   relaxes requiredness and must not rewrite existing emails or remove rows.
   Prove multiple NULL rows and conflicting non-null addresses on real PostgreSQL.
4. Amend shared action/API/tool/dedup/read models and all affected consumers;
   keep auth and outbound operations strict. Run affected tests and both web
   typechecks against the generated nullable client, not an older shared client.
5. Exercise the native owner UI and coworker on an authorized governed target:
   create, reload, find same/different person, add email, reload history. Capture
   genuine measured UX and independent source review. No external send is needed.
6. Publish the coherent compatibility change via a DCO ready PR and protected
   queue. Advance only through the canonical update, then verify the same served
   workflow. Source tests alone do not establish business acceptance.

These steps form one compatible delivery: admitting null data without updating
its readers/auth boundaries is not independently safe to ship. No product code,
migration, source test or served scenario has been run by this design-only work.
The initial worktree was source-only. A subsequent managed dependency bootstrap
reported compile-ready; that is dependency readiness, not a product test result.
