---
title: "Operations"
area: operations
order: 1
---

## Overview

Operations is the delivery backlog for the platform. It tracks the work items, epics, priorities, and deployments that make up your team's delivery commitments. It is designed for transparency — blockers are visible, work in progress is limited by investment (each portfolio admits new work while its points in flight fit its allowance, so ten small items and two large ones that cost the same are treated alike), and progress is always up to date.

## Work in progress: the Work Atlas

**Work** in the main navigation opens this same page — there is one entry for work activity, not a separate dashboard beside it. It is distinct from the coworker directory under **Workforce**: the Workforce portfolio groups business work, including supporting activities such as hiring and finance, while the coworker directory is a people-and-agent view across all four portfolios.

Open **Work in progress** (`/ops/workrooms`) to see every open workroom on one screen, called the **Work Atlas**. Grey means a room is moving on its own. Colour and shape mean you should look.

**Today's question** sits at the top: how many rooms are waiting on a person, and which of them has gone longest without a new signal. Select that room to open it.

Below it are five counts, each with the mark it uses on the map:

- **Needs a person** (amber diamond): a decision, approval, owner or closeout is waiting on someone.
- **Stuck or held** (red square with a bar): the room is blocked, failed, or paused by its drive. This replaces the old **Shared recovery issues** section.
- **Working now** (light grey square): an executor is demonstrably working.
- **Waiting its turn** (dark grey square): the room is waiting for capacity or input.
- **No recent signal** (hatched square): nothing recorded says what the room is doing.

Select a count to highlight those rooms and dim the rest. Select it again to show every state. A renewed session lease alone does not mean work is progressing.

The map draws one square per room. Rooms group by portfolio (Manufacturing and Delivery first, **Not yet placed** last), then by delivery shape (**Unshaped** when a room declares none). Within a shape, rooms that need a look sit at the left. Each portfolio heading gives its totals, for example "118 rooms · 18 need you · 7 stuck". Select a portfolio name to show only that portfolio. Select any square to open its room.

Select a shape's name to open its rows. Each row shows the room, its stage rail (done, current, still to do) and what it is doing or why it is held, with its accountable person. A held room shows the drive's recorded cause and since when. Rows show eight at a time; filter by state to narrow the rest. **Not assigned** accountability means no person has been resolved; the page does not guess from who started the session.

Filters live in the address, for example `/ops/workrooms?portfolio=forEmployees&state=stuck&shape=delivery-small`, so other pages and agents can link straight to a view and a refresh keeps it. An area's **Work** view now gives its room counts and links here filtered to that portfolio. Agents read the same picture through `list_workrooms` with `view: "atlas"`.

The Atlas reads every open room, up to 2,000. Above that it says the picture is truncated. Open **Architecture > Workrooms** for reusable definitions rather than instance history.

