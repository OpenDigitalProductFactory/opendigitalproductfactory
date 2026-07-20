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
- **Priority** — Items are ranked by priority to make the most important work visible. Priorities can be adjusted as circumstances change.
- **Promotions** — Records of features moving from the Build Studio sandbox to production. Each promotion tracks its status (pending, approved, deployed, rolled back), deployment log, and backup reference.
- **Change Requests (RFCs)** — Formal change records created when features are shipped. RFCs track the type of change (normal, emergency), risk level, and approval chain.
- **Deployment Windows** — Time periods when deployments are allowed. Normal changes respect these windows; emergency changes can override them.
- **Network Demand** — Demand that another approved DPF installation explicitly shared. You can observe or follow it without changing your backlog, or adopt it to create a new locally owned backlog item. The source installation cannot change your local status, priority, estimate, or build state.

## What You Can Do

- View the full delivery backlog and filter by epic, status, priority, or owner
- Create and update backlog items, assign owners, and set due dates
- Group items into epics and track epic-level progress
- Identify and resolve blockers before they stall delivery
- Review and approve promotions for deployment
- Deploy approved promotions with the "Deploy Now" button
- Monitor deployment status in real time (the page polls for updates)
- Review deployment logs and backup references for completed promotions
- Track change requests and their lifecycle (draft, approved, in-progress, completed)
- Review shared demand on Delivery Flow, follow useful signals, and deliberately adopt selected items into your local backlog

## Shared Demand

Delivery Flow shows a **Shared by connected installations** panel above the
local investment and execution flow. It contains only the minimized demand an
approved connection is allowed to project. When nothing has been shared, the
panel keeps a direct path to **Connections** so an operator can review pairing
and demand-sharing policy without interrupting local backlog work.

- **Observe** leaves the item as read-only network context.
- **Follow** records local interest and keeps the item visible as its source
  publishes newer versions or a withdrawal.
- **Adopt into our backlog** creates a separate, locally authoritative backlog
  item with immutable federation provenance. Later peer updates never overwrite
  its local delivery state.

Connection policy and revocation are managed from **Platform > Connections**.
Source installation IDs, source backlog IDs, routing paths, customer-private
context, estimates, priorities, discussions, attachments, and work-capsule
details are not displayed or copied into the shared-demand view.

## Promotions

The Promotions tab in Operations shows all features that have been through the Build Studio ship phase. Each promotion has a status:

- **Pending** — Feature shipped but not yet reviewed for deployment
- **Approved** — Ready to deploy where promotion is enabled. Click "Deploy Now" to trigger the governed deployment pipeline.
- **Executing** — Deployment in progress. The promoter is building and swapping the application.
- **Deployed** — Successfully deployed to production. Health check passed.
- **Rolled Back** — Deployment failed and was automatically reversed. Check the deployment log for details.

When you click "Deploy Now", the platform starts the promoter service for the governed deployment workflow. The page updates automatically while deployment is in progress.

### Promoter timeout

The promoter builds a fresh application image and swaps the running container. That build is bounded by a hard wall-clock budget (default **25 minutes**): if a build step stalls — for example on a slow or degraded network fetch — the promoter is killed, its container is force-removed, and the deployment is marked failed with a retryable `promoter-timeout` diagnosis instead of hanging. A normal deployment completes in a few minutes; the timeout only trips on a genuine stall. Operators on unusually slow hosts can raise it by setting `DPF_PROMOTER_TIMEOUT_MS` (milliseconds) in the environment. A periodic watchdog additionally force-removes any promoter container orphaned by a mid-deployment restart, so a stalled build can never linger and cause an unexpected later swap.
