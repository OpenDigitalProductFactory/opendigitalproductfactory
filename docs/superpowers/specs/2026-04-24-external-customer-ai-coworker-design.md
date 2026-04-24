# External Customer AI Coworker Design

| Field | Value |
|---|---|
| Date | 2026-04-24 |
| Status | Draft |
| Author | Codex + Mark Bodman |
| Scope | Design the first external/customer-facing AI coworker for DPF across public storefront and authenticated customer portal routes, with strong trust disclosure, constrained tool use, customer-safe data access, adaptive human escalation, and a future-facing GAID-backed trust model |

## 1. Problem Statement

DPF already has internal AI coworkers and an internal marketing/workspace design, but it does not yet have a well-governed external customer-facing AI coworker.

The new coworker must solve a different problem from internal coworkers:

1. Help anonymous and authenticated customers understand products and services.
2. Support conversion into inquiry, booking, checkout, or other allowed customer actions.
3. Provide limited account-aware help for authenticated customers or narrowly verified lookups.
4. Present a credible trust model so customers understand what the assistant is, what it can do, and what it cannot do.
5. Avoid exposing internal drafts, strategy, notes, or speculative content.
6. Create useful interaction records and route humans intelligently without creating unmanaged queues everywhere.

The design must also anticipate a future in which external agent identity is verifiable through GAID-style infrastructure and immutable trust badging, even though that external verification ecosystem is not fully implemented today.

## 2. Goals and Non-Goals

### Goals

1. Create one customer-facing assistant identity that works across public storefront and authenticated customer portal routes.
2. Keep the assistant business-branded while making DPF trust and governance visible.
3. Restrict answers to approved customer-safe context and verified customer-scoped data.
4. Make human escalation adaptive to urgency, availability, archetype, and interaction type.
5. Make recording, review, and audit disclosure always visible from first interaction.
6. Design the trust badge so it can evolve into externally verifiable GAID-backed identity without redesigning the UX later.
7. Keep the external coworker cleanly separated from internal marketing, CRM, and operator coworkers.

### Non-Goals

1. Implementing the full GAID public registry, verifier, or immutable external trust ledger in this spec.
2. Designing the internal marketing workspace itself.
3. Giving the customer-facing coworker broad CRM, strategy, or operator access.
4. Allowing autonomous publishing, customer account mutation, or unrestricted cross-customer lookup.
5. Solving every future voice, omnichannel, or external messaging channel in v1.

## 3. Current-State Grounding

### 3.1 Verified Existing Product Surfaces

Verified in the current codebase:

1. Public storefront routes live under `/s/[slug]`.
2. Authenticated customer portal routes live under `/portal/*`.
3. `/portal` currently includes `Orders`, `Services`, `Support`, and `Account`.
4. `/portal/account` is live and customer-authenticated.
5. `/portal/orders`, `/portal/services`, and `/portal/support` exist, but some of those surfaces are still placeholders.
6. Internal storefront operations already have a real `/storefront/inbox` surface.

### 3.2 Verified Existing Human-Handoff and Interaction Surfaces

Verified in the current codebase:

1. `StorefrontInquiry`, `StorefrontBooking`, `StorefrontOrder`, and `StorefrontDonation` already exist in the schema.
2. `/storefront/inbox` already aggregates inquiries, bookings, orders, and donations for internal staff.
3. The platform already has an internal `Notification` model and an in-app notification adapter.
4. The platform already has `WorkQueue` and `WorkItem` models for more formal routed work.
5. SMTP-backed email sending already exists through `apps/web/lib/shared/email.ts`.

### 3.3 Verified Existing Identity and Trust Building Blocks

Verified in the current codebase:

1. Internal agent identity already supports private GAID aliases.
2. Platform AI surfaces already display internal GAID references for coworkers.
3. Tool grants are already enforced through the agent grant model.
4. Tool execution auditing already exists elsewhere in the platform.

### 3.4 Verified Internal Context Boundary

The internal marketing workspace spec at `docs/superpowers/specs/2026-04-24-customer-marketing-workspace-design.md` already establishes an important rule:

1. Internal marketing owns strategy, campaign planning, and operator-facing reasoning.
2. The future customer-facing coworker must consume only approved public-facing context published from internal systems.
3. It must not read raw draft strategy, unapproved campaign plans, or internal notes directly.

### 3.5 Live Backlog Hygiene Check

