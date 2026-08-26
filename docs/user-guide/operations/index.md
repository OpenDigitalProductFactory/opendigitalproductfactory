---
title: "Operations"
area: operations
order: 1
---

## Overview

Operations is the delivery backlog for the platform. It tracks the work items, epics, priorities, and deployments that make up your team's delivery commitments. It is designed for transparency — blockers are visible, WIP limits are enforced, and progress is always up to date.

## Workroom Inventory

Open **Operations > Workrooms** (`/ops/workrooms`) for one operational inventory across business work, coworker activity, and development. **Live now** requires current execution evidence such as a valid lease, an open pull request, or recent activity. **History and cleanup** retains terminal, expired, stalled, and cleanup-eligible records without counting them as active. Select a Workroom to open its canonical activity case; open **Architecture > Workrooms** when you need the reusable definition instead of the instance history.

## Key Concepts

- **Backlog Items** — Individual units of work with a status, priority, epic, and owner. Items move through triaging, open, in-progress, done, deferred, or retired.
- **Epics** — Groups of related backlog items that together deliver a meaningful outcome. The list shows the item mix by status and calculates progress from items marked done only.
- **Archetype Scope** — Planning metadata that indicates whether work is platform-wide, common across businesses, or specific to an archetype category or leaf archetype. This helps separate market-specific gaps from common finance, workforce, identity, and platform substrate work.
- **Priority** — Items are ranked by priority to make the most important work visible. Priorities can be adjusted as circumstances change.
- **Promotions** — Records of features moving from the Build Studio sandbox to production. Each promotion tracks its status (pending, approved, deployed, rolled back), deployment log, and backup reference.
- **Change Requests (RFCs)** — Formal change records created when features are shipped. RFCs track the type of change (normal, emergency), risk level, and approval chain.
- **Deployment Windows** — Time periods when deployments are allowed. Normal changes respect these windows; emergency changes can override them.

## What You Can Do

- View the full delivery backlog and filter by epic, status, priority, or owner
- Review archetype scope fields in backlog workbook grids when planning roadmap or budget slices
- Create and update backlog items and assign owners
- Group items into epics and track epic-level progress
- Identify and resolve blockers before they stall delivery
- Review and approve promotions for deployment
- Deploy approved promotions with the "Deploy Now" button
- Monitor deployment status in real time (the page polls for updates)
- Review deployment logs and backup references for completed promotions
- Track change requests and their lifecycle (draft, approved, in-progress, completed)

## Reading Epic Progress

Each epic row separates active, deferred, done, and retired work. For example,
`1 open · 2 deferred · 16 done · 3 retired` means exactly that: 16 items are
complete, two remain wanted but parked, three were intentionally closed without
delivery, and one remains active. Deferred and retired work do not increase the
done count.

**Active only** is enabled by default. It hides deferred, done, and retired item
rows when you expand an epic, while the row-level status mix stays visible. Turn
it off to inspect parked and terminal items.

The same default follows you when you switch from **List** to **Grid** or
**Board**. Grid and Board load active work first so closed history does not slow
the initial view. Choose **All items** beside the view controls when you need
deferred, done, and retired records; that choice remains in the page URL for
sharing or refreshing.

- **Triaging** — Waiting for an intake decision.
- **Open** — Accepted work that has not started.
- **In progress** — Work is actively underway.
- **Done** — Completed work; this is the only status counted as done in epic progress.
- **Deferred** — Parked but still wanted. A deferral records why it is parked,
  what event should resume it, who owns that decision, and when it must be
  reviewed. Deferred work still keeps its epic open. An overdue review is shown
  on the item so parked work cannot disappear silently.
- **Retired** — Terminal history for work intentionally closed without delivery,
  such as an obsolete request, discarded proposal, or duplicate. Retirement is
  applied through the governed triage or retirement action rather than the
  general item editor.

A retired duplicate is labeled **retired duplicate**; the other backlog item is
the canonical record, so the duplicate is retained for history without being
counted as completed. Retired items no longer keep an epic open.

## Shared Demand

### Activate local demand

The first lane in **Operations > Delivery Flow** is **Needs classification**.
It contains historical or unscoped backlog requests whose product-demand intent
cannot be inferred safely. Classify only real demand; do not create a product,
team, customer, subscriber, or entitlement to make a card look complete.

An item advances one adjacent stage at a time:

