# WhatsApp Secretary Gateway Design

**Date:** 2026-03-21 (rewritten 2026-05-16)
**Status:** Draft — channel-specific slice
**Epic:** EP-SECRETARY-001
**Relationship:** This is the WhatsApp-specific slice under the [Employee Communication Fabric](2026-05-15-employee-communication-fabric-design.md) and the [Autonomous Coworker Runtime](2026-05-11-autonomous-coworker-runtime-design.md). Identity, queue, dispatch, failure taxonomy, and step-up substrate are inherited from those specs and **not duplicated here**. This document owns only the WhatsApp-specific concerns: Meta Cloud API posture, the 24-hour customer-service window, Message Templates (HSMs), webhook integrity, OTP-over-WhatsApp binding, and outbound conversation cost.

---

## 1. Goal

Add a WhatsApp-first company secretary that:

- Operates one outward-facing identity per organization (the secretary).
- Lets validated employees act through bound WhatsApp numbers, never beyond their actual authority.
- Serves unknown/public senders in a limited, safe mode.
- Routes cross-human asks into the shared `WorkItem` queue.
- Sends proactive reminders within Meta policy (24-hour window + approved templates).

The secretary is useful, but **never** a backdoor admin user. Authority is always carried from a resolved `Principal`, never from a phone number.

## 2. Non-Goals

1. Multi-channel substrate — owned by the fabric spec.
2. Generic identity/queue/dispatch models — already shipped per the fabric spec.
3. Payments, credential changes, admin actions, or any side effect categorically prohibited from chat (§5.2).
4. DPF acting as a Meta Solution Partner. See §3.

## 3. Meta Posture — DPF as Conduit, Not Broker

**DPF does not enroll as a Meta Business Solution Provider, does not host a shared WhatsApp Business Account, and does not own any customer's outbound conversations.**

The supported posture is:

- The customer owns their Meta Business Account and their WhatsApp Business Account (WABA).
- The customer registers a phone number through their own Business Manager.
- The customer creates a system-user access token in their own Business Manager and provides it to DPF via the existing `IntegrationCredential` flow (per AGENTS.md "DPF is a conduit, not a broker").
- DPF makes WhatsApp Cloud API calls **directly** from the customer's account, using the customer's token, against the customer's WABA. No DPF-hosted intermediary.
- Webhook callbacks are configured by the customer to point at the install's public DPF endpoint.

Alternative postures explicitly rejected:

- **BSP-mediated (Twilio / 360dialog / MessageBird):** pulls DPF into a partner posture, adds per-message margin, and creates a credential bottleneck. Rejected.
- **DPF-hosted WABA:** makes DPF responsible for Meta policy violations across all installs. Rejected.

The customer-owned-credential posture means: the secretary's WhatsApp identity is **the customer's**, not DPF's. DPF supplies the runtime, governance, and audit; the customer supplies the Meta relationship.

## 4. Identity, Sessions, and Queue — Inherited from the Fabric

This spec does **not** introduce new identity, session, or queue tables. The fabric spec already ships the substrate:

| Concept | Substrate (fabric / runtime) |
| --- | --- |
| Secretary identity | `Principal{kind:"service_secretary"}` + `PrincipalAlias{aliasType:"whatsapp_waba", aliasValue:"<phone_number_id>"}` |
| Secretary WhatsApp channel | `CommunicationChannelBinding{channelType:"whatsapp", providerKey:"meta_whatsapp", providerAccountId:"<waba_id>"}` |
| Employee WhatsApp binding | `PrincipalAlias{aliasType:"whatsapp_msisdn", aliasValue:"+E.164"}` + `CommunicationChannelBinding{channelType:"whatsapp", principalId:<employee>}` |
| Channel session continuity | `CommunicationChannelSession{channelType:"whatsapp", externalPeerId:"+E.164"}` |
| Human ask / queue item | `WorkItem` (`sourceType` ∈ `approval | manual-task | scheduled`) + `WorkItemMessage` |
| Coworker work parent | `TaskRun` (per runtime spec) linked from the channel session (fabric §14.1) |
| Step-up challenge | `ChannelStepUpChallenge` (fabric §14.2) |
| Delivery evidence | `CommunicationDeliveryAttempt` (fabric) |
| Failure taxonomy | runtime `exceptionClass` enum (runtime §5.6 + fabric §14.3) |

