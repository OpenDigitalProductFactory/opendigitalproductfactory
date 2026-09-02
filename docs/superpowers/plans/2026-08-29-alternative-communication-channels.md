---
status: active
---

# Alternative Communication Channels Implementation Plan

**Epic:** `EP-03CC88EF` — Alternative communication channels: one dispatcher, many providers
**Branch:** `doc/communication-channels-epic-plan` (this plan) — implementation branches are per-BI
**Predecessor epic:** `EP-COMM-FABRIC` (Employee Communication Fabric), lost in the 2026-08-22 backlog reset

## Outcome

DPF gains working communication channels beyond in-app. A message can leave DPF through a provider the operator actually uses, and a reply can come back and attach to the Work Room that originated it.

The epic delivers a substrate fix first and providers second, because no adapter is reachable today regardless of whether it exists.

## Design grounding

This plan implements existing ratified design. It introduces no new architecture.

- **Channel posture:** `docs/superpowers/specs/2026-05-15-employee-communication-fabric-design.md`. DPF is system of record; external channels are adapters; DPF does not build a chat client. §4.1 carries the per-provider research (Teams for Microsoft-first, Slack for software teams, WhatsApp for field and volunteer operations) and §5 the per-provider binding fields.
- **Room attachment:** `docs/superpowers/specs/2026-07-26-work-rooms-collaboration-design.md` §12 "Channel continuity" — the seven-step inbound flow, already implemented in `apps/web/lib/work-management/room-channel-ingress.ts`.
- **Room boundary:** the same spec §4.5 reject list. "Channel membership as authority" and "Provider-local room clone" are both rejected. A provider channel never becomes a Work Room.
- **Action boundary:** kernel decision `DI-EFEB6002A5C5`, encoded as `interactive: false` on every shipped adapter. An adapter cannot carry an action.
- **Scope fence, inherited:** `docs/superpowers/plans/2026-07-26-work-rooms-collaboration.md` line 469 routes provider capability out of Work Room PRs and into the communication fabric epic. This plan is the receiving end of that fence.

## Current state

Established by reading the code, not inferred.

**Outbound is built and unwired.**

- `COMMUNICATION_CHANNELS` (`apps/web/lib/communications/channel-types.ts`) declares eight channels: in-app, push, email, teams, slack, whatsapp, telegram, webhook.
- `apps/web/lib/queue/notification-adapter.ts` registers at most two — in-app, plus Expo push when configured.
- `createEmailAdapter` has zero non-test imports. `registerAdapter` has zero callers.
- `selectCommunicationPlan` (dispatch-policy.ts) and `planReach` (attention/reach-policy.ts) have no production caller. The only live send path hardcodes `channel: "in-app"`.
- The dispatcher's answer to a missing adapter is a per-send `adapter_not_registered` failure record. Nothing surfaces the gap earlier.

**Inbound is built and unreachable.**

- `ingestWorkroomChannelEvent` implements §12 and has a real consumer in `apps/web/lib/finance/bookkeeping/bookkeeping-inbound-trigger.ts`, so the contract is proven.
- No inbound HTTP route exists for any channel anywhere under `apps/web/app/api`.
- `CommunicationChannelSession` carries `agentThreadId` and `workItemId` but no Workroom foreign key. That is deliberate: the Work Case is the durable room anchor while sessions and TaskRuns turn over.

## Backlog coverage

This plan is epic-scoped, not umbrella-BI-scoped. It carries no `**Backlog item:**` header, so `scripts/check-plan-backlog-coverage.mjs` treats it as outside the coverage-receipt gate by design — that gate validates a plan bound to one umbrella BacklogItem with a live MCP receipt. Stated openly rather than passed by omission: coverage here is the epic and its eight filed items below, each independently shippable and already linked to `EP-03CC88EF`. If this work is later rebound to an umbrella BI, add the `Decision` / `Parent` / `Receipt` / `Rationale` / `Dependencies` block and record a real receipt; do not synthesize an umbrella item solely to satisfy the gate.

Eight items, all under `EP-03CC88EF`.

| BI | Work | Size |
| --- | --- | --- |
| `BI-8B6C262D` | Declared channel with no adapter fails silently at send instead of loudly at startup | S |
| `BI-1DBE64A4` | Email adapter written, tested, never registered | S |
| `BI-5F608E5C` | Urgency routing ladder has no production caller | M |
| `BI-7FA101D2` | Slack adapter, credential provider, inbound capability | M |
| `BI-8BCA9666` | No provider webhook route exists for any channel | M |
| `BI-7EA0E228` | Microsoft Teams adapter | M |
| `BI-1C52AA58` | WhatsApp adapter | M |
| `BI-C758ABC1` | HITL gate channel vocabulary is untyped and diverged | S |