- **Raw → Screened** requires a stated problem and reviewed evidence.
- **Screened → Shaped** requires a computable, explainable score, visible
  confidence, a selected investment bucket, and reconciled effort provenance.
- **Shaped → Ready** requires the existing organization-governed funding
  decision.

Use **Link evidence** to retain a stable source reference. Booking, order,
subscription, and fulfillment records are evidence only when they really
exist. The completeness line measures classified, evidence-linked,
explainably-scored, and funding-decided records; it does not reward clicks.

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

## Being reached when you are away

Most decisions do not happen at a desk. DPF can reach you by email when something genuinely
needs you — a bill, a customer waiting, a booking — while deliberately never sending you
technical noise and never letting a decision be made from the email itself. See
[Being Reached When You Are Not At A Desk](./getting-reached.md).

## Business Journeys

Promotions and self-upgrade tell you what the platform did. **Business Journeys** tells you whether your customers can still do what your business depends on — find you, enquire, book, sign in, and pay. A scheduled check exercises those paths against the live install on Monday, Wednesday and Friday, states honestly how much each check proved, and raises anything broken into your "Needs you" inbox. A check that could not run at all — most often because no public web address is set yet — is shown as "Could not check" rather than as a failure, because nothing was tested and so nothing is known. See [Business Journeys](./business-journeys.md).

### Promoter timeout

The portal first prepares the candidate promoter image, then the promoter builds a fresh application image and swaps the running container. Both builds use Docker BuildKit and the same bounded wall-clock budget (default **25 minutes**). Candidate preparation happens before quiescence, so a preparation failure leaves the current portal available. If either build stalls — for example on a slow or degraded network fetch — it is killed and the deployment is marked failed with a retryable `promoter-timeout` diagnosis instead of hanging. A normal deployment completes in a few minutes; the timeout only trips on a genuine stall. Operators on unusually slow hosts can raise the shared budget by setting `DPF_PROMOTER_TIMEOUT_MS` (milliseconds) in the environment. A periodic watchdog additionally force-removes any promoter container orphaned by a mid-deployment restart, so a stalled build can never linger and cause an unexpected later swap.

## Platform stack currency

**Operations > Stack Currency** (`/ops/stack-currency`) shows the technology lifecycle the platform is *subject to* — its own runtimes and frameworks (Node, PostgreSQL, Next.js, and so on) on the shared currency axis: current, approaching end of life, unsupported, or end of life. It is deliberately separate from **Patches**, which covers the discovered customer estate. Current versions are read from the platform's own manifests; a support/end-of-life date that has not been recorded shows as "EOL not sourced" — an invitation to record one — rather than a made-up status, and anything approaching or past end of life is flagged for an upgrade path.

## What this installation is

**Operations → Installation** states what this installation is and what your AI
coworkers may do here. It never grants access — access still comes from roles,
grants, and approved links.

You reach it from the installation badge beside the logo, which appears on every
installation that is not production.

### Who runs this installation

Name the company or team that operates this installation. This is not the
business it runs for: an IT services company operating installations for twenty
customers is one operator with twenty businesses, and a development installation
paired with a production one shares the operator while the businesses differ.

Two installations that belong together share this name, and it is how you tell
them apart everywhere else — in the badge, and in the name your AI coworkers see
when they connect to this installation rather than another one.

Leave it empty if you would rather not name it yet. The badge then shows the job
alone, such as **DEV**.

### What your AI coworkers may do here

Five stances, each shown with the reason it resolved that way:

- **Credentials** — whether an agent may generate and rotate local test
  credentials, or whether you enter every credential yourself.
- **Teardown** — whether this installation may be destroyed, only after its work
  is captured, or never.
- **Source changes** — whether platform source may be edited from a governed
  worktree, or not from this directory at all.
- **Paired installation** — whether a paired installation may be read, written
  through an approved link, or is absent.
- **Work sync** — whether the work this installation owns is mirrored to a
  paired installation, so it survives a teardown, or has nowhere to go.

An installation that has not said what it is counts as production, so every
brake stays on until someone declares otherwise.

### Correcting the identity

Open **Change what this installation is** to set its main job, its environment,
and the production installation it is paired with.

Choose **Show me the impact** first. The preview lists the fields you are
changing, what each stance becomes, any brake that gets looser, and the evidence
that stops describing this installation. Nothing is saved until you confirm it.

The operator name is different: it is a label rather than a change to what your
coworkers may do, so it saves directly without an impact preview. The preview
step is reserved for changes that actually move a brake.