If the implementation discovers a model that's missing, that model lands in the fabric spec — not here.

## 5. Trust Classes and Action Tiers

The trust classes from the original draft remain — they are WhatsApp-specific only inasmuch as the channel determines how the sender is identified.

### 5.1 Sender trust classes

| Class | Resolution | Allowed |
| --- | --- | --- |
| Unknown/public | `PrincipalAlias` lookup on `whatsapp_msisdn` returns no match | Public info, store hours, lightweight booking inquiry, "pass a message" |
| Known customer contact | Match resolves to a `CustomerContact`'s principal | Public-safe + customer-safe workflow actions explicitly whitelisted |
| Bound employee | Match resolves to an `EmployeeProfile`'s principal, binding verified | Low-risk operational actions within employee's actual authority; cross-human asks; proactive reminders |

These trust classes feed the runtime's `requiresTaskRun()` predicate (runtime §7.1) and the channel adapter's authority resolution before `tasks/submit` (fabric §14.4).

### 5.2 Action trust tiers

| Tier | Examples | Requirement |
| --- | --- | --- |
| Public | Product/service info, hours, lightweight inquiry | None |
| Bound-employee operational | Schedule check, low-risk record creation, customer notification, create `BacklogItem` | Bound binding + employee already holds the authority |
| Bound-employee sensitive | Sensitive customer/HR disclosure, materially consequential workflow change | Step-up via `ChannelStepUpChallenge` (fabric §14.2) |
| Prohibited in chat | Payments, credentials/secrets, security/admin config, any action beyond employee authority | Refused; surfaces as `policy-violation` (runtime §5.6) |

## 6. Employee Binding — OTP Over WhatsApp

**Binding flow** (no separate SMS or email required — the user is already on WhatsApp):

1. Employee adds a WhatsApp number in DPF (`/employee/<id>/reachability`).
2. Platform generates a server-side nonce, persists a pending `ChannelStepUpChallenge` keyed by `principalId` + nonce, and sends a templated message to the candidate number through the WhatsApp Cloud API (using an approved utility template — the binding-verification template is one of the templates the customer must pre-approve, see §7).
3. Employee replies with the nonce in WhatsApp.
4. Webhook resolves the inbound, matches the nonce against the open challenge, marks the challenge consumed, creates the `PrincipalAlias` + `CommunicationChannelBinding` rows.
5. Future inbound from that number is treated as employee-authenticated channel traffic.

**Lifecycle rules:**

- Re-verification required after 90 days of inactivity, or on any change-of-device signal Meta surfaces.
- Self-revoke: employee replies `STOP` (Meta-policy keyword); revokes binding and opts out of proactive sends.
- Admin-revoke: platform admin can revoke any binding; written to `AuthorizationDecisionLog`.
- One employee may bind multiple numbers; one number may **not** bind to multiple employees (enforced by `PrincipalAlias.@@unique([aliasType, aliasValue, issuer])`).

## 7. Message Templates (HSMs) and the 24-Hour Window

Meta's WhatsApp Business Messaging Policy splits outbound into two regimes:

| Regime | Trigger | Outbound rule |
| --- | --- | --- |
| **24-hour customer service window** | Customer sent an inbound message within the past 24 hours | Free-form prose, media, interactive buttons allowed |
| **Outside the window** | No inbound from this peer within 24 hours | **Only pre-approved Message Templates (HSMs)** in categories `utility`, `marketing`, or `authentication` |

Most secretary outbound work is *outside* the window — appointment reminders, follow-up nudges, SLA-breach alerts, binding verification. These all require approved templates.

**Substrate addition (fabric §6 candidate, owned by the fabric spec):** a `MessageTemplate` entity with `providerKey`, `providerTemplateId`, `category`, `language`, `variableSchema`, `approvalStatus`, `approvedAt`, `lastQualityScore`. The fabric's `CommunicationAdapter.capabilities.templatesRequired` (already shipped) becomes meaningful with this entity behind it.

**Authoring + submission flow:**

1. Admin authors a template in DPF (`/platform/tools/integrations/communications/whatsapp/templates`).
2. DPF submits the template to Meta via Cloud API; stores Meta's response with `approvalStatus = "pending"`.
3. Meta returns approved/rejected (typically within 24 hours).
4. Approved templates become eligible for use by `source="proactive"` runs.

