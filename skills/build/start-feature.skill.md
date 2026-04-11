---
name: start-feature
description: "Start building a new feature"
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "conversation"
triggerPattern: "start|new feature|build"
userInvocable: true
agentInvocable: true
allowedTools: [update_feature_brief]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Start a New Feature

I want to build a new feature.

## Steps

1. Ask the user to describe the feature in one or two sentences.
2. Clarify the target audience and which route/page it belongs to.
3. Ask about key requirements: what data does it need, what actions does it enable?
4. Draft a feature brief and present it for review.
5. Use `update_feature_brief` to save the brief once the user approves.
6. Outline the next steps: ideate, plan, build, test, ship.

## Guidelines

- Keep the feature brief concise — problem, solution, scope, success criteria.
- Ask clarifying questions rather than making assumptions.
- If the feature overlaps with an existing one, point this out.
- The brief should be actionable enough for the build pipeline to work from.
