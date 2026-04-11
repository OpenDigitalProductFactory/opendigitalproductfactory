---
name: report-issue
description: "Report a bug, usability problem, or provide feedback about the current page"
category: universal
assignTo: ["*"]
capability: null
taskType: conversation
triggerPattern: "report|bug|issue|feedback|broken|problem|not working|wrong"
userInvocable: true
agentInvocable: false
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Report an Issue

Collect a structured bug report or feedback from the user about the current page.

## What This Skill Does

Guides the user through reporting an issue by gathering the right details, then creates a trackable backlog item.

## Instructions

1. **Acknowledge the report.** If the user already described the issue, skip to step 3.

2. **Ask what happened.** Use one open question:
   - "What went wrong, or what could be better?"

3. **Clarify if needed.** Only ask one follow-up if the report is ambiguous:
   - "Does this happen every time, or just sometimes?"
   - "What did you expect to happen instead?"

4. **Capture context automatically** from PAGE DATA:
   - Current route/page
   - Any visible error messages or empty states
   - User workspace or project context

5. **Classify the issue:**
   - **Bug**: Something is broken or behaves incorrectly
   - **UX feedback**: Works but confusing or could be better
   - **Feature request**: User wants something that does not exist

6. **Create a backlog item** with:
   - Title: Clear, specific summary
   - Description: What the user reported plus auto-captured context
   - Type: "product"
   - Status: "open"

7. **Confirm** that the issue was recorded with the item title.

## Guidelines

- Never make the user repeat information they already provided.
- Keep the conversation to 2-3 exchanges maximum.
- Do not ask the user to reproduce, provide screenshots, or check console.
- Use the user's own words in the backlog item title.
- If the user is frustrated, acknowledge briefly and move to resolution.
