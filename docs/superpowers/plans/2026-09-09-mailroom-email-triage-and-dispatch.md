---
status: active
---

# Mailroom — email triage and dispatch — implementation plan

**Backlog item:** `BI-4F7BB48B` (parent)  
**Design:** `docs/superpowers/specs/2026-09-09-mailroom-email-triage-and-dispatch-design.md`  
**Epic:** `EP-EMAIL-COMMS`  
**Archetype driver:** pet-rescue operating model §7c (inbound channels) — three of four requirements open  
**Objectives:** OBJ-MAIL-DECLARED-MAILBOXES, OBJ-MAIL-NEAR-HOURLY-INTAKE, OBJ-MAIL-TYPED-TRIAGE, OBJ-MAIL-ROUTED-TO-OWNER, OBJ-MAIL-CHASED, OBJ-MAIL-REPLY-INSIDE, OBJ-MAIL-EDUCATES-WHEN-EMPTY (design §1.1)

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the completion gate before
any success claim, and `dpf-pr-with-dco` for handoff. Claim every slice with the
shape its row declares. UI slices get a `dpf-ux-fit-review` before handoff.

## Current state

Every claim below is a grep hit on `main` at `3a1b676ce23`.

- **Nothing reads a mailbox.** No IMAP client, no Gmail client, no mailbox
  registry, no cursor, no poll job exists under `apps/` or `packages/`. The
  Microsoft 365 connector (`apps/web/lib/integrations/microsoft365-communications/communications-client.ts:123`)
  lists five inbox messages as a connection probe and discards them.
- **One inbound path exists and it is marketing's.** The Postmark webhook
  (`apps/web/app/api/integrations/email-postmark/inbound/route.ts`) persists to
  `InboundChannelMessage` with `domain = "marketing"` and hands off to
  `runInboundResponder` (`apps/web/lib/marketing/channels/email-postmark/responder.ts`),
  whose four classes are sales-shaped.
- **The room-native inbound seam is built and nearly unreachable.**
  `ingestWorkroomChannelEvent` (`apps/web/lib/work-management/room-channel-ingress.ts`)
  refuses any sender without a verified `CommunicationChannelBinding`; its only
  consumer is the bookkeeping trigger. A stranger's mail can never enter it, by
  design.
- **Outbound exists.** `sendEmail` (`apps/web/lib/shared/email.ts:386`) resolves
  the three-tier SMTP config; `EmailOptions` has no threading headers.
  `OutboundDraft` with `status = "pending-review"` is the approval queue the
  responder already uses.
- **The scheduled-job pattern is settled.** Inngest cron under
  `apps/web/lib/queue/functions/`, exported from `functions/index.ts`, declared
  in `apps/web/lib/operate/scheduled-jobs/catalog.ts`, gated by `gateAtEntry`.
- **Setup has no mail step.** `SETUP_STEPS` (`apps/web/lib/actions/setup-constants.ts:6`)
  runs `storefront` → `platform-development`; the only email collected is the
  owner's login and the storefront contact address.
- **The archetype has the vocabulary and no channel.** `pet-rescue-operating-model.md`
  §7c tables seven arrival reasons with urgencies; `nonprofit-community.ts`
  seeds the roles those reasons need (Intake coordinator, Veterinary
  coordinator, Adoption lead, Foster coordinator); the reference install has
  zero credentials, zero bindings, zero inbound messages.
- **The attention-source pattern is settled.** `apps/web/lib/attention/sources/storefront-inquiry.ts`
  is a pure mapper plus thin loader, wired in `aggregate.ts`.

## Shared implementation rules

1. **Extend, do not duplicate.** Items live in `InboundChannelMessage`; replies
   are `OutboundDraft`s; queue rooms are standing `WorkItem`s; sends go through
   `sendEmail`; notifications go through `sendQueueNotification`.
2. **Closed sets are enums.** `MailboxProvider`, `MailboxStatus`,
   `MailroomItemStatus`, `MailroomUrgency` are Prisma enums with generated
   unions. Reason, purpose and queue keys are registry keys validated against
   the archetype profile, the same discipline as work-shape keys.
3. **Inbound text is untrusted.** No governed verb runs from message content.
   The classifier's answer is parsed against the profile's keys and nothing
   else.
4. **Sending needs a person.** Every send is an approved draft. No slice adds
   an automatic reply.
5. **Secrets go through `credential-crypto`.** A mailbox's safe projection never
   contains them.
6. **New route files declare `@exposure`.** New pages carry purpose contracts.
7. **New test files are registered** in the CI inventory where the guard
   requires it.
