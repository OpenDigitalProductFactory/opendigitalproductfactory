# Employee Communication Fabric Design

**Date:** 2026-05-15  
**Status:** Draft  
**Related backlog:** BI-INT-8D4F72, EP-INT-2E7C1A  
**Related specs:** `2026-03-21-whatsapp-secretary-gateway-design.md`, `2026-04-04-collaborative-work-queue-design.md`, `2026-03-19-mobile-companion-app-design.md`, `2026-04-01-phase-handoff-and-human-authority-engagement-design.md`

## 1. Goal

DPF needs a governed way to reach employees, receive employee responses, and let AI coworkers coordinate with humans without assuming every worker is sitting inside the web portal.

The design goal is an **employee communication fabric**:

- DPF remains the system of record for work, authority, audit, and decisions.
- External channels are adapters, not the source of truth.
- Employees can use the tools they already use, such as Microsoft Teams, Slack, WhatsApp, email, push notifications, and later Telegram.
- Sensitive work still resolves through DPF authority, queue, and audit models.
- DPF does not build a general-purpose chat client before it has a strong communication substrate.

## 2. Current Repo Grounding

DPF already has several pieces that should be reused rather than replaced:

- `AgentThread` and `AgentMessage` model authenticated coworker conversations.
- `Notification` and `PushDeviceRegistration` model in-app and mobile notification projections.
- `WorkQueue`, `WorkItem`, and `WorkItemMessage` model durable human/agent work routing.
- The WhatsApp Secretary Gateway spec already argues for channel adapters, channel sessions, employee binding, authority envelopes, and a shared human queue.
- The Mobile Companion App spec already positions DPF mobile as the owned phone surface for dashboards, agent conversations, approvals, notification history, and push deep links.
- The native integrations area already includes Microsoft 365 Communications and WhatsApp Business readiness surfaces.
- Live backlog inspection on 2026-05-15 showed a communications connector benchmark item, `BI-INT-8D4F72`, under `EP-INT-2E7C1A`; it did not show a clean dedicated employee communication fabric epic.

The conclusion: this should not start as a new chat product. It should start as a refactorable communication layer that extends existing queue, notification, identity, mobile, and native integration work.

## 3. Decision

DPF should **not create its own general chat client first**.

DPF should create:

1. An owned communication center inside the platform.
2. A mobile/push path for DPF-native work.
3. A channel adapter interface for customer-preferred tools.
4. Verified employee channel bindings and delivery preferences.
5. A canonical work queue and audit trail for all decisions.

The DPF mobile app is still important, but its job is not to replace Teams, Slack, WhatsApp, or Telegram. Its job is to provide the governed work surface that external channels deep-link into.

## 4. Research And Benchmarking

### 4.1 Open-source and open-protocol references

**Matrix**

Matrix models communication as extensible JSON events in rooms, with homeservers storing and synchronizing communication history. Adopt the event-log mindset and the idea that transport state is separate from client UI. Do not copy federation complexity into DPF's first slice.

Reference: https://spec.matrix.org/

**Zulip**

Zulip separates direct messages from channel/stream messages and requires explicit topics for channel-style communication. Adopt topic/work-item structure for durable context. Avoid treating free-form channel chatter as the canonical task record.

Reference: https://zulip.com/api/send-message

**OpenClaw**

OpenClaw separates external channels from agent routing and uses deterministic routing rules before model execution. Adopt the bounded channel-adapter pattern and session-key isolation. Do not copy a personal automation trust model directly into DPF; DPF must resolve authority through principals, employee bindings, queue policy, and audit.

Reference: https://docs.openclaw.ai/channels/channel-routing

### 4.2 Commercial and platform references

**Microsoft Teams / Microsoft 365**

Best for enterprise customers already living in Microsoft identity, mailbox, calendar, and Teams. DPF already has a Microsoft 365 communications preview, so Teams should be one of the first enterprise adapters after the core fabric exists.

References:

- https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages
- https://learn.microsoft.com/en-us/graph/api/chatmessage-post

**Slack**

Best for software, product, and services teams. Slack supports bot posting and interactive messages, which fits DPF's quick-response approval and work-item model. Slack should not be the only default because many DPF customers will be Microsoft-first or field/mobile-first.

References:

- https://docs.slack.dev/reference/methods/chat.postMessage/
- https://api.slack.com/interactivity

**WhatsApp Business**

Best for field, local-service, customer-contact, and regions where WhatsApp is the daily communication habit. DPF already has a WhatsApp Secretary Gateway design and WhatsApp Business readiness UI. WhatsApp should be a channel-specific worker/secretary slice, not the whole communication architecture.

Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/

**Telegram**

