---
title: "AI Coworker"
area: getting-started
order: 3
---

## The Short Version

DPF coworkers are purposed helpers, not a generic chatbot. The coworker on a page understands the page, the selected business archetype, the user's role, and the tools that coworker is allowed to propose.

The standing COO may have an owner-chosen conversational name, shown as **Name · AI COO**. This is presentation only: the canonical coworker remains COO, and identity, permissions, authority, audit attribution, and the owner's accountability do not change. Authorized users can change or clear the name from the COO record in **AI Workforce**.

For the broader product framing, see [Market Archetypes And Coworkers](../market-archetypes.md).

## How It Works

The AI coworker is available on every page via the floating button in the bottom-right corner. It understands:

- **What page you're on** — it knows the domain context (compliance, HR, operations, etc.)
- **What business archetype is active** — customer-facing and internal language should follow the selected archetype where that surface has been configured
- **What data is visible** — it can read the current page's content
- **What actions are available** — it has tools specific to the current area

## Quick Actions

Each page has skill buttons that trigger common tasks. These appear at the top of the coworker panel when you open it. Examples:

- On the **Compliance** page: "Gap assessment", "Posture report", "Onboard a regulation"
- On the **Operations** page: "Create item", "Epic progress"
- On the **Portfolio** page: "Health summary", "Register a product"

## Universal Skills

Four skills appear on every page:

- **Analyze this page** — Get insights about what's on screen
- **Do this for me** — Perform the primary action for this page
- **Add a skill** — Extend the page with a new quick action
- **Evaluate this page** — Check the page for usability and accessibility issues

## Voice

Where enabled, the microphone path sends dictated text into the same coworker message flow as typing. Voice does not bypass permissions or approvals.

Narrated output is separate. Text-to-speech can read decision rationales or persona-profile output when a voice profile is configured, but text remains the primary governed answer. A real-person voice requires explicit consent before training.

## Authority & Approvals

The coworker operates within a two-layer authorization model:

- **Your role determines what's possible** — your platform role (e.g., Portfolio Manager, Enterprise Architect) controls which capabilities are available
- **The agent's grants determine what's offered** — each agent persona has declared tool grants that scope what it can do. The coworker on the Ops page (Scrum Master) has different grants than the one on the Portfolio page (Portfolio Analyst)
- **Side-effect actions require approval** — when the coworker wants to create, update, or delete something, it proposes the action and waits for your approval before executing
- **Every action is recorded** — all tool calls (not just proposals) are logged with your identity and the agent's identity for audit purposes. View the log at `/platform/ai/authority`

## WWMD And Autonomy

When a coworker hits an ambiguous decision, it should not guess from chat context alone. WWMD is the decision gate that lets the coworker consult the founder-kernel wiki and score options against platform principles.

The gate can return four outcomes:

- **Recommend** — enough evidence exists to advise a path, but the user or workflow still owns approval
- **Arbitrate** — a low-risk decision has enough confidence for the coworker to continue under policy
- **Escalate** — risk, conflict, low confidence, or a policy boundary needs a human resolver
- **Defer** — the wiki does not yet contain enough guidance, so the gap should be captured instead of guessed

This is a critical step toward trustworthy autonomy: every answer keeps sources, confidence, rationale, and decision history attached. For the technical details, see [Autonomy, WWMD, and trusted coworker decisions](../../architecture/autonomy-and-wwmd.md).

## Tool Evaluation

When you need to add an external tool (MCP server, npm package, API), the coworker can help evaluate it. On the Platform page, use the "Evaluate tool" skill to initiate a multi-agent review covering security, architecture fit, compliance, and integration testing.

## Tips

- Be specific. "Show me overdue compliance actions" works better than "what's wrong?"
- The coworker can create backlog items, register products, assign roles, and more — it's not just a chatbot
- If the coworker proposes an action (like creating a record), you'll see an approval prompt before anything changes
- Each conversation is tied to the page context. If you switch pages, the coworker knows the new context
- Ask in the words of your business. "Which trucks need restock?" or "Which appointments are missing forms?" is better than guessing the platform's internal module name.