8. **Providers are compile-time complete.** The adapter registry is a
   `Record<MailboxProvider, MailboxProviderAdapter>`.

## Phase 1 — substrate

### `BI-E64B3730` — Mailroom profile registry (small)

**Deliverable.** `mailroomProfile` on `ArchetypeDefinition`
(`packages/storefront-templates/src/types.ts`), `COMMON_MAILROOM_PROFILE` and
`resolveMailroomProfile(archetypeId)` in
`packages/storefront-templates/src/mailroom-profile.ts`, the pet-rescue profile
in `nonprofit-community.ts` per design §4.2.

**Red test.** `resolveMailroomProfile("pet-rescue")` returns nine reasons
including `veterinary-correspondence` routed to `veterinary`; an unknown
archetype returns the common profile; a profile whose reason names an unknown
queue fails validation.

**Verification.** Package tests, production build.

### `BI-1DDFC3D1` — data model and migration (small)

**Deliverable.** `MailboxAccount` and the four enums in a new
`packages/db/prisma/schema/mailroom.prisma`; the mailroom columns on
`InboundChannelMessage` (`marketing.prisma`) with the partial unique index; one
forward-only migration; regenerated enum unions.

**Red test.** Migration applies against a database holding existing marketing
rows; inserting two items with the same `(channelId, externalMessageId)`
fails; marketing rows keep `classification`.

**Verification.** Migration apply, db tests, production build.

### `BI-13919D7E` — provider adapters (medium)

**Deliverable.** `apps/web/lib/mailroom/providers/{types,imap,microsoft365,registry}.ts`;
`imapflow` and `mailparser` adopted with a tool-evaluation record; Graph delta
read reusing `token-client.ts`.

**Red test.** IMAP adapter against a fake client: first fetch with no cursor
reads only mail after the configured start; second fetch returns nothing new;
a changed `UIDVALIDITY` resets and re-reads without throwing. Microsoft
adapter against a fake fetch: honours `deltaLink`, normalises `internetMessageId`
and threading headers. Both `probe` calls fail with a safe message on bad
credentials.

**Verification.** Unit tests, production build, one probe against a real IMAP
mailbox on the reference install.

## Phase 2 — the loop

### `BI-9C362E23` — intake job (medium)

**Deliverable.** `apps/web/lib/mailroom/intake.ts` (`pollMailbox`,
`ingestNormalizedMail`), Inngest `mailroom/mailbox-poll` and
`mailroom/mailbox-poll.requested` in `apps/web/lib/queue/functions/mailroom-poll.ts`,
exports and catalog entry.

**Red test.** A mailbox with `nextPollAt` in the past is polled and one in the
future is not; the same provider message twice yields one item; a provider
throw marks that mailbox `error` and the next mailbox still polls; cursor and
`nextPollAt` advance on success.

**Verification.** Unit tests, production build, the job visible on the
scheduled-jobs surface.

### `BI-9BD223B1` — triage and dispatch (medium)

**Deliverable.** `apps/web/lib/mailroom/triage.ts` (pure; classifier port),
`apps/web/lib/mailroom/dispatch.ts` (known-sender ingress, queue room via a
`mailroom-queue` standing-room helper mirroring `bookkeeping-period-room.ts`,
`WorkItemMessage`, owner resolution, notification, acknowledge window),
`apps/web/lib/mailroom/classifier.ts` (routed inference, `email-triage` task
type, attributed to `AGT-WS-MAILROOM`).

**Red test.** `Auto-Submitted: auto-replied` is noise with no classifier call;
"found a dog on Elm St" hits `found-animal` by hint with urgency `hours` and
`acknowledgeBy = receivedAt + 4h`; a classifier answering a key outside the
profile falls back to the default reason and flags the item; a sender with a
verified binding lands on their existing room and no queue room is opened; an
unknown sender opens the queue room once and reuses it; a bound owner receives
one notification.

**Verification.** Unit tests, production build, one real message through the
loop on the reference install.

### `BI-12B0AE91` — chase (small)

**Deliverable.** `apps/web/lib/attention/sources/mailroom-item.ts` wired into
`aggregate.ts`; `acknowledgeMailroomItem` action.

**Red test.** An item past `acknowledgeBy` projects with the age past window;
an `immediate` item projects at once; an acknowledged item does not.

**Verification.** Unit tests, production build, the card visible on
`/workspace/inbox`.

## Phase 3 — the reply and the surfaces