As of 2026-04-24, the live PostgreSQL backlog did not show an open epic dedicated to this external customer coworker design. The currently open epics are focused on remote assist, customer site records, integration harness work, and lab foundations rather than customer-facing AI concierge design.

## 4. Design Principles

### 4.1 One Assistant, Two Trust Scopes

Customers should experience one assistant identity across `/s/[slug]` and `/portal/*`. The assistant's scope changes visibly with the route and verification context, but its identity does not.

### 4.2 Trust Like a Browser Certificate

The design should follow the spirit of browser certificate UX:

1. Trust should be inspectable.
2. Trust should not require customers to understand the raw identifier format.
3. Identity, authority, and scope should be visible.
4. The detailed underlying trust evidence can live one click deeper.

### 4.3 Public Truth Before Personalized Truth

The assistant must answer from approved public context by default. Customer-specific data is only available when the request is bound to a valid customer identity or a narrowly allowed verification path.

### 4.4 Internal Reasoning Never Leaks Externally

Internal strategy, notes, campaign drafts, operator deliberation, and unrestricted CRM data are never part of the external assistant's context window or retrieval layer.

### 4.5 Adaptive Escalation, Not Queue Sprawl

Every interaction should produce a record, but human routing should adapt to urgency, availability, working hours, archetype, and issue type rather than dumping everything into one unmanaged queue.

### 4.6 Safety Is Both Procedural and Behavioral

Tool grants and data restrictions are necessary but not sufficient. The assistant also needs behavioral screening, anti-circumvention handling, and explicit refusal/escalation rules.

### 4.7 Recording and Review Must Be Disclosed Up Front

Customers should not discover later that the interaction was reviewed or retained. The UI must disclose from first interaction that messages may be recorded and reviewed for service quality, safety, troubleshooting, and security.

## 5. Target Information Architecture

### 5.1 Canonical Customer-Facing Surfaces

The external assistant should appear only on:

1. Public storefront routes under `/s/[slug]`
2. Authenticated customer portal routes under `/portal/*`

It should not appear as an operator-facing assistant in:

1. Internal `/storefront`
2. Internal `/customer`
3. Internal marketing or CRM workspaces

### 5.2 Surface Model

The assistant is presented as:

1. Business-branded assistant name
2. Secondary `Powered by DPF` trust line
3. Always-visible trust/recording disclosure
4. Expandable trust card
5. Route-aware suggested prompts and next actions

### 5.3 Public Storefront Mode

On `/s/[slug]`, the assistant acts as a trusted product and service concierge.

Primary jobs:

1. Explain offers and services
2. Answer FAQ-style product questions
3. Route into inquiry, booking, checkout, or other allowed conversion actions
4. Escalate to a human when the question exceeds scope or requires judgment

Suggested prompts should be things like:

1. `What do you offer?`
2. `Can I book this online?`
3. `What's included?`
4. `Talk to a person`

### 5.4 Authenticated Customer Portal Mode

On `/portal/*`, the assistant keeps the same identity but enters verified account-help mode.

Primary jobs:

1. Help with customer-safe account support
2. Explain account-visible information
3. Check order, booking, billing, or service status when identity rules are satisfied
4. Route support issues toward humans when needed

Suggested prompts should be things like:

1. `Check my order`
2. `Help with billing`
3. `Review my services`
4. `Contact support`

### 5.5 Visible Mode Shift

The UI must explicitly label the active trust scope:

1. `Public information only`
2. `Verified account help`

This keeps one assistant identity while making the permission boundary legible.

## 6. UX Design

### 6.1 Launcher

Use a persistent but non-intrusive launcher near the lower-right edge.

Launcher content:

1. Business-branded assistant name
2. Trust shorthand such as `Verified AI assistant`
3. `Powered by DPF`

### 6.2 Chat Shell

The chat shell should contain:

1. Header with assistant name, business affiliation, and trust badge
2. Scope label showing public vs verified mode
3. Always-visible recording/review disclosure
4. Suggested prompt chips
5. Primary conversation thread
6. Contextual next-action chips

### 6.3 Recording Disclosure

The disclosure must be visible from the first rendered shell, not only after the first message.

Recommended day-one copy:

1. Public storefront:
   `Messages may be recorded and reviewed to improve service, safety, troubleshooting, and security.`
2. Verified account help:
   `Verified support interactions may be recorded and reviewed for account protection, service quality, troubleshooting, and security.`

This disclosure should also appear inside the expanded trust card.