## Sequence

Four phases. Each phase is independently shippable and leaves the system working.

**Phase 1 — substrate.** `BI-8B6C262D`, `BI-1DBE64A4`, `BI-5F608E5C`.
Nothing downstream is reachable until the dispatcher is wired. Land the parity guard first so the rest of the epic cannot regress silently.

**Phase 2 — Slack end to end.** `BI-7FA101D2`, `BI-8BCA9666`.
Slack is the partner request and the proving ground for the adapter shape in both directions. The webhook route lands with Slack as its first provider; Teams and WhatsApp extend it rather than adding parallel routes.

**Phase 3 — remaining providers.** `BI-7EA0E228`, `BI-1C52AA58`.
Built against the shape Phase 2 proved. These may run in parallel with each other.

**Phase 4 — vocabulary hygiene.** `BI-C758ABC1`.
Independent of the others. May land at any point; it is listed last only because nothing blocks on it.

## Shared implementation rules

1. **Extend, do not duplicate.** The email adapter already wraps the existing Postmark client rather than adding a second mail path. Every provider adapter follows that: reuse the existing credential provider (`microsoft365` for Teams), and reuse the existing WhatsApp Secretary Gateway design rather than starting a second WhatsApp path.
2. **Registration is conditional on credentials.** An adapter registered without its configuration fails at send time instead of registration time, which is the failure mode this epic exists to remove.
3. **`interactive: false` on every adapter in this epic.** Flipping it is out of scope and gated on the per-class security review named in the fabric spec. Channels carry a notification and a deep link; the decision resolves in DPF.
4. **Fail open on the send path.** A channel failure must not fail the caller, and in-app remains the floor when a plan is empty. The current dispatcher records rather than throws; preserve that.
5. **Inbound refuses by default.** `ingestWorkroomChannelEvent` requires a binding that is active, `verified`, and permits `inbound`. An unrecognized sender is a refusal, not an implicit onboarding path. Do not relax this to make a test pass.
6. **Idempotency is the provider's event id.** The ingress key is `providerKey:providerEventId`. Every provider redelivers; supply the real provider event id, never a generated one.
7. **New test files must be registered.** The CI test inventory in `scripts/ci-policy-guards.mjs` is hand-enumerated — a new `*.test.mjs` that is not listed there silently never runs.

## Phase 1 — substrate

### BI-8B6C262D — channel/adapter parity guard

**Deliverable.** A check that fails when a channel is declared in `COMMUNICATION_CHANNELS` without either a registered adapter or an explicit not-yet-implemented marker.

**Expected files.** `apps/web/lib/communications/channel-parity.ts` (the marker registry and the assertion), `channel-parity.test.ts`, and a registration in the CI test inventory.

**Red test.** With `slack` declared and no adapter and no marker, the check fails. With a marker present, it passes and the channel reports as unavailable rather than offered.

**Design note.** Prefer a test-time assertion over a startup throw. A startup throw would block boot on an install that legitimately has no Postmark or Expo configuration. The goal is that a developer adding a channel to the enum cannot land it without deciding what happens on send.

**Verification.** Unit tests, `pnpm --filter web build`.

**Rollback.** Delete the check; no runtime behaviour depends on it.

### Implementation record (2026-08-29)

Shipped as `apps/web/lib/communications/channel-parity.ts` + `channel-parity.test.ts`.

Two deviations from the sketch above, both deliberate.

**The invariant is enforced at compile time, not only by a test.** `CHANNEL_IMPLEMENTATION` is a `Record<CommunicationChannel, ChannelImplementation>`, so widening `COMMUNICATION_CHANNELS` fails `pnpm --filter web build` until the new channel is classified. That is stronger than the planned assertion and needs no startup throw, so the concern about blocking boot on an unconfigured install does not arise. The runtime test remains as a backstop against a type assertion widening the enum past the Record.

**"Implemented" and "registered" are separate axes.** The plan spoke of "a registered adapter or an explicit not-yet-implemented marker", but those collapse two different questions. Whether an adapter exists is a property of the tree; whether it is active is a property of this install's configuration. `describeChannelAvailability(channel, registeredChannels)` returns `available` / `not-configured` / `not-implemented` so a surface can distinguish "email works once you add Postmark" from "Slack does not exist yet". The integrations page currently lists Slack beside working channels with nothing to separate them; this is the contract that lets it stop.