Telegram is useful where it is culturally common and bot setup is lightweight. It should be supported as an optional later adapter. It should not be the foundation because DPF needs enterprise-grade employee verification, customer-specific governance, delivery receipts, provider compliance, and channel policy. Those belong in DPF, not in Telegram-specific code.

Reference: https://core.telegram.org/bots/features

### 4.3 Patterns adopted

- Canonical work records live inside DPF.
- External channels deliver prompts, summaries, and action requests.
- Inbound channel messages are normalized before agent routing.
- Channel sessions are not authority principals.
- Employees explicitly bind and verify each channel.
- Interactive responses are converted into `WorkItemMessage`, approval, decision, or follow-up records.
- Delivery and read status are recorded as evidence, not treated as completion.

### 4.4 Patterns rejected

- A WhatsApp-only system.
- A Telegram-first system.
- Building a replacement Slack/Teams client.
- Letting the model pick arbitrary outbound channels.
- Treating a phone number, chat handle, or bot user as business authority.
- Executing high-risk actions directly from chat.
- Scattering provider-specific notification logic across route actions.

## 5. User Experience

### 5.1 Employee reachability

Each employee should have a **Reachability** tab or panel in the employee/profile area:

- DPF mobile push: enabled, device status, last seen.
- Email: work email, fallback email, verification state.
- Microsoft Teams: tenant, user, channel preference.
- Slack: workspace, user ID, channel preference.
- WhatsApp Business: verified phone binding where allowed.
- Telegram: optional later binding where the customer enables it.
- Quiet hours, timezone, urgency thresholds, and emergency override policy.

This surface should be compact and operational. Use channel icons, verification badges, last-tested timestamps, and test-message buttons. Keep advanced provider details collapsed.

### 5.2 Admin communication center

Platform Tools should expose a **Communications** hub:

- Provider readiness cards for Microsoft 365, Slack, WhatsApp Business, email, push, webhook, and later Telegram.
- Per-channel health and last delivery result.
- Which business workflows can use each provider.
- A test harness for sending a safe test notification to a known employee.
- Clear separation between read-only preview, outbound notifications, inbound messages, and action-capable approvals.

This should extend the existing native integrations pattern rather than invent a new admin shell.

### 5.3 Work queue and notification UX

The work queue is the canonical employee interaction surface:

- Work items show channel badges, last contact attempt, last response, and next escalation.
- Quick approvals can happen from in-app, push, Slack, Teams, or email links, but the result writes back to the same work item.
- AI coworkers should say plainly who was contacted and how: "I sent this to Alex through Teams and in-app. It is waiting on their response."
- Channel transcripts should not flood the main UI. Show concise evidence and expand only when needed.

### 5.4 DPF mobile

DPF mobile is the owned first-class work client:

- Notification history.
- Push deep links.
- Approval cards.
- Work item responses.
- Field evidence capture later.
- Offline read cache where appropriate.

It should not try to become the user's social chat app.

## 6. Architecture

### 6.1 Canonical records

| Need | Canonical DPF record |
| --- | --- |
| Human work, approvals, asks, handoffs | `WorkItem` |
| Human/agent work conversation | `WorkItemMessage` |
| Coworker conversation | `AgentThread`, `AgentMessage` |
| User alert projection | `Notification` |
| Mobile delivery target | `PushDeviceRegistration` |
| Human identity | `Principal`, `PrincipalAlias`, `User`, `EmployeeProfile` |
| Authority decision | `AuthorizationDecisionLog` |
| Provider credential/readiness | Existing native integration credential rows |
| Provider delivery evidence | New delivery attempt/event records |

Notifications remain projections. Work queue items and decision logs are the durable truth.

### 6.2 Identity and binding

External channel identities must converge into DPF's principal model:

- `PrincipalAlias` stores identity-bearing aliases such as Microsoft Entra object ID, Slack user ID, WhatsApp phone binding, or Telegram user ID.
- A channel binding stores employee preference, provider account, verification status, allowed urgency, quiet hours, and delivery policy.
- A channel session stores external conversation context and maps it to a principal, work item, or agent thread.

Do not introduce channel-specific identity tables that bypass `PrincipalAlias`.

### 6.3 Proposed model additions

The exact Prisma shape should be refined during implementation, but the target concepts are:

```prisma
model CommunicationChannelBinding {
  id                 String   @id @default(cuid())
  bindingId          String   @unique @default(cuid())
  principalId         String
  employeeProfileId   String?
  channelType         String   // dpf_push | email | teams | slack | whatsapp | telegram | webhook
  providerKey         String   // microsoft365 | slack | meta_whatsapp | smtp | expo | telegram_bot
  providerAccountId   String?
  externalSubject     String
  displayLabel        String?
  verificationStatus  String   @default("pending") // pending | verified | failed | disabled
  allowedDirections   String[] @default([]) // outbound | inbound | interactive
  allowedUrgencies    String[] @default([]) // routine | priority | urgent | emergency
  quietHours          Json?
  preferences         Json?
  lastVerifiedAt      DateTime?
  lastTestedAt        DateTime?
  lastError           String?
  isActive            Boolean  @default(true)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model CommunicationChannelSession {
  id                 String   @id @default(cuid())
  sessionId          String   @unique @default(cuid())
  channelType         String
  providerKey         String
  providerAccountId   String?
  externalPeerId      String
  trustLevel          String   @default("unknown") // unknown | public | bound_employee | verified_customer
  principalId         String?
  agentThreadId       String?
  workItemId          String?
  lastInboundAt       DateTime?
  lastOutboundAt      DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model CommunicationDeliveryAttempt {
  id                 String   @id @default(cuid())
  attemptId          String   @unique @default(cuid())
  channelBindingId   String?
  channelType         String
  targetType          String   // notification | work_item | agent_thread | direct_test
  targetId            String
  providerMessageId   String?
  status              String   @default("queued") // queued | sent | delivered | read | failed | expired
  urgency             String   @default("routine")
  errorCode           String?
  errorMessage        String?
  sentAt              DateTime?
  deliveredAt         DateTime?
  readAt              DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

The raw-provider event log may be separate if webhooks need durable replay or redacted troubleshooting. Do not store secret-bearing payloads without the integration-lab redaction policy.

### 6.4 Adapter interface

All external providers should sit behind one interface:

```ts
type CommunicationAdapter = {
  key: string;
  channelType: string;
  capabilities: {
    outbound: boolean;
    inbound: boolean;
    interactive: boolean;
    deliveryReceipts: boolean;
    readReceipts: boolean;
    templatesRequired: boolean;
  };
  verifyBinding(input: VerifyBindingInput): Promise<VerifyBindingResult>;
  sendNotification(input: SendNotificationInput): Promise<DeliveryResult>;
  sendActionRequest(input: SendActionRequestInput): Promise<DeliveryResult>;
  normalizeInboundEvent(input: ProviderWebhookInput): Promise<NormalizedChannelEvent>;
};
```

The model or coworker never chooses a provider directly. It asks the communication dispatcher to contact a principal or work item target. The dispatcher applies channel policy, urgency, reachability, quiet hours, and fallback rules.

### 6.5 Dispatch policy

Default dispatch order:

1. In-platform notification and coworker relay.
2. DPF mobile push when registered.
3. Preferred real-time channel, such as Teams, Slack, or WhatsApp.
4. Email fallback.
5. Emergency policy can fan out across all allowed channels simultaneously.

Customer archetype can influence defaults:

- Microsoft-first enterprise: Teams before Slack.
- Software/product/operator teams: Slack or Teams depending on configured provider.
- Field/local-service teams: WhatsApp before Slack.
- Regions or teams where Telegram is explicitly preferred: Telegram after verification and policy approval.

## 7. Authority and Safety

For every inbound channel event:

1. Normalize the provider event.
2. Resolve channel session.
3. Resolve `PrincipalAlias` and employee binding.
4. Assign trust level.
5. Determine whether the event maps to a work item, coworker thread, or public workflow.
6. Apply authority envelope:

```text
effective channel authority =
  resolved principal authority
  intersected with channel binding policy
  intersected with workflow policy
  intersected with risk and step-up rules