**Per-send selection logic:**

- Inside the 24-hour window: free-form via the existing coworker reply path.
- Outside the window: the dispatcher must select an approved template + variable values. If no approved template fits the intent, the run fails with `exceptionClass = "policy-violation"` (per fabric §14.3) — the runtime does not attempt a free-form send Meta will reject.

**Quality-rating monitoring:** Meta surfaces a per-number quality rating (GREEN/YELLOW/RED). Drop to RED auto-pauses outbound on that number until quality recovers. DPF must surface the current rating in the admin communications hub and respect the pause.

## 8. Webhook Integrity

Meta Cloud API delivers via HTTPS POST with `X-Hub-Signature-256` HMAC. The fabric's WhatsApp adapter must, in order:

1. **Verify the signature** against the customer's app secret. Mismatch → reject with 401; record gateway audit; do not create any `TaskRun`.
2. **Dedupe** on `messages[].id`. Meta delivers at-least-once and replays on missing 200 ack; idempotency is mandatory. Stored on `CommunicationChannelSession` or a dedicated `WhatsAppInboundEvent` ledger if replay durability is needed.
3. **Acknowledge within 5 seconds** with HTTP 200. Reasoning, agent invocation, and tool execution happen *after* the ack, never before. A slow ack causes Meta to back off the webhook and degrade the number's quality rating.
4. **Normalize** the event (text, image, audio, video, location, contact card, document, interactive-button reply) into the fabric's `NormalizedChannelEvent` shape.
5. **Escalate** to `tasks/submit` (fabric §14.4) if `requiresTaskRun()` returns true; otherwise return inline through the adapter.

Webhook signature mismatch and replay are gateway-level rejections — they do not create `TaskRun`s (per runtime §7.7 / fabric §14.3).

## 9. Step-Up Over the Same Channel

The original draft routed step-up to a portal "queue item / approval task." That doesn't work for a field employee on WhatsApp — they aren't at a portal. Step-up over WhatsApp uses the fabric's `ChannelStepUpChallenge` entity (fabric §14.2):

1. Runtime moves the sensitive `TaskRun` to `status = "auth-required"`.
2. WhatsApp adapter sends a templated step-up message: *"To authorize <action>, reply CONFIRM-A7K2 within 5 minutes. Reply NO to cancel."*
3. Inbound webhook resolves the reply, matches against open challenges for this session/binding, consumes on match, writes audit row, runtime advances `TaskRun.status` back to `working`.
4. On expiry or failed-attempts cap: runtime ends as `rejected` with `exceptionClass = "human-rejected"`.

For categorically-prohibited actions (§5.2 prohibited tier) there is no step-up path — the secretary refuses and may create a `WorkItem` for an authorized human to take the action through the portal.

## 10. Outbound Cost and Abuse Controls

Meta charges per 24-hour **conversation** initiated (per category: utility, marketing, authentication, service). Cost controls:

- **Per-org outbound budget** on `OrgSettings` (or an `AiProviderFinanceProfile`-style row): hard stop on outbound when monthly budget exhausted; warn at threshold.
- **Per-peer inbound rate limit** for unknown senders: N messages per hour; excess returns a generic public template and is not escalated to `tasks/submit`.
- **Block list** propagating to Meta via the API for confirmed-abuse numbers.
- **Opt-in record** per `PrincipalAlias` for proactive sends. Meta policy requires documented opt-in; this is stored on the alias (or via a `principalAliasOptInLog`-shape table if richer audit is needed) and is a prerequisite for any `source="proactive"` outbound to that alias.

Cost ceiling and the opt-in record are enforced by the WhatsApp adapter before any Cloud API call; the runtime treats violations as `exceptionClass = "policy-violation"`.

## 11. Security Rules

Mandatory:

1. The secretary principal (`kind:"service_secretary"`) is never an admin user and never originates authority.
2. Bound phone number proves channel possession, not unlimited authority.
3. Unknown senders remain public/limited by default.
4. Every non-public action resolves to a human authority context or is refused.
5. High-risk actions require step-up (§9).
6. Categorically-prohibited actions (§5.2 prohibited tier) are never executed from WhatsApp.
7. Inbound free text from unknown senders is treated as a prompt-injection surface; the runtime's `prompt-injection-suspected` exception class applies.
8. Webhook signature verification is non-bypassable.

