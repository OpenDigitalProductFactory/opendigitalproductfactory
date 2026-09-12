---
status: draft
Backlog: BI-4F7BB48B
Profile: feature
Author: Mark Bodman
Plan: docs/superpowers/plans/2026-09-09-mailroom-email-triage-and-dispatch.md
Epic: EP-EMAIL-COMMS
Date: 2026-09-09
---

# Mailroom — email triage and dispatch

## 1. Outcome

Every business receives correspondence it did not ask for and must answer on a
clock: a vet's records, an adopter's question, a supplier's invoice, a stranger
reporting a found animal. Today none of it reaches the product. The Mailroom is
the front door for that correspondence. It watches the mailboxes the business
names, reads what arrives on a near-hourly cadence, works out why the sender
wrote and how urgent it is, puts the item in the queue that owns that reason,
tells the accountable person, chases an item nobody has picked up, and lets the
reply be written and approved from inside the product.

The business declares its mailboxes and their purpose during setup, right after
it has chosen what kind of business it is, because the archetype knows which
mailboxes such a business typically runs. An owner who has none yet is not
blocked: the step becomes the moment the platform explains what the Mailroom
would do for them and where to come back and connect one.

This design delivers the **email** half of the Mailroom concept recorded on
BI-4F7BB48B. Physical parcel tracking and delivered-but-not-received
reconciliation for carriers stay on that item as deferred scope; the
acknowledgement-chase mechanism built here is the pattern they will reuse.

### 1.1 Objectives and acceptance criteria

**OBJ-MAIL-DECLARED-MAILBOXES:** A business declares which mailboxes the
platform reads and what each one is for, using the purposes its archetype
expects, and can do so during first-run setup or later from the Mailroom.

**OBJ-MAIL-NEAR-HOURLY-INTAKE:** Every connected mailbox is read on a schedule
the owner controls, defaulting to once an hour, without any AI client present,
and a message is never ingested twice.

**OBJ-MAIL-TYPED-TRIAGE:** Each arriving message is assigned a typed reason,
an urgency, and where possible the business subject it concerns, from a
registry the archetype owns; inbound text never executes anything.

**OBJ-MAIL-ROUTED-TO-OWNER:** Each triaged message lands in the standing queue
room that owns its reason, and the accountable role for that queue is told.

**OBJ-MAIL-CHASED:** An item nobody acknowledges within the window its urgency
sets surfaces where the owner already looks for things that need them.

**OBJ-MAIL-REPLY-INSIDE:** A reply can be drafted from the item, with the
coworker's help, and is sent only after a person approves it, threaded onto the
original conversation.

**OBJ-MAIL-EDUCATES-WHEN-EMPTY:** An owner with no mailbox to connect learns,
at the setup step and on the Mailroom page, what the platform would do and how
to connect one later, and setup completes without it.

