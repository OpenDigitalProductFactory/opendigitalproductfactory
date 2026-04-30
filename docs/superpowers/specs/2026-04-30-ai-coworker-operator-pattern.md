# AI Coworker Operator Pattern

| Field | Value |
| - | - |
| Status | Draft |
| Date | 2026-04-30 |
| First exemplar | Marketing Strategist |
| Scope | Define the repeatable pattern for turning AI coworkers from chat responders into governed operators with skills, tools, persistent work products, and failure reporting |

## 1. Problem

Several coworkers can answer questions, but they do not consistently turn useful work into durable platform state. The Marketing Strategist exposed the failure mode clearly:

- it repeated the same diagnosis after short confirmations such as `ok`
- it treated recommendations as chat output instead of saved work product
- it could say a tool was unavailable without recording an internal issue
- it had tools, but not a prescribed lifecycle for using them

This is not only a Marketing issue. Every coworker that gives operational recommendations needs the same architectural contract.

## 2. Research And Benchmarking

Current agent and marketing platforms point to the same operating model:

- OpenAI Skills define reusable workflows with instructions, resources, examples, tool/app access, required output format, and checks before finalizing.
- Agent Skills standardizes the same pattern as a portable `SKILL.md` package with optional scripts, references, templates, and assets.
- Anthropic Skills uses automatic skill activation so a model follows a team workflow without the user re-explaining the process every time.
- HubSpot Breeze Agents frames agents as specialized teammates that run full go-to-market workflows while keeping the operator in control through guardrails, approvals, and visibility.
- Salesforce Agentforce Marketing treats marketing agents as workflow operators that create briefs, segments, content, journeys, summaries, and optimization actions with marketer approval for higher-risk execution.

Patterns adopted:

- skills are repeatable workflows, not labels
- tools must be paired with prescribed behavior
- useful AI output becomes durable work product
- short confirmations advance active work, they do not restart discovery
- external publication, sending, scheduling, or customer-visible action requires explicit approval
- failed tool execution is itself an operational issue that must be logged

Patterns rejected:

- chat-only recommendations
- one large generic coworker prompt for all domains
- granting tools without a role-specific lifecycle
- silent fallback when a tool is missing or denied
- repeated diagnosis when no data changed

## 3. Core Pattern

Each AI coworker with operational responsibility gets five coordinated pieces.

### 3.1 Operator Contract

The system prompt must define:

- the coworker's domain perspective
- what counts as concrete work product
- when short confirmations mean continue
- what must be saved before final response
- what requires human approval
- how tool failures are reported
- when not to repeat prior diagnosis

### 3.2 Skill Playbooks

Skills belong to coworkers, not pages. Each skill should represent one repeatable workflow, for example:

- diagnose current state
- draft a brief
- produce a task list
- create an approval proposal
- review execution evidence
- update a KPI baseline

Each skill should name required inputs, steps, tools, output format, and final checks.

### 3.3 Tool Surface

Tools must cover the coworker's actual lifecycle:

- read context
- create or update internal work product
- create tasks or follow-ups
- request approval for risky actions
- record execution evidence
- log operational issues

A coworker should never be expected to behave operationally with read-only advisory tools.

### 3.4 Persistent Work Products

Every coworker needs a small set of canonical artifacts. For Marketing Strategist, the first set is:

- `MarketingReview`
- `MarketingStrategy`
- campaign brief
- proof/content asset task
- KPI baseline or checkpoint
- automation candidate
- tool or execution issue report

Other coworkers should define equivalent artifacts in their own domain before tool implementation.

### 3.5 UI Surface

The page should show:

- current recommendation or active work session
- saved work products
- pending drafts
- pending approvals
- execution evidence
- tool or process issues needing attention

The user should be able to answer `ok` in chat and also see what changed on the page.

## 4. Marketing Strategist Exemplar

Marketing Strategist is the first implementation target.

Required behavior:

- On a concrete strategy, channel, cadence, KPI, or campaign recommendation, call `save_marketing_review` before final response.
- On `ok`, `yes`, `continue`, `next`, or similar, advance the active marketing plan instead of restarting diagnosis.
- Do not repeat the same baseline diagnosis unless the data changed or the user asks for a recap.
- If a tool fails, say what failed, what was being saved or executed, and log the issue.
- Never publish, send, schedule, or externally change marketing without explicit approval.

First slice implemented by this spec:

- route prompt now includes an `ACTIVE MARKETING WORK` operator contract
- routed persona grant lookup resolves `marketing-specialist` as well as `AGT-WS-MARKETING`
- tests pin both behaviors
- marketing work-product tools create campaign briefs, asset tasks, KPI checkpoints, and automation candidates
- `/customer/marketing` surfaces saved strategist work products next to strategy context

## 5. Rollout Pattern For Other Coworkers

Use this sequence for each coworker:

1. Identify the coworker's operational decisions and concrete work products.
2. Audit existing skills, route prompts, tools, grants, and page surfaces.
3. Add tests for the missing operator contract and tool/grant availability.
4. Update the prompt and skill playbooks.
5. Add or extend tools only where a work product or approval path is missing.
6. Surface the active work and saved artifacts in the UI.
7. Add execution evidence and issue logging.
8. Run unit tests, typecheck, production build, and route-specific UX verification.

Do not skip from step 2 to tool creation. A coworker with tools but no lifecycle will still behave like a chat responder.

## 6. Acceptance Criteria

- A coworker can explain what work product it is creating before it creates it.
- Concrete recommendations are persisted or explicitly reported as not persisted.
- Short confirmations continue the active workflow.
- Repeated tool calls with identical arguments become a logged process issue.
- Tool access is resolved through the routed persona slug and canonical registry ID.
- UI shows the result of the coworker's work, not only the chat transcript.
- External actions are approval-gated.

## 7. Open Follow-Up

Marketing still needs deeper execution slices: approval workflow integration for automation candidates, campaign status transitions, richer funnel attribution, and route-level UX verification for a full `ok -> saved brief/task` coworker conversation.