### 6.4 Human Handoff UX

When escalating, the assistant should never imply magical immediate human availability if none exists.

It should communicate:

1. what will happen next
2. what channel is being used
3. what information was captured
4. what the expected next step is

Examples:

1. `I've passed this to the team and recorded the details.`
2. `I've asked the support team to follow up during business hours.`
3. `This needs a human decision, so I've routed it for review.`

## 7. Trust and Badge Model

### 7.1 Core Positioning

The customer-facing trust model should not expose the raw GAID string by default.

Instead:

1. The raw external identifier is the hidden trust anchor.
2. The badge is the customer-facing trust expression.
3. The detailed trust card is the inspectable bridge between those two.

### 7.2 Badge Layers

#### A. Primary Visible Trust

Show:

1. assistant name
2. business affiliation
3. `Powered by DPF`
4. short trust phrase such as `Verified AI assistant for this business`

#### B. Expanded Trust Card

Show:

1. who this assistant represents
2. what it is allowed to help with
3. current trust scope: public info vs verified account help
4. when it hands off to a human
5. recording/review disclosure
6. verification details link or trust details entry point

#### C. Future Verifiable Identity Layer

Design for later support of:

1. externally resolvable identifier
2. third-party verification endpoint
3. issuer and scope claims
4. last attested / last reviewed timestamp
5. operating-scope badge history
6. immutable trust evidence references

### 7.3 Day-One Badge Semantics

The badge language must not overclaim maturity.

Allowed day-one semantics:

1. `Business-authorized AI assistant`
2. `Verified identity and scope published by this platform`
3. `Verification details available`

Avoid day-one claims that imply:

1. complete public GAID federation
2. complete immutable public registry support
3. third-party certification that does not yet exist

### 7.4 Future GAID Alignment

This design should serve as an example implementation path for future GAID adoption:

1. customers trust the badge first
2. advanced users can inspect verification details
3. later infrastructure can resolve and attest the external identity without changing the visible UX model

## 8. Tool Boundary and Safe Data Access

### 8.1 Data Band Model

#### Band 1: Public Approved Context

Available to anonymous storefront users:

1. approved offers
2. approved product/service descriptions
3. approved FAQs
4. approved pricing or price ranges intended for customers
5. approved positioning summaries
6. availability and routing rules
7. trust and disclosure metadata

#### Band 2: Verified Customer Context

Available only when the request is bound to a valid customer identity or permitted scoped lookup:

1. account basics
2. order status
3. booking status
4. billing or invoice status
5. active services appropriate for that customer
6. customer-safe support context

#### Band 3: Internal-Only Context

Never available:

1. raw strategy drafts
2. internal notes
3. unpublished campaign plans
4. operator deliberation artifacts
5. unrestricted CRM data
6. internal backlog and planning content

### 8.2 Publication Boundary

The customer-facing coworker should not read internal sources directly.

Instead:

1. internal marketing and storefront workspaces remain authoring systems
2. a curated customer-safe publication layer emits approved external context
3. the external coworker reads only that approved projection plus tightly scoped customer-service data

### 8.3 Allowed Tool Classes

Allowed classes should remain intentionally small:

1. `read_public_catalog_context`
2. `read_public_faq_context`
3. `read_public_routing_rules`
4. `read_trust_badge_metadata`
5. `start_inquiry_flow`
6. `start_booking_flow`
7. `start_checkout_flow`
8. `lookup_customer_order_status`
9. `lookup_customer_booking_status`
10. `lookup_customer_billing_status`
11. `create_interaction_record`
12. `notify_human_route`

### 8.4 Explicitly Disallowed Tool Classes

Disallow:

1. broad CRM read access
2. internal strategy or notes access
3. arbitrary search across customer records
4. internal admin or operator tools
5. internal marketing authoring tools
6. silent account mutation outside approved workflow steps
7. autonomous publishing or customer communication tools outside the approved response shell

### 8.5 Identity Binding Rule

Every verified-customer tool call must carry explicit customer identity context.

Tool requests must be rejected if:

1. there is no authenticated customer identity when one is required
2. the request is not allowed under the active verification mode
3. the lookup basis exceeds the archetype-appropriate scope

## 9. Safety Model

### 9.1 Layer One: Procedural Safety

Procedural safety includes:

1. route-bound tool grants
2. data-band restrictions
3. identity requirements
4. immutable or durable interaction records
5. audit metadata on tool execution and escalation decisions

