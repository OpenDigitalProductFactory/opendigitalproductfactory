---
status: draft
Backlog: BI-4B5E3443
Profile: feature
Author: Mark Bodman
Plan: docs/superpowers/plans/2026-09-08-onboarding-ownership-implementation.md
Date: 2026-09-08
---

# Onboarding Ownership — Design

## 1. Outcome

Standing the platform up for an archetype ends with every accountable role that
archetype's work shapes name bound to a real principal — a person or a coworker —
so the first Workroom created has an owner with authority and can execute. An
install that cannot bind a role says so, names the role, and refuses to report
itself ready.

Ownership is established once, at setup, as a step in creating the workforce:
create the employees, then assign them their roles. It is not deferred to the
moment a room is claimed, and it is not left to whoever notices a stalled room
weeks later.

### 1.1 Objectives and acceptance criteria

**OBJ-ONB-ROLES-DERIVED:** The set of roles an install must bind is derived from
the archetype's own work shapes, never from a hand-maintained list that drifts
away from them.

**OBJ-ONB-BIND-AT-SETUP:** Every derived role is bound to a principal during
setup, in the same step that creates the workforce, before any work exists.

**OBJ-ONB-IMPORT-ASSISTED:** An installer who does not personally know the
organisation's people can propose them from a spreadsheet or from a published
public source, and confirms each proposal before a person record is created.

**OBJ-ONB-READY-REFUSES:** An install holding an unbound role cannot report
itself ready, and names the unbound roles where the installer is already looking.

**OBJ-ONB-OWNER-FROM-DAY-ZERO:** The first Workroom created after setup resolves
an owner with a valid authority binding, and its first drive cycle advances.

| AC | Objective | Statement |
| --- | --- | --- |
| AC-ONB-DERIVED-INVENTORY | OBJ-ONB-ROLES-DERIVED | The role inventory for an archetype is computed from the union of `role:*` accountable principals across the shapes registered for it; adding a shape that names a new role adds that role to the inventory with no other edit. |
| AC-ONB-SETUP-STEP | OBJ-ONB-BIND-AT-SETUP | Business setup presents the derived inventory after employees are created, and each role is bound to a person or a coworker in that step. |
| AC-ONB-SPREADSHEET | OBJ-ONB-IMPORT-ASSISTED | A spreadsheet of people is mapped to columns, proposed as candidate person records, and created only for the rows the installer confirms. |
| AC-ONB-PUBLIC-SOURCE | OBJ-ONB-IMPORT-ASSISTED | A published public-officials or leadership page is fetched, proposed as candidates carrying the source URL and retrieval date, and created only for the entries the installer confirms. |
| AC-ONB-READINESS-REFUSAL | OBJ-ONB-READY-REFUSES | Install verification reports not-ready while any derived role is unbound, naming each unbound role and the shapes that need it. |
| AC-ONB-FIRST-ROOM-EXECUTES | OBJ-ONB-OWNER-FROM-DAY-ZERO | On a freshly set-up install, a claimed Workroom reports exactly one Process Overseer with a coordination binding, and its first drive cycle advances rather than pausing or escalating. |
| AC-ONB-UNBOUND-VISIBLE | OBJ-ONB-READY-REFUSES | The portal shows the unbound roles and offers binding, so the condition is repairable without an out-of-band identifier. |

## 2. Why this is missing today

`resolveRoomOwner` already descends three rungs: an explicit appointment, the
shape's own driver, then `archetypePrincipalRef` — "the archetype's default owner
for rooms of this kind, when declared". The third rung is the right hook and
nothing populates it. Grep finds no reference to a process overseer anywhere in
the seed or in install verification.

The consequence was measured on the reference install (BI-71F441A4). Forty-three
live Workrooms, none executing. Every room refused on
`missing_explicit_coordinator` on every drive cycle. Appointing an owner by hand
moved the refusal one step to `coordinator_authority_binding_ineligible`, because
`planCoordinationBindings` seeds a binding only for shapes in the standing
registry and only when the driver resolves to an `agent:` reference. The delivery
shapes name roles, so no binding is ever seeded and no AI overseer is ever
eligible. The install reported healthy throughout.

Three separate mechanisms therefore have to agree at setup: the role exists, a
principal holds it, and that principal carries the authority to coordinate. Any
one of them missing produces the same silent stall.

## 3. Contract

### 3.1 The role inventory is derived