`intent` on an unimplemented channel is prose, and a test asserts it never contains a `BI-`/`EP-` identifier. A hardcoded backlog id is install-local data that dangles on a fresh install and after every reset — the defect PR #4877 fixed in the integration coverage matrix. Naming the work instead is the same discipline applied here.

### BI-1DBE64A4 — register the email adapter

**Deliverable.** `createEmailAdapter` is registered in `apps/web/lib/queue/notification-adapter.ts` when Postmark configuration is present.

**Expected files.** `notification-adapter.ts` and its test.

**Red test.** An email dispatch currently returns `adapter_not_registered`. After the change, with configuration present, it reaches the Postmark client seam; with configuration absent, the channel reports unavailable via the Phase 1 marker rather than failing at send.

**Implementation note.** Follow the existing `isPushEnabled()` conditional shape. The adapter needs `serverToken` and `from`; gate on both.

**Verification.** Unit tests, production build, and one real send against the configured install.

**Rollback.** Remove the registration line. The adapter returns to being inert, which is the current state.

### BI-5F608E5C — wire urgency routing to the live send path

**Deliverable.** `sendQueueNotification` resolves the recipient's verified `CommunicationChannelBinding` rows, calls `planReach`/`selectCommunicationPlan`, and dispatches to the selected channels.

**Expected files.** `apps/web/lib/queue/notification-adapter.ts`, caller wiring for `apps/web/lib/attention/reach-policy.ts` (the policy itself is correct and tested), and tests.

**Red test.** A recipient with a verified binding on a non-in-app channel and an urgent notification currently receives in-app only. After the change the plan is honoured, `fanOut` is respected for emergency, and a recipient with no bindings still receives in-app.

**Implementation notes.**

- `planReach` returns `reachable: false` for the custodian and weekly-digest lanes. Honour that: those are not interruptions.
- `oneClickEligible` is already computed and must not be used to authorize anything in this BI — no adapter carries an action.
- Preserve the existing fail-open posture and the in-app floor.

**Verification.** Unit tests, production build, and a UX pass on the notification path against the running app per AGENTS.md §4.3.

**Rollback.** Restore the hardcoded `channel: "in-app"` send. One revert, no data migration.

## Phase 2 — Slack end to end

### BI-7FA101D2 — Slack adapter and credential provider

**Deliverable.** Slack becomes real in both directions: a credential provider so `credentialProvider: "slack"` resolves, a verified `CommunicationChannelBinding`, an outbound adapter against `chat.postMessage`, and `capabilities.inbound: true`.

**Expected files.** A Slack credential provider under the existing integrations credential surface, `apps/web/lib/communications/slack-adapter.ts`, and tests.

**Red test.** A Slack dispatch currently returns `adapter_not_registered`. After the change, with credentials present, it reaches the `chat.postMessage` seam and records a `CommunicationDeliveryAttempt` carrying a `providerMessageId`.

**Binding fields.** Per fabric spec §5: workspace, user ID, channel preference.

**Scope fence.** `interactive: false`. Slack's interactivity API is researched in the spec and deliberately not adopted here.

**Verification.** Unit tests, production build, one real outbound message to the partner workspace.

**Rollback.** Remove the registration; the adapter goes inert.

### BI-8BCA9666 — inbound webhook route

**Deliverable.** A governed inbound route that terminates Slack's Events API callback and calls `ingestWorkroomChannelEventPrisma`.

**Expected files.** A route under `apps/web/app/api/` for provider webhooks, a per-provider signature verifier, and tests.

**Non-negotiable requirements.**

- **Signature verification before any DB read.** Slack signs with `X-Slack-Signature` and `X-Slack-Request-Timestamp` over the *raw* body. A route that parses JSON before verifying cannot verify. Preserve the raw body.
- **Replay rejection** on the timestamp window, in addition to the `eventId` idempotency the ingress already provides.
- **URL-verification handshake** (`url_verification` challenge) answered without touching room state.
- **Unbound senders are refused.** The ingress already requires a verified binding; the route must not create one implicitly.
- **`trustLevel` is honoured**, not defaulted to trusted.
- **No governed verbs execute from an inbound message.** Per §12, delivery receipts prove transport, not authorization, and sensitive actions require `auth-required`/step-up. This route attaches observed channel events only.

**Red test.** A correctly-signed Slack event from a verified binding produces exactly one `WorkItemMessage`; a replay of the same `event_id` produces none; a wrong signature is rejected before any query runs; an unbound sender is refused.

**Verification.** Unit tests, production build, and one real inbound message from the partner workspace landing in the correct Work Room's activity.