**Day-to-day operations** lists every standing room with its last 14 days. A missed day shows as an outlined cross, so it stands out as clearly as a stuck project. See [Day-to-day operations](../workspace/work-rooms.md#day-to-day-operations) for what each mark means.

## Key Concepts

- **Backlog Items** — Individual units of work with a status, priority, epic, and owner. Items move through triaging, open, in-progress, awaiting acceptance, done, deferred, or retired.
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

Delivered work that has not yet been accepted is counted on its own, never as
done: `3 awaiting acceptance (2 over 14 days) · 5 done`. The part in brackets is
how many have waited 14 days or more since entering awaiting acceptance. It
reads `up to 2` when some of those items have no recorded entry date, because
their age is then counted from when they were created and the real figure may
be lower; hover it for the explanation. The progress bar shows done in one
colour and awaiting acceptance as a separate segment after it. The workspace
**Backlog** tile shows the same counts as **Awaiting acceptance** and **Awaiting
14+ days**, above **Done**. The tile counts only the items this installation
can accept. Items copied in from a connected installation by work sync are
accepted by the installation they came from, so the tile shows them separately
as **Awaiting at peer installation** and leaves them out of the other two
counts. While work sync with that installation is failing, the row reads
**stale since** the last successful sync, because the copies no longer change.
If sync has not worked for six hours, **Needs you** names the installation, the
last success, what kind of failure it is (the connection was revoked or
refused, the network, or a secure-connection problem) and what to check. The
item clears once sync works again.

**Active only** is enabled by default. It hides awaiting-acceptance, deferred, done, and retired item
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
- **Awaiting acceptance** — Delivered (for example merged) but not yet closed.
  It is not done, and it is not counted in epic progress. Most items do not wait
  here: once its change merges, an item closes on its own and the acceptance
  sweep finishes the move. Only items tagged `contractual` wait for a separate
  acceptance, because a customer was promised one. If something is still wrong
  after a change ships, report it as a new item.

When you file an item, say what will be true, and for whom, once it is done (the
**Outcome** field). Add how you will know only when that is not obvious.
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

### Security findings from GitHub

On the installation that stewards the repository, inbound issue triage reads
three GitHub security surfaces every four hours: Dependabot, code scanning and
secret scanning. Each one becomes backlog work:

- **One item per unit of fix.** Dependabot findings are grouped by package, so
  one upgrade closes one item. Code scanning is grouped by rule. Each leaked
  secret is its own item.
- **Ranked by severity.** Leaked secrets and critical findings are priority 1,
  high is 2, medium 3 and low 4. A rise in severity raises the item; the job
  never lowers a priority.
- **Closed when GitHub resolves it.** When GitHub no longer reports a finding
  open, the item records that as evidence and moves to awaiting acceptance. The
  daily acceptance sweep then closes it. If the finding comes back first, the
  item returns to open.
- **Unreadable is never zero.** If the installation's GitHub connection cannot
  read a surface, the schedule view marks that surface **UNREADABLE** and the
  run as failed. The connection needs read access to Dependabot alerts, code
  scanning alerts and secret scanning alerts.

### Clearing copies of a paired installation's demand

Before a fix in November 2026, inbound issue triage filed a second, local copy
of every demand record a same-organization installation sent. It also filed
copies from revoked links and from demand the other installation had withdrawn.
Work sync already shows that installation's backlog here, so these copies are
duplicates. Your coworker clears them in one governed step:

1. **Dry run.** It reports how many copies would be retired, split by source:
   revoked link, withdrawn demand, or live same-organization demand. It also
   shows how many will be marked duplicate of the work-sync item with the same
   title, a few samples from each group, and the copies it will keep. Nothing
   changes.
2. **One approval.** You get one approval card for the whole set. The card is
   tied to the exact selection from the dry run. If anything changes before it
   runs, such as someone claiming one of the copies, it is refused and your
   coworker runs a new dry run.
3. **Retire.** Each copy is retired the same way a single item is. It gets a
   status-history entry and a resolution that explains why. A copy can be put
   back with a status change to triaging or open. Running it again retires
   nothing twice.

Some copies are kept for you to review one at a time. These are copies that are
claimed, being built, in a Work Room, have evidence, or have been worked on
since they were filed.

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

### What Build Studio starts next

When the governed backlog lane is on, the daily tee-up (and the capacity drain,
when it is switched on) starts accepted, build-ready work in this order:

1. Items with a demand score come before items without one, highest score
   first.
2. If you have set investment-bucket targets, an item whose bucket (Run, Grow
   or Transform) is below its target in the work already in flight goes ahead
   of higher-scored work in the same group. The balance is re-checked after
   each start.
3. Ties go to work on an active epic, then to the oldest item.

Each started build records why it was picked in its activity, for example
"Ranked 1 of 12 eligible by demand score 42 (rice)". An item with no score
says so, so unscored work is never started by age without saying it. To have
an item considered on value, give it a score in Delivery Flow.

#### Use spare weekly AI allowance (capacity drain)

The capacity drain is off until you turn it on. When it is on, the platform
checks every hour whether the weekly AI allowance is close to resetting with
allowance left over and free build slots. If so, it starts a few of the
top-ranked ready items, in the order above, so the allowance is not wasted. It
stops when the allowance is nearly spent or a provider reports a rate limit,
and it only acts while the governed backlog lane is on.

To turn it on or off, open **Admin > Platform Development**, find **Let Build
Studio pick up work on its own**, open **Daily limits and the autopilot
switches**, tick or clear **Use spare weekly AI allowance**, and select
**Save**. Changing it needs the platform management permission. An agent can
make the same change with the `set_backlog_delivery_budget` tool
(`capacityDrainEnabled`); that tool asks a person to approve the change first,
and its read shows the current setting.

### Proposed scores

Each day the Portfolio Advisor proposes a score for a batch of open and
in-progress items that have none, starting with items in active epics, items a
user asked for, and bugs with live evidence. It fills in reach, impact,
confidence, and effort from what the item already records, and picks an
investment bucket where the work type makes it clear. A proposed score is marked
as proposed by an agent and lists the reasons behind each number in the item's
history. Proposed confidence never goes above 80%.

To change a proposed score, score the item yourself. Your values replace the
proposal, and the advisor never proposes over them again. If an item has no
effort size or estimate, the advisor leaves it unscored so a person can size it.

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

## Platform software composition and currency

Platform dependencies no longer have a separate Operations ledger. Open the
**Digital Product Factory Portal** in **Products > Portfolio**, then choose
**Operate > Dependencies**. That one surface shows product relationships,
deployed or discovered estate, and the persisted CycloneDX software composition.
Lifecycle milestones attached to the shared component catalogue provide the
currency and support posture; a missing milestone remains visibly unsourced.

The former `/ops/stack-currency` address remains only as a compatibility route
to the software-composition section. **Operations > Patches** still covers
patch work for discovered estate and is not another source of platform
component facts.

## What this installation is

**Operations → Installation** states what this installation is and what your AI
coworkers may do here. It never grants access — access still comes from roles,
grants, and approved links.

You reach it from the installation badge beside the logo, which appears on every
installation that is not production.

### How this computer is set up to keep the platform running

The platform stops serving whenever the computer it runs on sleeps, restarts and
waits at the sign-in screen, or starts without Docker. This section shows three
checks, read from the computer each time the platform starts after someone signs
in:

- **Plugged in to power.** On battery a Mac goes to sleep when idle.
- **Never sleeps on power.** In System Settings, open **Battery**, then
  **Options**, and turn on **Prevent automatic sleeping on power adapter when the
  display is off**. On a Mac without a battery this is under **Energy**.
- **Docker starts at sign-in.** In Docker Desktop, open **Settings**, then
  **General**, and turn on **Start Docker Desktop when you sign in to your
  computer**.

These are suggestions. The platform reads the settings but never changes them.
After a restart, for example for a macOS update, the platform starts again only
once someone signs in to the computer. If the platform was down for more than half
an hour, the next time it runs **Needs you** shows how long and the likely cause.

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
- **Work sync** — whether this installation's backlog and a paired
  installation's backlog copy each other every few minutes, so work survives a
  teardown and a development box sees the production backlog, or whether there
  is nowhere to copy to. The copies are read-only; each item changes only where
  it was created.

An installation that has not said what it is counts as production, so every
brake stays on until someone declares otherwise.

### Operational posture across your installations

Below the identity, one card per installation shows its version and build, how
many of its runtimes are serving, how many estate items it tracks, and its open
patch findings by severity. Your own card is captured the moment the page loads.
A connected installation's card is what it last reported over the approved
link, and the card says so — **Reported by** the installation, with how old the
report is. Only counts travel between installations; the findings themselves
stay where they were found.

A connected installation reports every five minutes when something changes and
at least hourly otherwise. A card marked **Stale** has missed heartbeats; one
marked **Silent** has been quiet for three hours and shows as **Offline** rather
than repeating its last self-assessment. A connection that has not reported yet
is listed as waiting.

### Correcting the identity

Open **Change what this installation is** to set its main job, its environment,
and the production installation it is paired with.

Choose **Show me the impact** first. The preview lists the fields you are
changing, what each stance becomes, any brake that gets looser, and the evidence
that stops describing this installation. Nothing is saved until you confirm it.

The operator name is different: it is a label rather than a change to what your
coworkers may do, so it saves directly without an impact preview. The preview
step is reserved for changes that actually move a brake.

Work in progress keeps recorded executor and invocation details inside each row’s Technical evidence disclosure. These identify the recorded execution path independently of the accountable person. Missing historical evidence is identified explicitly; a schedule alone does not establish agent-to-agent delegation.
