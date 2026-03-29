---
title: "Operations"
area: operations
order: 1
lastUpdated: 2026-03-29
updatedBy: Claude (Software Engineer)
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

## Promotions

The Promotions tab in Operations shows all features that have been through the Build Studio ship phase. Each promotion has a status:

- **Pending** — Feature shipped but not yet reviewed for deployment
- **Approved** — Ready to deploy. Click "Deploy Now" to trigger the autonomous deployment pipeline.
- **Executing** — Deployment in progress. The promoter is building and swapping the application.
- **Deployed** — Successfully deployed to production. Health check passed.
- **Rolled Back** — Deployment failed and was automatically reversed. Check the deployment log for details.

When you click "Deploy Now", the platform starts the promoter service which handles the entire process autonomously. The page updates automatically while deployment is in progress.