### `BI-DFEFAE1C` — reply (medium)

**Deliverable.** `apps/web/lib/mailroom/reply.ts` (`draftMailroomReply`,
`sendApprovedMailroomReply`), `EmailOptions` gains `inReplyTo` and
`references`, approval hook where `OutboundDraft` domain `mailroom` is
approved.

**Red test.** Drafting creates one pending-review draft and never calls
`sendEmail`; approving calls `sendEmail` with the threading headers and marks
the item replied; with SMTP unconfigured, approving returns the settings route
and the item stays routed.

**Verification.** Unit tests, production build, one approved reply received
threaded in a real mail client.

### `BI-727D5FD9` — Mailroom surface (medium, UX-fit)

**Deliverable.** `apps/web/app/(shell)/workspace/mailroom/page.tsx`,
`items/[inboundId]/page.tsx`, server actions in `actions.ts` (connect with
probe-then-save and first read, pause, test, remove, check now, acknowledge,
draft reply), components under `apps/web/components/mailroom/`, purpose
contracts under `apps/web/lib/ux-budget/purpose-contracts/mailroom.ts`.

**Red test.** With no mailbox the page renders the education state with the
archetype's expected mailboxes and a connect action; with items, the list is
ordered unacknowledged-worst-first and filters on reason, urgency and queue;
connect refuses to save when the probe fails and shows the safe error.

**Verification.** Unit tests, production build, UX verification on the running
app, `dpf-ux-fit-review`.

### `BI-A670CDF8` — setup step (small)

**Deliverable.** `mailroom` in `SETUP_STEPS` after `storefront`; routes and
labels; `buildStepTrigger` case; `mailroomSkipped` in `SetupContext`;
evidence-driven completion when a `MailboxAccount` exists.

**Red test.** Step order places `mailroom` after `storefront`; skipping records
the skip and advances; connecting completes the step; the trigger text names
the Mailroom and the return route.

**Verification.** Unit tests, production build, a fresh setup run on the
reference install through the step both ways.

## Phase 4 — the coworker and the second door

### `BI-0426D15B` — Mailroom coworker (small)

**Deliverable.** `AGT-WS-MAILROOM` in `packages/db/data/agent_registry.json`;
establishment in `runSetupCompletionSeeds` when a mailbox exists and on first
connect otherwise; triage and draft turns attributed to it.

**Red test.** Registry validation passes with the new entry; the seed is
idempotent; `TokenUsage` for a triage turn carries the agent id.

**Verification.** Unit tests, production build.

### `BI-DD24A293` — Postmark branch (small)

**Deliverable.** The inbound route hands a message addressed to a
`postmark_inbound` mailbox to `ingestNormalizedMail` and skips the marketing
responder.

**Red test.** With no such mailbox the route behaves exactly as today; with one,
the item lands with `domain = "mailroom"` and the responder is not called.

**Verification.** Unit tests, production build.

## Phase 5 — acceptance

### `BI-E6BAF90F` — live acceptance (small)

Run design §9 on the reference install and record evidence with
`record_execution_evidence`; reconcile against the objective baseline with
`record_product_outcome_observation`; close the parent.

## Completion gate (every slice)

1. Focused vitest for the touched files, then the affected package suites.
2. `pnpm --filter web build` with zero errors.
3. UX verification on the running app for any page, action, or setup change.
4. Migration applies cleanly where one was added.
5. Docs: `docs/architecture/orientation.md` route map gains `/workspace/mailroom`
   (surface slice); the pet-rescue operating model §7c gains the "met" note for
   requirements 2–4 (acceptance slice); the archetype's business-type page names
   the Mailroom (acceptance slice).

## Risks and scope fences

| Risk | Signal | Response |
| --- | --- | --- |
| Triage starts executing actions | A governed verb is called from `triage.ts` or `dispatch.ts` with message content as input | Stop. Design §4.5; inbound text is data. |
| A second inbound table appears | A new `Mail*Message` model | Stop. `InboundChannelMessage` is the store; widen it. |
| Auto-reply creeps in | A send with no approved draft | Stop. Kernel commandment on outbound actions. |
| Parcel scope leaks in | Carrier code in any slice | Stop. Deferred on the parent item. |
| Provider added without adapter | Build passes with an enum value missing from the registry | The registry type must be the enum-keyed Record; fix the type. |
| Rooms multiply per message | A `WorkItem` per inbound item | Stop. One standing room per queue; items are messages on it. |

## Backlog coverage

