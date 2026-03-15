# External Site Access Design

## Overview

The Digital Product Factory needs a controlled way for AI co-workers to access public external websites for research and configuration assistance. The first concrete use case is branding setup on the admin page, where a user wants to provide a website URL and have the platform derive branding suggestions from it.

This capability should not give models unrestricted internet access. The platform acts as the intermediary: it performs the external request, extracts normalized evidence, logs what happened, and only then provides structured results to the agent for reasoning and optional form assistance.

## Goals

- allow a user to temporarily enable external-site access for the current session on the current page
- support public web search as a generic platform capability
- support public URL fetch and extraction as a generic platform capability
- record evidence for external search/fetch operations
- enable a branding-analysis flow on top of public fetch for the admin branding form
- keep external content read-only and human-visible

## Non-Goals

- authenticated external website access
- side-effecting browser automation such as payments or form submissions on third-party sites
- persistent user preference for external access beyond the current session
- full-site crawling or deep scraping
- autonomous application of branding changes without human review

## User Experience

### External Access Pill

Add an `External Off / External On` pill to the coworker header on pages that can use external-site tools.

Behavior:

- default state is `External Off`
- the user explicitly turns it on
- the toggle is remembered for the current authenticated session and current page
- it resets on logout or session timeout
- the pill remains visible while enabled so the human is aware that public external access is available to the coworker

This is intentionally temporary so users do not forget that external access is enabled.

### Scope

The first slice should be page-aware rather than global. This allows `/admin` branding work to enable external access without implying all other pages should use the same setting.

### Branding Flow

On the admin branding page:

1. user enables `External On`
2. user provides a public website URL or asks the coworker to analyze a URL
3. the platform fetches and extracts branding evidence
4. the coworker proposes branding values
5. if `Hands On` is enabled and the form is registered for assist, the coworker can populate the branding form fields for review
6. the human reviews and clicks apply/save

## Capability Phases

### Phase 1: Public Web Search

Add a normalized search capability for public internet results.

Candidate provider:

- Brave Search

Output should be normalized and provider-agnostic:

- title
- url
- snippet
- rank

This is a generic capability that can later support research, navigation, and evidence gathering across multiple pages.

### Phase 2: Public Web Fetch

Add a normalized public fetch capability for a specific URL.

The platform performs the fetch server-side and extracts:

- canonical URL
- page title
- metadata
- visible text summary
- candidate image assets such as logos and icons
- linked stylesheet references if useful

This is read-only and bounded.

### Phase 3: Evidence Logging

Every external search/fetch operation should create an evidence record.

Captured metadata should include:

- actor user id
- route/page
- timestamp
- operation type
- query or URL
- normalized result summary
- status
- content hash or extraction hash where helpful

The goal is auditability and later review, not full archival of the public web.

### Phase 4: Branding Analysis

Build a specialized branding-analysis step on top of public fetch.

Expected structured output:

- company name candidate
- logo candidate URL
- primary and secondary color candidates
- optional font hints
- rationale / evidence summary
- confidence

This should be consumable by the branding configurator rather than remaining free-form chat text.

## Governance and Safety

### Platform as Intermediary

The platform is the conduit for public web access.

The model does not directly browse the internet. Instead:

1. the platform validates and fetches the target
2. the platform extracts normalized evidence
3. the model receives controlled data, not raw browsing autonomy

This is the correct architecture because it enables policy enforcement, logging, caching, and future governance.

### Untrusted Content

Fetched website content is always untrusted input data, never instructions.

The system must not treat site text as prompt authority. Prompt injection embedded in site content should be ignored by treating the fetched content as evidence only.

### Public Targets Only

MVP public fetch must allow only public `http` and `https` targets.

Block:

- localhost
- private IP ranges
- link-local addresses
- cloud metadata endpoints
- non-http protocols

This is necessary to prevent SSRF and internal-network access.

### Bounded Fetching

Keep the fetch constrained:

- one explicit user-provided URL at a time
- size/time limits
- limited asset extraction
- no recursive crawling in the first slice

### Sensitivity Interaction

Route sensitivity still matters. Restricted pages can expose the external-access pill, but only when the human explicitly enables it for the session.

This is different from provider sensitivity:

- the page may remain `restricted`
- the external fetch is still performed by the platform under explicit human control
- downstream model/provider usage should still respect the page's provider policy

## Architecture

### Session Access State

Add a session-scoped page-aware external access state, likely using a server-backed session key or a secure route-local session preference rather than a long-lived browser preference.

Required properties:

- `user`
- `route`
- `enabled`
- implicit expiry on session end

### Tooling Layer

Extend the existing agent tool/proposal system rather than creating a parallel execution path.

Relevant integration points:

- `apps/web/lib/mcp-tools.ts`
- `apps/web/lib/actions/agent-coworker.ts`
- `apps/web/lib/actions/proposals.ts`

Add read-only tools such as:

- `search_public_web`
- `fetch_public_web_page`
- later `analyze_public_website_branding`

The first two can be direct read capabilities. Branding analysis may either be:

- a specialized tool, or
- an orchestration step that calls fetch and then derives structured branding output

### Evidence Model

Add a new persistence model for external evidence rather than overloading generic message tables.

Suggested concepts:

- evidence record id
- operation type
- actor user id
- route context
- query/url
- extracted summary
- provider/source
- created timestamp
- optional content hash

The exact schema can stay modest in the first slice.

## Admin Branding Integration

The branding page currently has manual configuration fields but no form-assist registration and no website analysis workflow.

To support the target behavior:

- register the branding form for coworker assist
- add a public URL input for brand analysis if needed
- allow the coworker to populate form fields when both:
  - `External On` is enabled
  - `Hands On` is enabled

The human still performs the final save/apply action.

## Future Evolution

This design intentionally separates:

- public website read
- authenticated website read
- authenticated website action

Future authenticated access would require:

- credential vault / connection management
- session isolation
- approval flows
- stronger audit controls
- likely proposal-based execution for side effects

That should be treated as a later capability, not folded into the MVP public access slice.

## Testing Strategy

Focused testing for the MVP slice should cover:

- external access session toggle behavior
- search adapter normalization
- public fetch URL validation and SSRF blocking
- evidence logging on search/fetch
- branding extraction result normalization
- admin branding form assist population from extracted branding suggestions

## Recommended MVP Order

1. session-scoped external access pill
2. Brave Search integration
3. public web fetch adapter
4. evidence logging
5. branding analysis and admin form wiring