An archetype's role inventory is the union of `accountablePrincipalRef` values of
the form `role:<name>` across every work shape registered for that archetype,
excluding stages that advance by governed decision — those name approvers, not
drivers, and binding them as coordinator trips `coordinator_approver_overlap`.

Deriving rather than listing is the point. A shape that introduces
`role:post-implementation-reviewer` adds that role to what the install must bind,
and no separate registry has to be remembered.

### 3.2 Binding happens where the workforce is created

Setup already creates employees. Immediately after that, and before any work can
be claimed, the installer is shown the derived inventory with each role and the
shapes that need it. Each role is bound to exactly one principal:

- a person created in this setup, or
- a coworker whose profession matches the role, offered as the default, or
- explicitly left unbound, which is recorded as a named gap rather than silence.

A binding writes the archetype's default owner for rooms of that kind. That is
the ladder's third rung, and it is what makes a room born owned.

### 3.3 Authority is seeded with the binding

Binding a role to an AI coworker seeds the coordination binding for every shape
that names the role, across the full shape registry rather than only the standing
one. Binding a role to a person seeds no AI authority and is not an error: a
person-driven room waits for that person, which is correct and now visible.

An install that binds every role but seeds no coordination bindings is not ready.
The two are recorded together or not at all.

### 3.4 Proposing people the installer does not know

The person setting up the platform often does not know the organisation's people
by name. Two assisted paths feed the same confirmation step:

**Spreadsheet.** A CSV or workbook is uploaded, columns are mapped to name, role,
contact and reporting line, and each row becomes a proposed person. Nothing is
created until the installer confirms the rows.

**Published public source.** For organisations whose leadership is a matter of
public record — public officials, boards, a corporate leadership page — a URL is
fetched and parsed into proposed people carrying the source URL and the retrieval
date on each proposal. These are proposals to a person who can judge them, never
silent creation, because a page can be stale, ambiguous, or wrong about who holds
a role today.

Both paths are bounded deliberately. Only publicly published pages are read, never
anything behind authentication. Only the fields the role binding needs are kept:
name, the role or title that justified the proposal, and the source. The platform
does not assemble a broader profile of a person because a page happened to carry
it. Every created record cites where it came from, so a wrong binding can be
traced and corrected rather than argued about.

### 3.5 Readiness refuses rather than reports healthy

Install verification adds an ownership check. While any derived role is unbound,
or any bound AI role lacks its coordination binding, the install reports
not-ready and names each gap with the shapes that need it. This is the change that
converts a silent forty-three-room stall into a loud failure at hour zero.

The check is also the reconciliation path for an install that predates this
design: it enumerates the same gaps on an existing install, and binding them
clears the stall without touching the rooms.

## 4. Enforcement

| Rule | Where |
| --- | --- |
| The inventory is derived from shapes, not listed | role-inventory derivation, unit tested against a shape that introduces a new role |
| Every derived role is bound before setup completes | business setup step; setup cannot be marked complete with an unbound role |
| An AI binding seeds coordination authority for every shape naming that role | binding write, in the same transaction as the binding |
| Imported people are proposals until confirmed | import surfaces return candidates; only a confirm action creates person records |
| An install with an unbound role is not ready | install verification, and the portal surface that reports readiness |

## 5. Read model and UX

The setup step lists roles, not principals: the reader is answering "who does this
job here", one row at a time, with the shapes that need it as the reason. A role
bound to a coworker reads as a coworker, not as a grant.

The unbound set appears wherever readiness is reported, with the same wording as
the readiness refusal, and offers binding in place. An operator repairing a
stalled install should never need a raw principal identifier, and should never
have to leave the page that told them something was wrong.

## 6. Scale, security, and rollback

Deriving the inventory is a pure function over the registered shapes and runs in
memory. Binding writes one row per role plus one coordination binding per shape
that names it.

Public-source import reads only published pages, keeps only the fields the binding
needs, and records provenance on every proposal. No credential is ever supplied to
fetch a page. A proposal the installer does not confirm leaves no record.

Rollback is per binding: a binding is a visible row and revoking it returns the
role to unbound, which the readiness check then reports. Nothing about this design
deletes a person or a coworker.

## 7. Acceptance

Acceptance is the AC table in section 1.1, verified on a live install: a fresh
archetype setup binds every derived role, install verification refuses while one
is unbound, and the first Workroom claimed afterwards resolves an owner with
authority and advances on its first drive cycle.
