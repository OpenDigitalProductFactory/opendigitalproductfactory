---
status: active
---

# Person-to-organization membership (BI-1B4AB42A)

Design and scope manifest for BI-1B4AB42A, under epic EP-0237A305. It implements
R2 of the [knowledge linking design](2026-10-14-knowledge-linking-design.md) §2:
a person reads as the organization they belong to, taken from their session, and
never as `prisma.organization.findFirst()`. It closes the "from the session" half
of AC-KLB-6 on BI-4EAFF7AC.

## 1. Problem

Nothing in the data model says which organization a person belongs to. On an
install that holds several organizations, such as an MSP estate, a reader can
therefore only be shown no organization at all, or a guessed one. A guess shows
one customer's pages to another, which R4 forbids.

The wiki reader shipped in #6699 bridges this with
`resolveReaderOrganizationId` (`apps/web/lib/wiki/reader-organization.ts`). It
answers only when the install holds exactly one organization and fails closed
otherwise. Two wiki actions still pick `prisma.organization.findFirst()`:
`apps/web/lib/actions/wiki-edit.ts` and `apps/web/lib/actions/wiki-publish.ts`.

## 2. Substrate verification (origin/main 2026-10-28)

- `User` has no organization relation. `EmployeeProfile` carries `userId` but no
  organization.
- `Team` / `TeamMembership` join a person to a team, and a team has no
  organization.
- `Principal.accountableForOrganizations` records who answers for an
  organization (`Organization.topAccountablePrincipalId`). That is
  accountability, one person per organization, and grants no capability.
- `apps/web/lib/federation/organization-membership.ts` is the enrolment of an
  installation in an organization's federation. It is not about people.
- Only two models carry both `userId` and `organizationId`: `WikiIngestEvent`
  and `PlatformSetupProgress`. Neither is membership.
- Live backlog: BI-FAF6A01E (directory base DNs per organization) is adjacent
  and does not cover membership.

The substrate is absent, so a new relation is justified.

## 3. Design

### 3.1 The relation keys on Principal

The core principle `principal-convergence` says authorization resolves on
`Principal`, and aliases (`user`, `employee`, …) are the entry points. Which
organization a person reads as is an authorization fact, so membership joins
`Principal` to `Organization`, not `User` to `Organization`. The session reaches
it through the existing `user` alias
(`resolveActiveHumanPrincipalRecordIdForUser`).

```prisma
/// @dpf lifecycle=operational retention=domain sensitivity=internal categories=identity,authorization owner=platform-owner steward=data-steward
model PrincipalOrganizationMembership {
  id             String       @id @default(cuid())
  principalId    String
  organizationId String
  isPrimary      Boolean      @default(false)
  source         String       // "sole-organization" | "operator"
  createdAt      DateTime     @default(now())
  principal      Principal    @relation(fields: [principalId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([principalId, organizationId])
  @@index([organizationId])
}
```

- The name avoids "organization membership", which already means federation
  enrolment of an installation.
- `@@unique([principalId, organizationId])` also serves lookups by principal.
- A partial unique index allows at most one primary membership per principal:
  `CREATE UNIQUE INDEX … ON "PrincipalOrganizationMembership"("principalId") WHERE "isPrimary"`.
- `source` is a closed string union in TypeScript (`MEMBERSHIP_SOURCES`). It
  records how a row arose, so an operator can tell a migrated row from a
  deliberate one.
- Rows live and die with the principal and the organization (`retention=domain`).

### 3.2 One session resolver

`resolveSessionOrganizationId(userId)` in
`apps/web/lib/identity/organization-membership.ts`:

1. It finds the active human principal for the user. If there is none, it runs
   `syncUserPrincipal`, the existing self-heal used by documents and federation
   actions. An inactive user resolves to null.
2. With exactly one membership, it returns that organization.
3. With several, it returns the primary one. With several and no primary, it
   returns null.
4. With no membership, it returns null, whatever the install holds. It never
   counts organizations and never picks the oldest.

`resolveReaderOrganizationId` keeps its name and module, so callers do not
churn. It takes the session's user id and delegates to this resolver, and its
single-organization fallback is removed. Null still means "no organization pages".

### 3.3 Sole-organization enrolment

Single-organization installs keep today's behaviour by holding real rows, not by
a read-time fallback.

- **Migration.** When exactly one organization exists, every active human
  principal with a `user` alias becomes a primary member of it
  (`source = 'sole-organization'`). With zero or several organizations, it adds
  no rows.
- **Ongoing.** `ensureSoleOrganizationMembership(principalId)` runs at the same
  rule when a human principal is synced (`syncUserPrincipal`,
  `syncEmployeePrincipal`) and when setup creates the first organization
  (`setup-entities.ts`). It is idempotent and adds nothing once a second
  organization exists.

This is a write-time rule over a count that the operator can see, and every
row it writes is visible and removable. It differs from the read-time "oldest
organization" default, which silently chose for the reader on every request.
Once an install holds a second organization, a new person belongs to no
organization until someone assigns them.

### 3.4 Readers and writers moved onto the resolver

- The wiki route `app/(shell)/coworker-decisions/[...slug]/page.tsx` reads the
  session (`auth()`) and passes the user id.
- `saveWikiOverlayEdit` (`wiki-edit.ts`) and `publishWikiOverlayPages`
  (`wiki-publish.ts`) write to the session's organization. With none, they
  refuse with a clear error instead of writing to the first organization.

The other `prisma.organization.findFirst()` callers across the web app
(about 130, for example marketing's oldest-first `lib/marketing/org-scope.ts`)
are follow-up work, filed as their own item. This item gives them the seam to
move onto.

### 3.5 Out of scope

- An admin screen or MCP tool to assign people to organizations on a
  multi-organization install. Until one exists, `addOrganizationMember` is the
  library entry point and multi-organization installs fail closed.
- A session organization switcher for a person in several organizations.
- Coworker (agent) organization context, which comes from the coworker's
  record (R2, second half).

## 4. Objectives and acceptance

**OBJ-POM-1:** A signed-in person reads organization-scoped records only for an organization they belong to, resolved from their session.

**OBJ-POM-2:** No read or write path on the wiki surfaces picks an organization the person does not belong to.

**OBJ-POM-3:** Single-organization installs keep today's behaviour through real membership rows.

| Acceptance | Objectives | Statement |
|------------|------------|-----------|
| AC-POM-1 | OBJ-POM-1 | With two organizations, a reader who is a member of one sees only that organization's wiki backlinks and overlay pages, and the route's organization comes from the session user's membership. |
| AC-POM-2 | OBJ-POM-1 | A person with no membership resolves to no organization on any install, including one that holds exactly one organization. A person with several memberships resolves to the primary one, or to none without a primary. |
| AC-POM-3 | OBJ-POM-2 | `resolveReaderOrganizationId` resolves from the session and has no single-organization fallback; `saveWikiOverlayEdit` and `publishWikiOverlayPages` write only to the session's organization and refuse without one. |
| AC-POM-4 | OBJ-POM-3 | The migration makes every active human principal a primary member of the only organization when exactly one exists, and adds no rows otherwise; principal sync and first-organization setup apply the same rule. |
| AC-POM-5 | OBJ-POM-3 | On the dev install after upgrade, the signed-in admin's wiki page shows organization overlay backlinks, resolved from the admin's membership row. |

## 5. Verification

- Unit tests for the resolver, sole-organization enrolment and the migration's
  rule; route and action tests with a stubbed session.
- The migration applies on the governed runtime.
- Live check on the dev install after release (AC-POM-5).