**Rollback.** Remove the route. The ingress contract returns to being reachable only by the bookkeeping consumer, which is the current state.

**Route note.** This is a net-new route. The net-new route UX-budget contract applies to portal routes; an API webhook endpoint has no page surface, but confirm the route-sensitivity classification before implementation rather than assuming exemption.

## Phase 3 — remaining providers

### BI-7EA0E228 — Microsoft Teams

Outbound against the Graph `chatMessage` API; binding fields tenant, user, channel preference. Reuse the existing `microsoft365` credential provider — do not add a second Microsoft auth path. `channel-types.ts` already normalizes `microsoft teams` and `ms_teams` to `teams`.

**Inbound-specific risk.** Graph change-notification subscriptions expire and must be renewed on a schedule. A lapsed subscription is a silent inbound outage. Renewal must be owned by a scheduled job, not assumed.

### BI-1C52AA58 — WhatsApp

Outbound against the Cloud API, reusing the existing WhatsApp Secretary Gateway design. Set `templatesRequired: true` — WhatsApp Business requires pre-approved templates for business-initiated messages outside the customer service window, and the dispatcher must honour that flag rather than attempting a free-form send the provider will reject.

**Inbound-specific risk.** The 24-hour customer service window governs whether a reply may be free-form or must be templated, and inbound receipt reopens it. Track the window per session, not per message.

**Authority note.** A phone number is not authority. The fabric spec's non-goals include treating a phone number or chat handle as business authority. An unrecognized number is a refusal.

## Phase 4 — vocabulary hygiene

### BI-C758ABC1 — HITL gate channel vocabulary

`ValueStreamHitlGate.channels` (`packages/db/prisma/schema/work-coordination.prisma:635`) is a bare `String[]` with the vocabulary in a comment reading `in-app|slack|email|sms`. It is a second home for a settled axis, contrary to AGENTS.md §8, and it has already diverged: it names `sms`, which is not a `CommunicationChannel`, and omits push, teams, whatsapp, telegram and webhook.

**Deliverable.** The field uses the generated channel union; a migration widens or corrects existing rows; the `sms` question is answered explicitly rather than silently dropped.

**The `sms` decision is substantive.** For field and volunteer operations SMS is the channel people actually use, and it is absent from the platform vocabulary. Either add it as a real channel with an adapter under this epic, or remove it from the comment. Record which, and why.

**Migration rule.** Per AGENTS.md §2 the migration must apply cleanly against any existing data state, with backfill SQL inline in the same migration file.

## Risks and scope fences

| Risk | Signal | Response |
| --- | --- | --- |
| Adapter work starts before the dispatcher is wired | A provider adapter PR appears before `BI-5F608E5C` | Stop. The adapter is unreachable and cannot be verified. |
| Chat becomes action-bearing | An adapter sets `interactive: true`, or a webhook executes a governed verb | Stop. `DI-EFEB6002A5C5` gates this on a per-class security review. |
| A provider channel is treated as a room | A Workroom foreign key is proposed on `CommunicationChannelSession`, or channel membership grants access | Stop. Work Rooms spec §4.5 rejects both. The Work Case is the anchor. |
| Room read/write logic migrates into this epic | Work Room projection code appears in a channel PR | Stop. This epic owns providers; the Work Room slice owns the attachment contract. |
| A second path is created for an existing provider | New Postmark, Microsoft, or WhatsApp auth code | Reuse the existing client or credential provider. |

## Documentation impact

- `docs/architecture/orientation.md` route map gains the inbound webhook route when `BI-8BCA9666` lands.
- The integrations surface copy at `/platform/tools/integrations/communications` describes Teams and Slack as carrying "fast approvals and nudges". Approvals are out of scope under `DI-EFEB6002A5C5`; correct that copy when Slack ships, or it overstates what the channel does.
- `packages/db/src/portfolio-sources/supported-integrations-manifest.ts` already lists Slack as tier-1. No change needed: the coverage axis is derived from real credential status, so it correctly reports `potential` until credentials exist.

## Provenance note

`EP-COMM-FABRIC` was in-progress with 5 items (3 done) in `docs/testing/backlog-snapshots/backlog-2026-06-10-pre-audit.json`. Every Epic and BacklogItem row in this install was created on or after 2026-08-22, so that epic and its items are absent here. The half-wired adapters this plan repairs are its residue. Source references to pre-reset ids — `BI-C7D25599` in the email adapter header, `BI-DG-015` across the governance baseline — resolve to nothing in this install for the same reason. Treat such an id as historical provenance, not as an open item to look up.