```

Sensitive actions require step-up inside DPF or a tokenized approval flow. Payments, credential changes, admin rights, deployment, and data export should not execute from raw chat.

Security controls:

- Explicit employee opt-in and verification for each channel.
- Provider scopes minimized per adapter.
- Prompt-injection filtering for inbound external messages.
- Rate limits and replay protection on webhook endpoints.
- Tokenized one-time action links for email and SMS-style flows.
- Redacted provider event logs.
- `AuthorizationDecisionLog` for all non-public decisions.
- Delivery receipts are evidence, not authorization.

## 8. Refactoring Budget

At least 20 percent of the implementation budget should be reserved for refactoring before adding more providers.

Targeted refactoring:

1. Extract `apps/web/lib/communications/` with adapter interfaces, dispatcher types, delivery results, and policy helpers.
2. Move in-app notification dispatch behind the same adapter contract.
3. Align existing `apps/web/lib/queue/queue-types.ts` channel constants with the broader provider set.
4. Reuse the native integration catalog for provider readiness instead of adding one-off provider pages.
5. Ensure WhatsApp Business and Microsoft 365 previews expose comparable readiness states.
6. Add contract tests for adapter behavior before Slack, Teams outbound, Telegram, or WhatsApp inbound work grows.

This is not polish. Without this slice, every provider will become a bespoke notification path and DPF will accumulate rework.

## 9. Rollout

### Slice 0: Communication foundation refactor

- Add shared communication adapter types.
- Add delivery attempt result types.
- Add dispatch policy helpers.
- Normalize channel constants.
- Keep providers in read-only or in-app mode where needed.

### Slice 1: DPF-owned delivery

- In-app notification adapter.
- Push adapter using existing mobile registration.
- Email fallback adapter.
- Employee reachability UI.
- Admin communication center shell.

### Slice 2: Enterprise real-time channels

- Microsoft Teams outbound notification/action adapter.
- Slack outbound notification/action adapter.
- Interactive approval or deep-link actions.
- Delivery evidence on work items.

### Slice 3: WhatsApp Secretary channel

- Convert the existing WhatsApp Secretary Gateway draft into a channel-specific implementation plan.
- Employee phone binding.
- Public-safe inbound mode.
- Bound-employee low-risk operational actions.
- Cross-human asks routed to `WorkItem`.

### Slice 4: Telegram and webhook expansion

- Telegram bot adapter where customers explicitly enable it.
- Generic webhook adapter for customer-owned systems.
- Provider-specific policy warnings in the admin center.

### Slice 5: Rich mobile work client

- Work item response cards.
- Approval action cards.
- Field evidence capture.
- Offline read cache.
- Push action buttons where platform support allows.

## 10. UI Standards

This work is operational UI, not marketing UI.

- Use dense but clear layouts.
- Use channel icons and status badges.
- Keep cards for provider/readiness items only.
- Prefer tables, compact lists, segmented controls, toggles, and test-action buttons.
- Use theme-aware DPF custom properties only.
- Avoid hardcoded colors.
- Show last tested, last delivered, last failed, and configured urgency in scan-friendly fields.
- Keep raw provider payloads out of normal operator views.

Expected surfaces:

- `/platform/tools/integrations` gains a Communications grouping or filtered section.
- `/platform/tools/integrations/<provider>` pages show provider readiness.
- `/employee/<id>` or profile settings gains Reachability.
- Work queue item detail shows contact attempts and response evidence.
- AI coworker panel shows concise coordination state, not full channel transcripts by default.

## 11. Testing Strategy

Unit tests:

- Channel binding validation.
- Principal alias resolution.
- Dispatch policy order.
- Quiet-hours handling.
- Urgency fallback.
- Adapter result normalization.

Integration tests:

- Work item creates notification projection.
- Notification dispatch records delivery attempt.
- Teams/Slack action callback maps back to the correct work item.
- WhatsApp bound employee maps to the correct principal.
- Unknown sender stays public/limited.

UX verification:

- Admin configures provider readiness.
- Employee verifies channel binding.
- Operator sends a test message.
- AI coworker creates a human ask and reports the selected channel.
- Work item shows delivery evidence and final response.

Security verification:

- Unknown sender cannot execute privileged action.
- Bound employee cannot exceed role authority.
- High-risk action requires DPF step-up.
- Provider webhook replay is rejected.
- Provider payload logs are redacted.

## 12. Backlog Recommendation

Use `BI-INT-8D4F72` for communications connector benchmarking and readiness comparison.

If this design is accepted, create a dedicated epic:

**Employee Communication Fabric: Governed Employee Reachability, Channel Adapters, and Work Queue Interaction**

Suggested backlog items:

1. Refactor notification and queue delivery behind a shared communication adapter interface.
2. Add employee channel bindings and reachability settings.
3. Add communication delivery attempts and provider event evidence.
4. Add in-app, push, and email adapters as the owned baseline.
5. Add Microsoft Teams and Slack outbound action adapters.
6. Convert WhatsApp Secretary Gateway into the WhatsApp channel slice.
7. Add Telegram as an optional adapter after policy and customer-fit review.

## 13. Open Questions

1. Should Teams or Slack ship first after the DPF-owned baseline, or should this be customer-archetype driven?
2. Should WhatsApp inbound require a separate worker runtime from the first implementation, or can the first slice be webhook-only with delivery constraints?
3. Should `CommunicationChannelBinding` be introduced immediately, or should `PrincipalAlias` plus a smaller preference table land first?
4. Which workflows are allowed to include action buttons outside DPF in v1?
5. What retention policy applies to provider event evidence?
6. Which Telegram-specific use cases justify bringing it ahead of webhook or SMS?

## 14. Recommendation

Proceed with the employee communication fabric, not a custom chat client and not a single-channel WhatsApp or Telegram bet.

The first implementation slice should be the refactor and DPF-owned baseline: shared adapter contract, in-app notification adapter, push/email fallback, employee reachability settings, delivery evidence, and a communication center. After that, add Teams/Slack for enterprise/dev teams and WhatsApp Secretary for field/local workflows. Telegram belongs as an optional adapter once the core fabric proves itself.