| AC | Objective | Statement |
| --- | --- | --- |
| AC-MAIL-SETUP-STEP | OBJ-MAIL-DECLARED-MAILBOXES | Setup presents a `mailroom` step after the archetype is chosen, listing the archetype's expected mailbox purposes, and lets the owner connect one or more mailboxes against those purposes or skip. |
| AC-MAIL-PURPOSE-REGISTRY | OBJ-MAIL-DECLARED-MAILBOXES | Expected mailbox purposes, contact reasons, urgencies and queues come from a per-archetype Mailroom profile with a common fallback; no reason or purpose is hard-coded in the triage or dispatch code. |
| AC-MAIL-CONNECT-LATER | OBJ-MAIL-DECLARED-MAILBOXES | The Mailroom page offers the same connect flow after setup, and a mailbox can be paused, re-tested, or removed there. |
| AC-MAIL-POLL-SCHEDULE | OBJ-MAIL-NEAR-HOURLY-INTAKE | A platform job reads every connected mailbox whose next-poll time has passed, on a per-mailbox interval defaulting to sixty minutes, and records the poll outcome on the mailbox. |
| AC-MAIL-IDEMPOTENT | OBJ-MAIL-NEAR-HOURLY-INTAKE | Re-reading a mailbox, a provider redelivery, or a restarted poll never creates a second item for the same provider message id. |
| AC-MAIL-PROVIDERS | OBJ-MAIL-NEAR-HOURLY-INTAKE | IMAP over TLS and Microsoft 365 (Graph) mailboxes can be connected, probed and read through one provider adapter contract; a Postmark inbound stream can be bound to a mailroom purpose through the same contract. |
| AC-MAIL-TYPED-REASON | OBJ-MAIL-TYPED-TRIAGE | Every ingested message carries a reason key from the archetype profile, a typed urgency, a plain-language summary, and, when the profile asks for it and the text contains one, a business subject reference. |
| AC-MAIL-NOISE-FIRST | OBJ-MAIL-TYPED-TRIAGE | Auto-submitted mail, bounces, and bulk mail are classified as noise by rules before any model is consulted, and noise never opens or advances a queue. |
| AC-MAIL-UNTRUSTED | OBJ-MAIL-TYPED-TRIAGE | Inbound text is treated as untrusted: the classifier's output is constrained to registry keys, and no governed action is executed from message content. |
| AC-MAIL-QUEUE-ROOM | OBJ-MAIL-ROUTED-TO-OWNER | Each reason maps to a standing queue room; the message appears in that room's activity as an external event and the item records which room it went to. |
| AC-MAIL-KNOWN-SENDER | OBJ-MAIL-ROUTED-TO-OWNER | A sender who is already a verified channel participant is routed through the existing room-native ingress first, so their message lands on the room they were already in. |
| AC-MAIL-OWNER-NOTIFIED | OBJ-MAIL-ROUTED-TO-OWNER | The principal bound to the queue's responsible role receives a notification through the communication dispatcher, with in-app as the floor. |
| AC-MAIL-ACK-WINDOW | OBJ-MAIL-CHASED | Each item records an acknowledge-by time derived from its urgency, and acknowledging it records who and when. |
| AC-MAIL-NEEDS-YOU | OBJ-MAIL-CHASED | Items past their acknowledge-by time, and every item of immediate urgency, appear on the owner's attention surface with a deep link to the item. |
| AC-MAIL-DRAFT-REPLY | OBJ-MAIL-REPLY-INSIDE | From an item the operator can ask for a drafted reply; the draft is created pending review and never sent by the drafting step. |
| AC-MAIL-APPROVED-SEND | OBJ-MAIL-REPLY-INSIDE | Approving a draft sends it through the install's configured outbound path with In-Reply-To and References set to the original message, and marks the item replied. |
| AC-MAIL-NO-SMTP-HONEST | OBJ-MAIL-REPLY-INSIDE | When no outbound email is configured, approval reports that fact and where to configure it instead of recording a send that did not happen. |
| AC-MAIL-SKIP-EDUCATES | OBJ-MAIL-EDUCATES-WHEN-EMPTY | Skipping the setup step records the skip, the onboarding coworker explains the capability in plain language, and setup proceeds. |
| AC-MAIL-EMPTY-STATE | OBJ-MAIL-EDUCATES-WHEN-EMPTY | The Mailroom page with no mailbox shows what the Mailroom does, the archetype's expected mailboxes, and a connect action, rather than an empty table. |

## 2. Why this is missing today

The pieces exist as unconnected parts. The email epic's own spec
(`2026-08-14-integrated-email-communications.md`) names a tier-1 slice, "connect
the customer's existing mailbox into Work Rooms; inbound lands as Work Items",
and the alternative-channels plan (`2026-08-29-alternative-communication-channels.md`)
measured the result: the room-native inbound seam `ingestWorkroomChannelEvent`
is built and has exactly one consumer, the bookkeeping trigger; no inbound route
exists for any channel except a Postmark webhook whose only consumer is the
marketing classifier; the email adapter is written and never registered.

Nothing reads a mailbox. The Microsoft 365 connector lists five inbox messages
as a connection probe and discards them. There is no IMAP client, no mailbox
registry, no cursor, no poll.

