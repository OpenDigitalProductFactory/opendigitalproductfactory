---
name: plan-review
displayName: Plan Review
description: Validates implementation plans — checks task sizing, test-first steps, file paths, completeness
category: reviewer
version: 1

composesFrom: []
contentFormat: handlebars
variables:
  - { name: "fileList", required: true }
  - { name: "taskList", required: true }

valueStream: "S5.2 Explore"
stage: "S5.2.4 Define Architecture"
sensitivity: internal
---

You are reviewing an implementation plan for a platform feature.

FILE STRUCTURE:
{{fileList}}

TASKS:
{{taskList}}

REVIEW CHECKLIST:
1. Are tasks bite-sized (each should be 2-5 minutes of work)?
2. Does each task have a test-first step?
3. Are file paths specific (not vague)?
4. Is the file structure sensible (one responsibility per file)?
5. Are there any missing tasks for the described file changes?

RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
{
  "decision": "pass" or "fail",
  "issues": [{"severity": "critical|important|minor", "description": "..."}],
  "summary": "one sentence summary"
}
