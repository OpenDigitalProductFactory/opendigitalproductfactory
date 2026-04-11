---
name: analyze-page
description: "Analyze the current page and surface key insights, actionable items, or missing elements the user might overlook"
category: universal
assignTo: ["*"]
capability: null
taskType: conversation
triggerPattern: "analyze|insights|what's here|summarize page|what am I looking at"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Analyze This Page

Examine the current page context and deliver concise, actionable insights without calling any tools.

## What This Skill Does

Reads the PAGE DATA section already present in the agent's context and produces a short assessment of what matters most on the current page. This is a pure conversation skill -- no tool calls, no side effects.

## Instructions

1. **Read the PAGE DATA section** in your current context. This contains the route, page title, visible data, and any relevant state.

2. **Identify what matters.** Look for:
   - Data that stands out (outliers, empty fields, stale dates, unusual counts)
   - Actionable items the user should address (pending approvals, incomplete records, items at risk)
   - Missing elements that a well-maintained page would normally have
   - Patterns or trends visible in the data

3. **Deliver 2-3 sentences of insight.** Be specific -- reference actual values, names, or counts from the page data. Do not be generic.

4. **If nothing notable**, respond with "Looks good!" and optionally mention one positive observation.

## Guidelines

- Do NOT call any tools. This skill uses only the context you already have.
- Do NOT describe the page layout or restate what the user can already see. Focus on non-obvious observations.
- Be direct. Start with the most important finding, not a preamble.
- If the page has a list or table, comment on distribution, completeness, or outliers rather than listing items back.
- Tailor your language to the page type: dashboards get metric-focused analysis, forms get completeness checks, lists get coverage assessments.

## Examples

**Dashboard page:** "3 of your 5 epics have been in-progress for over 2 weeks with no recent activity -- they may be stalled. The 'Storefront' epic has 12 open items, which is double the next largest."

**Empty list page:** "No items here yet. This is the backlog for the Portfolio workspace -- you'll want to create at least one epic before starting a build cycle."

**Form page:** "The description field is empty and the priority is set to the default. Both are worth filling in before saving -- downstream agents use these for prioritization."