- Decision: decomposed
- Parent: `BI-4F7BB48B`
- Receipt: blocked-by: the coverage receipt is minted after the design's spec-approval baseline exists on this branch's pushed head; recorded once the reviewer routes have run and re-recorded whenever this file changes
- Rationale: each child is one clean revert with its own tests; the registry and data slices go first because every other slice reads them, and the loop (intake, triage, chase) ships value before the surfaces.
- Dependencies: profile-registry -> `BI-E64B3730` (none); data-model -> `BI-1DDFC3D1` (none); provider-adapters -> `BI-13919D7E` (BI-1DDFC3D1); intake-job -> `BI-9C362E23` (BI-1DDFC3D1, BI-13919D7E); triage-dispatch -> `BI-9BD223B1` (BI-E64B3730, BI-1DDFC3D1); chase -> `BI-12B0AE91` (BI-1DDFC3D1); reply -> `BI-DFEFAE1C` (BI-1DDFC3D1, BI-9BD223B1); mailroom-surface -> `BI-727D5FD9` (BI-1DDFC3D1, BI-13919D7E, BI-9C362E23); setup-step -> `BI-A670CDF8` (BI-E64B3730, BI-727D5FD9); mailroom-coworker -> `BI-0426D15B` (BI-9BD223B1); postmark-branch -> `BI-DD24A293` (BI-9C362E23); live-acceptance -> `BI-E6BAF90F` (BI-9C362E23, BI-9BD223B1, BI-12B0AE91, BI-DFEFAE1C, BI-727D5FD9, BI-A670CDF8)

| Key | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- |
| profile-registry | OBJ-MAIL-DECLARED-MAILBOXES, AC-MAIL-PURPOSE-REGISTRY | spec:4.2 | plan:phase-1 | package tests |
| data-model | OBJ-MAIL-NEAR-HOURLY-INTAKE, AC-MAIL-IDEMPOTENT | spec:4.3 | plan:phase-1 | migration apply, db tests |
| provider-adapters | OBJ-MAIL-NEAR-HOURLY-INTAKE, AC-MAIL-PROVIDERS | spec:4.4 | plan:phase-1 | unit tests, live probe |
| intake-job | OBJ-MAIL-NEAR-HOURLY-INTAKE, AC-MAIL-POLL-SCHEDULE, AC-MAIL-IDEMPOTENT | spec:4.4 | plan:phase-2 | unit tests, scheduled-jobs surface |
| triage-dispatch | OBJ-MAIL-TYPED-TRIAGE, OBJ-MAIL-ROUTED-TO-OWNER, AC-MAIL-TYPED-REASON, AC-MAIL-NOISE-FIRST, AC-MAIL-UNTRUSTED, AC-MAIL-QUEUE-ROOM, AC-MAIL-KNOWN-SENDER, AC-MAIL-OWNER-NOTIFIED, AC-MAIL-ACK-WINDOW | spec:4.5, spec:4.6 | plan:phase-2 | unit tests, live message |
| chase | OBJ-MAIL-CHASED, AC-MAIL-NEEDS-YOU | spec:4.7 | plan:phase-2 | unit tests, Needs you card |
| reply | OBJ-MAIL-REPLY-INSIDE, AC-MAIL-DRAFT-REPLY, AC-MAIL-APPROVED-SEND, AC-MAIL-NO-SMTP-HONEST | spec:4.8 | plan:phase-3 | unit tests, threaded receipt |
| mailroom-surface | OBJ-MAIL-DECLARED-MAILBOXES, OBJ-MAIL-EDUCATES-WHEN-EMPTY, AC-MAIL-CONNECT-LATER, AC-MAIL-EMPTY-STATE | spec:4.9, spec:6 | plan:phase-3 | unit tests, UX verification, ux-fit review |
| setup-step | OBJ-MAIL-DECLARED-MAILBOXES, OBJ-MAIL-EDUCATES-WHEN-EMPTY, AC-MAIL-SETUP-STEP, AC-MAIL-SKIP-EDUCATES | spec:4.9 | plan:phase-3 | unit tests, fresh setup run |
| mailroom-coworker | OBJ-MAIL-TYPED-TRIAGE, OBJ-MAIL-REPLY-INSIDE | spec:4.10 | plan:phase-4 | unit tests |
| postmark-branch | OBJ-MAIL-NEAR-HOURLY-INTAKE, AC-MAIL-PROVIDERS | spec:4.4 | plan:phase-4 | unit tests |
| live-acceptance | all objectives | spec:9 | plan:phase-5 | execution evidence, outcome observation |