### 9.2 Layer Two: Behavioral Safety

Behavioral safety includes:

1. customer-safe skills and prompts
2. anti-circumvention language screening
3. prompt-injection handling
4. internal-data extraction refusal handling
5. identity-bypass refusal handling
6. escalation triggers for misuse or distress

### 9.3 Procedural Screening of Language

The assistant should be screened for:

1. attempts to override instructions
2. attempts to reveal hidden prompts or internal context
3. attempts to retrieve data outside the user's scope
4. attempts to manipulate escalation or tool routing improperly
5. repeated probing behavior that suggests abuse or social engineering

### 9.4 Behavioral Risk Classes

The spec should explicitly classify:

1. prompt injection / instruction override attempt
2. internal-data extraction attempt
3. identity bypass attempt
4. abuse or harassment
5. social engineering attempt

Default behavior:

1. refuse briefly
2. restate what the assistant can help with
3. offer human routing only where appropriate
4. mark the interaction with elevated safety metadata

## 10. Response Policy

### 10.1 Answer Directly

Answer directly when:

1. the answer exists in approved public context
2. the request is straightforward and in scope
3. verified customer context is authorized and sufficient
4. the assistant can safely route into inquiry, booking, or checkout

### 10.2 Ask a Clarifying Question

Ask one short clarifying question when the answer depends on a missing fact that materially changes the result.

Examples:

1. which service the customer means
2. which location or service area applies
3. which order or booking reference should be checked
4. whether the user wants inquiry, booking, or general info

Clarification must be about customer intent, not internal fishing.

### 10.3 Escalate to a Human

Escalate when:

1. human judgment or override is required
2. the request exceeds certified scope
3. identity is insufficient for the requested action
4. the customer is distressed, urgent, or repeatedly blocked
5. the request touches high-risk or sensitive areas beyond approved coverage
6. circumvention or misuse is detected

## 11. Human Escalation Model

### 11.1 Canonical Rule

Every interaction creates a durable interaction record.

Human routing is then adaptive rather than fixed to one queue.

### 11.2 Routing Inputs

Routing should consider:

1. urgency
2. business archetype
3. issue type
4. product/service context
5. anonymous vs authenticated status
6. human working hours
7. configured employee availability
8. preferred business channels

### 11.3 Available Routing Outputs

Current or near-term outputs:

1. storefront inbox record
2. work item / queue record
3. in-app employee notification
4. email notification
5. future mature portal support case

### 11.4 Current Product Reality

Today:

1. the internal storefront inbox is the strongest existing real staff-facing handoff surface
2. work queue and work item primitives exist and are a stronger long-term canonical routing model
3. portal support exists only as an early placeholder and should not be treated as the only escalation destination in v1

### 11.5 Recommended Handoff Architecture

Recommended v1 direction:

1. create an interaction record for every conversation
2. choose the best delivery channel per escalation
3. favor one governed routing policy over many unmanaged visible queues

## 12. Relationship to Internal Coworkers

The external assistant must be a separate governed assistant identity.

It must not be presented as:

1. the internal marketing specialist
2. the internal customer advisor
3. the COO
4. any internal operator persona

The relationship should be:

1. internal coworkers curate, approve, and publish customer-safe context
2. the external coworker consumes approved outputs only
3. the external coworker never inherits internal persona framing directly

## 13. Research and Benchmarking

This design includes the required benchmark research across current commercial and open-source systems plus current prompt-injection guidance.

### 13.1 Systems Reviewed

#### Intercom Fin AI Agent

Sources:

