---
title: "Operations"
area: operations
order: 1
---

## Overview

Operations is the delivery backlog for the platform. It tracks the work items, epics, priorities, and deployments that make up your team's delivery commitments. It is designed for transparency — blockers are visible, WIP limits are enforced, and progress is always up to date.

## Key Concepts

- **Backlog Items** — Individual units of work with a status, priority, epic, owner, and optional due date. Items move through statuses: open, in-progress, done, deferred.
- **Epics** — Groups of related backlog items that together deliver a meaningful outcome. Epics have their own progress tracking based on the status of their items.
- **Archetype Scope** — Planning metadata that indicates whether work is platform-wide, common across businesses, or specific to an archetype category or leaf archetype. This helps separate market-specific gaps from common finance, workforce, identity, and platform substrate work.
- **Priority** — Items are ranked by priority to make the most important work visible. Priorities can be adjusted as circumstances change.
- **Promotions** — Records of features moving from the Build Studio sandbox to production. Each promotion tracks its status (pending, approved, deployed, rolled back), deployment log, and backup reference.
- **Change Requests (RFCs)** — Formal change records created when features are shipped. RFCs track the type of change (normal, emergency), risk level, and approval chain.
- **Deployment Windows** — Time periods when deployments are allowed. Normal changes respect these windows; emergency changes can override them.

## What You Can Do

- View the full delivery backlog and filter by epic, status, priority, or owner
- Review archetype scope fields in backlog workbook grids when planning roadmap or budget slices
- Create and update backlog items, assign owners, and set due dates
- Group items into epics and track epic-level progress
- Identify and resolve blockers before they stall delivery
- Review and approve promotions for deployment
- Deploy approved promotions with the "Deploy Now" button
- Monitor deployment status in real time (the page polls for updates)
- Review deployment logs and backup references for completed promotions
- Track change requests and their lifecycle (draft, approved, in-progress, completed)

## Shared Demand

Open **Operations > Delivery Flow** (`/ops/demand`) to review demand shared by
approved DPF connections. A shared item is an observation from another
installation, not a local backlog item. You can follow it, offer help, or adopt
it; adoption creates a new locally owned backlog item and never transfers
control of the sender's work.

For installations owned by the same company, an approved
**same organization** connection keeps share-safe platform demand visible in
both directions automatically. This supports separate development and test
systems without merging their databases. Each source item remains authoritative
on its original installation; the other installation receives a versioned
mirror and may follow it or adopt separately owned local work.

Across company boundaries, the sharing path for demand your installation owns
is **end company → distributor → Founder Hub**. Use the item-level controls to
choose one item and an eligible approved destination. An end company sees its
distributor links; a distributor sees its upstream Founder Hub link, identified
by the connected installation's name (for example, Central Founder Hub). Customer-facing
and downstream reseller relationships are never offered as outbound
destinations.

Forwarding is off by default. An end company can allow its selected distributor
to forward the minimized demand to that distributor's Founder Hub for 90 days.
The distributor sees the forwarding action only while that consent is valid,
and the original pseudonymous provenance stays attached. Withdrawal stops the
shared copy from being actionable without deleting the source item.

If a share or response action is unavailable, check the displayed connection
state and consent explanation. Manage the relationship itself under **Platform
> Connections**. See the [federated demand channel runbook](../../operations/federated-demand-channels.md)
for enrollment, revocation, and recovery procedures.

### Founder shared portfolio

On the Founder Hub authority installation, **Delivery Flow** also shows the
Founder shared portfolio when trusted upstream reseller demand exists. Select
one or more unclustered signals, name the review cluster, and create it. Reach
counts distinct originating installations; a direct copy and a reseller-routed
copy of the same origin count once while both routes remain auditable.

Development and test signals are labeled and cannot enter the production
portfolio until an authorized operator selects **Promote to production
portfolio**. Accepting an eligible cluster creates a normal local backlog item;
rejecting it does not create work. The decision is queued back to the sharing
connection and appears under **Founder decisions** on the originating
installation. Local backlogs continue to operate if the Founder Hub or GitHub
is unavailable.

## Promotions

The Promotions tab in Operations shows all features that have been through the Build Studio ship phase. Each promotion has a status:

- **Pending** — Feature shipped but not yet reviewed for deployment
- **Approved** — Ready to deploy where promotion is enabled. Click "Deploy Now" to trigger the governed deployment pipeline.
- **Executing** — Deployment in progress. The promoter is building and swapping the application.
- **Deployed** — Successfully deployed to production. Health check passed.
- **Rolled Back** — Deployment failed and was automatically reversed. Check the deployment log for details.

When you click "Deploy Now", the platform starts the promoter service for the governed deployment workflow. The page updates automatically while deployment is in progress.

To upgrade the platform itself — building a fresh application image and swapping the running install — see [Self-Upgrade](./self-upgrade.md).

### Promoter timeout

The promoter builds a fresh application image and swaps the running container. That build is bounded by a hard wall-clock budget (default **25 minutes**): if a build step stalls — for example on a slow or degraded network fetch — the promoter is killed, its container is force-removed, and the deployment is marked failed with a retryable `promoter-timeout` diagnosis instead of hanging. A normal deployment completes in a few minutes; the timeout only trips on a genuine stall. Operators on unusually slow hosts can raise it by setting `DPF_PROMOTER_TIMEOUT_MS` (milliseconds) in the environment. A periodic watchdog additionally force-removes any promoter container orphaned by a mid-deployment restart, so a stalled build can never linger and cause an unexpected later swap.
