---
title: "Admin"
area: admin
order: 1
---

## Overview

The Admin area is the control centre for platform configuration. It is where administrators manage users, define access rules, configure branding, and maintain the reference data that underpins other areas. Most settings here apply platform-wide.

## Key Concepts

- **User Management** — Creating, editing, and deactivating user accounts. Each user has a role, optional superuser status, and profile information.
- **Role & Capability Matrix** — The mapping of roles to capabilities. Admins can review the full matrix and understand what each role can and cannot do.
- **Branding Configuration** — The organization's name, logo, colours, and display preferences. Applied across the internal shell and the customer-facing storefront.
- **Reference Data** — Lookup tables and configurable values used throughout the platform (e.g., product categories, status labels, regulation types). Changes here affect all areas.
- **Storefront Admin** — Configuration for the public-facing storefront, including domain routing, archetype selection, and presentation settings.

## What You Can Do

- Create and manage user accounts, set roles, and grant or revoke superuser status
- Review the capability matrix to understand and communicate access rules
- Update branding settings and preview how they appear across the platform
- Maintain reference data tables used by portfolios, compliance, HR, and other areas
- Configure storefront settings including domain routing and public storefront behaviour

## Graph Explorer

Open **Admin > Graph Explorer** to see how the platform is connected. It draws
one graph over four corpora that used to be separate: the source code (files,
symbols, routes, MCP tools, tests), the data model (models and their fields), the
architecture ontology (EA / ArchiMate elements), and discovered infrastructure.

The top of the page is a census — how many things the platform currently knows
about in each of those domains. That count is live, so it also answers "how much
does this install actually understand about itself?".

To explore, type a name, path, or key into **Find a starting point** — a data
model such as `BacklogItem`, a route such as `/admin`, a tool such as
`search_code_graph`. Pick a result and its neighbourhood is drawn. From there:

- **Hops** controls how far out from your starting point the drawing reaches.
- Clicking a node opens **Details**, which shows what it is, its stored
  properties, and how many links it has across the whole graph.
- **Expand from here** adds that node as a second starting point, growing the
  picture instead of replacing it.
- Selecting one or more domain tiles narrows both search and expansion.
- **More filters** exposes the individual node types and link types with their
  counts, for when you want to follow only, say, "Imports".

The corpus is large enough that a view can be clipped; when that happens the page
says so and names the three ways to narrow it. Nothing on this page changes any
data — it is read-only.

## Hive result review

Open **Admin > Hive Contributions** to review result-only contributions received
from trusted reseller channels. The intake record is saved before any GitHub
operation. It may contain a code result, verification evidence, DCO/provenance,
attribution, and a review recommendation; source backlog items, priorities,
estimates, discussions, workrooms, and customer-private context are rejected
before persistence.

Choose **Accept** to approve the result and attempt delivery to the configured
forge, or **Reject** to retain the audit without delivery. A GitHub outage leaves
the accepted contribution intact and shows retry state in the ledger. Use
**Retry forge delivery** after credentials or connectivity recover.

## Scheduled work

Open **Admin > Advanced > Scheduled Jobs** to see everything the platform runs on
a cadence — proactive AI coworker tasks and platform crons together.

The register is split into three lanes, because they are different kinds of thing:

- **Coworker work** — a coworker doing a job on a cadence. Each row names the
  coworker, the route its output lands on, and its last run.
- **Platform crons** — code-defined jobs. Core-locked ones protect platform
  integrity and are read-only.
- **Spent & run-slots** — one-off dispatches that already fired, and run-slot
  claims that were never scheduled work at all. Nothing here runs again;
  **Retire** clears it from the register.

**What needs attention** sits at the top and counts only real problems: a job
that reported an error, and a job that is **overdue** — its next run came and
went. A job that has stopped firing no longer looks healthy.

Two labels are worth knowing:

- **No reporting** — the job runs, but records nothing, so its last run cannot be
  shown. This is normal for most crons and is not a fault.
- **No kill switch** — disabling this job would not stop it, because it never
  reads the enabled flag. The control is withheld rather than shown as a button
  that does nothing.

On a coworker row, the **proactivity** level explains the cadence: a coworker set
to assertive self-drives daily, balanced weekly, and quiet produces no scheduled
work at all. The level is shown next to the coworker, with the cadence it implies
for that coworker's own recurring task. A level marked *inferred* was derived by
the platform from an existing task rather than chosen by you. Tasks that are not
the coworker's own self-task say so, because proactivity does not set their cadence.

**What is going to run** projects the live cadences over the next day, week, or
month. Jobs that fire more often than the chart can usefully plot are listed
below it instead. Click any name to filter the register to it.

Anything in the register can be run on demand with **Run now** — a cron dispatches
immediately, a coworker task is queued for the next dispatcher tick. **Edit**
opens on the cadence the job actually runs at, accepts either a frequency or a
cron expression, and previews the next fire before you save. Coworker work cannot
be scheduled more often than daily.