## 12. Rollout — Slice 3 of the Fabric

Per the [Employee Communication Fabric](2026-05-15-employee-communication-fabric-design.md) §9 slice plan, WhatsApp is **Slice 3** (after Slice 0/1 baseline shipped and Slice 2 Teams adapter lands).

### 12.1 WhatsApp Slice 3a — Inbound + reactive secretary

- Cloud API webhook endpoint + signature verification + idempotency + fast ack (§8).
- OTP-over-WhatsApp binding flow (§6).
- Unknown-sender public-safe replies (no `TaskRun`).
- Bound-employee inbound escalates to `tasks/submit` (fabric §14.4).
- Templated step-up over the channel (§9).
- `CommunicationChannelSession.taskRunId` schema delta added if not already in Slice 2.

### 12.2 WhatsApp Slice 3b — Proactive sends

- `MessageTemplate` substrate (§7) — fabric-owned but lands with this slice.
- Template authoring + Meta submission flow (admin UI).
- `source="proactive"` outbound runs (runtime §5.2) with template selection.
- Per-org budget enforcement + opt-in record (§10).
- Quality-rating surfacing + auto-pause (§7).

### 12.3 Deferred

- Voice notes, video, location, contact-card understanding beyond storage. Slice 5+ depending on customer demand.
- Customer-side richer self-service authority (booking changes, profile updates).

## 13. Files and Components Likely Affected

**New:**

- `apps/web/lib/communications/adapters/whatsapp/` — Cloud API client, webhook handler, signature verifier, idempotency store, normalizer, template selector.
- `apps/web/app/api/communications/whatsapp/webhook/route.ts` — webhook endpoint.
- `apps/web/app/(shell)/platform/tools/integrations/communications/whatsapp/` — admin readiness + template authoring UI.

**Extended (fabric-owned):**

- `packages/db/prisma/schema.prisma` — `CommunicationChannelSession.taskRunId` (if not landed in Slice 2), `ChannelStepUpChallenge` (if not landed earlier), `MessageTemplate`.
- `apps/web/lib/communications/dispatcher.ts` — template selection branch for outside-window outbound.
- `apps/web/lib/communications/channel-bindings.ts` — `whatsapp_msisdn` validator (E.164).

## 14. Testing Strategy

**Unit:**

- E.164 validation; binding lifecycle (verify, expire, revoke).
- 24-hour-window state machine; template eligibility selection.
- Webhook signature verification; idempotency dedupe; ≤5s ack budget enforcement.
- Trust-class resolution; nonce match for step-up.

**Integration:**

- Bound employee inbound → `tasks/submit` → `TaskRun` created, session linked.
- Unknown sender inbound → public-safe reply, no `TaskRun`.
- Sensitive action → `auth-required` → step-up sent → nonce match → run resumes.
- Outside-window proactive without approved template → `policy-violation`.
- Outside-window proactive with approved template → send succeeds, evidence recorded.
- Webhook replay → deduped, no duplicate run.

**End-to-end:**

- Field employee asks secretary to schedule a customer follow-up → `WorkItem` created with `sourceType="manual-task"`, assigned employee notified through their preferred channel via the fabric dispatcher.
- Customer asks for a callback → `WorkItem` (`sourceType="approval"`) routed to assigned employee, customer follow-up message confirms receipt.

**Security verification:**

- Webhook signature mismatch rejected with 401, no `TaskRun` created.
- Unknown sender cannot execute privileged action.
- Bound employee cannot exceed actual authority.
- Step-up nonce cannot be reused.
- `STOP` keyword revokes binding and halts proactive outbound to that alias.

## 15. Recommendation

Wait for fabric Slice 2 (Teams) to validate the adapter contract end-to-end, then implement WhatsApp as Slice 3. WhatsApp's API constraints (24-hour window, template approval, quality rating, webhook latency budget) are heavier than any other channel; carrying them on a partly-proven adapter contract is the wrong cost. Once Teams is live, the substrate that WhatsApp needs is either already there (per fabric §14 contracts) or has a clear home (`MessageTemplate` lands with Slice 3b).

The first implementation spec **after** this one should be the Slice 3a plan: webhook + binding + reactive secretary, scoped to the contracts above.