1. [Fin AI Agent FAQs](https://www.intercom.com/help/en/articles/7837535-fin-ai-agent-faqs)
2. [Hand over Fin AI Agent conversations to another support tool](https://www.intercom.com/help/en/articles/7995955-hand-over-fin-ai-agent-conversations-to-another-support-tool)
3. [Intercom human support overview](https://www.intercom.com/customer-support-software/human-support)

What we learned:

1. customer-facing AI should answer only from approved support content and connected data
2. escalation needs explicit rules for sensitive topics
3. AI-to-human handoff benefits from collecting the right context before transfer
4. keeping AI and human records connected improves continuity

Patterns adopted:

1. approved-content-only answering model
2. explicit escalation guidance for sensitive topics
3. context-preserving handoff model

Patterns rejected:

1. treating the AI as a broad omniscient support layer without strict publication boundaries

#### Zendesk AI Agents

Sources:

1. [About AI agents](https://support.zendesk.com/hc/en-us/articles/6970583409690-About-AI-agents)
2. [Managing conversation handoff and handback](https://support.zendesk.com/hc/en-us/articles/4408824482586-Managing-conversation-handoff-and-handback)

What we learned:

1. AI/human handoff state should be explicit
2. routing should respect the organization's established support flows
3. handback to AI is a distinct state, not a fuzzy continuation

Patterns adopted:

1. explicit handoff rules
2. adaptive routing instead of one universal queue
3. clear separation between AI-resolved vs human-owned interaction state

Patterns rejected:

1. opaque escalation behavior where customers do not know who owns the next step

#### Chatwoot

Sources:

1. [Website Live Chat](https://www.chatwoot.com/features/live-chat)
2. [Chatwoot product overview](https://www.chatwoot.com/)

What we learned:

1. customer-facing chat works best when brand-customizable and operationally grounded
2. inboxes, working hours, and multi-brand separation matter
3. offline/working-hours behavior needs to be explicit to customers

Patterns adopted:

1. always-visible business affiliation
2. working-hours-aware human routing
3. inbox-aware escalation outputs

Patterns rejected:

1. pretending humans are immediately available when the operating schedule says otherwise

#### Botpress

Sources:

1. [Introduction to Webchat](https://botpress.com/docs/webchat)
2. [Knowledge Bases](https://www.botpress.com/docs/studio/concepts/knowledge-base/introduction)

What we learned:

1. customer-facing assistants benefit from a strongly scoped knowledge base
2. webchat needs a configurable front-end shell
3. transitions when the knowledge base cannot answer should be intentional

Patterns adopted:

1. curated knowledge publication layer
2. explicit scope limitation of external context

Patterns rejected:

1. letting the assistant improvise from uncurated mixed internal and external sources

#### Current Prompt-Injection Guidance

Sources:

1. [OpenAI: Understanding prompt injections](https://openai.com/safety/prompt-injections/)
2. [OpenAI: Designing AI agents to resist prompt injection](https://openai.com/index/designing-agents-to-resist-prompt-injection/)
3. [OWASP Prompt Injection](https://owasp.org/www-community/attacks/PromptInjection)
4. [OWASP GenAI LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
5. [Anthropic: Mitigate jailbreaks and prompt injections](https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks)

What we learned:

1. prompt injection is a layered social-engineering problem, not just a keyword problem
2. limiting tool/data access is necessary but not sufficient
3. monitoring, confirmation, and scoped permissions are part of the defense model
4. external content and user prompts both need screening and risk handling

Patterns adopted:

1. dual procedural + behavioral safety model
2. narrow tool scopes and explicit verification
3. anti-circumvention screening and audit markers

Patterns rejected:

1. assuming RAG or curated context alone solves prompt injection risk

### 13.2 Differentiator

DPF's differentiator is not simply offering chat on a storefront.

The differentiator is:

1. business-branded customer UX with visible trust badging
2. future GAID-aligned external identity design
3. clean separation between internal reasoning and published customer-safe truth
4. adaptive human routing based on real operations
5. explicit audit and recording disclosure from first interaction

### 13.3 Anti-Patterns to Avoid

1. exposing internal drafts or notes
2. making raw GAID strings the primary customer trust surface
3. giving the assistant broad CRM/operator access
4. unmanaged queue proliferation
5. hidden recording or review behavior
6. pretending human availability the business cannot actually support
7. allowing conversational identity bypass for sensitive requests

## 14. Recommended Outcome

Approve a business-branded, DPF-powered external customer coworker that:

1. lives on `/s/[slug]` and `/portal/*`
2. uses one assistant identity with visible trust-scope changes
3. answers only from approved public context and verified customer-scoped data
4. discloses recording and review from first interaction
5. uses constrained tools plus behavioral screening
6. routes humans adaptively based on urgency, availability, and archetype
7. is designed now to support future GAID-backed external verification later

## 15. Open Questions for Later Implementation Planning

1. What is the exact published data model for approved external customer-safe context?
2. Which archetypes permit non-authenticated reference-based status lookups, and under what proof rules?
3. What should be the canonical interaction record model for all customer AI conversations?
4. Which human-routing outputs should be first-class in v1: storefront inbox, work items, notifications, email, or some combination?
5. How should immutable trust-badge evidence be stored once the external verification layer lands?