The pet-rescue operating model (`docs/architecture/archetypes/pet-rescue-operating-model.md`
§7c) states the archetype-level consequence. Seven reasons a stranger arrives,
with urgencies from immediate to weeks, and four requirements of which three are
open: the reason for contact is not a typed field, an enquiry about an animal
does not carry the animal, and "a reply is possible from inside the product.
Today the only action on an enquiry is to convert it into an internal work
item; there is no reply." The only inbound channel that works is the storefront
contact form, and it has no clock.

The reference install confirms the shape: zero integration credentials, zero
channel bindings, zero inbound messages, and an organisation record with no
email address, after a completed eleven-step setup that never asked.

## 3. Research and benchmarking

Three open-source help desks solve the same problem for support teams; the
Mailroom adopts their proven shape and rejects the parts that would make DPF a
help desk.

**Zammad** binds one or more email accounts to *groups*, each account fetched on
a schedule, with triggers that fire on arrival to set group, owner and
auto-reply ([email channel docs](https://admin-docs.zammad.org/en/latest/channels/email/index.html),
[account setup](https://admin-docs.zammad.org/en/latest/channels/email/accounts/account-setup.html),
[triggers](https://admin-docs.zammad.org/en/6.4/manage/trigger.html)).
Adopted: a mailbox belongs to a purpose, and arrival fires typed routing.
Rejected: a ticket model. DPF already has the Work Case, WorkItem and Workroom;
an inbound item is an external event on a room, not a new case type.

**FreeScout** runs one mailbox per shared address (support@, sales@), fetches
unread mail from a cron, and applies per-mailbox *workflows* that assign and
reply ([workflows module](https://freescout.net/module/workflows/),
[fetching emails](https://github.com/freescout-help-desk/freescout/wiki/Fetching-Emails)).
Adopted: per-mailbox scheduled fetch with a durable cursor and the rule that
background fetching only reads new mail. Rejected: rules authored per install by
hand. In DPF the rules are the archetype's profile, so a rescue gets found-pet,
surrender and cruelty lanes without configuring anything.

**Chatwoot** connects several addresses to one account, each with its own team,
over IMAP or Microsoft OAuth, and routes with automation rules on conditions
([email integration](https://www.chatwoot.com/features/email-integration),
[automation and routing](https://www.chatwoot.com/hc/user-guide/articles/1677238266-lesson-4-complete-your-customer-engagement-suite),
[email channel configuration](https://developers.chatwoot.com/self-hosted/configuration/features/email-channel/introduction)).
Adopted: IMAP and Microsoft Graph as the two first-class mailbox providers,
because together they cover Gmail, Outlook, Microsoft 365 and every self-hosted
server. Rejected: the agent-conversation UI. Replies in DPF go through the
existing outbound draft and approval queue.

**Domain software** for this archetype (Petstablished, Shelterluv) centralises
adoption applications, medical records and applicant communication
([Petstablished](https://petstablished.com/), [market survey](https://www.guideflow.com/blog/animal-shelter-software))
but treats email as a notification channel out of the product, not a door into
it. The Mailroom's contribution is the door: correspondence from a vet or an
adopter becomes work on the animal it concerns.

**Standards followed.** Message identity and threading use `Message-ID`,
`In-Reply-To` and `References` from [RFC 5322](https://www.rfc-editor.org/rfc/rfc5322).
Auto-generated mail is detected by the `Auto-Submitted` header of
[RFC 3834](https://www.rfc-editor.org/rfc/rfc3834) and by `List-Id` /
`List-Unsubscribe` ([RFC 2369](https://www.rfc-editor.org/rfc/rfc2369)); a reply is
never drafted to such mail. IMAP access follows [RFC 9051](https://www.rfc-editor.org/rfc/rfc9051)
(IMAP4rev2) with UID-based cursors keyed on `UIDVALIDITY`, over TLS only.
Microsoft 365 reading uses the Graph messages
[delta query](https://learn.microsoft.com/en-us/graph/api/message-delta) so a
poll asks only for what changed. Outbound replies inherit the epic's SPF, DKIM
and DMARC posture from `smtp-config.ts` and send from the configured business
identity.

**Library adoption.** IMAP needs a client library; Node has none built in.
`imapflow` (MIT, maintained by the EmailEngine authors, promise-based, handles
IDLE, UID search and `UIDVALIDITY` changes) and `mailparser` (MIT, same
maintainers, MIME to text/HTML/attachments) are the de-facto pair. Alternatives
rejected: `node-imap` (unmaintained since 2019, callback API) and `imap-simple`
(wraps `node-imap`). The adoption is recorded through the tool-evaluation skill
in the plan's first phase; nothing else in the design depends on the choice.

## 4. Contract

### 4.1 Vocabulary

- **Mailbox**: an address the platform reads, with a provider, a purpose, a
  schedule and a cursor. Owned by the organisation.
- **Purpose**: why the business runs that mailbox (`adoptions`, `intake`,
  `veterinary`, `general`). A registry key from the archetype's Mailroom
  profile.
- **Reason**: why one message was sent (`adopt-animal`, `found-animal`,
  `veterinary-correspondence`). A registry key from the same profile, carrying
  a default urgency and a queue.
- **Urgency**: `immediate`, `hours`, `days`, `weeks`. Platform-closed; a Prisma
  enum. Each maps to an acknowledgement window: 1 hour, 4 hours, 2 days, 7 days.
- **Queue**: the standing room that owns a reason, with a responsible role. A
  registry key from the profile.
- **Item**: one ingested message, its triage, its routing and its
  acknowledgement and reply state. Platform-closed status: `received`,
  `noise`, `quarantined`, `routed`, `acknowledged`, `replied`, `closed`.
- **Subject reference**: the business record the message concerns, when the
  profile defines how to recognise one. For a rescue, an animal.

### 4.2 The Mailroom profile (archetype registry)

`ArchetypeDefinition` gains an optional `mailroomProfile`:

```
mailroomProfile: {
  expectedMailboxes: [{ purposeKey, label, examples, why }],
  reasons: [{ key, label, urgency, queueKey, hints, subjectKind? }],
  queues:  [{ key, label, responsibleRole, roomTitle }],
  subjectKinds?: [{ kind, referencePattern, lookup }],
}
```

A `COMMON_MAILROOM_PROFILE` covers every archetype without one: purposes
`general`, `billing`, `support`; reasons for a customer enquiry, a supplier
invoice or statement, a support request, a job application, and noise; queues
for the owner, finance and support. An archetype profile is merged over the
common one, so every business gets the supplier-invoice lane and a rescue adds
its own.

The **pet-rescue profile** encodes §7c of the operating model plus the two
correspondents the founder named:

| Reason key | Urgency | Queue (responsible role) | Subject |
| --- | --- | --- | --- |
| `adopt-animal` | days | `adoptions` (Adoption counsellor) | animal |
| `found-animal` | hours | `intake` (Intake coordinator) | — |
| `lost-animal` | hours | `intake` (Intake coordinator) | — |
| `surrender-animal` | days | `intake` (Intake coordinator) | — |
| `cruelty-or-at-risk` | immediate | `management` (Shelter manager) | — |
| `foster-or-volunteer` | weeks | `fostering` (Foster and volunteer coordinator) | — |
| `donation-or-bequest` | weeks | `fundraising` (Fundraising lead) | — |
| `veterinary-correspondence` | days | `veterinary` (Veterinary coordinator) | animal |
| `adopter-follow-up` | days | `adoptions` (Adoption counsellor) | animal |

Expected mailboxes: `general` (info@), `adoptions` (adopt@), `intake`
(intake@ or the same as general), `veterinary` (the address vets are given).
The `animal` subject kind recognises the platform's animal reference pattern
and the animal's name against `AdoptableAnimal` / `AnimalProfile`.

The responsible roles are the same role vocabulary the onboarding-ownership
design (BI-4B5E3443) binds at setup; a queue room resolves its owner through the
existing room-owner ladder, so a role bound there is the person who gets told.

### 4.3 Data

**New model `MailboxAccount`** (organisation-scoped). Fields: `mailboxId`
(`MBX-` public id), `organizationId`, `address` (unique per organisation),
`displayName`, `purposeKey`, `provider` (enum `MailboxProvider`: `imap`,
`microsoft365`, `postmark_inbound`), `status` (enum `MailboxStatus`: `pending`,
`connected`, `error`, `paused`), `settings` (Json: host, port, folder, user,
tenant, client id, mailbox UPN — nothing secret), `secretsEnc` (encrypted Json
via `credential-crypto`: password or client secret), `cursor` (Json: IMAP
`uidValidity` + `lastUid`, or the Graph `deltaLink`), `pollIntervalMinutes`
(default 60), `lastPolledAt`, `nextPollAt`, `lastPollStatus`, `lastError`,
`lastMessageAt`, `createdByPrincipalId`. Indexes on `(organizationId, status)`
and `nextPollAt`.

Why not `IntegrationCredential`: it is unique per `integrationId`, one row per
install. A business runs several mailboxes. Why not
`CommunicationChannelBinding`: it binds a *principal's* address for outbound
reach and inbound trust; it is who may talk to us, not where we listen.

**Extended model `InboundChannelMessage`.** This is already the install's inbound
message store, with a `domain` column documented as "marketing today". The
Mailroom writes `domain = "mailroom"` and adds: `mailboxAccountId` (optional
relation), `toAddress`, `mailroomStatus` (enum `MailroomItemStatus`),
`reasonKey`, `urgency` (enum `MailroomUrgency`), `queueKey`,
`subjectRef`, `triageSummary`, `routedWorkItemId`, `acknowledgeBy`,
`acknowledgedAt`, `acknowledgedByPrincipalId`, `repliedAt`. A unique index on
`(channelId, externalMessageId)` where the message id is present makes
idempotency a database fact rather than a read-before-write. The existing
marketing rows are untouched: the new columns are nullable and the marketing
responder keeps its `classification` column.

**Queue rooms** are standing `WorkItem` rows with `sourceType =
"mailroom-queue"` and `sourceId = <queueKey>`, created on first use exactly as
the bookkeeping-period room is. An item's arrival is a `WorkItemMessage` with
`senderType = "external"` and `channel = "email"` on that room, carrying the
item id, reason, urgency and subject reference in `structuredPayload`.

**Replies** are `OutboundDraft` rows with `domain = "mailroom"`, `sourceType =
"inbound-channel-message"`, `sourceId = inboundId`, `status = "pending-review"`,
and `metadata` carrying `to`, `subject`, `inReplyTo`, `references`. The
existing approval surface owns the decision.

### 4.4 Intake

An Inngest function `mailroom/mailbox-poll` runs every fifteen minutes and
honours the scheduled-jobs kill switch. For each `connected` mailbox with
`nextPollAt <= now` it:

1. Opens the provider adapter and fetches messages after the cursor.
2. For each message, upserts the item keyed on `(channelId, externalMessageId)`;
   an existing row ends the step for that message.
3. Runs triage and dispatch (§4.5, §4.6) for each new item.
4. Advances the cursor, sets `lastPolledAt`, `nextPollAt = now + interval`,
   `lastPollStatus`, and clears or records `lastError`. A provider failure
   marks the mailbox `error` with the safe message and does not stop the other
   mailboxes.

A `mailroom/mailbox-poll.requested` event runs one mailbox now, for the "Check
now" action and for the connect flow's first read. The Postmark inbound webhook
gains one branch: when the `To` address matches a `postmark_inbound` mailbox,
the parsed message enters the same intake path instead of the marketing
responder.

**Provider adapter contract** (`apps/web/lib/mailroom/providers/`):

```
probe(config)            → { ok, mailboxLabel, error? }
fetchNew(config, cursor) → { messages: NormalizedInboundMail[], cursor }
```

`NormalizedInboundMail` is provider-neutral: `providerMessageId`,
`messageIdHeader`, `inReplyTo`, `references`, `from`, `to`, `subject`,
`textBody`, `htmlBody`, `receivedAt`, `headers` (the subset the rules read),
`attachments` (name, type, size — bytes are not fetched in this slice).

IMAP: `imapflow` over implicit TLS or STARTTLS, `UID SEARCH UID <lastUid+1>:*`
in the configured folder; a changed `UIDVALIDITY` resets the cursor and the
unique index absorbs the re-read. Microsoft 365: Graph delta on the Inbox using
the existing client-credentials token client; the `deltaLink` is the cursor.

### 4.5 Triage

`triageInboundMail(profile, item)` runs in two stages and is a pure function
over the message plus a classifier port, so it is unit-tested without a model.

**Rules first.** `Auto-Submitted` other than `no`, `List-Id`,
`List-Unsubscribe`, `Precedence: bulk|list|junk`, the existing bounce and
no-reply sender patterns, and delivery-status content types classify the item
as `noise`. Noise is stored (so the record is complete) and goes no further.
Then each reason's `hints` are matched against subject and body; a single
unambiguous hit assigns the reason without a model call. A subject reference is
extracted by the profile's `referencePattern` and confirmed by its lookup.

**Model second.** Anything still unassigned goes to the routed-inference layer
with the existing `email-triage` task type (utility tier, background mode, no
provider pin), the archetype's reason list as the only allowed answers, and the
subject and first four thousand characters of the body. The prompt asks for the
reason key, a one-sentence summary, and a candidate subject reference; the
parser accepts only keys from the profile and falls back to the profile's
default reason with `urgency` from that reason. A classifier failure never
blocks intake; the item is routed to the default queue and flagged.

Inbound text is untrusted (Work Rooms design §14). The classifier output is
data; nothing in the triage path calls a governed verb, and the coworker turn
that drafts a reply receives the message as quoted material, never as
instructions.

### 4.6 Dispatch

1. **Known sender first.** If the sender's address resolves through
   `ingestWorkroomChannelEvent` to an accepted room event, the item records that
   room and stops: the person was already in a conversation with us.
2. **Queue room.** Otherwise the reason's queue room is opened or reused, a
   `WorkItemMessage` is written, and the item records `routedWorkItemId`,
   `queueKey`, `mailroomStatus = routed`, and `acknowledgeBy` from the urgency.
3. **Notify.** The queue's owner resolves through the room-owner ladder. When a
   principal is bound, `sendQueueNotification` dispatches through the
   communication dispatcher, in-app as the floor, urgency mapped from the item's
   urgency. When no principal is bound the item still surfaces through §4.7, so
   an unowned queue is visible rather than silent.

### 4.7 Chase

An attention source `mailroom-item` projects two sets onto the owner's
"Needs you" surface: every unacknowledged item whose `acknowledgeBy` has
passed, and every item of `immediate` urgency from the moment it is routed.
Each carries the sender, the reason, the age past the window, and a deep link to
the item. Acknowledging from the item, the room, or the attention card records
`acknowledgedAt` and the principal, and the card clears. This is the
delivered-but-not-received reconciliation BI-4F7BB48B asks for, applied to mail.

### 4.8 Reply

From an item the operator asks for a draft. The Mailroom coworker composes it
with the reason's tone, the business identity, and, when a subject reference
exists, the facts the platform holds about it (an animal's status and
placement readiness, for example). The result is an `OutboundDraft` pending
review. Approving it calls the shared `sendEmail` with `inReplyTo` and
`references` set from the original headers, records `repliedAt` and the
outbound message id on the item, and writes a `WorkItemMessage` from the
business on the room. When `isEmailConfigured()` is false, approval returns the
configuration gap and the settings route; nothing is recorded as sent. Sending
is a consequential, outward action and stays behind explicit approval per the
kernel commandment on outbound actions.

### 4.9 Setup step and Mailroom surface

`SETUP_STEPS` gains `mailroom` directly after `storefront`, because the
archetype is chosen there and the expected mailboxes depend on it. Its route is
`/workspace/mailroom`, a real portal route, following the setup design rule that
steps tour the product. The page shows the archetype's expected mailboxes as
cards, each with a connect action (provider, address, credentials, purpose,
interval) that probes before saving and runs a first read on success. The step
is skippable; the skip is recorded in setup context, and `buildStepTrigger`
gives the onboarding coworker a `mailroom` case that explains what the Mailroom
does in two or three sentences and names the page to return to.

After setup the same route is the Mailroom: mailboxes and their last poll, the
item list with reason, urgency, queue, acknowledgement state and age, filters
on those typed fields, the item view with the message, its triage, its room,
acknowledge and draft-reply actions, and a "Check now" per mailbox. The route
carries a purpose contract and an exposure declaration like every other route.

### 4.10 The Mailroom coworker

A coworker `AGT-WS-MAILROOM` ("mailroom-coordinator") is registered in the
agent registry with the specialist tier and grants limited to reading items,
recording triage overrides, and creating reply drafts. It owns the triage model
turn (so token usage is attributed, not `unknown`) and the reply-draft turn.
It is established through the coworker paved road at setup completion when at
least one mailbox is connected, and lazily on the first connect otherwise. It
does not poll: intake is a platform job so the guarantee holds with no AI
client and no coworker present.

## 5. Enforcement

- A new `MailboxProvider` value without an adapter fails the build: the adapter
  registry is a `Record<MailboxProvider, MailboxProviderAdapter>`, the same
  compile-time parity the channel registry uses.
- A profile reason whose `queueKey` names no queue, or a mailbox whose
  `purposeKey` names no purpose, fails the archetype seed test.
- The poll job is in the scheduled-jobs catalog and gated by `gateAtEntry`.
- New API routes declare `@exposure authenticated`; the setup and Mailroom
  pages carry purpose contracts.
- Mailbox secrets are written only through `credential-crypto`; the safe
  projection never includes them; a probe uses them and discards them.
- The classifier's allowed keys are the profile's; a key outside it is a parse
  failure, not a new reason.

## 6. Read model and UX

The Mailroom page answers, in order: which mailboxes are being read and when
they were last read; what arrived that nobody has acknowledged, worst first;
what arrived today by reason. An item shows the message as received, the
triage with a one-line reason the operator can override, the room it went to,
who was told, and the reply state. Every filter is a typed column. The empty
state is the education state: three sentences on what the Mailroom does, the
archetype's expected mailboxes, and a connect action. The setup step reuses the
same components inside the setup overlay.

## 7. Scale, security, and rollback

Volume for the target segment is tens to low hundreds of messages a day; a
fifteen-minute sweep over a handful of mailboxes is trivial. Body storage is
bounded (text body kept whole, HTML kept whole, attachments as metadata).
Credentials are encrypted at rest with the install's key. Inbound content is
never rendered as HTML without sanitisation and never interpreted as an
instruction. A mailbox can be paused without deleting history. Rollback: remove
the setup step and the job registration; tables remain and are inert. The
Postmark branch is guarded by the existence of a `postmark_inbound` mailbox, so
an install without one is unaffected.

## 8. Non-goals

- Physical parcel tracking and carrier integrations (kept on BI-4F7BB48B as
  deferred scope).
- Running a mail server (epic tier 2) or orchestrating managed hosting (tier 3).
- A Gmail API adapter: Gmail is reachable over IMAP with an app password in this
  slice; OAuth for Google is a follow-on.
- Sending any mail without a person's approval.
- Fetching attachment bytes or reading calendars.

## 9. Acceptance

The design is accepted when the acceptance criteria in §1.1 are demonstrated on
the reference install with one IMAP mailbox connected during a fresh setup run:
a vet's message about a named animal lands in the veterinary queue with the
animal reference, an unacknowledged found-animal report appears on "Needs you"
after four hours, and a drafted reply to an adopter is approved and arrives
threaded in the adopter's mail client. A second run that skips the step
completes setup and shows the education state on the Mailroom page.
