# Customer Marketing Coworker-Led UX Correction

| Field | Value |
| - | - |
| Date | 2026-04-25 |
| Status | Draft for review |
| Author | Codex + Mark Bodman |
| Scope | Correct the `/customer/marketing` interaction model so it is a safe, guided AI-coworker workspace instead of a dashboard that can accidentally send multiple prompts |

## 1. Problem Statement

The Phase 1 marketing workspace placed marketing under `/customer` and routed the Marketing Strategist correctly, but the first interactive pass exposed a design failure:

1. The page used large action cards that looked like informational cards but immediately sent messages to the AI Coworker.
2. A user could click around the page and unintentionally queue multiple coworker prompts.
3. The page still felt like a database summary in places, even after language improvements.
4. The interaction model did not make it clear what was information, what was selection, and what would start AI work.

This breaks the product direction already established for DPF:

- The page should orient the user.
- The AI Coworker should handle feedback, clarification, and strategy development.
- The coworker should reduce burden without taking surprising action.

The correction is not just a styling pass. It is a reusable AI-workspace pattern for specialist coworker surfaces.

## 2. Research and Benchmarking

### 2.1 Nielsen Norman Group Usability Heuristics

Source:

- [Nielsen Norman Group usability heuristics summary](https://media.nngroup.com/media/articles/attachments/Heuristic_Summary_A4_compressed.pdf)

Relevant lessons:

- The interface should speak the user's language, not internal system language.
- Users need control and a clearly marked way out when they act by mistake.
- Good design prevents problems before errors occur.
- Actions and options should be visible so users do not need to remember hidden behavior.
- Extra information competes with relevant information.

Adopted pattern:

- Make AI-starting actions visually and textually explicit.
- Do not make informational cards double as send buttons.
- Use marketer-facing labels such as "market", "buyer", "sales motion", "proof", and "campaign" instead of database labels such as `sourceSummary`, `localityModel`, or raw stale-area strings.

### 2.2 Microsoft HAX Guidelines

Source:

- [Microsoft HAX Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/)

Relevant lessons:

- Human-AI experiences need guidance at initial interaction, during interaction, when the AI is wrong, and over time.
- The guidelines are evidence-based and come from research synthesis across AI interaction design.
- AI experiences should be planned with explicit patterns rather than ad hoc prompt entry points.

Adopted pattern:

- Treat "start AI work" as an explicit state transition.
- Make the initial interaction explain what the coworker will do next.
- Give the user a chance to confirm the first prompt before the system sends it.

### 2.3 Google People + AI Guidebook

Sources:

- [People + AI Guidebook: Mental Models](https://pair.withgoogle.com/chapter/People%20%2B%20AI%20Guidebook%20-%20Mental%20Models.pdf)
- [People + AI Guidebook: Feedback + Control](https://pair.withgoogle.com/chapter/People%20%2B%20AI%20Guidebook%20-%20Feedback%20%2B%20Control.pdf)

Relevant lessons:

- AI features should set accurate expectations for what the AI can do.
- Conversation is useful when the interaction relies on human-like back-and-forth, but the system must not create overtrust.
- AI products must balance automation and user control.
- Users prefer control when they feel responsible for the outcome or when stakes are meaningful.

Adopted pattern:

- The Marketing Strategist should be presented as a guided specialist, not a magic autopilot.
- The page should cue the correct interaction: "start a guided review" rather than "click cards to send prompts".
- Campaign direction, audience choice, and proof selection are user-accountable decisions, so the AI should ask, draft, and recommend before acting.

### 2.4 GOV.UK Service Design Patterns

Sources:

- [GOV.UK start using a service pattern](https://design-system.service.gov.uk/patterns/start-using-a-service/)
- [GOV.UK question pages pattern](https://design-system.service.gov.uk/patterns/question-pages/)

Relevant lessons:

- A service start point should provide just enough information to understand the service and a clear action to begin.
- Complex eligibility or decision logic should happen inside the service, not on the start page.
- Question flows work best when they ask one question at a time.
- Users should not be asked to re-enter information already known.

Adopted pattern:

- `/customer/marketing` should be a service start point for marketing work.
- The first screen should not expose every detail or action.
- The coworker should ask one focused question at a time and reuse existing strategy/business context.

### 2.5 Atlassian Rovo AI Patterns

Sources:

- [Atlassian Design: Rovo AI patterns](https://atlassian.design/patterns/rovo-ai)
- [Atlassian AI transparency notes](https://www.atlassian.com/trust/ai/transparency)

Relevant lessons:

- AI experiences should be clearly identified to build trust and transparency.
- AI actions should support the user's task or need.
- AI prompts can appear inline when the user is creating or editing content.
- Chat message cards can summarize information, confirm actions, and link to content.
- AI responses are probabilistic, so transparency and review matter.

Adopted pattern:

- Use AI nudges as suggestions, not automatic sends.
- Confirm AI actions in chat with structured cards.
- Keep AI actions tied to a concrete marketing task.

### 2.6 Salesforce Einstein Copilot / Human-in-the-Loop

Sources:

- [Salesforce Einstein Copilot announcement](https://www.salesforce.com/news/press-releases/2024/02/27/einstein-copilot-news/)
- [Salesforce: Keeping a Human in the Loop of AI Builds Trust](https://www.salesforce.com/blog/ai-and-human-touch/)

Relevant lessons:

- CRM copilots work best when grounded in company data and embedded in the user's workflow.
- Human-in-the-loop design gives people a chance to review and act on AI-generated content.
- AI should make teams more efficient without removing the human relationship or judgment.

Adopted pattern:

- Ground the Marketing Strategist in DPF's organization, storefront, strategy, and CRM data.
- Keep campaign and publishing steps reviewable.
- Use AI to prepare and structure marketing work, not to silently publish or decide.

## 3. Design Principles for DPF AI Workspaces

### 3.1 Page Orientates, Coworker Interacts

The page should tell the user where they are, what the specialist can help with, and what is currently known. The coworker owns questions, feedback, recommendations, and draft work.

### 3.2 No Surprise Sends

No click on a page card, tile, tab, or summary panel should immediately send a message to the coworker unless the control is explicitly labeled as a send/start action.

### 3.3 One Clear Primary Start

Each specialist workspace should have one obvious primary action. For marketing, that action is:

```text
Start marketing review
```

Secondary options can shape the starting topic, but they should not send separate prompts by themselves.

### 3.4 Preview Before Prompt

When a page action will send a prompt, show a prompt preview or confirmation state first. The user should know:

- which coworker will receive it
- what context will be used
- what the coworker will do next
- whether anything external will happen

### 3.5 One Question at a Time

The Marketing Strategist should start a guided review by asking one useful question at a time. The first question should depend on current gaps:

- missing market scope
- missing buyer segment
- missing proof
- missing channel focus
- overdue strategy review

### 3.6 AI Output Becomes Work Product

The coworker should not just chat. Its useful outputs should become structured work products:

- strategy review note
- campaign brief
- proof asset task
- content brief
- automation candidate
- backlog item or approval proposal when appropriate

### 3.7 Human Judgment Stays Explicit

Campaigns, public messages, customer-facing content, and automations must remain reviewable. The Marketing Strategist may draft, organize, and recommend; it must not silently publish.

### 3.8 Page Body Has a Job

The main page body should not become the chat conversation. It has different jobs at different route levels:

- **Higher-level overview pages** summarize the area, show current state, expose key signals, and help the user decide where to go next.
- **Detail/configuration pages** show the editable facts, settings, and records that define the area.
- **Coworker launch surfaces** start guided specialist work from either an overview or detail page, but only after explicit user confirmation.

For marketing, this means `/customer/marketing` is primarily an overview and orientation page. `/customer/marketing/strategy` is where the user should inspect and eventually change strategy details. The Marketing Strategist is available from both, but the body should not be replaced by a pile of prompts or chat messages.

## 4. Proposed UX Pattern: AI Work Launcher

### 4.1 Pattern Summary

An AI Work Launcher is a reusable component for DPF specialist pages.

It has four states:

1. **Orientation**: explain the specialist's job in one short paragraph.
2. **Topic selection**: user selects the work area, such as strategy, campaign, proof, funnel, or automation.
3. **Prompt preview**: system shows the draft prompt, expected next step, and context used.
4. **Confirmed start**: user clicks `Start with Marketing Strategist`; only then does the coworker panel open and send the prompt.

### 4.2 Why This Beats Action Cards

Action cards are too ambiguous in an AI workspace. They can look like dashboard cards, navigation cards, or commands. When they send prompts immediately, exploratory clicking becomes accidental automation.

The AI Work Launcher makes the state transition explicit:

```text
I am reading -> I am choosing -> I am confirming -> AI is working
```

### 4.3 Reusable Component Contract

Suggested component name:

```text
AgentWorkLauncher
```

Suggested props:

```ts
type AgentWorkLauncherProps = {
  agentName: string;
  routeContext: string;
  primaryActionLabel: string;
  topics: Array<{
    id: string;
    label: string;
    description: string;
    prompt: string;
    contextSummary: string;
    expectedNextStep: string;
  }>;
};
```

Behavior:

- topic click selects only
- selected topic displays a preview panel
- `Start with [Agent]` dispatches `open-agent-panel`
- send occurs only after explicit confirmation
- `Cancel` clears selection and does not touch the coworker

## 5. Marketing Page Correction

### 5.1 Landing Page Shape

`/customer/marketing` should contain:

1. Compact title and orientation.
2. One primary `Start marketing review` button.
3. Optional topic selector:
   - `Strategy`
   - `Campaign ideas`
   - `Proof of expertise`
   - `Funnel diagnosis`
   - `Automation opportunities`
4. A prompt preview panel after topic selection.
5. A small "current working context" summary.

The current working context should use marketing language:

- Market
- Buyer
- Sales motion
- Channels
- Proof
- Next check-in

It should not lead with data model labels or raw stale-area strings.

This page is not where detailed strategy editing happens. It should show enough context to orient the user and help them choose the next marketing activity. Detailed configuration belongs in sub-routes such as `/customer/marketing/strategy`, and future campaign, funnel, and automation detail routes.

### 5.2 First Interaction

Default first prompt:

```text
Run a marketing review for this business. Use the current business, storefront, customer, and strategy context. Start by telling me what you think the first marketing decision should be, then ask me one focused question before recommending campaigns.
```

The coworker should not receive three prompts at once. The first review should start a guided thread.

### 5.3 Empty or Weak Context

If key context is missing, the page should not display alarming internal labels. It should say:

```text
The strategist needs one decision before campaigns will be useful.
```

Then show the next decision in human language:

- "Where should we try to win customers first?"
- "Which buyer group should we pursue first?"
- "What proof can we use to make the offer credible?"

### 5.4 Strategy Detail Page Shape

`/customer/marketing/strategy` should be a detail and configuration page, not another overview.

It should:

- show current strategy facts in editable or reviewable sections
- make ownership and review state clear
- let the user inspect or change market, buyer, sales motion, channels, proof, constraints, and review rhythm
- offer a coworker launcher for strategy review or assisted editing
- avoid sending prompts when the user clicks into fields, sections, or cards

Future detail pages should follow the same split:

- `/customer/marketing/campaigns` for campaign records, planning, approvals, and changes
- `/customer/marketing/funnel` for analysis and filters
- `/customer/marketing/automation` for automation state, integration readiness, and reviewable activation

The coworker assists these pages; it does not replace their ability to inspect and configure details.

## 6. Interaction Rules

### 6.1 Allowed Without Confirmation

- Selecting a topic
- Expanding context details
- Opening the coworker panel without sending text
- Viewing prompt preview
- Navigating to strategy details
- Editing local form fields before save/submit
- Opening a configuration section
- Reading or filtering page data

### 6.2 Requires Confirmation

- Sending a prompt to the coworker
- Starting a guided review
- Asking the coworker to draft campaign copy
- Asking the coworker to create a backlog item, proposal, or other persisted work product
- Saving strategy, campaign, funnel, or automation configuration changes

### 6.3 Requires Later Explicit Approval

- Publishing or sending external marketing content
- Scheduling external posts or email campaigns
- Changing customer-facing public content
- Starting automations that message customers or prospects

## 7. Alternative Approaches Considered

### Option A: Keep Cards, Add Confirmation

Tradeoff:

- Smallest change.
- Still visually ambiguous because cards remain command-like.

Rejected as the long-term pattern. Acceptable only as a short emergency patch.

### Option B: Convert Cards to Links Into Skills

Tradeoff:

- Makes each marketing skill more discoverable.
- Still fragments the first experience across too many choices.

Rejected for the landing page. Better for the skill menu or a later specialist library.

### Option C: AI Work Launcher

Tradeoff:

- Slightly more implementation work.
- Establishes a reusable pattern across DPF.
- Best fit for safety, clarity, and specialist-led work.

Recommended.

## 8. Acceptance Criteria

### UX

- The marketing page has one clear primary start action.
- The marketing overview body summarizes state and next direction; it does not pretend to be the conversation.
- Strategy and future child routes are responsible for detailed configuration and changes.
- Clicking informational areas never sends a prompt.
- Selecting a topic shows a preview, expected next step, and context summary.
- Prompt send requires explicit confirmation.
- The coworker starts by asking one focused question, not by dumping a long plan.
- The page uses marketing language, not schema language.

### Technical

- Add tests proving topic selection does not call `/api/agent/send`.
- Add tests proving confirmation dispatches `open-agent-panel` with one prompt.
- Add Playwright QA for accidental clicks on the marketing page.
- Existing route ownership remains unchanged: `/customer/marketing` resolves to `marketing-specialist`.
- Existing permission gates remain unchanged.

### Content

- Remove raw stale-area strings from the top-level UX.
- Avoid "AI Coworker" as the main CTA label; name the specialist.
- Use "Marketing Strategist" consistently on internal marketing pages.
- Use "review", "brief", "campaign", "proof", "audience", "market", and "sales motion" as the primary vocabulary.

## 9. Implementation Guidance

1. Replace `MarketingCoworkerActions` with `AgentWorkLauncher` or a marketing-specific wrapper around it.
2. Change the current cards from send buttons into selectable topics.
3. Add a prompt preview panel with `Start with Marketing Strategist` and `Cancel`.
4. Dispatch `open-agent-panel` only from the confirm button.
5. Consider adding an `openOnly` event option to `AgentCoworkerShell` so pages can open the coworker without sending a message.
6. Add an explicit visual distinction between:
   - data/context
   - selectable topic
   - confirmed AI action
7. Keep `/customer/marketing` focused on overview and routing to the next useful work.
8. Move detailed strategy inspection and future edits to `/customer/marketing/strategy`.
9. Keep the hotfix isolated to `/customer/marketing` first, then generalize the launcher once the pattern feels right.

## 10. Follow-On Design Work

This spec corrects the internal marketing workspace. A separate spec is still needed for the future customer-facing AI coworker, including:

- GAID trust badging
- approved public context only
- product/service Q&A boundaries
- human escalation
- no access to raw internal strategy or draft campaigns

## 11. Recommended Next Step

Implement Option C for `/customer/marketing` as the next patch, with a narrow scope:

1. Replace auto-send action cards.
2. Add topic selection and prompt preview.
3. Send exactly one prompt only after explicit confirmation.
4. Preserve the overview/detail split: overview summarizes, strategy detail configures.
5. Verify via tests and browser QA that accidental clicking cannot spam the coworker.
