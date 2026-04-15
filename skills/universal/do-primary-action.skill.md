---
name: do-primary-action
description: "Perform the primary action on this page -- fill forms, create entries, or summarize what needs attention"
category: universal
assignTo: ["*"]
capability: null
taskType: conversation
triggerPattern: "do it|do this|just do it|primary action|handle this|take action"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Do This For Me

Determine the primary action for the current page and execute the safest well-supported action using available tools.

## What This Skill Does

Looks at the page context, infers what a human would most likely do next, and does it when that action is well-supported. This is an action-oriented skill, but not a guessing license.

## Instructions

1. **Identify the page type** from your PAGE DATA context:
   - **Form page** -- Fill fields with sensible defaults and submit. Use domain knowledge to pick reasonable values (e.g., status: "open", type based on context, descriptive titles).
   - **List/table page** -- Create a new entry if the list is sparse, or summarize what needs attention if populated.
   - **Dashboard page** -- Summarize the current state and highlight the top 1-2 items needing action.
   - **Detail page** -- Check for incomplete fields and offer to fill them, or summarize the item's status.
   - **Settings page** -- Review current settings and flag anything that looks misconfigured.

2. **Act using your tools.** Call the appropriate MCP tools to create items, update records, or navigate. Do not ask for confirmation unless the action is destructive (deleting data, changing permissions) or the context is too ambiguous to act correctly.

3. **Report what you did** in 1-2 sentences after completing the action.

## Guidelines

- Bias toward action, but keep integrity first. If you can reasonably infer what to do, do it. If ambiguity would materially change the outcome, ask one short clarifying question instead of forcing an answer.
- Use sensible defaults that follow project conventions (see CLAUDE.md for canonical enum values).
- For forms: fill ALL required fields. Leave optional fields empty only if you have no reasonable value.
- For lists: prefer creating one well-formed entry over multiple placeholder entries.
- If the page context is ambiguous and multiple actions are equally valid, pick the most common one and mention what else you could have done.
- Never perform destructive actions (delete, reset, clear) without explicit user confirmation.
- Never optimize for a proxy pass signal alone. Preserve the user's actual intent rather than taking brittle shortcuts.

## Examples

**Backlog list page:** Create a new backlog item with type "product", status "open", and a title derived from the current workspace context.

**Epic detail page with empty description:** Fill in the description based on the epic title and existing backlog items, then confirm what was written.

**Dashboard with stale items:** "You have 3 items stuck in 'in-progress' for over a week. The highest priority is 'API Authentication' -- want me to check its build status?"
